import crypto from "node:crypto";
import type {
  CreatePublicMarketingInquiryRequest,
  CreatePublicMarketingInquiryResponse,
  PublicMarketingAssistantTopic,
} from "../../../../packages/shared-types/index.ts";
import type { PoolClient, QueryResultRow } from "pg";
import { isDatabaseConfigured, queryDb, withDbTransaction } from "./db/client.ts";
import { isReservedRecipientEmail, sendPlatformEmail } from "./email/emailTransportService.ts";
import { HttpError } from "../utils/http.ts";
import { logInfo, logWarn } from "../utils/logger.ts";

interface MarketingAssistantInquiryRow extends QueryResultRow {
  id: string;
  created_at: Date | string;
}

interface CreatePublicMarketingInquiryInput extends CreatePublicMarketingInquiryRequest {
  clientIp?: string;
  userAgent?: string;
}

interface PersistedInquiry {
  inquiryId: string;
  receivedAt: string;
  shouldNotifyOwner: boolean;
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 160;
const MAX_COMPANY_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_PROMPT_LENGTH = 180;
const MAX_PAGE_URL_LENGTH = 300;
const MAX_CLIENT_IP_LENGTH = 120;
const MAX_USER_AGENT_LENGTH = 500;
const MAX_EMAIL_SUBMISSIONS_PER_HOUR = 4;
const MAX_IP_SUBMISSIONS_PER_HOUR = 8;
const DUPLICATE_WINDOW_MINUTES = 30;

const VALID_TOPICS: ReadonlySet<PublicMarketingAssistantTopic> = new Set([
  "social_media_automation",
  "founder_brand_system",
  "growth_automation",
  "service_fit",
  "other",
]);

function normalizeOptionalString(value: string | undefined, maxLength: number): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function normalizeMessage(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function assertValidInquiry(input: {
  name: string;
  email: string;
  message: string;
}): void {
  if (input.name.trim().length < 2) {
    throw new HttpError(400, "marketing_inquiry_name_required", "Please share your name.");
  }

  if (input.name.trim().length > MAX_NAME_LENGTH) {
    throw new HttpError(400, "marketing_inquiry_name_too_long", "Name is too long.");
  }

  if (input.email.trim().length === 0 || input.email.trim().length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(input.email)) {
    throw new HttpError(400, "marketing_inquiry_email_invalid", "Please enter a valid email address.");
  }

  if (input.message.trim().length < 12) {
    throw new HttpError(
      400,
      "marketing_inquiry_message_required",
      "Please tell us what you want to automate or improve.",
    );
  }

  if (input.message.trim().length > MAX_MESSAGE_LENGTH) {
    throw new HttpError(400, "marketing_inquiry_message_too_long", "Message is too long.");
  }
}

function normalizeTopic(value: PublicMarketingAssistantTopic | undefined): PublicMarketingAssistantTopic {
  return value && VALID_TOPICS.has(value) ? value : "other";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTopicLabel(topic: PublicMarketingAssistantTopic): string {
  switch (topic) {
    case "social_media_automation":
      return "Social media automation";
    case "founder_brand_system":
      return "Founder brand system";
    case "growth_automation":
      return "Growth automation";
    case "service_fit":
      return "Service fit";
    default:
      return "General inquiry";
  }
}

function resolveOwnerEmail(): string {
  return (
    process.env.MARKETING_OWNER_EMAIL?.trim()
    || process.env.SYSTEM_FROM_EMAIL?.trim()
    || "hello@foundercontent.ai"
  );
}

function resolveFromEmail(ownerEmail: string): string {
  return process.env.SYSTEM_FROM_EMAIL?.trim() || ownerEmail || "hello@foundercontent.ai";
}

async function ensureSubmissionWithinLimit(
  client: PoolClient,
  email: string,
  clientIp: string | null,
): Promise<void> {
  const emailResult = await client.query<{ submission_count: string | number }>(
    `
      select count(*)::int as submission_count
      from marketing_assistant_inquiries
      where lower(email) = lower($1)
        and created_at >= now() - interval '1 hour'
    `,
    [email],
  );

  const recentEmailSubmissions = Number(emailResult.rows[0]?.submission_count ?? 0);

  if (recentEmailSubmissions >= MAX_EMAIL_SUBMISSIONS_PER_HOUR) {
    throw new HttpError(
      429,
      "marketing_inquiry_rate_limited",
      "You have sent a few requests already. Please wait a bit and try again.",
    );
  }

  if (!clientIp) {
    return;
  }

  const ipResult = await client.query<{ submission_count: string | number }>(
    `
      select count(*)::int as submission_count
      from marketing_assistant_inquiries
      where client_ip = $1
        and created_at >= now() - interval '1 hour'
    `,
    [clientIp],
  );

  const recentIpSubmissions = Number(ipResult.rows[0]?.submission_count ?? 0);

  if (recentIpSubmissions >= MAX_IP_SUBMISSIONS_PER_HOUR) {
    throw new HttpError(
      429,
      "marketing_inquiry_rate_limited",
      "Too many requests from this connection. Please wait a bit and try again.",
    );
  }
}

async function persistInquiry(input: {
  ownerEmail: string;
  normalizedCompanyName: string | null;
  normalizedEmail: string;
  normalizedMessage: string;
  normalizedName: string;
  normalizedPageUrl: string | null;
  normalizedPrompt: string | null;
  normalizedTopic: PublicMarketingAssistantTopic;
  normalizedClientIp: string | null;
  normalizedUserAgent: string | null;
}): Promise<PersistedInquiry> {
  if (!isDatabaseConfigured()) {
    return {
      inquiryId: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      shouldNotifyOwner: true,
    };
  }

  return withDbTransaction(async (client) => {
    await ensureSubmissionWithinLimit(client, input.normalizedEmail, input.normalizedClientIp);

    const duplicateResult = await client.query<MarketingAssistantInquiryRow>(
      `
        select id, created_at
        from marketing_assistant_inquiries
        where lower(email) = lower($1)
          and message = $2
          and created_at >= now() - ($3::text || ' minutes')::interval
        order by created_at desc
        limit 1
      `,
      [input.normalizedEmail, input.normalizedMessage, String(DUPLICATE_WINDOW_MINUTES)],
    );

    const duplicate = duplicateResult.rows[0];

    if (duplicate) {
      return {
        inquiryId: duplicate.id,
        receivedAt: toIsoString(duplicate.created_at),
        shouldNotifyOwner: false,
      };
    }

    const insertResult = await client.query<MarketingAssistantInquiryRow>(
      `
        insert into marketing_assistant_inquiries (
          full_name,
          email,
          company_name,
          message,
          topic,
          selected_prompt,
          page_url,
          client_ip,
          user_agent,
          owner_email
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning id, created_at
      `,
      [
        input.normalizedName,
        input.normalizedEmail,
        input.normalizedCompanyName,
        input.normalizedMessage,
        input.normalizedTopic,
        input.normalizedPrompt,
        input.normalizedPageUrl,
        input.normalizedClientIp,
        input.normalizedUserAgent,
        input.ownerEmail,
      ],
    );

    const row = insertResult.rows[0];

    return {
      inquiryId: row.id,
      receivedAt: toIsoString(row.created_at),
      shouldNotifyOwner: true,
    };
  });
}

async function markInquiryNotified(inquiryId: string, ownerEmail: string): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  await queryDb(
    `
      update marketing_assistant_inquiries
      set
        notified_at = now(),
        owner_email = $2
      where id = $1
    `,
    [inquiryId, ownerEmail],
  );
}

async function notifyOwner(input: {
  companyName: string | null;
  email: string;
  inquiryId: string;
  message: string;
  name: string;
  ownerEmail: string;
  pageUrl: string | null;
  prompt: string | null;
  topic: PublicMarketingAssistantTopic;
}): Promise<void> {
  if (isReservedRecipientEmail(input.ownerEmail)) {
    logWarn("Skipped marketing inquiry notification because the owner email is reserved.", {
      inquiryId: input.inquiryId,
      ownerEmail: input.ownerEmail,
    });
    return;
  }

  const subject = `New Growth Concierge inquiry from ${input.name}`;
  const htmlBody = [
    "<div style=\"font-family: Inter, Arial, sans-serif; color: #1f1814; line-height: 1.6;\">",
    "<p style=\"margin: 0 0 18px; font-size: 18px; font-weight: 700;\">New Growth Concierge inquiry</p>",
    "<table style=\"border-collapse: collapse; width: 100%; margin-bottom: 18px;\">",
    `<tr><td style="padding: 6px 0; font-weight: 700;">Name</td><td style="padding: 6px 0;">${escapeHtml(input.name)}</td></tr>`,
    `<tr><td style="padding: 6px 0; font-weight: 700;">Email</td><td style="padding: 6px 0;">${escapeHtml(input.email)}</td></tr>`,
    `<tr><td style="padding: 6px 0; font-weight: 700;">Company</td><td style="padding: 6px 0;">${escapeHtml(input.companyName ?? "Not provided")}</td></tr>`,
    `<tr><td style="padding: 6px 0; font-weight: 700;">Topic</td><td style="padding: 6px 0;">${escapeHtml(formatTopicLabel(input.topic))}</td></tr>`,
    `<tr><td style="padding: 6px 0; font-weight: 700;">Prompt</td><td style="padding: 6px 0;">${escapeHtml(input.prompt ?? "Custom question")}</td></tr>`,
    `<tr><td style="padding: 6px 0; font-weight: 700;">Page</td><td style="padding: 6px 0;">${escapeHtml(input.pageUrl ?? "Landing page")}</td></tr>`,
    `<tr><td style="padding: 6px 0; font-weight: 700;">Inquiry ID</td><td style="padding: 6px 0;">${escapeHtml(input.inquiryId)}</td></tr>`,
    "</table>",
    "<p style=\"margin: 0 0 10px; font-weight: 700;\">Message</p>",
    `<div style="padding: 16px 18px; border-radius: 18px; background: #fff7f1; border: 1px solid rgba(179, 103, 55, 0.16); white-space: pre-wrap;">${escapeHtml(input.message)}</div>`,
    "</div>",
  ].join("");
  const textBody = [
    "New Growth Concierge inquiry",
    "",
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Company: ${input.companyName ?? "Not provided"}`,
    `Topic: ${formatTopicLabel(input.topic)}`,
    `Prompt: ${input.prompt ?? "Custom question"}`,
    `Page: ${input.pageUrl ?? "Landing page"}`,
    `Inquiry ID: ${input.inquiryId}`,
    "",
    "Message:",
    input.message,
  ].join("\n");

  await sendPlatformEmail({
    fromEmail: resolveFromEmail(input.ownerEmail),
    fromName: process.env.SYSTEM_FROM_NAME?.trim() || "Founder Content Concierge",
    replyToEmail: input.email,
    toEmail: input.ownerEmail,
    subject,
    htmlBody,
    textBody,
    tags: {
      channel: "public_marketing",
      surface: "growth_concierge",
      topic: input.topic,
    },
  });
}

export async function createPublicMarketingInquiry(
  rawInput: CreatePublicMarketingInquiryInput,
): Promise<CreatePublicMarketingInquiryResponse> {
  if (rawInput.honeypot?.trim()) {
    return {
      inquiryId: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
    };
  }

  const normalizedName = rawInput.name.trim();
  const normalizedEmail = rawInput.email.trim().toLowerCase();
  const normalizedCompanyName = normalizeOptionalString(rawInput.companyName, MAX_COMPANY_LENGTH);
  const normalizedMessage = normalizeMessage(rawInput.message);
  const normalizedTopic = normalizeTopic(rawInput.topic);
  const normalizedPrompt = normalizeOptionalString(rawInput.selectedPrompt, MAX_PROMPT_LENGTH);
  const normalizedPageUrl = normalizeOptionalString(rawInput.pageUrl, MAX_PAGE_URL_LENGTH);
  const normalizedClientIp = normalizeOptionalString(rawInput.clientIp, MAX_CLIENT_IP_LENGTH);
  const normalizedUserAgent = normalizeOptionalString(rawInput.userAgent, MAX_USER_AGENT_LENGTH);
  const ownerEmail = resolveOwnerEmail();

  assertValidInquiry({
    name: normalizedName,
    email: normalizedEmail,
    message: normalizedMessage,
  });

  const persisted = await persistInquiry({
    ownerEmail,
    normalizedCompanyName,
    normalizedEmail,
    normalizedMessage,
    normalizedName,
    normalizedPageUrl,
    normalizedPrompt,
    normalizedTopic,
    normalizedClientIp,
    normalizedUserAgent,
  });

  if (persisted.shouldNotifyOwner) {
    try {
      await notifyOwner({
        companyName: normalizedCompanyName,
        email: normalizedEmail,
        inquiryId: persisted.inquiryId,
        message: normalizedMessage,
        name: normalizedName,
        ownerEmail,
        pageUrl: normalizedPageUrl,
        prompt: normalizedPrompt,
        topic: normalizedTopic,
      });
      await markInquiryNotified(persisted.inquiryId, ownerEmail);
    } catch (error) {
      logWarn("Unable to notify the owner about a new marketing inquiry.", {
        inquiryId: persisted.inquiryId,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  logInfo("Captured public marketing inquiry.", {
    inquiryId: persisted.inquiryId,
    email: normalizedEmail,
    topic: normalizedTopic,
  });

  return {
    inquiryId: persisted.inquiryId,
    receivedAt: persisted.receivedAt,
  };
}
