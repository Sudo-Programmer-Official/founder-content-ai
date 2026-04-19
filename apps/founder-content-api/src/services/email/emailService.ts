import crypto from "node:crypto";
import { parseEmailBodyBlocks } from "../../../../../packages/shared-types/index.ts";
import type {
  BusinessEmailSettings,
  CreateEmailCampaignRequest,
  CreateEmailCampaignResponse,
  CreateEmailDomainRequest,
  CreateEmailDomainResponse,
  DeleteEmailCampaignResponse,
  EmailCampaign,
  EmailCampaignSend,
  EmailCampaignListResponse,
  EmailBodyBlock,
  EmailCampaignRecipient,
  EmailCampaignStats,
  EmailCampaignStatsResponse,
  EmailContact,
  EmailContactAttributes,
  EmailContactImportJob,
  EmailContactImportJobError,
  EmailContactStatus,
  EmailContactListResponse,
  EmailDnsRecord,
  EmailDnsInstruction,
  EmailDomainConflictFlag,
  EmailDomainSetupAnalysis,
  EmailDomainSettingsResponse,
  EmailFooterSettings,
  EmailFooterSocialLinks,
  EmailPreviewSenderSettings,
  EmailList,
  EmailListListResponse,
  EmailMxRecord,
  EmailContactImportDuplicateStrategy,
  EmailContactImportField,
  EmailContactImportFieldPreview,
  EmailContactImportMapping,
  EmailContactImportPreviewRow,
  EmailContactImportPreviewSummary,
  EmailSpfValidationState,
  EmailSubscriptionStatusResponse,
  ImportEmailContactsRequest,
  ImportEmailContactsPreviewResponse,
  ImportEmailContactsResponse,
  EmailContactImportJobListResponse,
  EmailContactImportJobResponse,
  QueueEmailContactsImportRequest,
  QueueEmailContactsImportResponse,
  PreviewEmailCampaignRequest,
  PreviewEmailCampaignResponse,
  ResubscribeEmailResponse,
  SendEmailCampaignResponse,
  SendTestEmailCampaignRequest,
  SendTestEmailCampaignResponse,
  UnsubscribeEmailResponse,
  UpdateEmailCampaignRequest,
  UpdateEmailCampaignResponse,
  VerifyEmailDomainResponse,
} from "../../../../../packages/shared-types/index.ts";
import type { PoolClient, QueryResultRow } from "pg";
import { incrementBusinessDailyUsage } from "../adminControlService.ts";
import { safeLogEvent } from "../analytics/eventLoggingService.ts";
import { getTableColumnSet, queryDb, withDbTransaction } from "../db/client.ts";
import { deriveProviderSignals, inspectDomainDns } from "./dnsInspectionService.ts";
import { sendEmailCampaignLifecycleNotification } from "./emailCampaignNotificationService.ts";
import { recalculateEmailDomainReputation } from "./emailDeliverabilityService.ts";
import {
  appendEmailOpenTrackingPixel,
  createEmailTrackingContextForSend,
  rewriteEmailTrackingLinksForRecipient,
} from "./emailTrackingService.ts";
import { resolveEmailPublicApiBaseUrl } from "./emailPublicUrlService.ts";
import { ensureSesDomainIdentity, getSesDomainIdentity } from "./sesIdentityService.ts";
import { sendPlatformEmail } from "./emailTransportService.ts";
import { HttpError } from "../../utils/http.ts";
import { logWarn } from "../../utils/logger.ts";
import { safeCreateSystemErrorLog } from "../systemErrorLogService.ts";
import { claimQueuedJobs, createJob, markJobCompleted, markJobFailed } from "../jobQueueService.ts";
import { resolveWorkspaceAssetPreviewUrl } from "../workspaceAssetService.ts";
import {
  buildEmailBillingSendWarnings,
  getBillingEmailAddonSummary,
  resolveBusinessPlanCode,
} from "../billing/emailBillingService.ts";

interface EmailSettingsRow extends QueryResultRow {
  id: string;
  business_id: string;
  from_name: string | null;
  from_email: string | null;
  reply_to_email: string | null;
  signature_text: string | null;
  configuration_json: unknown;
  provider: string;
  ses_identity: string | null;
  domain_name: string | null;
  domain_status: string;
  dkim_status: string;
  spf_status: string;
  dns_records_json: unknown;
  existing_mx_json: unknown;
  existing_spf_value: string | null;
  existing_dmarc_value: string | null;
  recommended_spf_value: string | null;
  conflict_flags_json: unknown;
  verified_at: Date | string | null;
  last_checked_at: Date | string | null;
  updated_at: Date | string;
}

interface EmailListRow extends QueryResultRow {
  id: string;
  business_id: string;
  name: string;
  created_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  contact_count?: string | number;
  member_list_ids_json?: unknown;
}

interface EmailContactRow extends QueryResultRow {
  id: string;
  business_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  tags_json: unknown;
  attributes_json: unknown;
  status: EmailContactStatus;
  unsubscribe_token: string;
  unsubscribed_at: Date | string | null;
  last_bounce_at: Date | string | null;
  last_complaint_at: Date | string | null;
  last_provider_event_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EmailUnsubscribeRow extends QueryResultRow {
  id: string;
  business_id: string;
  email: string;
  reason: string | null;
  source: "campaign" | "manual" | "system" | "bounce" | "complaint";
  source_campaign_id: string | null;
  created_at: Date | string;
}

interface EmailCampaignRow extends QueryResultRow {
  id: string;
  business_id: string;
  list_id: string | null;
  source_asset_id: string | null;
  source_idea_id: string | null;
  source_title: string | null;
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  status: EmailCampaign["status"];
  reply_to_email: string | null;
  created_by_user_id: string | null;
  scheduled_at: Date | string | null;
  send_started_at: Date | string | null;
  send_completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  recipient_count?: string | number;
  pending_count?: string | number;
  sent_count?: string | number;
  delivered_count?: string | number;
  failed_count?: string | number;
  unsubscribed_count?: string | number;
}

interface EmailCampaignSendRow extends QueryResultRow {
  id: string;
  campaign_id: string;
  business_id: string;
  status: EmailCampaignSend["status"];
  recipient_count: string | number;
  delivered_count: string | number;
  failed_count: string | number;
  unsubscribed_count: string | number;
  send_started_at: Date | string | null;
  send_completed_at: Date | string | null;
  created_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EmailCampaignRecipientRow extends QueryResultRow {
  id: string;
  campaign_id: string;
  send_id: string;
  contact_id: string;
  personalized_subject: string;
  personalized_body_html: string;
  personalized_body_text: string;
  status: EmailCampaignRecipient["status"];
  ses_message_id: string | null;
  sent_at: Date | string | null;
  delivered_at: Date | string | null;
  failed_at: Date | string | null;
  open_count: string | number;
  first_opened_at: Date | string | null;
  last_opened_at: Date | string | null;
  click_count: string | number;
  first_clicked_at: Date | string | null;
  last_clicked_at: Date | string | null;
  failure_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  contact_email?: string;
  contact_status?: EmailContactStatus;
  first_name?: string | null;
  last_name?: string | null;
  unsubscribe_token?: string;
}

interface CountRow extends QueryResultRow {
  total: string | number;
}

interface BusinessIdRow extends QueryResultRow {
  business_id: string;
}

interface EmailFooterBrandingRow extends QueryResultRow {
  logo_url: string | null;
  configuration_json: unknown;
  brand_name: string | null;
  name: string | null;
}

interface EmailFooterLogoAssetRow extends QueryResultRow {
  storage_key: string | null;
  storage_url: string;
}

interface SourceAssetRow extends QueryResultRow {
  id: string;
  business_id: string | null;
  title: string | null;
  source_idea_id: string | null;
  content_body: unknown;
}

interface SourceIdeaRow extends QueryResultRow {
  id: string;
  business_id: string;
  body: string;
  understanding_json: unknown | null;
}

interface EmailCampaignRecipientProgressRow extends QueryResultRow {
  queued_total: string | number;
  sending_total: string | number;
  failed_total: string | number;
  recipient_total?: string | number;
  delivered_total?: string | number;
  unsubscribed_total?: string | number;
}

interface EmailContactImportJobRow extends QueryResultRow {
  id: string;
  business_id: string;
  job_id: string | null;
  list_name: string;
  file_name: string | null;
  status: string;
  total_rows: string | number;
  processed_rows: string | number;
  inserted_count: string | number;
  updated_count: string | number;
  skipped_count: string | number;
  error_count: string | number;
  mapping_json: unknown;
  error_summary_json: unknown;
  created_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
}

interface ProcessQueuedEmailCampaignsOptions {
  businessId?: string;
  campaignId?: string;
  batchSize?: number;
}

interface ProcessQueuedEmailCampaignsResult {
  campaignsVisited: number;
  campaignsFinalized: number;
  recipientsClaimed: number;
  recipientsSent: number;
  recipientsFailed: number;
  recipientsUnsubscribed: number;
  requeuedRecipients: number;
}

interface EmailContactImportJobPayload {
  listName: string;
  csvText: string;
  mapping?: EmailContactImportMapping;
  duplicateStrategy?: EmailContactImportDuplicateStrategy;
  fileName?: string | null;
  actorUserId?: string | null;
}

interface ProcessQueuedEmailContactImportJobsOptions {
  batchSize?: number;
}

interface ProcessQueuedEmailContactImportJobsResult {
  jobsClaimed: number;
  jobsCompleted: number;
  jobsFailed: number;
  contactsInserted: number;
  contactsUpdated: number;
  contactsSkipped: number;
  contactErrors: number;
}

const DOMAIN_STATUS_VERIFIED = "verified";
const EMAIL_ADDRESS_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;
const DEFAULT_EMAIL_CAMPAIGN_WORKER_BATCH_SIZE = 100;
const DEFAULT_EMAIL_CAMPAIGN_RECIPIENT_LEASE_MINUTES = 30;
const DEFAULT_EMAIL_CONTACT_IMPORT_WORKER_BATCH_SIZE = 2;
const MAX_EMAIL_CAMPAIGN_DRAIN_PASSES = 1000;
const EMAIL_SETTINGS_SELECT_FIELDS = `
  id,
  business_id,
  from_name,
  from_email,
  reply_to_email,
  signature_text,
  configuration_json,
  provider,
  ses_identity,
  domain_name,
  domain_status,
  dkim_status,
  spf_status,
  dns_records_json,
  existing_mx_json,
  existing_spf_value,
  existing_dmarc_value,
  recommended_spf_value,
  conflict_flags_json,
  verified_at,
  last_checked_at,
  updated_at
`;

function resolvePositiveIntegerEnv(envName: string, fallback: number): number {
  const rawValue = process.env[envName]?.trim();

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function resolveEmailCampaignWorkerBatchSize(): number {
  return resolvePositiveIntegerEnv(
    "EMAIL_CAMPAIGN_WORKER_BATCH_SIZE",
    DEFAULT_EMAIL_CAMPAIGN_WORKER_BATCH_SIZE,
  );
}

function resolveEmailCampaignRecipientLeaseMinutes(): number {
  return resolvePositiveIntegerEnv(
    "EMAIL_CAMPAIGN_RECIPIENT_LEASE_MINUTES",
    DEFAULT_EMAIL_CAMPAIGN_RECIPIENT_LEASE_MINUTES,
  );
}

function resolveEmailContactImportWorkerBatchSize(): number {
  return resolvePositiveIntegerEnv(
    "EMAIL_CONTACT_IMPORT_WORKER_BATCH_SIZE",
    DEFAULT_EMAIL_CONTACT_IMPORT_WORKER_BATCH_SIZE,
  );
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseJsonObject<T>(value: unknown): T {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as T;
  }

  return {} as T;
}

const EMAIL_CONTACT_ATTRIBUTE_KEYS = [
  "state",
  "city",
  "business_type",
  "audience_type",
  "language",
  "plan",
] as const;

type EmailContactAttributeKey = (typeof EMAIL_CONTACT_ATTRIBUTE_KEYS)[number];

const US_STATE_NAME_BY_CODE: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District Of Columbia",
  AS: "American Samoa",
  GU: "Guam",
  MP: "Northern Mariana Islands",
  PR: "Puerto Rico",
  VI: "Virgin Islands",
};

const STATE_LOOKUP_TO_NAME = Object.fromEntries(
  Object.entries(US_STATE_NAME_BY_CODE).flatMap(([code, name]) => [
    [code.toLowerCase(), name],
    [name.toLowerCase().replace(/[^a-z]/g, ""), name],
  ]),
) as Record<string, string>;

const STATE_NAME_TO_CODE = Object.fromEntries(
  Object.entries(US_STATE_NAME_BY_CODE).map(([code, name]) => [name, code]),
) as Record<string, string>;

const PLAN_LOOKUP_TO_LABEL: Record<string, string> = {
  basic: "Basic",
  free: "Free",
  starter: "Starter",
  standard: "Standard",
  premium: "Premium",
  pro: "Pro",
  professional: "Professional",
  enterprise: "Enterprise",
  team: "Team",
};

let emailContactCapabilitiesPromise: Promise<{ hasAttributesJson: boolean }> | null = null;

async function getEmailContactCapabilities(): Promise<{ hasAttributesJson: boolean }> {
  if (!emailContactCapabilitiesPromise) {
    emailContactCapabilitiesPromise = getTableColumnSet("email_contacts")
      .then((columns) => ({
        hasAttributesJson: columns.has("attributes_json"),
      }))
      .catch((error) => {
        emailContactCapabilitiesPromise = null;
        throw error;
      });
  }

  return emailContactCapabilitiesPromise;
}

function normalizeContactAttributeValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function toTitleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeContactAttributeLookupKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeStateAttributeValue(value: string | undefined): string | undefined {
  const normalized = normalizeContactAttributeValue(value);

  if (!normalized) {
    return undefined;
  }

  const match = STATE_LOOKUP_TO_NAME[normalizeContactAttributeLookupKey(normalized)];
  return match ?? toTitleCase(normalized.toLowerCase().replace(/\s+/g, " "));
}

function normalizePlanAttributeValue(value: string | undefined): string | undefined {
  const normalized = normalizeContactAttributeValue(value)
    ?.toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) {
    return undefined;
  }

  return PLAN_LOOKUP_TO_LABEL[normalized] ?? toTitleCase(normalized);
}

function normalizeGenericContactAttributeValue(value: string | undefined): string | undefined {
  const normalized = normalizeContactAttributeValue(value)?.replace(/\s+/g, " ");
  return normalized ? toTitleCase(normalized.toLowerCase()) : undefined;
}

function normalizeContactAttributeValueByKey(
  key: EmailContactAttributeKey,
  value: string | undefined,
): string | undefined {
  if (key === "state") {
    return normalizeStateAttributeValue(value);
  }

  if (key === "plan") {
    return normalizePlanAttributeValue(value);
  }

  return normalizeGenericContactAttributeValue(value);
}

function normalizeContactAttributes(attributes: EmailContactAttributes | undefined): EmailContactAttributes {
  const normalized: EmailContactAttributes = {};

  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (typeof value !== "string") {
      continue;
    }

    const attributeKey = key as EmailContactAttributeKey;
    const normalizedValue = EMAIL_CONTACT_ATTRIBUTE_KEYS.includes(attributeKey)
      ? normalizeContactAttributeValueByKey(attributeKey, value)
      : normalizeContactAttributeValue(value);

    if (normalizedValue) {
      normalized[key] = normalizedValue;
    }
  }

  return normalized;
}

function normalizeEmailListNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function buildContactAttributeFilterVariants(key: string, value: string): string[] {
  if (key === "state") {
    const normalizedState = normalizeStateAttributeValue(value);

    if (!normalizedState) {
      return [];
    }

    const stateCode = STATE_NAME_TO_CODE[normalizedState];
    return [...new Set([normalizedState.toLowerCase(), stateCode?.toLowerCase()].filter(Boolean))];
  }

  if (key === "plan") {
    const normalizedPlan = normalizePlanAttributeValue(value);
    return normalizedPlan ? [normalizedPlan.toLowerCase()] : [];
  }

  const normalizedValue = normalizeContactAttributeValue(value)?.toLowerCase();
  return normalizedValue ? [normalizedValue] : [];
}

function extractContactAttributesFromRaw(
  raw: Record<string, string>,
  mapping: EmailContactImportMapping,
): EmailContactAttributes {
  const attributes: EmailContactAttributes = {};

  for (const key of EMAIL_CONTACT_ATTRIBUTE_KEYS) {
    const columnName = mapping[key];

    if (!columnName) {
      continue;
    }

    const value = normalizeContactAttributeValueByKey(key, raw[columnName]);

    if (value) {
      attributes[key] = value;
    }
  }

  return attributes;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function includesAmazonSes(value: string | undefined | null): boolean {
  return typeof value === "string" && /\binclude:amazonses\.com\b/i.test(value);
}

function normalizeOptionalEmail(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeDomainNameInput(value: string | undefined | null): string | null {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  const emailDomain = extractEmailDomain(normalized);

  if (emailDomain) {
    return emailDomain.replace(/^www\./, "").replace(/\.$/, "");
  }

  const withoutProtocol = normalized.replace(/^[a-z]+:\/\//i, "");
  const urlCandidate = /^[a-z]+:\/\//i.test(normalized) ? normalized : `https://${withoutProtocol}`;

  try {
    return new URL(urlCandidate).hostname.replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    const candidate = withoutProtocol.split(/[/?#]/)[0]?.replace(/^www\./, "").replace(/\.$/, "") || "";
    return candidate || null;
  }
}

function normalizeOptionalHttpUrl(value: string | undefined | null): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

type EmailSettingsConfiguration = {
  footer?: EmailFooterSettings;
  testRecipientEmail?: string;
};

const EMAIL_FOOTER_SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "x",
  "youtube",
  "linkedin",
] as const;

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOptionalPublicUrl(value: string | undefined | null): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  return normalizeOptionalHttpUrl(/^[a-z]+:\/\//i.test(normalized) ? normalized : `https://${normalized}`);
}

function normalizeEmailFooterSocialUrl(
  platform: typeof EMAIL_FOOTER_SOCIAL_PLATFORMS[number],
  value: unknown,
): string | undefined {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    return undefined;
  }

  const directUrl = normalizeOptionalPublicUrl(normalized);

  if (directUrl) {
    return directUrl;
  }

  const handle = normalized.replace(/^@/, "").replace(/^\/+|\/+$/g, "");

  if (!handle) {
    return undefined;
  }

  switch (platform) {
    case "facebook":
      return `https://www.facebook.com/${handle}`;
    case "instagram":
      return `https://www.instagram.com/${handle}`;
    case "x":
      return `https://x.com/${handle}`;
    case "youtube":
      return handle.includes("/") || handle.startsWith("@")
        ? `https://www.youtube.com/${handle.replace(/^\/+/, "")}`
        : `https://www.youtube.com/@${handle}`;
    case "linkedin":
      return `https://www.linkedin.com/company/${handle}`;
    default:
      return undefined;
  }
}

function normalizeEmailFooterSocialLinks(value: unknown): EmailFooterSocialLinks | undefined {
  const source = parseJsonObject<Record<string, unknown>>(value);
  const socialLinks = EMAIL_FOOTER_SOCIAL_PLATFORMS.reduce<EmailFooterSocialLinks>((accumulator, platform) => {
    const url = normalizeEmailFooterSocialUrl(platform, source[platform]);

    if (url) {
      accumulator[platform] = url;
    }

    return accumulator;
  }, {});

  return Object.keys(socialLinks).length > 0 ? socialLinks : undefined;
}

function normalizeEmailFooterSettings(value: unknown): EmailFooterSettings | undefined {
  const source = parseJsonObject<Record<string, unknown>>(value);
  const footer: EmailFooterSettings = {
    signoff: normalizeOptionalText(source.signoff),
    businessName: normalizeOptionalText(source.businessName),
    websiteUrl: normalizeOptionalPublicUrl(normalizeOptionalText(source.websiteUrl)) ?? undefined,
    supportEmail: normalizeOptionalEmail(normalizeOptionalText(source.supportEmail)) ?? undefined,
    streetAddress: normalizeOptionalText(source.streetAddress),
    addressLine2: normalizeOptionalText(source.addressLine2),
    city: normalizeOptionalText(source.city),
    state: normalizeOptionalText(source.state),
    postalCode: normalizeOptionalText(source.postalCode),
    country: normalizeOptionalText(source.country),
    additionalText: normalizeOptionalText(source.additionalText),
    socialLinks: normalizeEmailFooterSocialLinks(source.socialLinks),
  };

  return Object.values(footer).some((entry) => {
    if (entry == null) {
      return false;
    }

    if (typeof entry === "object") {
      return Object.keys(entry).length > 0;
    }

    return true;
  })
    ? footer
    : undefined;
}

function parseEmailSettingsConfiguration(value: unknown): EmailSettingsConfiguration {
  const source = parseJsonObject<Record<string, unknown>>(value);
  return {
    footer: normalizeEmailFooterSettings(source.footer),
    testRecipientEmail: normalizeOptionalEmail(normalizeOptionalText(source.testRecipientEmail)) ?? undefined,
  };
}

function buildEmailSettingsConfiguration(input: {
  footer?: EmailFooterSettings;
  testRecipientEmail?: string;
}): EmailSettingsConfiguration {
  return {
    footer: normalizeEmailFooterSettings(input.footer),
    testRecipientEmail: normalizeOptionalEmail(input.testRecipientEmail) ?? undefined,
  };
}

function extractStorageKeyFromStoredUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("s3://")) {
    const parts = normalized.replace(/^s3:\/\//, "").split("/");
    return parts.length > 1 ? parts.slice(1).join("/") : null;
  }

  return null;
}

function resolveStoredLogoUrl(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const storageKey = extractStorageKeyFromStoredUrl(normalized);
  return storageKey ? resolveWorkspaceAssetPreviewUrl(storageKey, normalized) ?? undefined : undefined;
}

function extractEmailDomain(value: string): string | null {
  const [localPart, domainPart, ...rest] = value.trim().toLowerCase().split("@");

  if (!localPart || !domainPart || rest.length > 0) {
    return null;
  }

  return domainPart;
}

function assertValidOptionalEmail(
  value: string | null,
  code: string,
  message: string,
): void {
  if (value && !EMAIL_ADDRESS_PATTERN.test(value)) {
    throw new HttpError(400, code, message);
  }
}

function assertFromEmailMatchesDomain(fromEmail: string | null, domainName: string): void {
  if (!fromEmail) {
    return;
  }

  if (extractEmailDomain(fromEmail) !== domainName) {
    throw new HttpError(
      400,
      "email_from_domain_mismatch",
      "From email must use the configured business domain.",
    );
  }
}

function hasBlockingConflict(conflictFlags: EmailDomainConflictFlag[]): boolean {
  return conflictFlags.some((flag) => flag.severity === "error");
}

function isSpfReady(spfValue: string | null | undefined): boolean {
  return Boolean(spfValue && includesAmazonSes(spfValue));
}

function getSpfValidationState(
  spfValue: string | null | undefined,
  conflictFlags: EmailDomainConflictFlag[],
): EmailSpfValidationState {
  if (conflictFlags.some((flag) => flag.code === "multiple_spf_records")) {
    return "multiple_records";
  }

  if (conflictFlags.some((flag) => flag.code === "spf_malformed")) {
    return "malformed";
  }

  if (conflictFlags.some((flag) => flag.code === "spf_include_missing")) {
    return "missing_ses_include";
  }

  if (conflictFlags.some((flag) => flag.code === "spf_record_missing")) {
    return "missing";
  }

  return isSpfReady(spfValue) ? "valid" : "missing";
}

function buildSafeToAddInstructions(row: EmailSettingsRow): EmailDnsInstruction[] {
  const domainName = row.domain_name;
  const dnsRecords = parseJsonArray<EmailDnsRecord>(row.dns_records_json);
  const instructions = dnsRecords
    .filter((record) => record.type === "CNAME")
    .map<EmailDnsInstruction>((record, index) => ({
      category: "safe_to_add",
      type: record.type,
      name: record.name,
      value: record.value,
      label: `DKIM CNAME ${index + 1}`,
      note: "Safe to add. These records will not interrupt your current inbox provider.",
    }));

  if (!row.existing_dmarc_value && domainName) {
    instructions.push({
      category: "safe_to_add",
      type: "TXT",
      name: `_dmarc.${domainName}`,
      value: "v=DMARC1; p=none;",
      label: "Optional DMARC",
      note:
        "Add this only if you do not already manage DMARC for this domain. If your IT team manages DMARC, leave it unchanged.",
    });
  }

  return instructions;
}

function buildMergeCarefullyInstructions(row: EmailSettingsRow): EmailDnsInstruction[] {
  if (!row.domain_name || !row.recommended_spf_value) {
    return [];
  }

  return [
    {
      category: "merge_carefully",
      type: "TXT",
      name: row.domain_name,
      value: row.recommended_spf_value,
      label: row.existing_spf_value ? "Update existing SPF" : "Add SPF record",
      note: row.existing_spf_value
        ? "We detected an existing SPF record. Update that record and append include:amazonses.com instead of creating a second SPF record."
        : "Add this as the only SPF record if your domain does not already have one.",
    },
  ];
}

function buildDoNotChangeInstructions(row: EmailSettingsRow): EmailDnsInstruction[] {
  const instructions = parseJsonArray<EmailMxRecord>(row.existing_mx_json).map<EmailDnsInstruction>(
    (record) => ({
      category: "do_not_change",
      type: "MX",
      name: row.domain_name ?? "current-domain",
      value: `${record.priority} ${record.exchange}`,
      label: "Current MX record",
      note: "Leave unchanged. Your current inbox provider can stay exactly as it is.",
    }),
  );

  if (row.existing_dmarc_value && row.domain_name) {
    instructions.push({
      category: "do_not_change",
      type: "TXT",
      name: `_dmarc.${row.domain_name}`,
      value: row.existing_dmarc_value,
      label: "Current DMARC record",
      note: "Keep your current DMARC policy unless your DNS admin or IT team decides to change it.",
    });
  }

  return instructions;
}

function buildDomainSetupAnalysis(row: EmailSettingsRow): EmailDomainSetupAnalysis | undefined {
  if (!row.domain_name) {
    return undefined;
  }

  const existingMxRecords = parseJsonArray<EmailMxRecord>(row.existing_mx_json);
  const conflictFlags = parseJsonArray<EmailDomainConflictFlag>(row.conflict_flags_json);
  const spfValidationState = getSpfValidationState(row.existing_spf_value, conflictFlags);
  const dkimReady =
    row.domain_status === DOMAIN_STATUS_VERIFIED && row.dkim_status === DOMAIN_STATUS_VERIFIED;
  const spfReady = spfValidationState === "valid";
  const dmarcConfigured = Boolean(row.existing_dmarc_value);
  const brandedSendingReady = dkimReady && spfReady && !hasBlockingConflict(conflictFlags);
  const state: EmailDomainSetupAnalysis["state"] = hasBlockingConflict(conflictFlags)
    ? "red"
    : brandedSendingReady
      ? "green"
      : "yellow";

  return {
    state,
    brandedSendingReady,
    dkimReady,
    spfReady,
    spfValidationState,
    dmarcConfigured,
    providerSignals: deriveProviderSignals(existingMxRecords),
    existingMxRecords,
    existingSpfValue: row.existing_spf_value ?? undefined,
    existingDmarcValue: row.existing_dmarc_value ?? undefined,
    recommendedSpfValue: row.recommended_spf_value ?? undefined,
    safeToAdd: buildSafeToAddInstructions(row),
    mergeCarefully: buildMergeCarefullyInstructions(row),
    doNotChange: buildDoNotChangeInstructions(row),
    conflictFlags,
  };
}

function mapEmailSettings(row: EmailSettingsRow): BusinessEmailSettings {
  const configuration = parseEmailSettingsConfiguration(row.configuration_json);

  return {
    id: row.id,
    businessId: row.business_id,
    provider: row.provider,
    fromName: row.from_name ?? undefined,
    fromEmail: row.from_email ?? undefined,
    replyToEmail: row.reply_to_email ?? undefined,
    signatureText: row.signature_text ?? undefined,
    domainName: row.domain_name ?? undefined,
    domainStatus: row.domain_status,
    dkimStatus: row.dkim_status,
    spfStatus: row.spf_status,
    sesIdentity: row.ses_identity ?? undefined,
    dnsRecords: parseJsonArray<EmailDnsRecord>(row.dns_records_json),
    verifiedAt: toIsoString(row.verified_at),
    lastCheckedAt: toIsoString(row.last_checked_at),
    updatedAt: toIsoString(row.updated_at),
    domainSetupAnalysis: buildDomainSetupAnalysis(row),
    footer: configuration.footer,
    testRecipientEmail: configuration.testRecipientEmail,
  };
}

async function loadEmailFooterBranding(
  businessId: string,
  client?: PoolClient,
): Promise<{ logoUrl?: string; logoAltText?: string }> {
  const result = await executeQuery<EmailFooterBrandingRow>(
    `
      select
        bk.logo_url,
        s.configuration_json,
        b.brand_name,
        b.name
      from businesses b
      left join business_email_settings s on s.business_id = b.id
      left join brand_kits bk on bk.business_id = b.id
      where b.id = $1::uuid
      limit 1
    `,
    [businessId],
    client,
  );

  const row = result.rows[0];
  const settingsConfiguration = parseEmailSettingsConfiguration(row?.configuration_json);
  const logoUrl = resolveStoredLogoUrl(row?.logo_url);
  const brandLabel = row?.brand_name?.trim() || row?.name?.trim() || "Brand";
  const companyName = settingsConfiguration.footer?.businessName?.trim() || brandLabel;

  return {
    logoUrl: logoUrl ?? undefined,
    logoAltText: `${companyName} logo`,
  };
}

async function attachEmailDeliverability(
  settings: BusinessEmailSettings,
): Promise<BusinessEmailSettings> {
  if (!settings.domainName) {
    return settings;
  }

  const deliverability = await recalculateEmailDomainReputation({
    businessId: settings.businessId,
    domainName: settings.domainName,
    settings,
  });

  return {
    ...settings,
    deliverability: deliverability ?? undefined,
  };
}

function mapEmailList(row: EmailListRow): EmailList {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    createdByUserId: row.created_by_user_id ?? undefined,
    contactCount: toNumber(row.contact_count),
    memberListIds: parseJsonArray<string>(row.member_list_ids_json),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapEmailContact(row: EmailContactRow): EmailContact {
  return {
    id: row.id,
    businessId: row.business_id,
    email: row.email,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    tags: parseJsonArray<string>(row.tags_json),
    attributes: normalizeContactAttributes(parseJsonObject<EmailContactAttributes>(row.attributes_json)),
    status: row.status,
    unsubscribedAt: toIsoString(row.unsubscribed_at),
    lastBounceAt: toIsoString(row.last_bounce_at),
    lastComplaintAt: toIsoString(row.last_complaint_at),
    lastProviderEventAt: toIsoString(row.last_provider_event_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapEmailCampaign(row: EmailCampaignRow): EmailCampaign {
  return {
    id: row.id,
    businessId: row.business_id,
    listId: row.list_id ?? undefined,
    sourceAssetId: row.source_asset_id ?? undefined,
    sourceIdeaId: row.source_idea_id ?? undefined,
    sourceTitle: row.source_title ?? undefined,
    name: row.name,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    status: row.status,
    replyToEmail: row.reply_to_email ?? undefined,
    createdByUserId: row.created_by_user_id ?? undefined,
    scheduledAt: toIsoString(row.scheduled_at),
    sendStartedAt: toIsoString(row.send_started_at),
    sendCompletedAt: toIsoString(row.send_completed_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: toIsoString(row.updated_at),
    recipientCount: toNumber(row.recipient_count),
    pendingCount: toNumber(row.pending_count),
    sentCount: toNumber(row.sent_count),
    deliveredCount: toNumber(row.delivered_count),
    failedCount: toNumber(row.failed_count),
    unsubscribedCount: toNumber(row.unsubscribed_count),
  };
}

function mapEmailContactImportJob(row: EmailContactImportJobRow): EmailContactImportJob {
  return {
    id: row.id,
    businessId: row.business_id,
    jobId: row.job_id ?? undefined,
    listName: row.list_name,
    fileName: row.file_name ?? undefined,
    status: row.status as EmailContactImportJob["status"],
    totalRows: toNumber(row.total_rows),
    processedRows: toNumber(row.processed_rows),
    insertedCount: toNumber(row.inserted_count),
    updatedCount: toNumber(row.updated_count),
    skippedCount: toNumber(row.skipped_count),
    errorCount: toNumber(row.error_count),
    mapping: parseJsonObject(row.mapping_json),
    errorSummary: parseJsonArray<EmailContactImportJobError>(row.error_summary_json),
    createdAt: new Date(row.created_at).toISOString(),
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
  };
}

function deriveSourceTitleFromContent(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim().split("\n").find((line) => line.trim() !== "");
    return normalized?.trim().slice(0, 120) || null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const direct =
    typeof candidate.text === "string"
      ? candidate.text
      : typeof candidate.textContent === "string"
        ? candidate.textContent
        : typeof candidate.body === "string"
          ? candidate.body
          : "";
  const normalized = direct.trim().split("\n").find((line) => line.trim() !== "");
  return normalized?.trim().slice(0, 120) || null;
}

async function resolveCampaignSource(
  businessId: string,
  input: CreateEmailCampaignRequest,
  client: PoolClient,
): Promise<{
  sourceAssetId: string | null;
  sourceIdeaId: string | null;
  sourceTitle: string | null;
}> {
  const requestedSourceAssetId = input.sourceAssetId?.trim() || null;
  const requestedSourceIdeaId = input.sourceIdeaId?.trim() || null;
  const requestedSourceTitle = input.sourceTitle?.trim() || null;
  let sourceAssetId = requestedSourceAssetId;
  let sourceIdeaId = requestedSourceIdeaId;
  let sourceTitle = requestedSourceTitle;

  if (requestedSourceAssetId) {
    const assetResult = await executeQuery<SourceAssetRow>(
      `
        select
          id,
          business_id,
          title,
          source_idea_id,
          content_body
        from content_assets
        where id = $1::uuid
        limit 1
      `,
      [requestedSourceAssetId],
      client,
    );

    const asset = assetResult.rows[0];

    if (!asset || asset.business_id !== businessId) {
      throw new HttpError(400, "email_campaign_invalid_source", "The selected source draft is invalid for this workspace.");
    }

    sourceAssetId = asset.id;
    sourceIdeaId = asset.source_idea_id ?? sourceIdeaId;
    sourceTitle = asset.title?.trim() || deriveSourceTitleFromContent(asset.content_body) || sourceTitle;
  }

  if (sourceIdeaId) {
    const ideaResult = await executeQuery<SourceIdeaRow>(
      `
        select
          id,
          business_id,
          body,
          understanding_json
        from idea_inbox_items
        where id = $1::uuid
        limit 1
      `,
      [sourceIdeaId],
      client,
    );

    const idea = ideaResult.rows[0];

    if (!idea || idea.business_id !== businessId) {
      throw new HttpError(400, "email_campaign_invalid_source", "The selected source idea is invalid for this workspace.");
    }

    const understanding =
      idea.understanding_json && typeof idea.understanding_json === "object" && !Array.isArray(idea.understanding_json)
        ? (idea.understanding_json as Record<string, unknown>)
        : null;

    sourceTitle =
      sourceTitle
      || (typeof understanding?.topic === "string" && understanding.topic.trim() ? understanding.topic.trim() : null)
      || deriveSourceTitleFromContent(idea.body);
  }

  return {
    sourceAssetId,
    sourceIdeaId,
    sourceTitle,
  };
}

function mapEmailRecipient(row: EmailCampaignRecipientRow): EmailCampaignRecipient {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sendId: row.send_id,
    contactId: row.contact_id,
    personalizedSubject: row.personalized_subject,
    personalizedBodyHtml: row.personalized_body_html,
    personalizedBodyText: row.personalized_body_text,
    status: row.status,
    sesMessageId: row.ses_message_id ?? undefined,
    sentAt: toIsoString(row.sent_at),
    deliveredAt: toIsoString(row.delivered_at),
    failedAt: toIsoString(row.failed_at),
    openCount: toNumber(row.open_count),
    firstOpenedAt: toIsoString(row.first_opened_at),
    lastOpenedAt: toIsoString(row.last_opened_at),
    clickCount: toNumber(row.click_count),
    firstClickedAt: toIsoString(row.first_clicked_at),
    lastClickedAt: toIsoString(row.last_clicked_at),
    failureReason: row.failure_reason ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: toIsoString(row.updated_at),
  };
}

function assertEmailCampaignEditable(
  campaign: Pick<EmailCampaignRow, "status">,
  action: "edit" | "delete",
): void {
  if (campaign.status === "draft" || campaign.status === "failed") {
    return;
  }

  throw new HttpError(
    409,
    "email_campaign_not_editable",
    action === "edit"
      ? "Only draft or failed campaigns can be edited."
      : "Only draft or failed campaigns can be deleted.",
  );
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

async function buildEmailContactSelectProjection(alias: string): Promise<string> {
  const { hasAttributesJson } = await getEmailContactCapabilities();
  const prefix = alias ? `${alias}.` : "";

  return `
    ${prefix}id,
    ${prefix}business_id,
    ${prefix}email,
    ${prefix}first_name,
    ${prefix}last_name,
    ${prefix}tags_json,
    ${hasAttributesJson ? `${prefix}attributes_json` : `'{}'::jsonb as attributes_json`},
    ${prefix}status,
    ${prefix}unsubscribe_token,
    ${prefix}unsubscribed_at,
    ${prefix}last_bounce_at,
    ${prefix}last_complaint_at,
    ${prefix}last_provider_event_at,
    ${prefix}created_at,
    ${prefix}updated_at
  `;
}

function buildEmailContactAttributeFilterClauses(input: {
  values: unknown[];
  attributeFilters?: Record<string, string>;
  hasAttributesJson: boolean;
  columnExpression?: string;
}): string {
  if (!input.hasAttributesJson || !input.attributeFilters) {
    return "";
  }

  const clauses: string[] = [];
  const columnExpression = input.columnExpression ?? "c.attributes_json";

  for (const [key, value] of Object.entries(input.attributeFilters)) {
    const normalizedKey = key.trim();
    const normalizedValues = buildContactAttributeFilterVariants(normalizedKey, value);

    if (!normalizedKey || normalizedValues.length === 0) {
      continue;
    }

    input.values.push(normalizedKey, normalizedValues);
    const keyPosition = input.values.length - 1;
    const valuePosition = input.values.length;
    clauses.push(`and lower(coalesce(${columnExpression} ->> $${keyPosition}, '')) = any($${valuePosition}::text[])`);
  }

  return clauses.length > 0 ? `\n        ${clauses.join("\n        ")}` : "";
}

async function inspectDomainSafety(input: {
  domainName: string;
  dnsRecords: EmailDnsRecord[];
  bypassCache?: boolean;
}): Promise<{
  existingMxJson: string;
  existingSpfValue: string | null;
  existingDmarcValue: string | null;
  recommendedSpfValue: string | null;
  conflictFlagsJson: string;
}> {
  const inspection = await inspectDomainDns({
    domainName: input.domainName,
    requiredDnsRecords: input.dnsRecords,
    bypassCache: input.bypassCache,
  });

  return {
    existingMxJson: JSON.stringify(inspection.existingMxRecords),
    existingSpfValue: inspection.existingSpfValue ?? null,
    existingDmarcValue: inspection.existingDmarcValue ?? null,
    recommendedSpfValue: inspection.recommendedSpfValue ?? null,
    conflictFlagsJson: JSON.stringify(inspection.conflictFlags),
  };
}

async function findEmailUnsubscribe(
  businessId: string,
  email: string,
  client?: PoolClient,
): Promise<EmailUnsubscribeRow | null> {
  const result = await executeQuery<EmailUnsubscribeRow>(
    `
      select
        id,
        business_id,
        email,
        reason,
        source,
        source_campaign_id,
        created_at
      from email_unsubscribes
      where business_id = $1::uuid
        and lower(email) = lower($2)
      limit 1
    `,
    [businessId, normalizeEmail(email)],
    client,
  );

  return result.rows[0] ?? null;
}

async function isEmailUnsubscribed(
  businessId: string,
  email: string,
  client?: PoolClient,
): Promise<boolean> {
  const result = await executeQuery<CountRow>(
    `
      select count(*)::int as total
      from email_unsubscribes
      where business_id = $1::uuid
        and lower(email) = lower($2)
    `,
    [businessId, normalizeEmail(email)],
    client,
  );

  return toNumber(result.rows[0]?.total) > 0;
}

async function findEmailContactByUnsubscribeToken(
  token: string,
  client?: PoolClient,
): Promise<EmailContactRow> {
  const projection = await buildEmailContactSelectProjection("");
  const contactResult = await executeQuery<EmailContactRow>(
    `
      select
        ${projection}
      from email_contacts
      where unsubscribe_token = $1
      limit 1
    `,
    [token],
    client,
  );

  const row = contactResult.rows[0];

  if (!row) {
    throw new HttpError(404, "unsubscribe_token_not_found", "Unsubscribe token not found.");
  }

  return row;
}

async function recordBusinessUnsubscribe(input: {
  businessId: string;
  email: string;
  reason?: string;
  source: EmailUnsubscribeRow["source"];
  sourceCampaignId?: string | null;
}, client?: PoolClient): Promise<void> {
  await executeQuery(
    `
      insert into email_unsubscribes (
        business_id,
        email,
        reason,
        source,
        source_campaign_id
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5::uuid
      )
      on conflict do nothing
    `,
    [
      input.businessId,
      normalizeEmail(input.email),
      input.reason?.trim() || null,
      input.source,
      input.sourceCampaignId ?? null,
    ],
    client,
  );
}

async function removeBusinessUnsubscribe(
  businessId: string,
  email: string,
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      delete from email_unsubscribes
      where business_id = $1::uuid
        and lower(email) = lower($2)
    `,
    [businessId, normalizeEmail(email)],
    client,
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeUnsubscribeReason(value: string | undefined, maxLength = 280): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkifyHtmlText(value: string): string {
  const urlPattern = /https?:\/\/[^\s<]+/gi;
  let html = "";
  let lastIndex = 0;

  for (const match of value.matchAll(urlPattern)) {
    const rawUrl = match[0];
    const index = match.index ?? 0;

    html += escapeHtml(value.slice(lastIndex, index));
    html += `<a href="${escapeHtml(rawUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(rawUrl)}</a>`;
    lastIndex = index + rawUrl.length;
  }

  html += escapeHtml(value.slice(lastIndex));
  return html.replace(/\n/g, "<br />");
}

function renderEmailCtaButtonBlock(cta: { label: string; url: string }): string {
  return `<div style="margin:24px 0;text-align:left;"><a href="${escapeHtml(cta.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;min-height:46px;padding:12px 22px;border-radius:999px;background:linear-gradient(135deg, #d76634 0%, #b94d1f 100%);color:#fffaf5;font-size:15px;font-weight:800;line-height:1.2;text-decoration:none;">${escapeHtml(cta.label)}</a></div>`;
}

function renderEmailParagraphBlock(text: string): string {
  return `<p style="margin:0 0 18px;font-size:16px;line-height:1.8;color:#241813;">${linkifyHtmlText(text)}</p>`;
}

function renderEmailHeroBlock(block: Extract<EmailBodyBlock, { type: "hero" }>): string {
  const parts: string[] = [
    `<section style="margin:0 0 24px;padding:28px 28px 24px;border-radius:26px;background:linear-gradient(135deg, #fff3ea 0%, #f7e2d3 100%);border:1px solid #f0d7c8;">`,
  ];

  if (block.headline) {
    parts.push(
      `<h2 style="margin:0 0 12px;font-size:28px;line-height:1.2;font-weight:900;letter-spacing:-0.02em;color:#241813;">${escapeHtml(block.headline)}</h2>`,
    );
  }

  if (block.body) {
    parts.push(
      `<p style="margin:0 0 18px;font-size:16px;line-height:1.75;color:#5e4639;">${linkifyHtmlText(block.body)}</p>`,
    );
  }

  if (block.buttonLabel && block.buttonUrl) {
    parts.push(renderEmailCtaButtonBlock({ label: block.buttonLabel, url: block.buttonUrl }));
  }

  parts.push(`</section>`);
  return parts.join("");
}

function renderEmailCtaSectionBlock(block: Extract<EmailBodyBlock, { type: "cta_section" }>): string {
  const parts: string[] = [
    `<section style="margin:24px 0;padding:22px 24px;border-radius:22px;background:#fff7f1;border:1px solid #ead6c7;">`,
  ];

  if (block.headline) {
    parts.push(
      `<h3 style="margin:0 0 10px;font-size:22px;line-height:1.3;font-weight:800;color:#241813;">${escapeHtml(block.headline)}</h3>`,
    );
  }

  if (block.body) {
    parts.push(
      `<p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#5e4639;">${linkifyHtmlText(block.body)}</p>`,
    );
  }

  if (block.buttonLabel && block.buttonUrl) {
    parts.push(renderEmailCtaButtonBlock({ label: block.buttonLabel, url: block.buttonUrl }));
  }

  parts.push(`</section>`);
  return parts.join("");
}

function renderEmailFeatureListBlock(block: Extract<EmailBodyBlock, { type: "feature_list" }>): string {
  const itemsHtml = block.items
    .map(
      (item) =>
        `<li style="margin:0 0 10px;color:#4b3528;font-size:15px;line-height:1.7;">${linkifyHtmlText(item)}</li>`,
    )
    .join("");

  return [
    `<section style="margin:24px 0;padding:22px 24px;border-radius:22px;background:#fffdf8;border:1px solid #efe3d8;">`,
    block.title
      ? `<h3 style="margin:0 0 14px;font-size:20px;line-height:1.3;font-weight:800;color:#241813;">${escapeHtml(block.title)}</h3>`
      : "",
    itemsHtml ? `<ul style="margin:0;padding-left:20px;">${itemsHtml}</ul>` : "",
    `</section>`,
  ].join("");
}

function renderEmailBodyBlockHtml(block: EmailBodyBlock): string {
  switch (block.type) {
    case "paragraph":
      return renderEmailParagraphBlock(block.text);
    case "cta_button":
      return renderEmailCtaButtonBlock({ label: block.label, url: block.url });
    case "hero":
      return renderEmailHeroBlock(block);
    case "cta_section":
      return renderEmailCtaSectionBlock(block);
    case "feature_list":
      return renderEmailFeatureListBlock(block);
    default:
      return "";
  }
}

function renderEmailBodyBlockText(block: EmailBodyBlock): string {
  switch (block.type) {
    case "paragraph":
      return block.text;
    case "cta_button":
      return `${block.label}: ${block.url}`;
    case "hero":
    case "cta_section": {
      const lines = [block.headline, block.body]
        .map((value) => value?.trim() || "")
        .filter((value) => value !== "");

      if (block.buttonLabel && block.buttonUrl) {
        lines.push(`${block.buttonLabel}: ${block.buttonUrl}`);
      } else if (block.buttonUrl) {
        lines.push(block.buttonUrl);
      }

      return lines.join("\n");
    }
    case "feature_list": {
      const lines = block.items.map((item) => `- ${item}`);
      if (block.title) {
        lines.unshift(block.title);
      }
      return lines.join("\n");
    }
    default:
      return "";
  }
}

function renderEmailImageBlock(input: { url: string; altText?: string; variant: "header" | "inline" }): string {
  const altText = input.altText?.trim() || (input.variant === "header" ? "Email header image" : "Email image");
  const margin = input.variant === "header" ? "0 0 24px" : "20px 0";
  const borderRadius = input.variant === "header" ? "20px" : "18px";

  return `<div style="margin:${margin};text-align:center;"><img src="${escapeHtml(input.url)}" alt="${escapeHtml(altText)}" style="display:block;width:100%;max-width:600px;margin:0 auto;border-radius:${borderRadius};height:auto;border:0;outline:none;text-decoration:none;" /></div>`;
}

function renderLegacySignatureHtml(input: {
  signatureText: string;
  logoUrl?: string;
  logoAltText?: string;
}): string {
  const paragraphs = input.signatureText
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");

  const logoUrl = normalizeOptionalHttpUrl(input.logoUrl);
  const renderedParagraphs = paragraphs.map(
    (paragraph) =>
      `<p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#6d5d53;">${linkifyHtmlText(paragraph)}</p>`,
  );
  const logoMarkup = logoUrl
    ? `<div style="margin:0 0 16px;"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(input.logoAltText?.trim() || "Brand logo")}" style="display:block;max-width:180px;max-height:72px;width:auto;height:auto;object-fit:contain;border:0;outline:none;text-decoration:none;" /></div>`
    : "";

  return `<div style="margin-top:28px;padding-top:18px;border-top:1px solid #eaded2;">${logoMarkup}${renderedParagraphs.join("")}</div>`;
}

function hasEmailFooterContent(footer?: EmailFooterSettings): boolean {
  if (!footer) {
    return false;
  }

  return Boolean(
    footer.signoff ||
      footer.businessName ||
      footer.websiteUrl ||
      footer.supportEmail ||
      footer.streetAddress ||
      footer.addressLine2 ||
      footer.city ||
      footer.state ||
      footer.postalCode ||
      footer.country ||
      footer.additionalText ||
      Object.keys(footer.socialLinks ?? {}).length > 0,
  );
}

function buildEmailFooterAddressLines(footer?: EmailFooterSettings): string[] {
  if (!footer) {
    return [];
  }

  const localityLine = [footer.city, footer.state, footer.postalCode].filter(Boolean).join(", ").replace(", ,", ",");

  return [footer.streetAddress, footer.addressLine2, localityLine, footer.country]
    .map((line) => line?.trim() || "")
    .filter((line) => line !== "");
}

function buildEmailFooterAddressUrl(footer?: EmailFooterSettings): string | undefined {
  const address = buildEmailFooterAddressLines(footer).join(", ");
  return address ? `https://maps.google.com/?q=${encodeURIComponent(address)}` : undefined;
}

function buildEmailFooterText(
  footer: EmailFooterSettings | undefined,
  fallbackSignatureText = "",
): string {
  if (!hasEmailFooterContent(footer)) {
    return fallbackSignatureText.trim();
  }

  const lines: string[] = [];

  if (footer?.signoff) {
    lines.push(footer.signoff.trim());
  }

  if (footer?.businessName) {
    lines.push(footer.businessName);
  }

  if (footer?.websiteUrl) {
    lines.push(footer.websiteUrl);
  }

  if (footer?.supportEmail) {
    lines.push(footer.supportEmail);
  }

  const addressLines = buildEmailFooterAddressLines(footer);

  if (addressLines.length > 0) {
    lines.push(addressLines.join(", "));
  }

  for (const [platform, url] of Object.entries(footer?.socialLinks ?? {})) {
    if (url) {
      lines.push(`${platform}: ${url}`);
    }
  }

  if (footer?.additionalText) {
    lines.push(footer.additionalText);
  }

  return lines.join("\n");
}

function renderEmailFooterSocialButtons(footer?: EmailFooterSettings): string {
  const socialEntries = Object.entries(footer?.socialLinks ?? {}).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  );

  if (socialEntries.length === 0) {
    return "";
  }

  const labels: Record<string, string> = {
    facebook: "f",
    instagram: "ig",
    x: "x",
    youtube: "yt",
    linkedin: "in",
  };

  const colors: Record<string, string> = {
    facebook: "#1877F2",
    instagram: "#E4405F",
    x: "#111827",
    youtube: "#FF0000",
    linkedin: "#0A66C2",
  };

  return `<div style="margin-top:16px;text-align:center;">${socialEntries
    .map(
      ([platform, url]) =>
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin:0 4px;width:34px;height:34px;line-height:34px;border-radius:999px;background:${colors[platform] || "#6d5d53"};color:#ffffff;text-decoration:none;font-size:${platform === "instagram" ? "10px" : "12px"};font-weight:700;text-transform:uppercase;text-align:center;">${escapeHtml(labels[platform] || platform.slice(0, 2))}</a>`,
    )
    .join("")}</div>`;
}

function renderEmailFooterHtml(input: {
  footer?: EmailFooterSettings;
  fallbackSignatureText?: string;
  logoUrl?: string;
  logoAltText?: string;
}): string {
  const footer = normalizeEmailFooterSettings(input.footer);
  const logoUrl = resolveStoredLogoUrl(input.logoUrl) ?? normalizeOptionalHttpUrl(input.logoUrl);
  const fallbackSignatureText = input.fallbackSignatureText?.trim() || "";
  const footerText = buildEmailFooterText(footer, fallbackSignatureText);

  if (!hasEmailFooterContent(footer)) {
    return footerText || logoUrl
      ? renderLegacySignatureHtml({
          signatureText: footerText,
          logoUrl: logoUrl ?? undefined,
          logoAltText: input.logoAltText,
        })
      : "";
  }

  const signoffMarkup = footer?.signoff
    ? footer.signoff
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map(
          (line) =>
            `<p style="margin:0 0 4px;font-size:16px;line-height:1.6;color:#3b2d23;text-align:center;font-weight:600;">${escapeHtml(line)}</p>`,
        )
        .join("")
    : "";
  const primaryLinks = [
    footer?.businessName ? `<strong style="font-weight:700;color:#2b1f19;">${escapeHtml(footer.businessName)}</strong>` : "",
    footer?.websiteUrl
      ? `<a href="${escapeHtml(footer.websiteUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:underline;">${escapeHtml(footer.websiteUrl)}</a>`
      : "",
    footer?.supportEmail
      ? `<a href="mailto:${escapeHtml(footer.supportEmail)}" style="color:#2563eb;text-decoration:underline;">${escapeHtml(footer.supportEmail)}</a>`
      : "",
  ].filter(Boolean);
  const addressLines = buildEmailFooterAddressLines(footer);
  const addressUrl = buildEmailFooterAddressUrl(footer);
  const additionalMarkup = footer?.additionalText
    ? footer.additionalText
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph !== "")
        .map(
          (paragraph) =>
            `<p style="margin:12px 0 0;font-size:13px;line-height:1.7;color:#6d5d53;text-align:center;">${linkifyHtmlText(paragraph)}</p>`,
        )
        .join("")
    : "";
  const logoMarkup = logoUrl
    ? `<div style="margin:0 0 16px;text-align:center;"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(input.logoAltText?.trim() || "Brand logo")}" style="display:inline-block;max-width:180px;max-height:72px;width:auto;height:auto;object-fit:contain;border:0;outline:none;text-decoration:none;" /></div>`
    : "";

  return `
    <div style="margin-top:28px;padding-top:18px;border-top:1px solid #eaded2;">
      ${logoMarkup}
      ${signoffMarkup}
      ${
        primaryLinks.length > 0
          ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.7;color:#6d5d53;text-align:center;">${primaryLinks.join('<span style="margin:0 6px;color:#c6ad9c;">|</span>')}</p>`
          : ""
      }
      ${
        addressLines.length > 0
          ? `<p style="margin:10px 0 0;font-size:13px;line-height:1.7;color:#6d5d53;text-align:center;">${
              addressUrl
                ? `<a href="${escapeHtml(addressUrl)}" target="_blank" rel="noopener noreferrer" style="color:#6d5d53;text-decoration:underline;">${escapeHtml(addressLines.join(", "))}</a>`
                : escapeHtml(addressLines.join(", "))
            }</p>`
          : ""
      }
      ${renderEmailFooterSocialButtons(footer)}
      ${additionalMarkup}
    </div>
  `.trim();
}

function resolveEmailSignatureText(
  settings: Pick<BusinessEmailSettings, "signatureText" | "fromName" | "fromEmail">,
): string {
  const explicit = settings.signatureText?.trim();

  if (explicit) {
    return explicit;
  }

  return [settings.fromName?.trim(), settings.fromEmail?.trim()].filter(Boolean).join("\n");
}

function buildEmailCampaignBodies(
  input: CreateEmailCampaignRequest,
  settings: Pick<BusinessEmailSettings, "signatureText" | "fromName" | "fromEmail" | "footer">,
  footerBranding: {
    logoUrl?: string;
    logoAltText?: string;
  } = {},
): { html: string; text: string } {
  const baseText = (input.bodyText?.trim() || stripHtml(input.bodyHtml ?? "")).trim();

  if (!baseText) {
    throw new HttpError(400, "email_campaign_invalid", "Subject and email body are required.");
  }

  const content = input.content;
  const headerImageUrl = normalizeOptionalHttpUrl(content?.headerImage?.url);
  const inlineImages = (content?.inlineImages ?? [])
    .flatMap((image) => {
      const url = normalizeOptionalHttpUrl(image.url);

      if (!url) {
        return [];
      }

      return [
        {
          url,
          altText: image.altText?.trim() || undefined,
        },
      ];
    })
    .slice(0, 6);
  const includeSignature = content?.includeSignature !== false;
  const signatureText = includeSignature ? resolveEmailSignatureText(settings) : "";
  const footerLogoUrl = includeSignature ? normalizeOptionalHttpUrl(footerBranding.logoUrl) : null;

  const blocks = parseEmailBodyBlocks(baseText);

  const htmlParts: string[] = [
    `<div style="width:100%;max-width:600px;margin:0 auto;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#241813;background:#fffaf5;">`,
  ];
  const textParts: string[] = [];

  if (headerImageUrl) {
    htmlParts.push(
      renderEmailImageBlock({
        url: headerImageUrl,
        altText: content?.headerImage?.altText,
        variant: "header",
      }),
    );
    textParts.push(`Header image: ${headerImageUrl}`);
  }

  blocks.forEach((block, index) => {
    htmlParts.push(renderEmailBodyBlockHtml(block));
    textParts.push(renderEmailBodyBlockText(block));

    if (index === 0 && inlineImages.length > 0) {
      for (const image of inlineImages) {
        htmlParts.push(
          renderEmailImageBlock({
            url: image.url,
            altText: image.altText,
            variant: "inline",
          }),
        );
        textParts.push(`Image: ${image.url}`);
      }
    }
  });

  if (blocks.length === 0) {
    if (baseText) {
      htmlParts.push(renderEmailParagraphBlock(baseText));
      textParts.push(baseText);
    }
  }

  if (blocks.length === 0 && inlineImages.length > 0) {
    for (const image of inlineImages) {
      htmlParts.push(
        renderEmailImageBlock({
          url: image.url,
          altText: image.altText,
          variant: "inline",
        }),
      );
      textParts.push(`Image: ${image.url}`);
    }
  }

  if (hasEmailFooterContent(settings.footer) || signatureText || footerLogoUrl) {
    const renderedFooter = renderEmailFooterHtml({
      footer: settings.footer,
      fallbackSignatureText: signatureText,
      logoUrl: footerLogoUrl ?? undefined,
      logoAltText: footerBranding.logoAltText,
    });

    if (renderedFooter) {
      htmlParts.push(renderedFooter);
    }

    const footerText = buildEmailFooterText(settings.footer, signatureText);

    if (footerText) {
      textParts.push(footerText);
    }
  }

  htmlParts.push("</div>");

  return {
    html: htmlParts.join(""),
    text: textParts.join("\n\n").trim(),
  };
}

function personalizeTemplate(template: string, contact: Pick<EmailContact, "firstName" | "lastName" | "email">): string {
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return template
    .replace(/{{\s*name\s*}}/gi, fullName || contact.firstName || contact.email)
    .replace(/{{\s*first_name\s*}}/gi, contact.firstName || contact.email)
    .replace(/{{\s*last_name\s*}}/gi, contact.lastName || "");
}

function appendUnsubscribeFooter(html: string, text: string, unsubscribeUrl: string): {
  html: string;
  text: string;
} {
  return {
    html: `${html}<p style="margin-top:24px;font-size:12px;color:#6b7280;">If you no longer want these emails, <a href="${unsubscribeUrl}">unsubscribe here</a>.</p>`,
    text: `${text}\n\nIf you no longer want these emails, unsubscribe here: ${unsubscribeUrl}`,
  };
}

function buildPreviewCampaignInput(input: PreviewEmailCampaignRequest): CreateEmailCampaignRequest {
  return {
    listId: "",
    name: input.subject.trim() || "Preview email",
    subject: input.subject.trim(),
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText,
    replyToEmail: input.replyToEmail,
    content: input.content,
  };
}

function buildPreviewEmailSettings(
  base: BusinessEmailSettings,
  sender?: EmailPreviewSenderSettings,
): Pick<BusinessEmailSettings, "signatureText" | "fromName" | "fromEmail" | "replyToEmail" | "footer"> {
  const footer = normalizeEmailFooterSettings(sender?.footer) ?? base.footer;
  const fromName = sender?.fromName?.trim() || base.fromName;
  const fromEmail = normalizeOptionalEmail(sender?.fromEmail) ?? base.fromEmail;
  const replyToEmail = normalizeOptionalEmail(sender?.replyToEmail) ?? base.replyToEmail;
  const signatureText =
    sender?.signatureText?.trim() || buildEmailFooterText(footer, base.signatureText ?? "");

  return {
    fromName: fromName || undefined,
    fromEmail: fromEmail || undefined,
    replyToEmail: replyToEmail || undefined,
    signatureText: signatureText || undefined,
    footer,
  };
}

function buildEmailPreviewBodies(
  input: PreviewEmailCampaignRequest,
  settings: Pick<BusinessEmailSettings, "signatureText" | "fromName" | "fromEmail" | "replyToEmail" | "footer">,
  footerBranding: {
    logoUrl?: string;
    logoAltText?: string;
  },
): { html: string; text: string } {
  const renderedBody = buildEmailCampaignBodies(buildPreviewCampaignInput(input), settings, footerBranding);
  const unsubscribeUrl = `${resolveEmailPublicApiBaseUrl()}/email/unsubscribe/test-preview`;
  return appendUnsubscribeFooter(renderedBody.html, renderedBody.text, unsubscribeUrl);
}

async function updateEmailSettingsConfiguration(
  businessId: string,
  patch: {
    footer?: EmailFooterSettings;
    testRecipientEmail?: string;
  },
  client?: PoolClient,
): Promise<EmailSettingsRow> {
  const existingRow = await ensureEmailSettingsRow(businessId, client);
  const existingConfiguration = parseEmailSettingsConfiguration(existingRow.configuration_json);
  const nextConfiguration = buildEmailSettingsConfiguration({
    footer: patch.footer ?? existingConfiguration.footer,
    testRecipientEmail: patch.testRecipientEmail ?? existingConfiguration.testRecipientEmail,
  });

  const result = await executeQuery<EmailSettingsRow>(
    `
      update business_email_settings
      set
        configuration_json = $2::jsonb,
        updated_at = now()
      where business_id = $1::uuid
      returning
        ${EMAIL_SETTINGS_SELECT_FIELDS}
    `,
    [businessId, JSON.stringify(nextConfiguration)],
    client,
  );

  if (!result.rows[0]) {
    throw new HttpError(500, "email_settings_missing", "Email settings could not be updated.");
  }

  return result.rows[0];
}

interface ParsedEmailImportContact {
  email: string;
  firstName?: string;
  lastName?: string;
  lists: string[];
  tags: string[];
  attributes: EmailContactAttributes;
  raw: Record<string, string>;
  issues: string[];
}

interface ParsedEmailImportPayload {
  columns: string[];
  suggestedMapping: EmailContactImportMapping;
  fieldPreviews: EmailContactImportFieldPreview[];
  previewRows: EmailContactImportPreviewRow[];
  contacts: ParsedEmailImportContact[];
  summary: Omit<EmailContactImportPreviewSummary, "existingContacts">;
}

interface UpsertContactResult {
  row: EmailContactRow;
  operation: "created" | "updated" | "skipped";
}

const EMAIL_CONTACT_IMPORT_FIELDS: Array<{
  field: EmailContactImportField;
  label: string;
  required: boolean;
}> = [
  { field: "email", label: "Email", required: true },
  { field: "name", label: "Full name", required: false },
  { field: "firstName", label: "First name", required: false },
  { field: "lastName", label: "Last name", required: false },
  { field: "lists", label: "Lists", required: false },
  { field: "tags", label: "Tags", required: false },
  { field: "state", label: "State", required: false },
  { field: "city", label: "City", required: false },
  { field: "business_type", label: "Business type", required: false },
  { field: "audience_type", label: "Audience type", required: false },
  { field: "language", label: "Language", required: false },
  { field: "plan", label: "Plan", required: false },
];

const EMAIL_CONTACT_IMPORT_FIELD_ALIASES: Record<EmailContactImportField, string[]> = {
  email: [
    "email",
    "emailaddress",
    "email_address",
    "e-mail",
    "mail",
    "contactemail",
    "contact_email",
    "workemail",
  ],
  name: [
    "name",
    "fullname",
    "full_name",
    "full name",
    "contactname",
    "contact_name",
  ],
  firstName: [
    "firstname",
    "first_name",
    "first name",
    "givenname",
    "given_name",
  ],
  lastName: [
    "lastname",
    "last_name",
    "last name",
    "surname",
    "familyname",
    "family_name",
  ],
  lists: ["lists", "list", "listname", "list_name", "audience_groups", "audiences", "groups"],
  tags: ["tags", "tag", "labels", "segments", "interests"],
  state: ["state", "region", "province", "territory"],
  city: ["city", "town", "municipality"],
  business_type: ["business_type", "business type", "industry", "vertical", "businesscategory"],
  audience_type: ["audience_type", "audience type", "audience", "persona", "segment_type"],
  language: ["language", "locale", "preferredlanguage", "preferred_language"],
  plan: ["plan", "tier", "account_type", "account type", "membership", "subscription"],
};

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let insideQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const nextCharacter = csvText[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === "," && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      currentRow.push(currentCell.trim());
      currentCell = "";
      if (currentRow.some((cell) => cell !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  if (currentCell !== "" || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell !== "")) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function normalizeColumnName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function computeLevenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (!left) {
    return right.length;
  }

  if (!right) {
    return left.length;
  }

  const rows = left.length + 1;
  const columns = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    matrix[rowIndex][0] = rowIndex;
  }

  for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
    matrix[0][columnIndex] = columnIndex;
  }

  for (let rowIndex = 1; rowIndex < rows; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex < columns; columnIndex += 1) {
      const cost = left[rowIndex - 1] === right[columnIndex - 1] ? 0 : 1;
      matrix[rowIndex][columnIndex] = Math.min(
        matrix[rowIndex - 1][columnIndex] + 1,
        matrix[rowIndex][columnIndex - 1] + 1,
        matrix[rowIndex - 1][columnIndex - 1] + cost,
      );
    }
  }

  return matrix[left.length][right.length];
}

function looksLikeHeaderRow(row: string[]): boolean {
  const normalized = row.map((cell) => normalizeColumnName(cell));

  if (
    normalized.some((cell) =>
      Object.values(EMAIL_CONTACT_IMPORT_FIELD_ALIASES).some((aliases) =>
        aliases.map(normalizeColumnName).includes(cell),
      ),
    )
  ) {
    return true;
  }

  return !row.some((cell) => EMAIL_ADDRESS_PATTERN.test(cell.trim()));
}

function scoreColumnMatch(field: EmailContactImportField, columnName: string): {
  score: number;
  confidence: EmailContactImportFieldPreview["confidence"];
} {
  const normalizedColumn = normalizeColumnName(columnName);

  if (!normalizedColumn) {
    return { score: 0, confidence: "none" };
  }

  const aliases = EMAIL_CONTACT_IMPORT_FIELD_ALIASES[field].map(normalizeColumnName);

  if (aliases.includes(normalizedColumn)) {
    return { score: 100, confidence: "high" };
  }

  if (aliases.some((alias) => alias.includes(normalizedColumn) || normalizedColumn.includes(alias))) {
    return { score: 82, confidence: "medium" };
  }

  let bestDistance = Number.POSITIVE_INFINITY;

  for (const alias of aliases) {
    bestDistance = Math.min(bestDistance, computeLevenshteinDistance(alias, normalizedColumn));
  }

  if (bestDistance <= 2) {
    return { score: 68 - bestDistance * 6, confidence: "low" };
  }

  return { score: 0, confidence: "none" };
}

function buildSuggestedImportMapping(columns: string[]): {
  mapping: EmailContactImportMapping;
  fields: EmailContactImportFieldPreview[];
} {
  const mapping: EmailContactImportMapping = {};
  const fields: EmailContactImportFieldPreview[] = [];
  const availableColumns = [...columns];

  for (const definition of EMAIL_CONTACT_IMPORT_FIELDS) {
    let selectedColumn = "";
    let selectedConfidence: EmailContactImportFieldPreview["confidence"] = "none";
    let selectedScore = -1;

    for (const columnName of availableColumns) {
      const { score, confidence } = scoreColumnMatch(definition.field, columnName);

      if (score > selectedScore) {
        selectedScore = score;
        selectedColumn = columnName;
        selectedConfidence = confidence;
      }
    }

    if (selectedScore > 0 && selectedColumn) {
      mapping[definition.field] = selectedColumn;
      const selectedIndex = availableColumns.indexOf(selectedColumn);

      if (selectedIndex >= 0) {
        availableColumns.splice(selectedIndex, 1);
      }
    }

    fields.push({
      field: definition.field,
      label: definition.label,
      required: definition.required,
      columnName: selectedScore > 0 ? selectedColumn : undefined,
      confidence: selectedScore > 0 ? selectedConfidence : "none",
    });
  }

  if (!mapping.email && columns[0]) {
    mapping.email = columns[0];
    const emailField = fields.find((field) => field.field === "email");

    if (emailField) {
      emailField.columnName = columns[0];
      emailField.confidence = "low";
    }
  }

  if (!mapping.name && columns[1] && columns[1] !== mapping.email) {
    mapping.name = columns[1];
    const nameField = fields.find((field) => field.field === "name");

    if (nameField) {
      nameField.columnName = columns[1];
      nameField.confidence = "low";
    }
  }

  return { mapping, fields };
}

function sanitizeImportMapping(
  mapping: EmailContactImportMapping | undefined,
  availableColumns: string[],
): EmailContactImportMapping {
  const available = new Set(availableColumns);
  const sanitized: EmailContactImportMapping = {};
  const usedColumns = new Set<string>();

  for (const field of EMAIL_CONTACT_IMPORT_FIELDS.map((definition) => definition.field)) {
    const candidate = mapping?.[field]?.trim();

    if (!candidate || !available.has(candidate) || usedColumns.has(candidate)) {
      continue;
    }

    sanitized[field] = candidate;
    usedColumns.add(candidate);
  }

  return sanitized;
}

function splitDelimitedImportValues(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[|,;]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function splitTags(value: string | undefined): string[] {
  return splitDelimitedImportValues(value);
}

function splitListNames(value: string | undefined): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const candidate of splitDelimitedImportValues(value)) {
    const normalizedKey = normalizeEmailListNameKey(candidate);

    if (!normalizedKey || seen.has(normalizedKey)) {
      continue;
    }

    seen.add(normalizedKey);
    names.push(candidate);
  }

  return names;
}

function extractImportedListNames(contacts: ParsedEmailImportContact[], fallbackListName: string): string[] {
  const seen = new Set<string>();
  const listNames: string[] = [];

  const register = (candidate: string | undefined): void => {
    const normalized = candidate?.trim();

    if (!normalized) {
      return;
    }

    const key = normalizeEmailListNameKey(normalized);

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    listNames.push(normalized);
  };

  register(fallbackListName);

  for (const contact of contacts) {
    for (const listName of contact.lists) {
      register(listName);
    }
  }

  return listNames;
}

function describeImportedLists(
  contacts: ParsedEmailImportContact[],
  fallbackListName: string,
): string {
  const listNames = extractImportedListNames(contacts, fallbackListName);

  if (listNames.length === 0) {
    return "Imported contacts";
  }

  if (listNames.length === 1) {
    return listNames[0];
  }

  return `${listNames[0]} + ${listNames.length - 1} more lists`;
}

function extractAppliedImportMapping(
  fields: EmailContactImportFieldPreview[],
): EmailContactImportMapping {
  const mapping: EmailContactImportMapping = {};

  for (const field of fields) {
    if (field.columnName) {
      mapping[field.field] = field.columnName;
    }
  }

  return mapping;
}

function buildImportErrorSummary(summary: {
  invalidRows: number;
  duplicateRows: number;
}): EmailContactImportJobError[] {
  const errorSummary: EmailContactImportJobError[] = [];

  if (summary.invalidRows > 0) {
    errorSummary.push({
      message: "Invalid rows were skipped because they were missing a usable email.",
      rowCount: summary.invalidRows,
    });
  }

  if (summary.duplicateRows > 0) {
    errorSummary.push({
      message: "Duplicate emails in the uploaded file were collapsed before import.",
      rowCount: summary.duplicateRows,
    });
  }

  return errorSummary;
}

function parseContactImportPayload(
  csvText: string,
  overrideMapping?: EmailContactImportMapping,
): ParsedEmailImportPayload {
  const rows = parseCsvRows(csvText);

  if (rows.length === 0) {
    throw new HttpError(400, "contacts_csv_empty", "CSV input is empty.");
  }

  const hasHeader = looksLikeHeaderRow(rows[0]);
  const columns = hasHeader ? rows[0].map((cell, index) => cell.trim() || `column_${index + 1}`) : rows[0].map((_, index) => `column_${index + 1}`);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const { mapping: suggestedMapping, fields } = buildSuggestedImportMapping(columns);
  const mapping = {
    ...suggestedMapping,
    ...sanitizeImportMapping(overrideMapping, columns),
  };
  const sanitizedMapping = sanitizeImportMapping(mapping, columns);
  const seenEmails = new Set<string>();
  const contacts: ParsedEmailImportContact[] = [];
  const previewRows: EmailContactImportPreviewRow[] = [];
  let invalidRows = 0;
  let duplicateRows = 0;

  for (const row of dataRows) {
    const raw = Object.fromEntries(columns.map((columnName, index) => [columnName, row[index]?.trim() || ""]));
    const email = normalizeOptionalEmail(sanitizedMapping.email ? raw[sanitizedMapping.email] : undefined) || "";
    const nameValue = sanitizedMapping.name ? raw[sanitizedMapping.name] : "";
    const firstNameValue = sanitizedMapping.firstName ? raw[sanitizedMapping.firstName] : "";
    const lastNameValue = sanitizedMapping.lastName ? raw[sanitizedMapping.lastName] : "";
    const [fallbackFirstName, ...fallbackRest] = nameValue.split(/\s+/).filter(Boolean);
    const issues: string[] = [];

    if (!email) {
      issues.push("Missing email");
    } else if (!EMAIL_ADDRESS_PATTERN.test(email)) {
      issues.push("Invalid email");
    }

    if (email && seenEmails.has(email)) {
      issues.push("Duplicate email in file");
      duplicateRows += 1;
    }

    const lists = splitListNames(sanitizedMapping.lists ? raw[sanitizedMapping.lists] : undefined);
    const tags = splitTags(sanitizedMapping.tags ? raw[sanitizedMapping.tags] : undefined);
    const attributes = extractContactAttributesFromRaw(raw, sanitizedMapping);
    const parsedContact: ParsedEmailImportContact = {
      email,
      firstName: firstNameValue || fallbackFirstName || undefined,
      lastName: lastNameValue || (fallbackRest.length > 0 ? fallbackRest.join(" ") : undefined),
      lists,
      tags,
      attributes,
      raw,
      issues,
    };

    if (issues.length > 0) {
      invalidRows += issues.includes("Duplicate email in file") && issues.length === 1 ? 0 : 1;
    } else {
      seenEmails.add(email);
      contacts.push(parsedContact);
    }

    if (previewRows.length < 10) {
      previewRows.push({
        email: email || undefined,
        name: nameValue || undefined,
        firstName: parsedContact.firstName,
        lastName: parsedContact.lastName,
        lists,
        tags,
        attributes,
        issues,
        raw,
      });
    }
  }

  if (contacts.length === 0) {
    throw new HttpError(400, "contacts_csv_invalid", "CSV must include at least one valid email.");
  }

  return {
    columns,
    suggestedMapping: suggestedMapping,
    fieldPreviews: fields.map((field) => ({
      ...field,
      columnName: sanitizedMapping[field.field] ?? field.columnName,
    })),
    previewRows,
    contacts,
    summary: {
      totalRows: dataRows.length,
      validRows: contacts.length,
      invalidRows,
      duplicateRows,
    },
  };
}

async function ensureEmailSettingsRow(
  businessId: string,
  client?: PoolClient,
): Promise<EmailSettingsRow> {
  await executeQuery(
    `
      insert into business_email_settings (
        business_id,
        provider,
        from_name,
        from_email
      ) values (
        $1::uuid,
        'ses',
        $2,
        $3
      )
      on conflict (business_id) do nothing
    `,
    [
      businessId,
      process.env.SYSTEM_FROM_NAME?.trim() || null,
      process.env.SYSTEM_FROM_EMAIL?.trim() || null,
    ],
    client,
  );

  const result = await executeQuery<EmailSettingsRow>(
    `
      select
        ${EMAIL_SETTINGS_SELECT_FIELDS}
      from business_email_settings
      where business_id = $1::uuid
      limit 1
    `,
    [businessId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(500, "email_settings_missing", "Email settings could not be initialized.");
  }

  return row;
}

async function refreshEmailDomainSettings(
  row: EmailSettingsRow,
  options: { bypassDnsCache?: boolean } = {},
): Promise<BusinessEmailSettings> {
  if (!row.domain_name) {
    throw new HttpError(400, "email_domain_missing", "No business email domain is configured.");
  }

  const snapshot = await getSesDomainIdentity(row.ses_identity ?? row.domain_name);
  const safety = await inspectDomainSafety({
    domainName: row.domain_name,
    dnsRecords: snapshot.dnsRecords,
    bypassCache: options.bypassDnsCache,
  });
  const updatedResult = await executeQuery<EmailSettingsRow>(
    `
      update business_email_settings
      set
        domain_status = $2,
        dkim_status = $3,
        spf_status = $4,
        ses_identity = $5,
        dns_records_json = $6::jsonb,
        existing_mx_json = $7::jsonb,
        existing_spf_value = $8,
        existing_dmarc_value = $9,
        recommended_spf_value = $10,
        conflict_flags_json = $11::jsonb,
        verified_at = case
          when $2 = '${DOMAIN_STATUS_VERIFIED}' then coalesce(verified_at, now())
          else null
        end,
        last_checked_at = now(),
        updated_at = now()
      where id = $1::uuid
      returning
        ${EMAIL_SETTINGS_SELECT_FIELDS}
    `,
    [
      row.id,
      snapshot.domainStatus,
      snapshot.dkimStatus,
      snapshot.spfStatus,
      snapshot.sesIdentity,
      JSON.stringify(snapshot.dnsRecords),
      safety.existingMxJson,
      safety.existingSpfValue,
      safety.existingDmarcValue,
      safety.recommendedSpfValue,
      safety.conflictFlagsJson,
    ],
  );

  return attachEmailDeliverability(mapEmailSettings(updatedResult.rows[0]));
}

async function ensureBusinessEmailSendingPreconditions(businessId: string): Promise<void> {
  const settings = mapEmailSettings(await ensureEmailSettingsRow(businessId));
  const fromEmail = settings.fromEmail || process.env.SYSTEM_FROM_EMAIL?.trim();

  if (!fromEmail || !settings.domainName || extractEmailDomain(fromEmail) !== settings.domainName) {
    return;
  }

  if (!settings.id) {
    throw new HttpError(400, "email_domain_missing", "Business email settings are incomplete.");
  }

  const refreshedSettings = (await verifyEmailDomain(businessId, settings.id)).settings;

  if (hasBlockingConflict(refreshedSettings.domainSetupAnalysis?.conflictFlags ?? [])) {
    throw new HttpError(
      409,
      "email_domain_dns_conflict",
      "This business domain still has DNS conflicts. Resolve the flagged SPF or DMARC issues before sending from this domain.",
    );
  }

  if (
    refreshedSettings.domainStatus !== DOMAIN_STATUS_VERIFIED ||
    refreshedSettings.dkimStatus !== DOMAIN_STATUS_VERIFIED
  ) {
    throw new HttpError(
      409,
      "email_domain_unverified",
      "This business domain is not verified yet. Add the SES DNS records and verify the domain before sending.",
    );
  }

  if (!refreshedSettings.domainSetupAnalysis?.spfReady) {
    const spfValidationState = refreshedSettings.domainSetupAnalysis?.spfValidationState;
    throw new HttpError(
      409,
      "email_domain_spf_unready",
      spfValidationState === "multiple_records"
        ? "This business domain has multiple SPF records. Consolidate them into a single valid SPF record before sending branded email."
        : spfValidationState === "malformed"
          ? "This business domain has a malformed SPF record. Fix it so it starts with v=spf1 and ends with ~all or -all before sending branded email."
          : refreshedSettings.domainSetupAnalysis?.existingSpfValue
            ? "This business domain still needs an SPF update. Edit the existing SPF record and add include:amazonses.com before sending branded email."
            : "This business domain does not have an SPF record yet. Add the recommended SPF record before sending branded email.",
    );
  }

  if (refreshedSettings.deliverability?.sendingBlocked) {
    const blockingIssue =
      refreshedSettings.deliverability.blockers.find((issue) => issue.severity === "error") ??
      refreshedSettings.deliverability.blockers[0];

    throw new HttpError(
      409,
      "email_domain_deliverability_blocked",
      blockingIssue?.message ||
        "Sending is paused because this domain has deliverability issues that need attention first.",
    );
  }
}

async function upsertContact(
  businessId: string,
  input: {
    email: string;
    firstName?: string;
    lastName?: string;
    tags: string[];
    attributes: EmailContactAttributes;
  },
  strategy: EmailContactImportDuplicateStrategy,
  client: PoolClient,
): Promise<UpsertContactResult> {
  const normalizedEmail = normalizeEmail(input.email);
  const isSuppressed = await isEmailUnsubscribed(businessId, normalizedEmail, client);
  const { hasAttributesJson } = await getEmailContactCapabilities();
  const projection = await buildEmailContactSelectProjection("");
  const existingResult = await executeQuery<EmailContactRow>(
    `
      select
        ${projection}
      from email_contacts
      where business_id = $1::uuid
        and lower(email) = lower($2)
      limit 1
    `,
    [businessId, normalizedEmail],
    client,
  );

  const tagJson = JSON.stringify(input.tags);
  const attributeJson = JSON.stringify(input.attributes ?? {});

  if (existingResult.rows[0]) {
    if (strategy === "skip") {
      return {
        row: existingResult.rows[0],
        operation: "skipped",
      };
    }

    const updateResult = await executeQuery<EmailContactRow>(
      `
        update email_contacts
        set
          first_name = coalesce($2, first_name),
          last_name = coalesce($3, last_name),
          status = case
            when $5 then 'unsubscribed'
            else status
          end,
          unsubscribed_at = case
            when $5 and unsubscribed_at is null then now()
            else unsubscribed_at
          end,
          tags_json = case
            when jsonb_array_length($4::jsonb) > 0 then $4::jsonb
            else tags_json
          end,
          ${hasAttributesJson ? "attributes_json = case when $6::jsonb <> '{}'::jsonb then coalesce(attributes_json, '{}'::jsonb) || $6::jsonb else attributes_json end," : ""}
          updated_at = now()
        where id = $1::uuid
        returning
          ${projection}
      `,
      [
        existingResult.rows[0].id,
        input.firstName ?? null,
        input.lastName ?? null,
        tagJson,
        isSuppressed,
        ...(hasAttributesJson ? [attributeJson] : []),
      ],
      client,
    );

    return {
      row: updateResult.rows[0],
      operation: "updated",
    };
  }

  const insertResult = await executeQuery<EmailContactRow>(
    `
      insert into email_contacts (
        business_id,
        email,
        first_name,
        last_name,
        tags_json,
        ${hasAttributesJson ? "attributes_json," : ""}
        status,
        unsubscribed_at
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5::jsonb,
        ${hasAttributesJson ? "$6::jsonb," : ""}
        $${hasAttributesJson ? "7" : "6"},
        $${hasAttributesJson ? "8" : "7"}::timestamptz
      )
      returning
        ${projection}
    `,
    [
      businessId,
      normalizedEmail,
      input.firstName ?? null,
      input.lastName ?? null,
      tagJson,
      ...(hasAttributesJson ? [attributeJson] : []),
      isSuppressed ? "unsubscribed" : "active",
      isSuppressed ? new Date().toISOString() : null,
    ],
    client,
  );

  return {
    row: insertResult.rows[0],
    operation: "created",
  };
}

async function loadEmailCampaignOrThrow(
  businessId: string,
  campaignId: string,
  client?: PoolClient,
): Promise<EmailCampaignRow> {
  const result = await executeQuery<EmailCampaignRow>(
    `
      select
        c.id,
        c.business_id,
        c.list_id,
        c.source_asset_id,
        c.source_idea_id,
        c.source_title,
        c.name,
        c.subject,
        c.body_html,
        c.body_text,
        c.status,
        c.reply_to_email,
        c.created_by_user_id,
        c.scheduled_at,
        c.send_started_at,
        c.send_completed_at,
        c.created_at,
        c.updated_at,
        count(r.id)::int as recipient_count,
        count(r.id) filter (where r.status in ('queued', 'sending'))::int as pending_count,
        count(r.id) filter (where r.status in ('sent', 'delivered'))::int as sent_count,
        count(r.id) filter (where r.status = 'delivered')::int as delivered_count,
        count(r.id) filter (where r.status = 'failed')::int as failed_count,
        count(r.id) filter (where r.status = 'unsubscribed')::int as unsubscribed_count
      from email_campaigns c
      left join lateral (
        select s.id
        from email_campaign_sends s
        where s.campaign_id = c.id
        order by s.created_at desc, s.id desc
        limit 1
      ) latest_send on true
      left join email_campaign_recipients r on r.send_id = latest_send.id
      where c.business_id = $1::uuid
        and c.id = $2::uuid
      group by c.id, latest_send.id
      limit 1
    `,
    [businessId, campaignId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "email_campaign_not_found", "Email campaign not found.");
  }

  return row;
}

async function loadEmailListOrThrow(
  businessId: string,
  listId: string,
  client?: PoolClient,
): Promise<EmailListRow> {
  const result = await executeQuery<EmailListRow>(
    `
      select
        l.id,
        l.business_id,
        l.name,
        l.created_by_user_id,
        l.created_at,
        l.updated_at,
        count(m.id)::int as contact_count
      from email_lists l
      left join email_list_members m on m.list_id = l.id
      where l.business_id = $1::uuid
        and l.id = $2::uuid
      group by l.id
      limit 1
    `,
    [businessId, listId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "email_list_not_found", "Email list not found.");
  }

  return row;
}

async function loadEmailListScopeById(
  businessId: string,
  listId: string,
  client?: PoolClient,
): Promise<{
  canonicalList: EmailListRow;
  memberListIds: string[];
  normalizedNameKey: string;
}> {
  const selectedList = await loadEmailListOrThrow(businessId, listId, client);
  const normalizedNameKey = normalizeEmailListNameKey(selectedList.name);
  const familyResult = await executeQuery<EmailListRow>(
    `
      with family_lists as (
        select
          l.id,
          l.business_id,
          l.name,
          l.created_by_user_id,
          l.created_at,
          l.updated_at
        from email_lists l
        where l.business_id = $1::uuid
          and lower(trim(l.name)) = $2
      ),
      ranked_lists as (
        select
          fl.*,
          row_number() over (
            order by fl.created_at desc, fl.id desc
          ) as family_rank
        from family_lists fl
      ),
      family_counts as (
        select
          count(distinct m.contact_id)::int as contact_count
        from family_lists fl
        left join email_list_members m on m.list_id = fl.id
      ),
      family_members as (
        select
          json_agg(fl.id order by fl.created_at desc, fl.id desc) as member_list_ids_json
        from family_lists fl
      )
      select
        rl.id,
        rl.business_id,
        rl.name,
        rl.created_by_user_id,
        rl.created_at,
        rl.updated_at,
        coalesce(fc.contact_count, 0)::int as contact_count,
        coalesce(fm.member_list_ids_json, '[]'::json) as member_list_ids_json
      from ranked_lists rl
      cross join family_counts fc
      cross join family_members fm
      where rl.family_rank = 1
      limit 1
    `,
    [businessId, normalizedNameKey],
    client,
  );

  const canonicalList = familyResult.rows[0];

  if (!canonicalList) {
    throw new HttpError(404, "email_list_not_found", "Email list not found.");
  }

  const memberListIds = parseJsonArray<string>(canonicalList.member_list_ids_json);

  return {
    canonicalList,
    memberListIds: memberListIds.length > 0 ? memberListIds : [selectedList.id],
    normalizedNameKey,
  };
}

async function ensureEmailListByName(
  businessId: string,
  listName: string,
  createdByUserId?: string,
  client?: PoolClient,
): Promise<EmailListRow> {
  const normalizedListName = listName.trim();

  if (!normalizedListName) {
    throw new HttpError(400, "email_list_name_required", "List name is required.");
  }

  const existingResult = await executeQuery<EmailListRow>(
    `
      select
        l.id,
        l.business_id,
        l.name,
        l.created_by_user_id,
        l.created_at,
        l.updated_at,
        count(m.id)::int as contact_count
      from email_lists l
      left join email_list_members m on m.list_id = l.id
      where l.business_id = $1::uuid
        and lower(l.name) = lower($2)
      group by l.id
      order by l.created_at desc
      limit 1
    `,
    [businessId, normalizedListName],
    client,
  );

  if (existingResult.rows[0]) {
    return existingResult.rows[0];
  }

  const insertedResult = await executeQuery<EmailListRow>(
    `
      insert into email_lists (
        business_id,
        name,
        created_by_user_id
      ) values (
        $1::uuid,
        $2,
        $3::uuid
      )
      returning
        id,
        business_id,
        name,
        created_by_user_id,
        created_at,
        updated_at,
        0::int as contact_count
    `,
    [businessId, normalizedListName, createdByUserId ?? null],
    client,
  );

  return insertedResult.rows[0];
}

async function loadLatestCampaignSend(
  campaignId: string,
  client?: PoolClient,
): Promise<EmailCampaignSendRow | null> {
  const result = await executeQuery<EmailCampaignSendRow>(
    `
      select
        id,
        campaign_id,
        business_id,
        status,
        recipient_count,
        delivered_count,
        failed_count,
        unsubscribed_count,
        send_started_at,
        send_completed_at,
        created_by_user_id,
        created_at,
        updated_at
      from email_campaign_sends
      where campaign_id = $1::uuid
      order by created_at desc, id desc
      limit 1
    `,
    [campaignId],
    client,
  );

  return result.rows[0] ?? null;
}

async function loadActiveCampaignSendOrThrow(
  campaignId: string,
  client?: PoolClient,
): Promise<EmailCampaignSendRow> {
  const result = await executeQuery<EmailCampaignSendRow>(
    `
      select
        id,
        campaign_id,
        business_id,
        status,
        recipient_count,
        delivered_count,
        failed_count,
        unsubscribed_count,
        send_started_at,
        send_completed_at,
        created_by_user_id,
        created_at,
        updated_at
      from email_campaign_sends
      where campaign_id = $1::uuid
        and status in ('queued', 'sending')
      order by created_at desc, id desc
      limit 1
    `,
    [campaignId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "email_campaign_send_not_found", "Email campaign send not found.");
  }

  return row;
}

async function createCampaignSend(
  campaign: EmailCampaignRow,
  recipientCount: number,
  actorUserId: string | undefined,
  client: PoolClient,
): Promise<EmailCampaignSendRow> {
  const result = await executeQuery<EmailCampaignSendRow>(
    `
      insert into email_campaign_sends (
        campaign_id,
        business_id,
        status,
        recipient_count,
        created_by_user_id
      ) values (
        $1::uuid,
        $2::uuid,
        'queued',
        $3::int,
        $4::uuid
      )
      returning
        id,
        campaign_id,
        business_id,
        status,
        recipient_count,
        delivered_count,
        failed_count,
        unsubscribed_count,
        send_started_at,
        send_completed_at,
        created_by_user_id,
        created_at,
        updated_at
    `,
    [campaign.id, campaign.business_id, recipientCount, actorUserId ?? campaign.created_by_user_id ?? null],
    client,
  );

  return result.rows[0];
}

async function loadCampaignContacts(
  businessId: string,
  campaignId: string,
  client?: PoolClient,
): Promise<Array<EmailContact & { unsubscribeToken: string }>> {
  const result = await executeQuery<
    EmailContactRow & { campaign_id: string | null }
  >(
    `
      select *
      from (
        select distinct on (c.id)
          c.id,
          c.business_id,
          c.email,
          c.first_name,
          c.last_name,
          c.tags_json,
          c.status,
          c.unsubscribe_token,
          c.unsubscribed_at,
          c.last_bounce_at,
          c.last_complaint_at,
          c.last_provider_event_at,
          c.created_at,
          c.updated_at
        from email_campaigns ec
        inner join email_lists selected_list on selected_list.id = ec.list_id
        inner join email_lists scoped_list
          on scoped_list.business_id = selected_list.business_id
         and lower(trim(scoped_list.name)) = lower(trim(selected_list.name))
        inner join email_list_members lm on lm.list_id = scoped_list.id
        inner join email_contacts c on c.id = lm.contact_id
        left join email_unsubscribes eu
          on eu.business_id = c.business_id
         and lower(eu.email) = lower(c.email)
        where ec.business_id = $1::uuid
          and ec.id = $2::uuid
          and c.status = 'active'
          and eu.id is null
        order by c.id, c.created_at asc
      ) contacts
      order by created_at asc
    `,
    [businessId, campaignId],
    client,
  );

  return result.rows.map((row) => ({
    ...mapEmailContact(row),
    unsubscribeToken: row.unsubscribe_token,
  }));
}

async function createCampaignRecipientsForSend(
  send: EmailCampaignSendRow,
  campaign: EmailCampaignRow,
  contacts: Array<EmailContact & { unsubscribeToken: string }>,
  client: PoolClient,
): Promise<void> {
  const apiBaseUrl = resolveEmailPublicApiBaseUrl();
  const trackingContext = await createEmailTrackingContextForSend({
    businessId: campaign.business_id,
    campaignId: campaign.id,
    sendId: send.id,
    bodyHtml: campaign.body_html,
    bodyText: campaign.body_text || stripHtml(campaign.body_html),
    client,
  });

  for (const contact of contacts) {
    const recipientId = crypto.randomUUID();
    const subject = personalizeTemplate(campaign.subject, contact);
    const htmlBody = personalizeTemplate(campaign.body_html, contact);
    const textBody = personalizeTemplate(campaign.body_text || stripHtml(campaign.body_html), contact);
    const trackedBody = rewriteEmailTrackingLinksForRecipient({
      businessId: campaign.business_id,
      campaignId: campaign.id,
      sendId: send.id,
      recipientId,
      html: htmlBody,
      text: textBody,
      trackingContext,
    });
    const footer = appendUnsubscribeFooter(
      trackedBody.html,
      trackedBody.text,
      `${apiBaseUrl}/email/unsubscribe/${contact.unsubscribeToken}`,
    );
    const trackedHtml = appendEmailOpenTrackingPixel({
      businessId: campaign.business_id,
      campaignId: campaign.id,
      sendId: send.id,
      recipientId,
      html: footer.html,
    });

    await executeQuery(
      `
        insert into email_campaign_recipients (
          id,
          send_id,
          campaign_id,
          contact_id,
          personalized_subject,
          personalized_body_html,
          personalized_body_text,
          status
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5,
          $6,
          $7,
          'queued'
        )
      `,
      [recipientId, send.id, campaign.id, contact.id, subject, trackedHtml, footer.text],
      client,
    );
  }
}

async function getCampaignStats(
  businessId: string,
  campaignId: string,
  client?: PoolClient,
): Promise<EmailCampaignStats> {
  const result = await executeQuery<{
    send_count: string | number;
    total: string | number;
    pending_total: string | number;
    sent_total: string | number;
    delivered_total: string | number;
    failed_total: string | number;
    unsubscribed_total: string | number;
    unique_opens: string | number;
    total_opens: string | number;
    unique_clicks: string | number;
    total_clicks: string | number;
  }>(
    `
      with send_counts as (
        select count(*)::int as send_count
        from email_campaign_sends
        where campaign_id = $2::uuid
      ),
      latest_send as (
        select id
        from email_campaign_sends
        where campaign_id = $2::uuid
        order by created_at desc, id desc
        limit 1
      )
      select
        send_counts.send_count,
        count(r.id)::int as total,
        count(r.id) filter (where r.status in ('queued', 'sending'))::int as pending_total,
        count(r.id) filter (where r.status in ('sent', 'delivered'))::int as sent_total,
        count(r.id) filter (where r.status = 'delivered')::int as delivered_total,
        count(r.id) filter (where r.status = 'failed')::int as failed_total,
        count(r.id) filter (where r.status = 'unsubscribed')::int as unsubscribed_total,
        count(r.id) filter (where r.open_count > 0)::int as unique_opens,
        coalesce(sum(r.open_count), 0)::int as total_opens,
        count(r.id) filter (where r.click_count > 0)::int as unique_clicks,
        coalesce(sum(r.click_count), 0)::int as total_clicks
      from send_counts
      inner join email_campaigns c
        on c.id = $2::uuid
       and c.business_id = $1::uuid
      left join latest_send on true
      left join email_campaign_recipients r on r.send_id = latest_send.id
      group by send_counts.send_count
    `,
    [businessId, campaignId],
    client,
  );

  const row = result.rows[0];

  return {
    campaignId,
    sendCount: toNumber(row?.send_count),
    recipientCount: toNumber(row?.total),
    pendingCount: toNumber(row?.pending_total),
    sentCount: toNumber(row?.sent_total),
    deliveredCount: toNumber(row?.delivered_total),
    failedCount: toNumber(row?.failed_total),
    unsubscribedCount: toNumber(row?.unsubscribed_total),
    uniqueOpens: toNumber(row?.unique_opens),
    totalOpens: toNumber(row?.total_opens),
    uniqueClicks: toNumber(row?.unique_clicks),
    totalClicks: toNumber(row?.total_clicks),
  };
}

async function requeueStaleSendingRecipients(
  sendId: string,
  leaseMinutes: number,
  client?: PoolClient,
): Promise<number> {
  const result = await executeQuery<CountRow>(
    `
      with requeued as (
        update email_campaign_recipients
        set
          status = 'queued',
          updated_at = now()
        where send_id = $1::uuid
          and status = 'sending'
          and updated_at < now() - ($2::int * interval '1 minute')
        returning 1
      )
      select count(*)::int as total
      from requeued
    `,
    [sendId, leaseMinutes],
    client,
  );

  return toNumber(result.rows[0]?.total);
}

async function claimQueuedCampaignRecipients(
  sendId: string,
  batchSize: number,
  client?: PoolClient,
): Promise<EmailCampaignRecipientRow[]> {
  const result = await executeQuery<EmailCampaignRecipientRow>(
    `
      with candidate_ids as (
        select r.id
        from email_campaign_recipients r
        where r.send_id = $1::uuid
          and r.status = 'queued'
        order by r.created_at asc
        limit $2
        for update skip locked
      ),
      claimed as (
        update email_campaign_recipients r
        set
          status = 'sending',
          updated_at = now()
        from candidate_ids c
        where r.id = c.id
        returning
          r.id,
          r.campaign_id,
          r.send_id,
          r.contact_id,
          r.personalized_subject,
          r.personalized_body_html,
          r.personalized_body_text,
          r.status,
          r.ses_message_id,
          r.sent_at,
          r.delivered_at,
          r.failed_at,
          r.open_count,
          r.first_opened_at,
          r.last_opened_at,
          r.click_count,
          r.first_clicked_at,
          r.last_clicked_at,
          r.failure_reason,
          r.created_at,
          r.updated_at
      )
      select
        claimed.id,
        claimed.campaign_id,
        claimed.send_id,
        claimed.contact_id,
        claimed.personalized_subject,
        claimed.personalized_body_html,
        claimed.personalized_body_text,
        claimed.status,
        claimed.ses_message_id,
        claimed.sent_at,
        claimed.delivered_at,
        claimed.failed_at,
        claimed.open_count,
        claimed.first_opened_at,
        claimed.last_opened_at,
        claimed.click_count,
        claimed.first_clicked_at,
        claimed.last_clicked_at,
        claimed.failure_reason,
        claimed.created_at,
        claimed.updated_at,
        c.email as contact_email,
        c.status as contact_status,
        c.first_name,
        c.last_name,
        c.unsubscribe_token
      from claimed
      inner join email_contacts c on c.id = claimed.contact_id
      order by claimed.created_at asc
    `,
    [sendId, batchSize],
    client,
  );

  return result.rows;
}

async function syncCampaignSendStatusFromRecipients(
  sendId: string,
  client?: PoolClient,
): Promise<EmailCampaignSend["status"]> {
  const result = await executeQuery<EmailCampaignRecipientProgressRow>(
    `
      select
        count(*)::int as recipient_total,
        count(*) filter (where status = 'queued')::int as queued_total,
        count(*) filter (where status = 'sending')::int as sending_total,
        count(*) filter (where status = 'failed')::int as failed_total,
        count(*) filter (where status = 'delivered')::int as delivered_total,
        count(*) filter (where status = 'unsubscribed')::int as unsubscribed_total
      from email_campaign_recipients
      where send_id = $1::uuid
    `,
    [sendId],
    client,
  );

  const row = result.rows[0];
  const recipientTotal = toNumber(row?.recipient_total);
  const queuedTotal = toNumber(row?.queued_total);
  const sendingTotal = toNumber(row?.sending_total);
  const failedTotal = toNumber(row?.failed_total);
  const deliveredTotal = toNumber(row?.delivered_total);
  const unsubscribedTotal = toNumber(row?.unsubscribed_total);

  const nextStatus: EmailCampaignSend["status"] =
    sendingTotal > 0 ? "sending" : queuedTotal > 0 ? "queued" : failedTotal > 0 ? "failed" : "sent";

  await executeQuery(
    `
      update email_campaign_sends
      set
        status = $2,
        recipient_count = $3::int,
        delivered_count = $4::int,
        failed_count = $5::int,
        unsubscribed_count = $6::int,
        send_started_at = case
          when $2 = 'sending' then coalesce(send_started_at, now())
          when $2 = 'queued' then send_started_at
          else send_started_at
        end,
        send_completed_at = case
          when $2 in ('queued', 'sending') then null
          else now()
        end,
        updated_at = now()
      where id = $1::uuid
    `,
    [sendId, nextStatus, recipientTotal, deliveredTotal, failedTotal, unsubscribedTotal],
    client,
  );

  return nextStatus;
}

async function syncCampaignStatusFromSends(
  campaignId: string,
  client?: PoolClient,
): Promise<EmailCampaign["status"]> {
  const result = await executeQuery<{
    queued_total: string | number;
    sending_total: string | number;
    latest_status: EmailCampaignSend["status"] | null;
    latest_send_started_at: Date | string | null;
    latest_send_completed_at: Date | string | null;
  }>(
    `
      with send_rollup as (
        select
          count(*) filter (where status = 'queued')::int as queued_total,
          count(*) filter (where status = 'sending')::int as sending_total
        from email_campaign_sends
        where campaign_id = $1::uuid
      ),
      latest_send as (
        select
          status as latest_status,
          send_started_at as latest_send_started_at,
          send_completed_at as latest_send_completed_at
        from email_campaign_sends
        where campaign_id = $1::uuid
        order by created_at desc, id desc
        limit 1
      )
      select
        send_rollup.queued_total,
        send_rollup.sending_total,
        latest_send.latest_status,
        latest_send.latest_send_started_at,
        latest_send.latest_send_completed_at
      from send_rollup
      left join latest_send on true
    `,
    [campaignId],
    client,
  );

  const row = result.rows[0];
  const sendingTotal = toNumber(row?.sending_total);
  const queuedTotal = toNumber(row?.queued_total);

  const nextStatus: EmailCampaign["status"] = sendingTotal > 0
    ? "sending"
    : queuedTotal > 0
      ? "queued"
      : row?.latest_status ?? "draft";

  await executeQuery(
    `
      update email_campaigns
      set
        status = $2,
        send_started_at = case
          when $2 = 'queued' then null
          when $2 = 'draft' then null
          else $3::timestamptz
        end,
        send_completed_at = case
          when $2 in ('sent', 'failed') then $4::timestamptz
          else null
        end,
        updated_at = now()
      where id = $1::uuid
    `,
    [campaignId, nextStatus, row?.latest_send_started_at ?? null, row?.latest_send_completed_at ?? null],
    client,
  );

  return nextStatus;
}

async function markCampaignRecipientUnsubscribed(
  recipientId: string,
  source: "business_unsubscribe" | "contact_status",
): Promise<void> {
  await executeQuery(
    `
      with updated as (
        update email_campaign_recipients
        set
          status = 'unsubscribed',
          updated_at = now()
        where id = $1::uuid
        returning send_id
      )
      insert into email_events (
        campaign_recipient_id,
        send_id,
        event_type,
        payload_json,
        occurred_at
      )
      select
        $1::uuid,
        updated.send_id,
        'unsubscribe',
        $2::jsonb,
        now()
      from updated
    `,
    [
      recipientId,
      JSON.stringify({
        source,
      }),
    ],
  );
}

async function markCampaignRecipientFailure(
  recipientId: string,
  failureMessage: string,
): Promise<void> {
  await executeQuery(
    `
      with updated as (
        update email_campaign_recipients
        set
          status = 'failed',
          failed_at = now(),
          failure_reason = $2,
          updated_at = now()
        where id = $1::uuid
        returning send_id
      )
      insert into email_events (
        campaign_recipient_id,
        send_id,
        event_type,
        payload_json,
        occurred_at
      )
      select
        $1::uuid,
        updated.send_id,
        'failed',
        $2::jsonb,
        now()
      from updated
    `,
    [
      recipientId,
      JSON.stringify({
        message: failureMessage,
      }),
    ],
  );
}

async function markCampaignRecipientSent(
  recipientId: string,
  sent: {
    messageId: string;
    sentAt: string;
    provider: string;
  },
): Promise<void> {
  await executeQuery(
    `
      with updated as (
        update email_campaign_recipients
        set
          status = 'sent',
          ses_message_id = $2,
          sent_at = $3::timestamptz,
          updated_at = now()
        where id = $1::uuid
        returning send_id
      )
      insert into email_events (
        campaign_recipient_id,
        send_id,
        event_type,
        provider_message_id,
        payload_json,
        occurred_at
      )
      select
        $1::uuid,
        updated.send_id,
        'sent',
        $2,
        $4::jsonb,
        $3::timestamptz
      from updated
    `,
    [
      recipientId,
      sent.messageId,
      sent.sentAt,
      JSON.stringify({ provider: sent.provider }),
    ],
  );
}

async function markCampaignRecipientSentStatusOnly(
  recipientId: string,
  sent: {
    messageId: string;
    sentAt: string;
  },
): Promise<void> {
  await executeQuery(
    `
      update email_campaign_recipients
      set
        status = 'sent',
        ses_message_id = $2,
        sent_at = $3::timestamptz,
        failed_at = null,
        failure_reason = null,
        updated_at = now()
      where id = $1::uuid
    `,
    [
      recipientId,
      sent.messageId,
      sent.sentAt,
    ],
  );
}

export async function importEmailContacts(
  businessId: string,
  actorUserId: string | undefined,
  input: ImportEmailContactsRequest,
): Promise<ImportEmailContactsResponse> {
  const listName = input.listName.trim();
  const parsedImport = parseContactImportPayload(input.csvText, input.mapping);
  const contacts = parsedImport.contacts;
  const duplicateStrategy = input.duplicateStrategy ?? "upsert";
  const importedListNames = extractImportedListNames(contacts, listName);

  if (importedListNames.length === 0) {
    throw new HttpError(
      400,
      "email_list_name_required",
      "Add a fallback list name or map a Lists column in the CSV before importing.",
    );
  }

  return withDbTransaction(async (client) => {
    const listCache = new Map<string, EmailListRow>();
    const ensureList = async (candidate: string): Promise<EmailListRow> => {
      const normalizedName = candidate.trim();
      const cacheKey = normalizeEmailListNameKey(normalizedName);
      const cached = listCache.get(cacheKey);

      if (cached) {
        return cached;
      }

      const row = await ensureEmailListByName(businessId, normalizedName, actorUserId, client);
      listCache.set(cacheKey, row);
      return row;
    };

    const importedContacts: EmailContact[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const contact of contacts) {
      const contactResult = await upsertContact(businessId, contact, duplicateStrategy, client);
      const membershipListNames = extractImportedListNames([contact], listName);

      for (const membershipListName of membershipListNames) {
        const targetList = await ensureList(membershipListName);
        await executeQuery(
          `
            insert into email_list_members (
              list_id,
              contact_id
            ) values (
              $1::uuid,
              $2::uuid
            )
            on conflict (list_id, contact_id) do nothing
          `,
          [targetList.id, contactResult.row.id],
          client,
        );
      }

      importedContacts.push(mapEmailContact(contactResult.row));

      if (contactResult.operation === "created") {
        createdCount += 1;
      } else if (contactResult.operation === "updated") {
        updatedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    const representativeListName = listName || importedListNames[0];
    const hydratedList = await loadEmailListOrThrow(
      businessId,
      (await ensureList(representativeListName)).id,
      client,
    );

    return {
      list: mapEmailList(hydratedList),
      contacts: importedContacts,
      importedCount: importedContacts.length,
      createdCount,
      updatedCount,
      skippedCount,
    };
  });
}

export async function previewEmailContactsImport(
  businessId: string,
  input: {
    csvText: string;
    mapping?: EmailContactImportMapping;
  },
): Promise<ImportEmailContactsPreviewResponse> {
  const parsed = parseContactImportPayload(input.csvText, input.mapping);
  const uniqueEmails = [...new Set(parsed.contacts.map((contact) => contact.email))];
  let existingContacts = 0;

  if (uniqueEmails.length > 0) {
    const existingResult = await executeQuery<CountRow>(
      `
        select count(*)::int as total
        from email_contacts
        where business_id = $1::uuid
          and lower(email) = any($2::text[])
      `,
      [businessId, uniqueEmails],
    );

    existingContacts = toNumber(existingResult.rows[0]?.total);
  }

  return {
    columns: parsed.columns,
    suggestedMapping: parsed.suggestedMapping,
    fields: parsed.fieldPreviews,
    previewRows: parsed.previewRows,
    summary: {
      ...parsed.summary,
      existingContacts,
    },
  };
}

async function loadEmailContactImportJobOrThrow(
  businessId: string,
  importJobId: string,
  client?: PoolClient,
): Promise<EmailContactImportJobRow> {
  const result = await executeQuery<EmailContactImportJobRow>(
    `
      select
        id,
        business_id,
        job_id,
        list_name,
        file_name,
        status,
        total_rows,
        processed_rows,
        inserted_count,
        updated_count,
        skipped_count,
        error_count,
        mapping_json,
        error_summary_json,
        created_at,
        started_at,
        completed_at
      from email_contact_import_jobs
      where business_id = $1::uuid
        and id = $2::uuid
      limit 1
    `,
    [businessId, importJobId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "email_contact_import_job_not_found", "Import job not found.");
  }

  return row;
}

async function loadEmailContactImportJobByJobIdOrThrow(
  businessId: string,
  jobId: string,
  client?: PoolClient,
): Promise<EmailContactImportJobRow> {
  const result = await executeQuery<EmailContactImportJobRow>(
    `
      select
        id,
        business_id,
        job_id,
        list_name,
        file_name,
        status,
        total_rows,
        processed_rows,
        inserted_count,
        updated_count,
        skipped_count,
        error_count,
        mapping_json,
        error_summary_json,
        created_at,
        started_at,
        completed_at
      from email_contact_import_jobs
      where business_id = $1::uuid
        and job_id = $2::uuid
      limit 1
    `,
    [businessId, jobId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(
      404,
      "email_contact_import_job_not_found",
      "Import job metadata was not found.",
    );
  }

  return row;
}

async function updateEmailContactImportJobProgress(
  importJobId: string,
  input: {
    status?: EmailContactImportJob["status"];
    totalRows?: number;
    processedRows?: number;
    insertedCount?: number;
    updatedCount?: number;
    skippedCount?: number;
    errorCount?: number;
    mapping?: EmailContactImportMapping;
    errorSummary?: EmailContactImportJobError[];
    startedAt?: string | null;
    completedAt?: string | null;
  },
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      update email_contact_import_jobs
      set
        status = coalesce($2, status),
        total_rows = coalesce($3::int, total_rows),
        processed_rows = coalesce($4::int, processed_rows),
        inserted_count = coalesce($5::int, inserted_count),
        updated_count = coalesce($6::int, updated_count),
        skipped_count = coalesce($7::int, skipped_count),
        error_count = coalesce($8::int, error_count),
        mapping_json = coalesce($9::jsonb, mapping_json),
        error_summary_json = coalesce($10::jsonb, error_summary_json),
        started_at = case
          when $11::timestamptz is not null then $11::timestamptz
          else started_at
        end,
        completed_at = case
          when $12::timestamptz is not null then $12::timestamptz
          else completed_at
        end
      where id = $1::uuid
    `,
    [
      importJobId,
      input.status ?? null,
      input.totalRows ?? null,
      input.processedRows ?? null,
      input.insertedCount ?? null,
      input.updatedCount ?? null,
      input.skippedCount ?? null,
      input.errorCount ?? null,
      input.mapping ? JSON.stringify(input.mapping) : null,
      input.errorSummary ? JSON.stringify(input.errorSummary) : null,
      input.startedAt ?? null,
      input.completedAt ?? null,
    ],
    client,
  );
}

export async function queueEmailContactsImport(
  businessId: string,
  actorUserId: string | undefined,
  input: QueueEmailContactsImportRequest,
): Promise<QueueEmailContactsImportResponse> {
  const listName = input.listName.trim();
  const parsedImport = parseContactImportPayload(input.csvText, input.mapping);
  const appliedMapping = extractAppliedImportMapping(parsedImport.fieldPreviews);
  const errorSummary = buildImportErrorSummary(parsedImport.summary);
  const importedListNames = extractImportedListNames(parsedImport.contacts, listName);

  if (importedListNames.length === 0) {
    throw new HttpError(
      400,
      "email_list_name_required",
      "Add a fallback list name or map a Lists column in the CSV before importing.",
    );
  }

  const importLabel = describeImportedLists(parsedImport.contacts, listName);

  return withDbTransaction(async (client) => {
    const queuedJob = await createJob({
      businessId,
      type: "email_contact_import",
      priority: 120,
      payload: {
        listName,
        csvText: input.csvText,
        mapping: appliedMapping,
        duplicateStrategy: input.duplicateStrategy ?? "upsert",
        fileName: input.fileName ?? null,
        actorUserId: actorUserId ?? null,
      },
      client,
    });

    const result = await executeQuery<EmailContactImportJobRow>(
      `
        insert into email_contact_import_jobs (
          business_id,
          job_id,
          list_name,
          file_name,
          status,
          total_rows,
          processed_rows,
          inserted_count,
          updated_count,
          skipped_count,
          error_count,
          mapping_json,
          error_summary_json,
          created_by_user_id
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          'queued',
          $5::int,
          0,
          0,
          0,
          0,
          $6::int,
          $7::jsonb,
          $8::jsonb,
          $9::uuid
        )
        returning
          id,
          business_id,
          job_id,
          list_name,
          file_name,
          status,
          total_rows,
          processed_rows,
          inserted_count,
          updated_count,
          skipped_count,
          error_count,
          mapping_json,
          error_summary_json,
          created_at,
          started_at,
          completed_at
      `,
      [
        businessId,
        queuedJob.id,
        importLabel,
        input.fileName?.trim() || null,
        parsedImport.summary.totalRows,
        parsedImport.summary.invalidRows,
        JSON.stringify(appliedMapping),
        JSON.stringify(errorSummary),
        actorUserId ?? null,
      ],
      client,
    );

    return {
      importJob: mapEmailContactImportJob(result.rows[0]),
    };
  });
}

export async function listEmailContactImportJobs(
  businessId: string,
): Promise<EmailContactImportJobListResponse> {
  const result = await executeQuery<EmailContactImportJobRow>(
    `
      select
        id,
        business_id,
        job_id,
        list_name,
        file_name,
        status,
        total_rows,
        processed_rows,
        inserted_count,
        updated_count,
        skipped_count,
        error_count,
        mapping_json,
        error_summary_json,
        created_at,
        started_at,
        completed_at
      from email_contact_import_jobs
      where business_id = $1::uuid
      order by created_at desc
      limit 20
    `,
    [businessId],
  );

  return {
    importJobs: result.rows.map(mapEmailContactImportJob),
  };
}

export async function getEmailContactImportJob(
  businessId: string,
  importJobId: string,
): Promise<EmailContactImportJobResponse> {
  return {
    importJob: mapEmailContactImportJob(await loadEmailContactImportJobOrThrow(businessId, importJobId)),
  };
}

export async function listEmailContacts(
  businessId: string,
  input: {
    search?: string;
    status?: EmailContactStatus;
    listId?: string;
    attributeFilters?: Record<string, string>;
    limit?: number;
  } = {},
): Promise<EmailContactListResponse> {
  const normalizedSearch = input.search?.trim().toLowerCase() ?? "";
  const searchPattern = normalizedSearch ? `%${normalizedSearch}%` : "";
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const { hasAttributesJson } = await getEmailContactCapabilities();
  const projection = await buildEmailContactSelectProjection("c");
  const listScope = input.listId
    ? await loadEmailListScopeById(businessId, input.listId)
    : null;
  const scopedListIds = listScope?.memberListIds ?? null;
  const countValues: unknown[] = [businessId, normalizedSearch, searchPattern, scopedListIds, input.status ?? null];
  const countAttributeClauses = buildEmailContactAttributeFilterClauses({
    values: countValues,
    attributeFilters: input.attributeFilters,
    hasAttributesJson,
  });

  const countResult = await executeQuery<CountRow>(
    `
      select count(distinct c.id)::int as total
      from email_contacts c
      left join email_list_members lm
        on lm.contact_id = c.id
       and ($4::uuid[] is null or lm.list_id = any($4::uuid[]))
      where c.business_id = $1::uuid
        and ($2::text = '' or (
          lower(c.email) like $3
          or lower(coalesce(c.first_name, '')) like $3
          or lower(coalesce(c.last_name, '')) like $3
        ))
        and ($5::text is null or c.status = $5::text)
        and ($4::uuid[] is null or lm.id is not null)
        ${countAttributeClauses}
    `,
    countValues,
  );

  const resultValues: unknown[] = [businessId, normalizedSearch, searchPattern, scopedListIds, input.status ?? null];
  const resultAttributeClauses = buildEmailContactAttributeFilterClauses({
    values: resultValues,
    attributeFilters: input.attributeFilters,
    hasAttributesJson,
  });
  resultValues.push(limit);
  const result = await executeQuery<EmailContactRow>(
    `
      select *
      from (
        select distinct on (c.id)
          ${projection}
        from email_contacts c
        left join email_list_members lm
          on lm.contact_id = c.id
         and ($4::uuid[] is null or lm.list_id = any($4::uuid[]))
        where c.business_id = $1::uuid
          and ($2::text = '' or (
            lower(c.email) like $3
            or lower(coalesce(c.first_name, '')) like $3
            or lower(coalesce(c.last_name, '')) like $3
          ))
          and ($5::text is null or c.status = $5::text)
          and ($4::uuid[] is null or lm.id is not null)
          ${resultAttributeClauses}
        order by c.id, c.updated_at desc, c.created_at desc
      ) contacts
      order by updated_at desc, created_at desc
      limit $${resultValues.length}::int
    `,
    resultValues,
  );

  return {
    contacts: result.rows.map(mapEmailContact),
    total: toNumber(countResult.rows[0]?.total),
  };
}

export async function updateEmailContact(
  businessId: string,
  contactId: string,
  input: {
    email: string;
    firstName?: string;
    lastName?: string;
    status?: EmailContactStatus;
  },
): Promise<{ contact: EmailContact }> {
  const normalizedEmail = normalizeEmail(input.email);

  if (!normalizedEmail) {
    throw new HttpError(400, "email_contact_invalid", "A valid email address is required.");
  }

  const normalizedStatus = input.status;

  if (
    normalizedStatus &&
    normalizedStatus !== "active" &&
    normalizedStatus !== "unsubscribed" &&
    normalizedStatus !== "bounced" &&
    normalizedStatus !== "complained" &&
    normalizedStatus !== "suppressed"
  ) {
    throw new HttpError(400, "email_contact_invalid_status", "A valid contact status is required.");
  }

  return withDbTransaction(async (client) => {
    const projection = await buildEmailContactSelectProjection("");
    const existingResult = await executeQuery<EmailContactRow>(
      `
        select
          ${projection}
        from email_contacts
        where business_id = $1::uuid
          and id = $2::uuid
        limit 1
      `,
      [businessId, contactId],
      client,
    );

    const existingContact = existingResult.rows[0];

    if (!existingContact) {
      throw new HttpError(404, "email_contact_not_found", "Email contact not found.");
    }

    const isSuppressed = await isEmailUnsubscribed(businessId, normalizedEmail, client);
    const isExplicitResubscribe =
      normalizedStatus === "active" &&
      (existingContact.status === "unsubscribed" || isSuppressed);

    if (isExplicitResubscribe) {
      await removeBusinessUnsubscribe(businessId, normalizedEmail, client);
    }

    const nextStatus = isExplicitResubscribe
      ? "active"
      : isSuppressed
        ? "unsubscribed"
        : normalizedStatus ?? existingContact.status;
    const shouldSetUnsubscribedAt = nextStatus === "unsubscribed";
    const shouldClearUnsubscribedAt =
      isExplicitResubscribe || (!shouldSetUnsubscribedAt && Boolean(normalizedStatus));

    try {
      const result = await executeQuery<EmailContactRow>(
        `
          update email_contacts
          set
            email = $2,
            first_name = $3,
            last_name = $4,
            status = $5,
            unsubscribed_at = case
              when $6 then coalesce(unsubscribed_at, now())
              when $7 then null
              else unsubscribed_at
            end,
            updated_at = now()
          where business_id = $1::uuid
            and id = $8::uuid
          returning
            ${projection}
        `,
        [
          businessId,
          normalizedEmail,
          input.firstName?.trim() || null,
          input.lastName?.trim() || null,
          nextStatus,
          shouldSetUnsubscribedAt,
          shouldClearUnsubscribedAt,
          contactId,
        ],
        client,
      );

      return {
        contact: mapEmailContact(result.rows[0]),
      };
    } catch (error) {
      const candidate = error as { code?: string };

      if (candidate.code === "23505") {
        throw new HttpError(
          409,
          "email_contact_duplicate",
          "A contact with that email already exists in this workspace.",
        );
      }

      throw error;
    }
  });
}

export async function deleteEmailContact(
  businessId: string,
  contactId: string,
): Promise<{ success: true; contactId: string }> {
  return withDbTransaction(async (client) => {
    const result = await executeQuery<{ id: string }>(
      `
        delete from email_contacts
        where business_id = $1::uuid
          and id = $2::uuid
        returning id
      `,
      [businessId, contactId],
      client,
    );

    if (!result.rows[0]) {
      throw new HttpError(404, "email_contact_not_found", "Email contact not found.");
    }

    return {
      success: true,
      contactId,
    };
  });
}

export async function processQueuedEmailContactImportJobs(
  options: ProcessQueuedEmailContactImportJobsOptions = {},
): Promise<ProcessQueuedEmailContactImportJobsResult> {
  const summary: ProcessQueuedEmailContactImportJobsResult = {
    jobsClaimed: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
    contactsInserted: 0,
    contactsUpdated: 0,
    contactsSkipped: 0,
    contactErrors: 0,
  };
  const claimedJobs = await claimQueuedJobs<EmailContactImportJobPayload>({
    types: ["email_contact_import"],
    batchSize: options.batchSize ?? resolveEmailContactImportWorkerBatchSize(),
    lockedBy: process.env.RENDER_SERVICE_NAME?.trim() || `app-worker:${process.pid}`,
    staleAfterMinutes: 30,
  });

  for (const job of claimedJobs) {
    summary.jobsClaimed += 1;

    if (!job.businessId) {
      await markJobFailed(job.id, "Email contact import job is missing a business id.");
      summary.jobsFailed += 1;
      continue;
    }

    try {
      const payload = job.payload;
      const parsedImport = parseContactImportPayload(payload.csvText, payload.mapping);
      const importJob = await loadEmailContactImportJobByJobIdOrThrow(job.businessId, job.id);
      const appliedMapping = extractAppliedImportMapping(parsedImport.fieldPreviews);
      const errorSummary = buildImportErrorSummary(parsedImport.summary);
      let processedRows = parsedImport.summary.invalidRows + parsedImport.summary.duplicateRows;
      let insertedCount = 0;
      let updatedCount = 0;
      let skippedCount = parsedImport.summary.duplicateRows;
      const errorCount = parsedImport.summary.invalidRows;
      const importedListNames = extractImportedListNames(parsedImport.contacts, payload.listName);

      if (importedListNames.length === 0) {
        throw new HttpError(
          400,
          "email_list_name_required",
          "Add a fallback list name or map a Lists column in the CSV before importing.",
        );
      }

      await updateEmailContactImportJobProgress(importJob.id, {
        status: "processing",
        totalRows: parsedImport.summary.totalRows,
        processedRows,
        insertedCount,
        updatedCount,
        skippedCount,
        errorCount,
        mapping: appliedMapping,
        errorSummary,
        startedAt: new Date().toISOString(),
      });

      const listCache = new Map<string, EmailListRow>();

      for (const contact of parsedImport.contacts) {
        const contactResult = await withDbTransaction(async (client) => {
          const upsertedContact = await upsertContact(
            job.businessId!,
            contact,
            payload.duplicateStrategy ?? "upsert",
            client,
          );

          const membershipListNames = extractImportedListNames([contact], payload.listName);

          for (const membershipListName of membershipListNames) {
            const cacheKey = normalizeEmailListNameKey(membershipListName);
            let listRow = listCache.get(cacheKey);

            if (!listRow) {
              listRow = await ensureEmailListByName(
                job.businessId!,
                membershipListName,
                payload.actorUserId ?? undefined,
                client,
              );
              listCache.set(cacheKey, listRow);
            }

            await executeQuery(
              `
                insert into email_list_members (
                  list_id,
                  contact_id
                ) values (
                  $1::uuid,
                  $2::uuid
                )
                on conflict (list_id, contact_id) do nothing
              `,
              [listRow.id, upsertedContact.row.id],
              client,
            );
          }

          return upsertedContact;
        });

        processedRows += 1;

        if (contactResult.operation === "created") {
          insertedCount += 1;
          summary.contactsInserted += 1;
        } else if (contactResult.operation === "updated") {
          updatedCount += 1;
          summary.contactsUpdated += 1;
        } else {
          skippedCount += 1;
          summary.contactsSkipped += 1;
        }

        if (processedRows % 25 === 0) {
          await updateEmailContactImportJobProgress(importJob.id, {
            processedRows,
            insertedCount,
            updatedCount,
            skippedCount,
            errorCount,
          });
        }
      }

      summary.contactsSkipped += parsedImport.summary.duplicateRows;
      summary.contactErrors += parsedImport.summary.invalidRows;

      await updateEmailContactImportJobProgress(importJob.id, {
        status: "completed",
        processedRows: parsedImport.summary.totalRows,
        insertedCount,
        updatedCount,
        skippedCount,
        errorCount,
        errorSummary,
        completedAt: new Date().toISOString(),
      });
      await markJobCompleted(job.id);
      summary.jobsCompleted += 1;
    } catch (error) {
      const failureMessage =
        error instanceof Error ? error.message : "Unable to process the email contact import.";
      const nextJobStatus = job.attempts >= job.maxAttempts ? "failed" : "queued";

      try {
        const importJob = await loadEmailContactImportJobByJobIdOrThrow(job.businessId, job.id);
        await updateEmailContactImportJobProgress(importJob.id, {
          status: nextJobStatus as EmailContactImportJob["status"],
          completedAt: nextJobStatus === "failed" ? new Date().toISOString() : null,
        });
      } catch {
        // Ignore metadata lookup failures; the queue row still captures the error.
      }

      await markJobFailed(job.id, failureMessage);
      summary.jobsFailed += 1;
      logWarn("Email contact import job failed.", {
        businessId: job.businessId,
        jobId: job.id,
        message: failureMessage,
      });
    }
  }

  return summary;
}

export async function createEmailCampaign(
  businessId: string,
  actorUserId: string | undefined,
  input: CreateEmailCampaignRequest,
): Promise<CreateEmailCampaignResponse> {
  if (input.subject.trim() === "" || (input.bodyText?.trim() || "") === "") {
    throw new HttpError(400, "email_campaign_invalid", "Subject and email body are required.");
  }

  return withDbTransaction(async (client) => {
    const listScope = await loadEmailListScopeById(businessId, input.listId, client);
    const settingsRow = await ensureEmailSettingsRow(businessId, client);
    const footerBranding = await loadEmailFooterBranding(businessId, client);
    const renderedBody = buildEmailCampaignBodies(input, mapEmailSettings(settingsRow), footerBranding);
    const campaignSource = await resolveCampaignSource(businessId, input, client);

    const result = await executeQuery<EmailCampaignRow>(
      `
        insert into email_campaigns (
          business_id,
          list_id,
          source_asset_id,
          source_idea_id,
          source_title,
          name,
          subject,
          body_html,
          body_text,
          reply_to_email,
          created_by_user_id,
          status
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11::uuid,
          'draft'
        )
        returning
          id,
          business_id,
          list_id,
          source_asset_id,
          source_idea_id,
          source_title,
          name,
          subject,
          body_html,
          body_text,
          status,
          reply_to_email,
          created_by_user_id,
          scheduled_at,
          send_started_at,
          send_completed_at,
          created_at,
          updated_at,
          0::int as recipient_count,
          0::int as pending_count,
          0::int as sent_count,
          0::int as delivered_count,
          0::int as failed_count,
          0::int as unsubscribed_count
      `,
      [
        businessId,
        listScope.canonicalList.id,
        campaignSource.sourceAssetId,
        campaignSource.sourceIdeaId,
        campaignSource.sourceTitle,
        input.name.trim() || input.subject.trim(),
        input.subject.trim(),
        renderedBody.html,
        renderedBody.text,
        input.replyToEmail?.trim() || null,
        actorUserId ?? null,
      ],
      client,
    );

    return {
      campaign: mapEmailCampaign(result.rows[0]),
    };
  });
}

export async function updateEmailCampaign(
  businessId: string,
  campaignId: string,
  actorUserId: string | undefined,
  input: UpdateEmailCampaignRequest,
): Promise<UpdateEmailCampaignResponse> {
  if (input.subject.trim() === "" || (input.bodyText?.trim() || "") === "") {
    throw new HttpError(400, "email_campaign_invalid", "Subject and email body are required.");
  }

  return withDbTransaction(async (client) => {
    const campaign = await loadEmailCampaignOrThrow(businessId, campaignId, client);
    assertEmailCampaignEditable(campaign, "edit");
    const latestSend = await loadLatestCampaignSend(campaignId, client);
    const listScope = await loadEmailListScopeById(businessId, input.listId, client);
    const settingsRow = await ensureEmailSettingsRow(businessId, client);
    const footerBranding = await loadEmailFooterBranding(businessId, client);
    const renderedBody = buildEmailCampaignBodies(input, mapEmailSettings(settingsRow), footerBranding);
    const campaignSource = await resolveCampaignSource(businessId, input, client);

    if (latestSend && campaign.status === "failed") {
      await executeQuery(
        `
          delete from email_campaign_sends
          where id = $1::uuid
        `,
        [latestSend.id],
        client,
      );
    }

    const result = await executeQuery<EmailCampaignRow>(
      `
        update email_campaigns
        set
          list_id = $2::uuid,
          source_asset_id = $3::uuid,
          source_idea_id = $4::uuid,
          source_title = $5,
          name = $6,
          subject = $7,
          body_html = $8,
          body_text = $9,
          reply_to_email = $10,
          created_by_user_id = coalesce($11::uuid, created_by_user_id),
          status = 'draft',
          send_started_at = null,
          send_completed_at = null,
          start_notification_sent_at = null,
          completion_notification_sent_at = null,
          failure_notification_sent_at = null,
          updated_at = now()
        where id = $1::uuid
        returning
          id,
          business_id,
          list_id,
          source_asset_id,
          source_idea_id,
          source_title,
          name,
          subject,
          body_html,
          body_text,
          status,
          reply_to_email,
          created_by_user_id,
          scheduled_at,
          send_started_at,
          send_completed_at,
          created_at,
          updated_at,
          0::int as recipient_count,
          0::int as pending_count,
          0::int as sent_count,
          0::int as delivered_count,
          0::int as failed_count,
          0::int as unsubscribed_count
      `,
      [
        campaignId,
        listScope.canonicalList.id,
        campaignSource.sourceAssetId,
        campaignSource.sourceIdeaId,
        campaignSource.sourceTitle,
        input.name.trim() || input.subject.trim(),
        input.subject.trim(),
        renderedBody.html,
        renderedBody.text,
        input.replyToEmail?.trim() || null,
        actorUserId ?? null,
      ],
      client,
    );

    return {
      campaign: mapEmailCampaign(result.rows[0]),
    };
  });
}

export async function previewEmailCampaign(
  businessId: string,
  input: PreviewEmailCampaignRequest,
): Promise<PreviewEmailCampaignResponse> {
  if (input.subject.trim() === "" || (input.bodyText?.trim() || input.bodyHtml?.trim() || "") === "") {
    throw new HttpError(400, "email_campaign_invalid", "Subject and email body are required.");
  }

  const settingsRow = await ensureEmailSettingsRow(businessId);
  const baseSettings = mapEmailSettings(settingsRow);
  const footerBranding = await loadEmailFooterBranding(businessId);
  const previewSettings = buildPreviewEmailSettings(baseSettings, input.sender);
  const renderedBody = buildEmailPreviewBodies(input, previewSettings, footerBranding);

  return {
    html: renderedBody.html,
    text: renderedBody.text,
    senderDisplayName: previewSettings.fromName,
    senderEmail: previewSettings.fromEmail,
    replyToEmail: input.replyToEmail?.trim() || previewSettings.replyToEmail,
  };
}

export async function sendTestEmailCampaign(
  businessId: string,
  input: SendTestEmailCampaignRequest,
): Promise<SendTestEmailCampaignResponse> {
  if (input.subject.trim() === "" || (input.bodyText?.trim() || input.bodyHtml?.trim() || "") === "") {
    throw new HttpError(400, "email_campaign_invalid", "Subject and email body are required.");
  }

  const recipientEmail = normalizeOptionalEmail(input.recipientEmail);
  assertValidOptionalEmail(
    recipientEmail,
    "email_recipient_invalid",
    "A valid test recipient email is required.",
  );

  await ensureBusinessEmailSendingPreconditions(businessId);

  return withDbTransaction(async (client) => {
    const settingsRow = await ensureEmailSettingsRow(businessId, client);
    const baseSettings = mapEmailSettings(settingsRow);
    const footerBranding = await loadEmailFooterBranding(businessId, client);
    const previewSettings = buildPreviewEmailSettings(baseSettings, input.sender);
    const fromEmail = previewSettings.fromEmail || process.env.SYSTEM_FROM_EMAIL?.trim();
    const fromName = previewSettings.fromName || process.env.SYSTEM_FROM_NAME?.trim() || undefined;
    const replyToEmail = input.replyToEmail?.trim() || previewSettings.replyToEmail;

    if (!fromEmail) {
      throw new HttpError(500, "system_from_email_missing", "SYSTEM_FROM_EMAIL is not configured.");
    }

    const renderedBody = buildEmailPreviewBodies(input, previewSettings, footerBranding);

    await sendPlatformEmail({
      fromEmail,
      fromName,
      replyToEmail: replyToEmail || undefined,
      toEmail: recipientEmail!,
      subject: input.subject.trim(),
      htmlBody: renderedBody.html,
      textBody: renderedBody.text,
      tags: {
        business_id: businessId,
        preview_send: "true",
      },
    });

    const updatedSettings = input.saveRecipient === false
      ? settingsRow
      : await updateEmailSettingsConfiguration(
          businessId,
          {
            testRecipientEmail: recipientEmail!,
          },
          client,
        );
    const updatedConfiguration = parseEmailSettingsConfiguration(updatedSettings.configuration_json);

    return {
      recipientEmail: recipientEmail!,
      savedRecipientEmail: updatedConfiguration.testRecipientEmail,
    };
  });
}

export async function deleteEmailCampaign(
  businessId: string,
  campaignId: string,
): Promise<DeleteEmailCampaignResponse> {
  return withDbTransaction(async (client) => {
    const campaign = await loadEmailCampaignOrThrow(businessId, campaignId, client);
    assertEmailCampaignEditable(campaign, "delete");

    await executeQuery(
      `
        delete from email_campaigns
        where business_id = $1::uuid
          and id = $2::uuid
      `,
      [businessId, campaignId],
      client,
    );

    return {
      success: true,
      campaignId,
    };
  });
}

export async function listEmailLists(businessId: string): Promise<EmailListListResponse> {
  const result = await executeQuery<EmailListRow>(
    `
      with family_lists as (
        select
          l.id,
          l.business_id,
          l.name,
          l.created_by_user_id,
          l.created_at,
          l.updated_at,
          lower(trim(l.name)) as normalized_name_key
        from email_lists l
        where l.business_id = $1::uuid
      ),
      ranked_lists as (
        select
          fl.*,
          row_number() over (
            partition by fl.normalized_name_key
            order by fl.created_at desc, fl.id desc
          ) as family_rank
        from family_lists fl
      ),
      family_counts as (
        select
          fl.normalized_name_key,
          count(distinct m.contact_id)::int as contact_count
        from family_lists fl
        left join email_list_members m on m.list_id = fl.id
        group by fl.normalized_name_key
      ),
      family_members as (
        select
          fl.normalized_name_key,
          json_agg(fl.id order by fl.created_at desc, fl.id desc) as member_list_ids_json
        from family_lists fl
        group by fl.normalized_name_key
      )
      select
        rl.id,
        rl.business_id,
        rl.name,
        rl.created_by_user_id,
        rl.created_at,
        rl.updated_at,
        coalesce(fc.contact_count, 0)::int as contact_count,
        coalesce(fm.member_list_ids_json, '[]'::json) as member_list_ids_json
      from ranked_lists rl
      inner join family_counts fc on fc.normalized_name_key = rl.normalized_name_key
      inner join family_members fm on fm.normalized_name_key = rl.normalized_name_key
      where rl.family_rank = 1
      order by rl.created_at desc, rl.id desc
    `,
    [businessId],
  );

  return {
    lists: result.rows.map(mapEmailList),
  };
}

export async function listEmailCampaigns(businessId: string): Promise<EmailCampaignListResponse> {
  const result = await executeQuery<EmailCampaignRow>(
    `
      select
        c.id,
        c.business_id,
        c.list_id,
        c.source_asset_id,
        c.source_idea_id,
        c.source_title,
        c.name,
        c.subject,
        c.body_html,
        c.body_text,
        c.status,
        c.reply_to_email,
        c.created_by_user_id,
        c.scheduled_at,
        c.send_started_at,
        c.send_completed_at,
        c.created_at,
        c.updated_at,
        count(r.id)::int as recipient_count,
        count(r.id) filter (where r.status in ('queued', 'sending'))::int as pending_count,
        count(r.id) filter (where r.status in ('sent', 'delivered'))::int as sent_count,
        count(r.id) filter (where r.status = 'delivered')::int as delivered_count,
        count(r.id) filter (where r.status = 'failed')::int as failed_count,
        count(r.id) filter (where r.status = 'unsubscribed')::int as unsubscribed_count
      from email_campaigns c
      left join lateral (
        select s.id
        from email_campaign_sends s
        where s.campaign_id = c.id
        order by s.created_at desc, s.id desc
        limit 1
      ) latest_send on true
      left join email_campaign_recipients r on r.send_id = latest_send.id
      where c.business_id = $1::uuid
      group by c.id, latest_send.id
      order by c.created_at desc
    `,
    [businessId],
  );

  return {
    campaigns: result.rows.map(mapEmailCampaign),
  };
}

export async function getEmailCampaignStatsResponse(
  businessId: string,
  campaignId: string,
): Promise<EmailCampaignStatsResponse> {
  await loadEmailCampaignOrThrow(businessId, campaignId);
  return {
    stats: await getCampaignStats(businessId, campaignId),
  };
}

export async function processQueuedEmailCampaigns(
  options: ProcessQueuedEmailCampaignsOptions = {},
): Promise<ProcessQueuedEmailCampaignsResult> {
  const batchSize = options.batchSize ?? resolveEmailCampaignWorkerBatchSize();
  const recipientLeaseMinutes = resolveEmailCampaignRecipientLeaseMinutes();
  const campaignResult = await executeQuery<EmailCampaignRow>(
    `
      select
        c.id,
        c.business_id,
        c.list_id,
        c.source_asset_id,
        c.source_idea_id,
        c.source_title,
        c.name,
        c.subject,
        c.body_html,
        c.body_text,
        c.status,
        c.reply_to_email,
        c.created_by_user_id,
        c.scheduled_at,
        c.send_started_at,
        c.send_completed_at,
        c.created_at,
        c.updated_at,
        count(r.id)::int as recipient_count,
        count(r.id) filter (where r.status in ('sent', 'delivered'))::int as sent_count,
        count(r.id) filter (where r.status = 'delivered')::int as delivered_count,
        count(r.id) filter (where r.status = 'failed')::int as failed_count,
        count(r.id) filter (where r.status = 'unsubscribed')::int as unsubscribed_count
      from email_campaigns c
      left join email_campaign_recipients r on r.campaign_id = c.id
      where c.status in ('queued', 'sending')
        and ($1::uuid is null or c.business_id = $1::uuid)
        and ($2::uuid is null or c.id = $2::uuid)
      group by c.id
      order by c.created_at asc
    `,
    [options.businessId ?? null, options.campaignId ?? null],
  );

  const summary: ProcessQueuedEmailCampaignsResult = {
    campaignsVisited: 0,
    campaignsFinalized: 0,
    recipientsClaimed: 0,
    recipientsSent: 0,
    recipientsFailed: 0,
    recipientsUnsubscribed: 0,
    requeuedRecipients: 0,
  };

  for (const campaign of campaignResult.rows) {
    summary.campaignsVisited += 1;

    let activeSend: EmailCampaignSendRow;

    try {
      activeSend = await loadActiveCampaignSendOrThrow(campaign.id);
    } catch {
      await syncCampaignStatusFromSends(campaign.id);
      continue;
    }

    const recoveredRecipients = await requeueStaleSendingRecipients(activeSend.id, recipientLeaseMinutes);
    summary.requeuedRecipients += recoveredRecipients;

    try {
      await ensureBusinessEmailSendingPreconditions(campaign.business_id);
    } catch (error) {
      const failureMessage =
        error instanceof Error
          ? error.message
          : "Business email domain is not ready for sending.";

      await withDbTransaction(async (client) => {
        await executeQuery(
          `
            update email_campaign_recipients
            set
              status = 'failed',
              failed_at = coalesce(failed_at, now()),
              failure_reason = $2,
              updated_at = now()
            where send_id = $1::uuid
              and status = 'queued'
          `,
          [
            activeSend.id,
            JSON.stringify({
              message: failureMessage,
            }),
          ],
          client,
        );
        await syncCampaignSendStatusFromRecipients(activeSend.id, client);
        await syncCampaignStatusFromSends(campaign.id, client);
      });

      summary.campaignsFinalized += 1;

      void safeCreateSystemErrorLog({
        route: "/api/businesses/:id/email/campaigns/:campaignId/send",
        businessId: campaign.business_id,
        code: "email_domain_not_ready",
        message: failureMessage,
        metadata: {
          campaignId: campaign.id,
        },
      });

      void sendEmailCampaignLifecycleNotification({
        campaignId: campaign.id,
        eventType: "failed",
      }).catch((notificationError) => {
        logWarn("Email campaign failure notification failed.", {
          businessId: campaign.business_id,
          campaignId: campaign.id,
          message:
            notificationError instanceof Error ? notificationError.message : "Unknown error",
        });
      });

      continue;
    }

    const settings = mapEmailSettings(await ensureEmailSettingsRow(campaign.business_id));
    const fromEmail = settings.fromEmail || process.env.SYSTEM_FROM_EMAIL?.trim();
    const fromName = settings.fromName || process.env.SYSTEM_FROM_NAME?.trim() || undefined;

    if (!fromEmail) {
      throw new HttpError(500, "system_from_email_missing", "SYSTEM_FROM_EMAIL is not configured.");
    }

    const claimedRecipients = await withDbTransaction(async (client) => {
      await executeQuery(
        `
          update email_campaign_sends
          set
            status = 'sending',
            send_started_at = coalesce(send_started_at, now()),
            send_completed_at = null,
            updated_at = now()
          where id = $1::uuid
        `,
        [activeSend.id],
        client,
      );

      await executeQuery(
        `
          update email_campaigns
          set
            status = 'sending',
            send_started_at = coalesce(send_started_at, now()),
            send_completed_at = null,
            updated_at = now()
          where id = $1::uuid
        `,
        [campaign.id],
        client,
      );

      return claimQueuedCampaignRecipients(activeSend.id, batchSize, client);
    });

    summary.recipientsClaimed += claimedRecipients.length;

    if (claimedRecipients.length > 0) {
      void sendEmailCampaignLifecycleNotification({
        campaignId: campaign.id,
        eventType: "started",
      }).catch((notificationError) => {
        logWarn("Email campaign start notification failed during worker processing.", {
          businessId: campaign.business_id,
          campaignId: campaign.id,
          message: notificationError instanceof Error ? notificationError.message : "Unknown error",
        });
      });
    }

    if (claimedRecipients.length === 0) {
      await syncCampaignSendStatusFromRecipients(activeSend.id);
      const finalStatus = await syncCampaignStatusFromSends(campaign.id);
      if (finalStatus !== "sending" && finalStatus !== "queued") {
        summary.campaignsFinalized += 1;
        void sendEmailCampaignLifecycleNotification({
          campaignId: campaign.id,
          eventType: finalStatus === "failed" ? "failed" : "completed",
        }).catch((notificationError) => {
          logWarn("Email campaign finalization notification failed.", {
            businessId: campaign.business_id,
            campaignId: campaign.id,
            eventType: finalStatus,
            message:
              notificationError instanceof Error ? notificationError.message : "Unknown error",
          });
        });
      }
      continue;
    }

    for (const recipientRow of claimedRecipients) {
      const contactEmail = recipientRow.contact_email?.trim() ?? "";
      const suppressedByBusinessUnsubscribe = contactEmail
        ? await isEmailUnsubscribed(campaign.business_id, contactEmail)
        : false;

      if (
        recipientRow.contact_status === "unsubscribed" ||
        suppressedByBusinessUnsubscribe
      ) {
        await markCampaignRecipientUnsubscribed(
          recipientRow.id,
          suppressedByBusinessUnsubscribe ? "business_unsubscribe" : "contact_status",
        );
        summary.recipientsUnsubscribed += 1;
        continue;
      }

      if (recipientRow.contact_status === "bounced" || recipientRow.contact_status === "complained") {
        await markCampaignRecipientFailure(
          recipientRow.id,
          `Contact is suppressed (${recipientRow.contact_status}).`,
        );
        summary.recipientsFailed += 1;
        continue;
      }

      if (contactEmail === "") {
        await markCampaignRecipientFailure(recipientRow.id, "Contact email is missing.");
        summary.recipientsFailed += 1;
        continue;
      }

      try {
        const sent = await sendPlatformEmail({
          fromEmail,
          fromName,
          replyToEmail: campaign.reply_to_email || settings.replyToEmail,
          toEmail: contactEmail,
          subject: recipientRow.personalized_subject,
          htmlBody: recipientRow.personalized_body_html,
          textBody: recipientRow.personalized_body_text,
          tags: {
            campaign_id: campaign.id,
            business_id: campaign.business_id,
            send_id: activeSend.id,
            recipient_id: recipientRow.id,
          },
        });

        try {
          await markCampaignRecipientSent(recipientRow.id, sent);
        } catch (persistError) {
          logWarn("Email recipient send succeeded but the send ledger update failed. Falling back to recipient-only sent status.", {
            businessId: campaign.business_id,
            campaignId: campaign.id,
            recipientId: recipientRow.id,
            messageId: sent.messageId,
            message: persistError instanceof Error ? persistError.message : "Unknown error",
          });

          await markCampaignRecipientSentStatusOnly(recipientRow.id, sent);

          void safeCreateSystemErrorLog({
            route: "/api/businesses/:id/email/campaigns/:campaignId/send",
            businessId: campaign.business_id,
            code: "email_send_persist_partial_failure",
            message:
              persistError instanceof Error
                ? persistError.message
                : "Email recipient send ledger update failed after provider success.",
            metadata: {
              campaignId: campaign.id,
              recipientId: recipientRow.id,
              providerMessageId: sent.messageId,
            },
          });
        }

        summary.recipientsSent += 1;
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : "Unknown email send failure.";

        await markCampaignRecipientFailure(recipientRow.id, failureMessage);
        summary.recipientsFailed += 1;

        void safeCreateSystemErrorLog({
          route: "/api/businesses/:id/email/campaigns/:campaignId/send",
          businessId: campaign.business_id,
          code: "email_send_failed",
          message: failureMessage,
          metadata: {
            campaignId: campaign.id,
            recipientId: recipientRow.id,
          },
        });
      }
    }

    await syncCampaignSendStatusFromRecipients(activeSend.id);
    const finalStatus = await syncCampaignStatusFromSends(campaign.id);
    if (finalStatus !== "sending" && finalStatus !== "queued") {
      summary.campaignsFinalized += 1;
      void sendEmailCampaignLifecycleNotification({
        campaignId: campaign.id,
        eventType: finalStatus === "failed" ? "failed" : "completed",
      }).catch((notificationError) => {
        logWarn("Email campaign finalization notification failed.", {
          businessId: campaign.business_id,
          campaignId: campaign.id,
          eventType: finalStatus,
          message:
            notificationError instanceof Error ? notificationError.message : "Unknown error",
        });
      });
    }
  }

  return summary;
}

export async function drainQueuedEmailCampaigns(
  options: ProcessQueuedEmailCampaignsOptions = {},
): Promise<ProcessQueuedEmailCampaignsResult> {
  const aggregate: ProcessQueuedEmailCampaignsResult = {
    campaignsVisited: 0,
    campaignsFinalized: 0,
    recipientsClaimed: 0,
    recipientsSent: 0,
    recipientsFailed: 0,
    recipientsUnsubscribed: 0,
    requeuedRecipients: 0,
  };

  for (let pass = 0; pass < MAX_EMAIL_CAMPAIGN_DRAIN_PASSES; pass += 1) {
    const result = await processQueuedEmailCampaigns(options);

    aggregate.campaignsVisited += result.campaignsVisited;
    aggregate.campaignsFinalized += result.campaignsFinalized;
    aggregate.recipientsClaimed += result.recipientsClaimed;
    aggregate.recipientsSent += result.recipientsSent;
    aggregate.recipientsFailed += result.recipientsFailed;
    aggregate.recipientsUnsubscribed += result.recipientsUnsubscribed;
    aggregate.requeuedRecipients += result.requeuedRecipients;

    if (result.recipientsClaimed === 0 && result.requeuedRecipients === 0) {
      return aggregate;
    }
  }

  logWarn("Email campaign drain reached the maximum pass limit.", {
    businessId: options.businessId ?? null,
    campaignId: options.campaignId ?? null,
    maxPasses: MAX_EMAIL_CAMPAIGN_DRAIN_PASSES,
  });

  return aggregate;
}

export async function sendEmailCampaign(
  businessId: string,
  campaignId: string,
  actorUserId?: string,
): Promise<SendEmailCampaignResponse> {
  await ensureBusinessEmailSendingPreconditions(businessId);
  let billingWarnings: string[] = [];
  let emailAddon: SendEmailCampaignResponse["emailAddon"] | undefined;

  await withDbTransaction(async (client) => {
    const campaign = await loadEmailCampaignOrThrow(businessId, campaignId, client);

    if (campaign.status === "queued" || campaign.status === "sending") {
      throw new HttpError(
        409,
        "email_campaign_already_processing",
        "This campaign is already being processed.",
      );
    }

    const contacts = await loadCampaignContacts(businessId, campaign.id, client);

    if (contacts.length === 0) {
      throw new HttpError(400, "email_campaign_no_contacts", "This campaign has no active contacts.");
    }

    const currentPlanCode = await resolveBusinessPlanCode(businessId, client);
    emailAddon = await getBillingEmailAddonSummary(businessId, {
      currentPlanCode,
    });
    billingWarnings = buildEmailBillingSendWarnings(emailAddon, contacts.length);

    await incrementBusinessDailyUsage(businessId, "emails", contacts.length);
    await ensureEmailSettingsRow(businessId, client);
    const send = await createCampaignSend(campaign, contacts.length, actorUserId, client);
    await createCampaignRecipientsForSend(send, campaign, contacts, client);
    await executeQuery(
      `
        update email_campaigns
        set
          status = 'queued',
          send_started_at = null,
          send_completed_at = null,
          start_notification_sent_at = null,
          completion_notification_sent_at = null,
          failure_notification_sent_at = null,
          updated_at = now()
        where id = $1::uuid
      `,
      [campaignId],
      client,
    );
  });

  void drainQueuedEmailCampaigns({
    businessId,
    campaignId,
  }).catch((error) => {
    logWarn("Background email campaign drain failed after enqueue.", {
      businessId,
      campaignId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  });

  void safeLogEvent("content_selected", actorUserId, businessId, {
    source: "email_campaign",
    campaignId,
  });

  void sendEmailCampaignLifecycleNotification({
    campaignId,
    eventType: "started",
  }).catch((notificationError) => {
    logWarn("Email campaign start notification failed.", {
      businessId,
      campaignId,
      message: notificationError instanceof Error ? notificationError.message : "Unknown error",
    });
  });

  const campaign = mapEmailCampaign(await loadEmailCampaignOrThrow(businessId, campaignId));
  const stats = await getCampaignStats(businessId, campaignId);

  return {
    campaign,
    stats,
    billingWarnings,
    emailAddon,
  };
}

export async function createEmailDomain(
  businessId: string,
  input: CreateEmailDomainRequest,
): Promise<CreateEmailDomainResponse> {
  const fromEmail = normalizeOptionalEmail(input.fromEmail);
  const replyToEmail = normalizeOptionalEmail(input.replyToEmail);
  const footer = normalizeEmailFooterSettings(input.footer);
  const signatureText = input.signatureText?.trim() || buildEmailFooterText(footer) || null;
  const domainName =
    normalizeDomainNameInput(input.domainName) ||
    normalizeDomainNameInput(fromEmail) ||
    null;

  if (!domainName || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domainName)) {
    throw new HttpError(400, "email_domain_invalid", "A valid domain is required. Use a root domain like yourbrand.com.");
  }

  assertValidOptionalEmail(fromEmail, "email_from_invalid", "A valid from email is required.");
  assertValidOptionalEmail(replyToEmail, "email_reply_to_invalid", "A valid reply-to email is required.");
  assertFromEmailMatchesDomain(fromEmail, domainName);

  const domainConflict = await executeQuery<BusinessIdRow>(
    `
      select business_id
      from business_email_settings
      where lower(domain_name) = $1
        and business_id <> $2::uuid
      limit 1
    `,
    [domainName, businessId],
  );

  if (domainConflict.rows[0]) {
    throw new HttpError(
      409,
      "email_domain_in_use",
      "This domain is already connected to another workspace.",
    );
  }

  const existingSettingsRow = await ensureEmailSettingsRow(businessId);
  const existingConfiguration = parseEmailSettingsConfiguration(existingSettingsRow.configuration_json);
  const configuration = buildEmailSettingsConfiguration({
    footer,
    testRecipientEmail: existingConfiguration.testRecipientEmail,
  });

  const snapshot = await ensureSesDomainIdentity(domainName);
  const safety = await inspectDomainSafety({
    domainName,
    dnsRecords: snapshot.dnsRecords,
    bypassCache: true,
  });

  const result = await executeQuery<EmailSettingsRow>(
    `
      insert into business_email_settings (
        business_id,
        from_name,
        from_email,
        reply_to_email,
        signature_text,
        configuration_json,
        provider,
        domain_name,
        domain_status,
        dkim_status,
        spf_status,
        ses_identity,
        dns_records_json,
        existing_mx_json,
        existing_spf_value,
        existing_dmarc_value,
        recommended_spf_value,
        conflict_flags_json,
        verified_at,
        last_checked_at
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        'ses',
        $7,
        $8,
        $9,
        $10,
        $11,
        $12::jsonb,
        $13::jsonb,
        $14,
        $15,
        $16,
        $17::jsonb,
        case when $18 then now() else null end,
        now()
      )
      on conflict (business_id)
      do update set
        from_name = excluded.from_name,
        from_email = excluded.from_email,
        reply_to_email = excluded.reply_to_email,
        signature_text = excluded.signature_text,
        configuration_json = excluded.configuration_json,
        domain_name = excluded.domain_name,
        domain_status = excluded.domain_status,
        dkim_status = excluded.dkim_status,
        spf_status = excluded.spf_status,
        ses_identity = excluded.ses_identity,
        dns_records_json = excluded.dns_records_json,
        existing_mx_json = excluded.existing_mx_json,
        existing_spf_value = excluded.existing_spf_value,
        existing_dmarc_value = excluded.existing_dmarc_value,
        recommended_spf_value = excluded.recommended_spf_value,
        conflict_flags_json = excluded.conflict_flags_json,
        verified_at = case
          when excluded.domain_status = '${DOMAIN_STATUS_VERIFIED}'
            then coalesce(business_email_settings.verified_at, now())
          else null
        end,
        last_checked_at = now(),
        updated_at = now()
      returning
        ${EMAIL_SETTINGS_SELECT_FIELDS}
    `,
    [
      businessId,
      input.fromName?.trim() || process.env.SYSTEM_FROM_NAME?.trim() || null,
      fromEmail,
      replyToEmail,
      signatureText,
      JSON.stringify(configuration),
      domainName,
      snapshot.domainStatus,
      snapshot.dkimStatus,
      snapshot.spfStatus,
      snapshot.sesIdentity,
      JSON.stringify(snapshot.dnsRecords),
      safety.existingMxJson,
      safety.existingSpfValue,
      safety.existingDmarcValue,
      safety.recommendedSpfValue,
      safety.conflictFlagsJson,
      snapshot.verifiedForSending,
    ],
  );

  return {
    settings: await attachEmailDeliverability(mapEmailSettings(result.rows[0])),
  };
}

export async function getEmailDomainSettings(
  businessId: string,
): Promise<EmailDomainSettingsResponse> {
  const row = await ensureEmailSettingsRow(businessId);

  if (!row.domain_name) {
    return {
      settings: mapEmailSettings(row),
    };
  }

  return {
    settings: await refreshEmailDomainSettings(row),
  };
}

export async function verifyEmailDomain(
  businessId: string,
  domainId: string,
): Promise<VerifyEmailDomainResponse> {
  const settingsRow = await executeQuery<EmailSettingsRow>(
    `
      select
        ${EMAIL_SETTINGS_SELECT_FIELDS}
      from business_email_settings
      where business_id = $1::uuid
        and id = $2::uuid
      limit 1
    `,
    [businessId, domainId],
  );

  const row = settingsRow.rows[0];

  if (!row) {
    throw new HttpError(404, "email_domain_not_found", "Email domain configuration not found.");
  }

  return {
    settings: await refreshEmailDomainSettings(row, {
      bypassDnsCache: true,
    }),
  };
}

export async function getEmailSubscriptionStatus(token: string): Promise<EmailSubscriptionStatusResponse> {
  return withDbTransaction(async (client) => {
    const row = await findEmailContactByUnsubscribeToken(token, client);
    const isUnsubscribed =
      row.status === "unsubscribed"
      || await isEmailUnsubscribed(row.business_id, row.email, client);

    return {
      email: row.email,
      status: isUnsubscribed ? "unsubscribed" : "active",
    };
  });
}

export async function unsubscribeEmail(
  token: string,
  reason?: string,
): Promise<UnsubscribeEmailResponse> {
  return withDbTransaction(async (client) => {
    const row = await findEmailContactByUnsubscribeToken(token, client);

    const sourceCampaignResult = await executeQuery<{ campaign_id: string | null }>(
      `
        select r.campaign_id
        from email_campaign_recipients r
        where r.contact_id = $1::uuid
        order by r.created_at desc
        limit 1
      `,
      [row.id],
      client,
    );

    await recordBusinessUnsubscribe(
      {
        businessId: row.business_id,
        email: row.email,
        reason: normalizeUnsubscribeReason(reason) || "Recipient clicked the unsubscribe link.",
        source: "campaign",
        sourceCampaignId: sourceCampaignResult.rows[0]?.campaign_id ?? null,
      },
      client,
    );

    await executeQuery(
      `
        update email_contacts
        set
          status = 'unsubscribed',
          unsubscribed_at = coalesce(unsubscribed_at, now()),
          updated_at = now()
        where id = $1::uuid
      `,
      [row.id],
      client,
    );

    const updatedRecipients = await executeQuery<{ id: string }>(
      `
        update email_campaign_recipients
        set
          status = 'unsubscribed',
          updated_at = now()
        where contact_id = $1::uuid
          and status in ('queued', 'sent', 'delivered')
        returning id
      `,
      [row.id],
      client,
    );

    for (const recipient of updatedRecipients.rows) {
      await executeQuery(
        `
          insert into email_events (
            campaign_recipient_id,
            event_type,
            payload_json,
            occurred_at
          ) values (
            $1::uuid,
            'unsubscribe',
            $2::jsonb,
            now()
          )
        `,
        [
          recipient.id,
          JSON.stringify({
            source: "recipient_link",
          }),
        ],
        client,
      );
    }

    return {
      success: true,
      email: row.email,
    };
  });
}

export async function resubscribeEmail(token: string): Promise<ResubscribeEmailResponse> {
  return withDbTransaction(async (client) => {
    const row = await findEmailContactByUnsubscribeToken(token, client);

    await removeBusinessUnsubscribe(row.business_id, row.email, client);

    await executeQuery(
      `
        update email_contacts
        set
          status = case
            when status = 'unsubscribed' then 'active'
            else status
          end,
          unsubscribed_at = case
            when status = 'unsubscribed' then null
            else unsubscribed_at
          end,
          updated_at = now()
        where id = $1::uuid
      `,
      [row.id],
      client,
    );

    return {
      success: true,
      email: row.email,
    };
  });
}
