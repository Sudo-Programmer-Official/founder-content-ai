import crypto from "node:crypto";
import { HttpError } from "../../utils/http.ts";
import { logInfo, logWarn } from "../../utils/logger.ts";

interface SendPlatformEmailInput {
  fromEmail: string;
  fromName?: string;
  replyToEmail?: string;
  toEmail: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  tags?: Record<string, string>;
}

export interface SentPlatformEmailResult {
  messageId: string;
  provider: "ses" | "log";
  sentAt: string;
}

function resolveAwsRegion(): string {
  return process.env.AWS_REGION?.trim() || "us-east-1";
}

function resolveSesCredentials(): {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
} | null {
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

function shouldUseLogTransport(): boolean {
  return !resolveSesCredentials() || !process.env.SYSTEM_FROM_EMAIL?.trim();
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
    `content-type:application/json`,
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

function formatFromAddress(fromEmail: string, fromName?: string): string {
  if (!fromName) {
    return fromEmail;
  }

  const sanitizedName = fromName.replace(/"/g, "").trim();
  return sanitizedName === "" ? fromEmail : `"${sanitizedName}" <${fromEmail}>`;
}

export async function sendPlatformEmail(
  input: SendPlatformEmailInput,
): Promise<SentPlatformEmailResult> {
  const now = new Date();

  if (shouldUseLogTransport()) {
    const messageId = `log-${crypto.randomUUID()}`;
    logWarn("SES credentials not configured. Logged email instead of sending.", {
      toEmail: input.toEmail,
      subject: input.subject,
      messageId,
    });
    return {
      messageId,
      provider: "log",
      sentAt: now.toISOString(),
    };
  }

  const credentials = resolveSesCredentials();

  if (!credentials) {
    throw new HttpError(500, "ses_credentials_missing", "SES credentials are not configured.");
  }

  const region = resolveAwsRegion();
  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const body = JSON.stringify({
    FromEmailAddress: formatFromAddress(input.fromEmail, input.fromName),
    Destination: {
      ToAddresses: [input.toEmail],
    },
    ReplyToAddresses: input.replyToEmail ? [input.replyToEmail] : undefined,
    ConfigurationSetName: process.env.SES_CONFIGURATION_SET?.trim() || undefined,
    Content: {
      Simple: {
        Subject: {
          Data: input.subject,
        },
        Body: {
          Html: {
            Data: input.htmlBody,
          },
          Text: {
            Data: input.textBody,
          },
        },
      },
    },
    EmailTags: Object.entries(input.tags ?? {}).map(([name, value]) => ({
      Name: name,
      Value: value,
    })),
  });

  const response = await fetch(`https://${host}${path}`, {
    method: "POST",
    headers: {
      host,
      ...signAwsV4({
        region,
        service: "ses",
        method: "POST",
        host,
        path,
        body,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
        now,
      }),
    },
    body,
  });

  const rawText = await response.text();
  let payload: Record<string, unknown> | null = null;

  try {
    payload = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new HttpError(
      502,
      "email_send_failed",
      payload && typeof payload.message === "string"
        ? payload.message
        : "SES rejected the email send request.",
    );
  }

  const messageId = typeof payload?.MessageId === "string" ? payload.MessageId : crypto.randomUUID();
  logInfo("Sent email via SES.", {
    toEmail: input.toEmail,
    messageId,
  });

  return {
    messageId,
    provider: "ses",
    sentAt: now.toISOString(),
  };
}
