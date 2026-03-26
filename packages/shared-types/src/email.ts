export type EmailContactStatus = "active" | "unsubscribed" | "bounced" | "complained";
export type EmailCampaignStatus = "draft" | "queued" | "sending" | "sent" | "failed";
export type EmailCampaignRecipientStatus =
  | "queued"
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

export interface BusinessEmailSettings {
  id?: string;
  businessId: string;
  provider: string;
  fromName?: string;
  fromEmail?: string;
  replyToEmail?: string;
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
  createdAt: string;
  updatedAt?: string;
}

export interface EmailCampaign {
  id: string;
  businessId: string;
  listId?: string;
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
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  unsubscribedCount: number;
}

export interface ImportEmailContactsRequest {
  listName: string;
  csvText: string;
}

export interface ImportEmailContactsResponse {
  list: EmailList;
  contacts: EmailContact[];
  importedCount: number;
}

export interface EmailListListResponse {
  lists: EmailList[];
}

export interface CreateEmailCampaignRequest {
  listId: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  replyToEmail?: string;
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
