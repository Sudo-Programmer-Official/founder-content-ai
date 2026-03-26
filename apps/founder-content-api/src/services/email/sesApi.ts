import crypto from "node:crypto";
import { HttpError } from "../../utils/http.ts";

interface SesCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface SesErrorPayload {
  message?: string;
  Message?: string;
  Code?: string;
  __type?: string;
}

export class SesApiError extends Error {
  readonly statusCode: number;
  readonly type: string | null;

  constructor(input: {
    message: string;
    statusCode: number;
    type?: string | null;
  }) {
    super(input.message);
    this.name = "SesApiError";
    this.statusCode = input.statusCode;
    this.type = input.type ?? null;
  }
}

export function resolveAwsRegion(): string {
  return process.env.AWS_REGION?.trim() || "us-east-1";
}

export function resolveSesCredentials(): SesCredentials | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN?.trim() || undefined,
  };
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function toDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function signAwsV4(input: {
  region: string;
  service: string;
  method: string;
  host: string;
  path: string;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  now: Date;
}): Record<string, string> {
  const amzDate = toAmzDate(input.now);
  const dateStamp = toDateStamp(input.now);
  const payloadHash = sha256Hex(input.body);
  const canonicalHeaders = [
    "content-type:application/json",
    `host:${input.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    ...(input.sessionToken ? [`x-amz-security-token:${input.sessionToken}`] : []),
  ].join("\n");
  const signedHeaders = [
    "content-type",
    "host",
    "x-amz-content-sha256",
    "x-amz-date",
    ...(input.sessionToken ? ["x-amz-security-token"] : []),
  ].join(";");
  const canonicalRequest = [
    input.method,
    input.path,
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), input.service),
    "aws4_request",
  );
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    "content-type": "application/json",
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(input.sessionToken ? { "x-amz-security-token": input.sessionToken } : {}),
    Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function normalizeSesErrorType(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const withoutNamespace = trimmed.includes("#") ? (trimmed.split("#").pop() ?? trimmed) : trimmed;
  const normalized = withoutNamespace.split(":")[0]?.trim();
  return normalized || null;
}

function resolveSesErrorType(
  response: Response,
  payload: SesErrorPayload | null,
): string | null {
  return (
    normalizeSesErrorType(response.headers.get("x-amzn-errortype")) ??
    normalizeSesErrorType(payload?.Code) ??
    normalizeSesErrorType(payload?.__type)
  );
}

function resolveSesErrorMessage(payload: SesErrorPayload | null, fallback: string): string {
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message;
  }

  if (typeof payload?.Message === "string" && payload.Message.trim()) {
    return payload.Message;
  }

  return fallback;
}

export async function sendSesJsonRequest<TResponse>(input: {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}): Promise<TResponse> {
  const credentials = resolveSesCredentials();

  if (!credentials) {
    throw new HttpError(500, "ses_credentials_missing", "SES credentials are not configured.");
  }

  const region = resolveAwsRegion();
  const host = `email.${region}.amazonaws.com`;
  const body = input.body ? JSON.stringify(input.body) : "";
  const now = new Date();
  const response = await fetch(`https://${host}${input.path}`, {
    method: input.method,
    headers: {
      host,
      ...signAwsV4({
        region,
        service: "ses",
        method: input.method,
        host,
        path: input.path,
        body,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        now,
      }),
    },
    body: input.method === "GET" ? undefined : body,
  });

  const rawText = await response.text();
  let payload: TResponse | SesErrorPayload | null = null;

  try {
    payload = rawText ? (JSON.parse(rawText) as TResponse | SesErrorPayload) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new SesApiError({
      statusCode: response.status,
      type: resolveSesErrorType(response, payload as SesErrorPayload | null),
      message: resolveSesErrorMessage(payload as SesErrorPayload | null, "SES request failed."),
    });
  }

  return (payload ?? {}) as TResponse;
}
