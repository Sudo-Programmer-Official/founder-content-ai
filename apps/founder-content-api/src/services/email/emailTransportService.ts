import crypto from "node:crypto";
import { HttpError } from "../../utils/http.ts";
import { logInfo, logWarn } from "../../utils/logger.ts";
import { SesApiError, resolveSesCredentials, sendSesJsonRequest } from "./sesApi.ts";

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

const RESERVED_RECIPIENT_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "invalid",
  "localhost",
  "test",
]);

function shouldUseLogTransport(): boolean {
  return !resolveSesCredentials() || !process.env.SYSTEM_FROM_EMAIL?.trim();
}

function formatFromAddress(fromEmail: string, fromName?: string): string {
  if (!fromName) {
    return fromEmail;
  }

  const sanitizedName = fromName.replace(/"/g, "").trim();
  return sanitizedName === "" ? fromEmail : `"${sanitizedName}" <${fromEmail}>`;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function extractDomain(value: string): string {
  const normalized = normalizeEmail(value);
  const atIndex = normalized.lastIndexOf("@");
  return atIndex >= 0 ? normalized.slice(atIndex + 1) : "";
}

export function isReservedRecipientEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  const domain = extractDomain(normalized);

  return (
    normalized === "" ||
    domain === "" ||
    RESERVED_RECIPIENT_DOMAINS.has(domain) ||
    domain.endsWith(".local")
  );
}

export async function sendPlatformEmail(
  input: SendPlatformEmailInput,
): Promise<SentPlatformEmailResult> {
  const now = new Date();
  const normalizedRecipient = normalizeEmail(input.toEmail);

  if (isReservedRecipientEmail(normalizedRecipient)) {
    logWarn("Blocked email send to reserved or placeholder recipient.", {
      toEmail: normalizedRecipient,
      subject: input.subject,
    });

    throw new HttpError(
      400,
      "email_recipient_invalid",
      "Refusing to send email to a placeholder or reserved recipient address.",
    );
  }

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

  try {
    const payload = await sendSesJsonRequest<Record<string, unknown>>({
      method: "POST",
      path: "/v2/email/outbound-emails",
      body: {
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
      },
    });

    const messageId =
      typeof payload.MessageId === "string" ? payload.MessageId : crypto.randomUUID();
    logInfo("Sent email via SES.", {
      toEmail: input.toEmail,
      messageId,
    });

    return {
      messageId,
      provider: "ses",
      sentAt: now.toISOString(),
    };
  } catch (error) {
    if (error instanceof SesApiError) {
      throw new HttpError(
        502,
        "email_send_failed",
        error.message || "SES rejected the email send request.",
      );
    }

    throw error;
  }
}
