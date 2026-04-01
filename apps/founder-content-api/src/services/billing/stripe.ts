import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "../../utils/http.ts";

interface StripeApiErrorResponse {
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
}

export interface StripeCheckoutSession {
  id: string;
  url?: string | null;
  customer?: string | null;
  subscription?: string | null;
  metadata?: Record<string, string>;
}

export interface StripeSubscription {
  id: string;
  customer?: string | null;
  status: string;
  cancel_at_period_end?: boolean;
  current_period_start?: number | null;
  current_period_end?: number | null;
  metadata?: Record<string, string>;
  items?: {
    data?: Array<{
      price?: {
        id?: string | null;
      } | null;
    }>;
  };
}

export interface StripeEvent<TObject = unknown> {
  id: string;
  type: string;
  data: {
    object: TObject;
  };
}

const STRIPE_API_BASE_URL = "https://api.stripe.com/v1";

function resolveStripeSecretKey(): string {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new HttpError(
      500,
      "stripe_not_configured",
      "Stripe billing is not configured yet.",
    );
  }

  return secretKey;
}

function resolveStripeWebhookSecret(): string {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!webhookSecret) {
    throw new HttpError(
      500,
      "stripe_webhook_not_configured",
      "Stripe webhook verification is not configured yet.",
    );
  }

  return webhookSecret;
}

function buildAuthorizationHeader(): string {
  return `Bearer ${resolveStripeSecretKey()}`;
}

function buildStripeRequestBody(input?: Record<string, string | number | boolean | null | undefined>): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined || value === null) {
      continue;
    }

    params.append(key, String(value));
  }

  return params.toString();
}

export async function stripeApiRequest<TResponse>(
  path: string,
  options?: {
    method?: "GET" | "POST";
    body?: Record<string, string | number | boolean | null | undefined>;
  },
): Promise<TResponse> {
  const method = options?.method ?? "POST";
  const requestUrl = `${STRIPE_API_BASE_URL}${path}`;
  const response = await fetch(requestUrl, {
    method,
    headers: {
      Authorization: buildAuthorizationHeader(),
      ...(method === "POST"
        ? {
            "Content-Type": "application/x-www-form-urlencoded",
          }
        : {}),
    },
    body: method === "POST" ? buildStripeRequestBody(options?.body) : undefined,
  });
  const responseText = await response.text();

  try {
    const parsedJson = JSON.parse(responseText) as TResponse | StripeApiErrorResponse;

    if (!response.ok) {
      const stripeError =
        typeof parsedJson === "object" && parsedJson && "error" in parsedJson
          ? parsedJson.error
          : undefined;
      throw new HttpError(
        502,
        stripeError?.code ?? "stripe_request_failed",
        stripeError?.message ?? "Stripe request failed.",
      );
    }

    return parsedJson as TResponse;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(502, "stripe_response_invalid", "Stripe returned an invalid response.");
  }
}

function parseStripeSignature(signatureHeader: string): {
  timestamp: string;
  signatures: string[];
} {
  const segments = signatureHeader
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
  let timestamp = "";
  const signatures: string[] = [];

  for (const segment of segments) {
    const [key, value] = segment.split("=", 2);

    if (key === "t" && value) {
      timestamp = value;
      continue;
    }

    if (key === "v1" && value) {
      signatures.push(value);
    }
  }

  if (!timestamp || signatures.length === 0) {
    throw new HttpError(400, "stripe_signature_missing", "Stripe signature header is malformed.");
  }

  return {
    timestamp,
    signatures,
  };
}

export function verifyStripeWebhookEvent(
  payload: Buffer,
  signatureHeader: string | undefined,
): StripeEvent {
  if (!signatureHeader?.trim()) {
    throw new HttpError(400, "stripe_signature_missing", "Stripe signature header is required.");
  }

  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  const signedPayload = `${timestamp}.${payload.toString("utf8")}`;
  const expectedSignature = createHmac("sha256", resolveStripeWebhookSecret())
    .update(signedPayload)
    .digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureMatches = signatures.some((signature) => {
    const actualBuffer = Buffer.from(signature);

    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  });

  if (!signatureMatches) {
    throw new HttpError(400, "stripe_signature_invalid", "Stripe signature verification failed.");
  }

  try {
    return JSON.parse(payload.toString("utf8")) as StripeEvent;
  } catch {
    throw new HttpError(400, "stripe_payload_invalid", "Stripe webhook payload is invalid.");
  }
}

export function extractStripeSubscriptionPriceId(subscription: StripeSubscription): string | undefined {
  return subscription.items?.data?.[0]?.price?.id?.trim() || undefined;
}
