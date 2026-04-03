import crypto from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { queryDb, withDbTransaction } from "../db/client.ts";
import { HttpError } from "../../utils/http.ts";

const TRACKING_TOKEN_VERSION = 1;
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64",
);

type EmailTrackingTokenType = "open" | "click";
type EmailTrackingSourceType = "unknown" | "human_likely" | "bot_suspected" | "prefetch";

interface BaseTrackingTokenPayload {
  v: number;
  type: EmailTrackingTokenType;
  businessId: string;
  campaignId: string;
  sendId: string;
  recipientId: string;
}

interface OpenTrackingTokenPayload extends BaseTrackingTokenPayload {
  type: "open";
}

interface ClickTrackingTokenPayload extends BaseTrackingTokenPayload {
  type: "click";
  linkId: string;
}

type TrackingTokenPayload = OpenTrackingTokenPayload | ClickTrackingTokenPayload;

interface EmailCampaignLinkRow extends QueryResultRow {
  id: string;
  campaign_id: string;
  send_id: string;
  business_id: string;
  original_url: string;
  normalized_url: string;
  label: string | null;
  position_index: number | null;
  created_at: Date | string;
}

interface EmailCampaignRecipientIdentityRow extends QueryResultRow {
  id: string;
  campaign_id: string;
  send_id: string;
  business_id: string;
}

interface EmailTrackingLinkDefinition {
  id: string;
  originalUrl: string;
  normalizedUrl: string;
}

export interface EmailTrackingContext {
  linkByNormalizedUrl: Map<string, EmailTrackingLinkDefinition>;
}

function resolveTrackingSecret(): string {
  const configuredSecret =
    process.env.EMAIL_TRACKING_SECRET?.trim() || process.env.META_AUTH_SESSION_SECRET?.trim();

  if (!configuredSecret) {
    throw new HttpError(
      500,
      "email_tracking_secret_missing",
      "EMAIL_TRACKING_SECRET is not configured.",
    );
  }

  return configuredSecret;
}

function resolveTrackingApiBaseUrl(): string {
  return (
    process.env.API_PUBLIC_BASE_URL?.trim() ||
    `http://localhost:${process.env.PORT?.trim() || "3001"}/api`
  ).replace(/\/$/, "");
}

function computeSignature(input: string): string {
  return crypto
    .createHmac("sha256", resolveTrackingSecret())
    .update(input, "utf8")
    .digest("base64url");
}

function encodeTrackingToken(payload: TrackingTokenPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${computeSignature(encodedPayload)}`;
}

function decodeTrackingToken(token: string): TrackingTokenPayload {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    throw new HttpError(400, "email_tracking_token_missing", "Tracking token is required.");
  }

  const separatorIndex = normalizedToken.lastIndexOf(".");

  if (separatorIndex <= 0 || separatorIndex === normalizedToken.length - 1) {
    throw new HttpError(400, "email_tracking_token_invalid", "Tracking token is invalid.");
  }

  const encodedPayload = normalizedToken.slice(0, separatorIndex);
  const signature = normalizedToken.slice(separatorIndex + 1);
  const expectedSignature = computeSignature(encodedPayload);
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    throw new HttpError(400, "email_tracking_token_invalid", "Tracking token is invalid.");
  }

  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(400, "email_tracking_token_invalid", "Tracking token is invalid.");
  }

  if (!parsedPayload || typeof parsedPayload !== "object") {
    throw new HttpError(400, "email_tracking_token_invalid", "Tracking token is invalid.");
  }

  const payload = parsedPayload as Partial<TrackingTokenPayload>;

  if (
    payload.v !== TRACKING_TOKEN_VERSION ||
    (payload.type !== "open" && payload.type !== "click") ||
    typeof payload.businessId !== "string" ||
    typeof payload.campaignId !== "string" ||
    typeof payload.sendId !== "string" ||
    typeof payload.recipientId !== "string"
  ) {
    throw new HttpError(400, "email_tracking_token_invalid", "Tracking token is invalid.");
  }

  if (payload.type === "click" && typeof payload.linkId !== "string") {
    throw new HttpError(400, "email_tracking_token_invalid", "Tracking token is invalid.");
  }

  return payload as TrackingTokenPayload;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isTrackableUrl(value: string): boolean {
  const trimmedValue = value.trim();

  if (!isHttpUrl(trimmedValue)) {
    return false;
  }

  const normalized = trimmedValue.toLowerCase();
  return !normalized.includes("/email/unsubscribe/") && !normalized.includes("/email/track/");
}

function normalizeTrackedUrl(value: string): string {
  try {
    const parsedUrl = new URL(value.trim());
    parsedUrl.hash = "";
    parsedUrl.protocol = parsedUrl.protocol.toLowerCase();
    parsedUrl.hostname = parsedUrl.hostname.toLowerCase();
    return parsedUrl.toString();
  } catch {
    return value.trim();
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlAttributeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function buildEmailTrackingSourceType(_userAgent: string | undefined): EmailTrackingSourceType {
  return "unknown";
}

function hashIpAddress(value: string | undefined): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  return crypto.createHash("sha256").update(normalizedValue, "utf8").digest("hex");
}

function buildOpenTrackingUrl(input: {
  businessId: string;
  campaignId: string;
  sendId: string;
  recipientId: string;
}): string {
  const token = encodeTrackingToken({
    v: TRACKING_TOKEN_VERSION,
    type: "open",
    businessId: input.businessId,
    campaignId: input.campaignId,
    sendId: input.sendId,
    recipientId: input.recipientId,
  });
  return `${resolveTrackingApiBaseUrl()}/email/track/open?t=${encodeURIComponent(token)}`;
}

function buildClickTrackingUrl(input: {
  businessId: string;
  campaignId: string;
  sendId: string;
  recipientId: string;
  linkId: string;
}): string {
  const token = encodeTrackingToken({
    v: TRACKING_TOKEN_VERSION,
    type: "click",
    businessId: input.businessId,
    campaignId: input.campaignId,
    sendId: input.sendId,
    recipientId: input.recipientId,
    linkId: input.linkId,
  });
  return `${resolveTrackingApiBaseUrl()}/email/track/click?t=${encodeURIComponent(token)}`;
}

function extractTrackableHtmlLinks(html: string): Array<{ originalUrl: string; label?: string }> {
  const results: Array<{ originalUrl: string; label?: string }> = [];
  const anchorPattern = /<a\b[^>]*href=(["'])(.*?)\1[^>]*>(.*?)<\/a>/gis;

  for (const match of html.matchAll(anchorPattern)) {
    const originalUrl = decodeHtmlAttributeEntities((match[2] ?? "").trim());

    if (!isTrackableUrl(originalUrl)) {
      continue;
    }

    const label = stripTags(match[3] ?? "");
    results.push({
      originalUrl,
      label: label || undefined,
    });
  }

  return results;
}

function trimTrailingUrlPunctuation(value: string): string {
  return value.replace(/[),.;!?]+$/g, "");
}

function extractTrackableTextLinks(text: string): Array<{ originalUrl: string }> {
  const results: Array<{ originalUrl: string }> = [];
  const urlPattern = /https?:\/\/[^\s<>"']+/gi;

  for (const match of text.matchAll(urlPattern)) {
    const originalUrl = trimTrailingUrlPunctuation(match[0] ?? "").trim();

    if (!isTrackableUrl(originalUrl)) {
      continue;
    }

    results.push({ originalUrl });
  }

  return results;
}

async function executeQuery<TRow extends QueryResultRow>(
  text: string,
  values: unknown[],
  client?: PoolClient,
): Promise<{ rows: TRow[] }> {
  if (client) {
    return client.query<TRow>(text, values);
  }

  return queryDb<TRow>(text, values);
}

export async function createEmailTrackingContextForSend(input: {
  businessId: string;
  campaignId: string;
  sendId: string;
  bodyHtml: string;
  bodyText: string;
  client: PoolClient;
}): Promise<EmailTrackingContext> {
  const discoveredLinks = [
    ...extractTrackableHtmlLinks(input.bodyHtml),
    ...extractTrackableTextLinks(input.bodyText),
  ];

  const uniqueLinks = new Map<string, { originalUrl: string; label?: string }>();

  for (const link of discoveredLinks) {
    const normalizedUrl = normalizeTrackedUrl(link.originalUrl);

    if (!uniqueLinks.has(normalizedUrl)) {
      uniqueLinks.set(normalizedUrl, link);
    }
  }

  const linkByNormalizedUrl = new Map<string, EmailTrackingLinkDefinition>();

  let positionIndex = 0;
  for (const [normalizedUrl, link] of uniqueLinks.entries()) {
    const result = await executeQuery<EmailCampaignLinkRow>(
      `
        insert into email_campaign_links (
          campaign_id,
          send_id,
          business_id,
          original_url,
          normalized_url,
          label,
          position_index
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4,
          $5,
          $6,
          $7::int
        )
        returning
          id,
          campaign_id,
          send_id,
          business_id,
          original_url,
          normalized_url,
          label,
          position_index,
          created_at
      `,
      [
        input.campaignId,
        input.sendId,
        input.businessId,
        link.originalUrl,
        normalizedUrl,
        link.label ?? null,
        positionIndex,
      ],
      input.client,
    );

    const row = result.rows[0];
    linkByNormalizedUrl.set(normalizedUrl, {
      id: row.id,
      originalUrl: row.original_url,
      normalizedUrl: row.normalized_url,
    });
    positionIndex += 1;
  }

  return {
    linkByNormalizedUrl,
  };
}

export function rewriteEmailTrackingLinksForRecipient(input: {
  businessId: string;
  campaignId: string;
  sendId: string;
  recipientId: string;
  html: string;
  text: string;
  trackingContext: EmailTrackingContext;
}): {
  html: string;
  text: string;
} {
  const rewriteUrl = (originalUrl: string): string | null => {
    const normalizedUrl = normalizeTrackedUrl(originalUrl);
    const link = input.trackingContext.linkByNormalizedUrl.get(normalizedUrl);

    if (!link) {
      return null;
    }

    return buildClickTrackingUrl({
      businessId: input.businessId,
      campaignId: input.campaignId,
      sendId: input.sendId,
      recipientId: input.recipientId,
      linkId: link.id,
    });
  };

  const html = input.html.replace(/(<a\b[^>]*href=(["']))(.*?)(\2)/gis, (match, prefix, quote, urlValue, suffix) => {
    const originalUrl =
      typeof urlValue === "string" ? decodeHtmlAttributeEntities(urlValue.trim()) : "";

    if (!isTrackableUrl(originalUrl)) {
      return match;
    }

    const trackedUrl = rewriteUrl(originalUrl);
    return trackedUrl ? `${prefix}${trackedUrl}${suffix}` : match;
  });

  const text = input.text.replace(/https?:\/\/[^\s<>"']+/gi, (matchedUrl) => {
    const normalizedCandidate = trimTrailingUrlPunctuation(matchedUrl);

    if (!isTrackableUrl(normalizedCandidate)) {
      return matchedUrl;
    }

    const trackedUrl = rewriteUrl(normalizedCandidate);

    if (!trackedUrl) {
      return matchedUrl;
    }

    return matchedUrl.endsWith(normalizedCandidate)
      ? trackedUrl
      : `${trackedUrl}${matchedUrl.slice(normalizedCandidate.length)}`;
  });

  return {
    html,
    text,
  };
}

export function appendEmailOpenTrackingPixel(input: {
  businessId: string;
  campaignId: string;
  sendId: string;
  recipientId: string;
  html: string;
}): string {
  const pixelUrl = buildOpenTrackingUrl({
    businessId: input.businessId,
    campaignId: input.campaignId,
    sendId: input.sendId,
    recipientId: input.recipientId,
  });

  return `${input.html}<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;" />`;
}

async function loadRecipientForTrackingOrThrow(
  payload: BaseTrackingTokenPayload,
  client: PoolClient,
): Promise<EmailCampaignRecipientIdentityRow> {
  const result = await executeQuery<EmailCampaignRecipientIdentityRow>(
    `
      select
        r.id,
        r.campaign_id,
        r.send_id,
        c.business_id
      from email_campaign_recipients r
      inner join email_campaigns c on c.id = r.campaign_id
      where r.id = $1::uuid
      limit 1
    `,
    [payload.recipientId],
    client,
  );

  const row = result.rows[0];

  if (
    !row ||
    row.campaign_id !== payload.campaignId ||
    row.send_id !== payload.sendId ||
    row.business_id !== payload.businessId
  ) {
    throw new HttpError(404, "email_tracking_target_not_found", "Tracking target not found.");
  }

  return row;
}

async function loadLinkForTrackingOrThrow(
  payload: ClickTrackingTokenPayload,
  client: PoolClient,
): Promise<EmailCampaignLinkRow> {
  const result = await executeQuery<EmailCampaignLinkRow>(
    `
      select
        id,
        campaign_id,
        send_id,
        business_id,
        original_url,
        normalized_url,
        label,
        position_index,
        created_at
      from email_campaign_links
      where id = $1::uuid
      limit 1
    `,
    [payload.linkId],
    client,
  );

  const row = result.rows[0];

  if (
    !row ||
    row.campaign_id !== payload.campaignId ||
    row.send_id !== payload.sendId ||
    row.business_id !== payload.businessId
  ) {
    throw new HttpError(404, "email_tracking_link_not_found", "Tracking link not found.");
  }

  return row;
}

export async function trackEmailOpen(input: {
  token: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<void> {
  const payload = decodeTrackingToken(input.token);

  if (payload.type !== "open") {
    throw new HttpError(400, "email_tracking_token_invalid", "Tracking token is invalid.");
  }

  const sourceType = buildEmailTrackingSourceType(input.userAgent);
  const ipHash = hashIpAddress(input.ipAddress);
  const occurredAt = new Date().toISOString();

  await withDbTransaction(async (client) => {
    await loadRecipientForTrackingOrThrow(payload, client);

    await executeQuery(
      `
        insert into email_events (
          campaign_recipient_id,
          send_id,
          event_type,
          payload_json,
          occurred_at,
          source_type,
          user_agent,
          ip_hash
        ) values (
          $1::uuid,
          $2::uuid,
          'open',
          $3::jsonb,
          $4::timestamptz,
          $5,
          $6,
          $7
        )
      `,
      [
        payload.recipientId,
        payload.sendId,
        JSON.stringify({
          type: "open",
          sourceType,
        }),
        occurredAt,
        sourceType,
        input.userAgent ?? null,
        ipHash,
      ],
      client,
    );

    await executeQuery(
      `
        update email_campaign_recipients
        set
          open_count = open_count + 1,
          first_opened_at = coalesce(first_opened_at, $2::timestamptz),
          last_opened_at = $2::timestamptz,
          updated_at = now()
        where id = $1::uuid
      `,
      [payload.recipientId, occurredAt],
      client,
    );
  });
}

export async function trackEmailClick(input: {
  token: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<{ redirectUrl: string }> {
  const payload = decodeTrackingToken(input.token);

  if (payload.type !== "click") {
    throw new HttpError(400, "email_tracking_token_invalid", "Tracking token is invalid.");
  }

  const sourceType = buildEmailTrackingSourceType(input.userAgent);
  const ipHash = hashIpAddress(input.ipAddress);
  const occurredAt = new Date().toISOString();

  return withDbTransaction(async (client) => {
    await loadRecipientForTrackingOrThrow(payload, client);
    const link = await loadLinkForTrackingOrThrow(payload, client);

    await executeQuery(
      `
        insert into email_events (
          campaign_recipient_id,
          send_id,
          link_id,
          event_type,
          payload_json,
          occurred_at,
          source_type,
          user_agent,
          ip_hash
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          'click',
          $4::jsonb,
          $5::timestamptz,
          $6,
          $7,
          $8
        )
      `,
      [
        payload.recipientId,
        payload.sendId,
        payload.linkId,
        JSON.stringify({
          type: "click",
          sourceType,
        }),
        occurredAt,
        sourceType,
        input.userAgent ?? null,
        ipHash,
      ],
      client,
    );

    await executeQuery(
      `
        update email_campaign_recipients
        set
          click_count = click_count + 1,
          first_clicked_at = coalesce(first_clicked_at, $2::timestamptz),
          last_clicked_at = $2::timestamptz,
          updated_at = now()
        where id = $1::uuid
      `,
      [payload.recipientId, occurredAt],
      client,
    );

    return {
      redirectUrl: link.original_url,
    };
  });
}

export function getEmailTrackingPixelBuffer(): Buffer {
  return TRANSPARENT_GIF;
}
