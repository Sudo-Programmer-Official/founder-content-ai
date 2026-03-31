export type EmailContactStatus =
  | "active"
  | "unsubscribed"
  | "bounced"
  | "complained"
  | "suppressed";
export type EmailCampaignStatus = "draft" | "queued" | "sending" | "sent" | "failed";
export type EmailCampaignRecipientStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "unsubscribed";
export type EmailEventType =
  | "queued"
  | "sent"
  | "delivered"
  | "open"
  | "bounce"
  | "complaint"
  | "unsubscribe"
  | "failed";

export interface EmailDnsRecord {
  type: "TXT" | "CNAME";
  name: string;
  value: string;
}

export interface EmailMxRecord {
  priority: number;
  exchange: string;
}

export interface EmailDomainConflictFlag {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export type EmailSpfValidationState =
  | "valid"
  | "missing"
  | "missing_ses_include"
  | "malformed"
  | "multiple_records";

export type EmailDeliverabilityBand = "excellent" | "needs_attention" | "at_risk";
export type EmailDeliverabilityDmarcStatus = "present" | "missing" | "invalid";

export interface EmailDeliverabilityIssue {
  code: string;
  severity: "warning" | "error";
  message: string;
}

export interface EmailDnsInstruction {
  category: "safe_to_add" | "merge_carefully" | "do_not_change";
  type: "TXT" | "CNAME" | "MX";
  name: string;
  value: string;
  label: string;
  note: string;
}

export interface EmailDomainSetupAnalysis {
  state: "green" | "yellow" | "red";
  brandedSendingReady: boolean;
  dkimReady: boolean;
  spfReady: boolean;
  spfValidationState: EmailSpfValidationState;
  dmarcConfigured: boolean;
  providerSignals: string[];
  existingMxRecords: EmailMxRecord[];
  existingSpfValue?: string;
  existingDmarcValue?: string;
  recommendedSpfValue?: string;
  safeToAdd: EmailDnsInstruction[];
  mergeCarefully: EmailDnsInstruction[];
  doNotChange: EmailDnsInstruction[];
  conflictFlags: EmailDomainConflictFlag[];
}

export interface EmailDeliverabilitySnapshot {
  score: number;
  scoreBand: EmailDeliverabilityBand;
  blockers: EmailDeliverabilityIssue[];
  sesVerified: boolean;
  dkimVerified: boolean;
  spfStatus: EmailSpfValidationState;
  dmarcStatus: EmailDeliverabilityDmarcStatus;
  bounceRate7d: number;
  complaintRate7d: number;
  deliveryRate7d: number;
  recentDeliveries7d: number;
  recentHardBounces7d: number;
  recentSoftBounces7d: number;
  recentComplaints7d: number;
  sendingBlocked: boolean;
  lastEvaluatedAt?: string;
}

export interface BusinessEmailSettings {
  id?: string;
  businessId: string;
  provider: string;
  fromName?: string;
  fromEmail?: string;
  replyToEmail?: string;
  signatureText?: string;
  domainName?: string;
  domainStatus: string;
  dkimStatus: string;
  spfStatus: string;
  sesIdentity?: string;
  dnsRecords: EmailDnsRecord[];
  verifiedAt?: string;
  lastCheckedAt?: string;
  updatedAt?: string;
  domainSetupAnalysis?: EmailDomainSetupAnalysis;
  deliverability?: EmailDeliverabilitySnapshot;
}

export interface EmailList {
  id: string;
  businessId: string;
  name: string;
  createdByUserId?: string;
  contactCount: number;
  createdAt: string;
  updatedAt?: string;
}

export interface EmailContact {
  id: string;
  businessId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  tags: string[];
  status: EmailContactStatus;
  unsubscribedAt?: string;
  lastBounceAt?: string;
  lastComplaintAt?: string;
  lastProviderEventAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface EmailCampaign {
  id: string;
  businessId: string;
  listId?: string;
  sourceAssetId?: string;
  sourceIdeaId?: string;
  sourceTitle?: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  status: EmailCampaignStatus;
  replyToEmail?: string;
  createdByUserId?: string;
  scheduledAt?: string;
  sendStartedAt?: string;
  sendCompletedAt?: string;
  createdAt: string;
  updatedAt?: string;
  recipientCount: number;
  pendingCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  unsubscribedCount: number;
}

export interface EmailCampaignRecipient {
  id: string;
  campaignId: string;
  contactId: string;
  personalizedSubject: string;
  personalizedBodyHtml: string;
  personalizedBodyText: string;
  status: EmailCampaignRecipientStatus;
  sesMessageId?: string;
  sentAt?: string;
  deliveredAt?: string;
  failedAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface EmailCampaignStats {
  campaignId: string;
  recipientCount: number;
  pendingCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  unsubscribedCount: number;
}

export interface EmailCampaignImage {
  url: string;
  altText?: string;
}

export interface EmailCampaignContent {
  headerImage?: EmailCampaignImage;
  inlineImages?: EmailCampaignImage[];
  includeSignature?: boolean;
}

export type EmailContactImportField =
  | "email"
  | "name"
  | "firstName"
  | "lastName"
  | "tags";

export type EmailContactImportDuplicateStrategy = "upsert" | "skip";
export type EmailJobStatus = "queued" | "processing" | "completed" | "failed" | "paused";
export type EmailContactImportJobStatus = "queued" | "processing" | "completed" | "failed";

export type EmailContactImportMapping = Partial<Record<EmailContactImportField, string>>;

export interface EmailContactImportJobError {
  message: string;
  rowCount?: number;
}

export interface EmailContactImportJob {
  id: string;
  businessId: string;
  jobId?: string;
  listName: string;
  fileName?: string;
  status: EmailContactImportJobStatus;
  totalRows: number;
  processedRows: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  mapping: EmailContactImportMapping;
  errorSummary: EmailContactImportJobError[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface EmailContactImportFieldPreview {
  field: EmailContactImportField;
  label: string;
  required: boolean;
  columnName?: string;
  confidence: "high" | "medium" | "low" | "none";
}

export interface EmailContactImportPreviewRow {
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  tags: string[];
  issues: string[];
  raw: Record<string, string>;
}

export interface EmailContactImportPreviewSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  existingContacts: number;
}

export interface ImportEmailContactsPreviewRequest {
  csvText: string;
  mapping?: EmailContactImportMapping;
}

export interface ImportEmailContactsPreviewResponse {
  columns: string[];
  suggestedMapping: EmailContactImportMapping;
  fields: EmailContactImportFieldPreview[];
  previewRows: EmailContactImportPreviewRow[];
  summary: EmailContactImportPreviewSummary;
}

export interface ImportEmailContactsRequest {
  listName: string;
  csvText: string;
  mapping?: EmailContactImportMapping;
  duplicateStrategy?: EmailContactImportDuplicateStrategy;
}

export interface QueueEmailContactsImportRequest extends ImportEmailContactsRequest {
  fileName?: string;
}

export interface ImportEmailContactsResponse {
  list: EmailList;
  contacts: EmailContact[];
  importedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
}

export interface QueueEmailContactsImportResponse {
  importJob: EmailContactImportJob;
}

export interface EmailContactImportJobResponse {
  importJob: EmailContactImportJob;
}

export interface EmailContactImportJobListResponse {
  importJobs: EmailContactImportJob[];
}

export interface EmailContactListResponse {
  contacts: EmailContact[];
  total: number;
}

export interface EmailListListResponse {
  lists: EmailList[];
}

export interface CreateEmailCampaignRequest {
  listId: string;
  name: string;
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  replyToEmail?: string;
  content?: EmailCampaignContent;
  sourceAssetId?: string;
  sourceIdeaId?: string;
  sourceTitle?: string;
}

export interface CreateEmailCampaignResponse {
  campaign: EmailCampaign;
}

export interface SendEmailCampaignRequest {
  businessId: string;
}

export interface SendEmailCampaignResponse {
  campaign: EmailCampaign;
  stats: EmailCampaignStats;
}

export interface EmailCampaignListResponse {
  campaigns: EmailCampaign[];
}

export interface EmailCampaignStatsResponse {
  stats: EmailCampaignStats;
}

export interface CreateEmailDomainRequest {
  domainName: string;
  fromName?: string;
  fromEmail?: string;
  replyToEmail?: string;
  signatureText?: string;
}

export interface CreateEmailDomainResponse {
  settings: BusinessEmailSettings;
}

export interface EmailDomainSettingsResponse {
  settings: BusinessEmailSettings;
}

export interface VerifyEmailDomainResponse {
  settings: BusinessEmailSettings;
}

export interface UnsubscribeEmailResponse {
  success: true;
  email: string;
}
