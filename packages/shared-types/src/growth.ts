export type GrowthLeadSource =
  | "landing_page"
  | "demo_request"
  | "manual"
  | "csv_import"
  | "system";
export type GrowthLeadSourcePlatform = "linkedin" | "email" | "manual" | "website";

export type GrowthLeadStatus = "new" | "engaged" | "trial" | "converted" | "churned";
export type GrowthAutomationTrigger = "lead_created";
export type GrowthAutomationChannel = "email";
export type GrowthAutomationFlowStatus = "active" | "paused" | "archived";
export type GrowthAutomationEnrollmentStatus = "active" | "paused" | "completed" | "failed";
export type GrowthLeadEventType =
  | "captured"
  | "enrolled"
  | "email_sent"
  | "email_delivered"
  | "email_bounced"
  | "email_complained"
  | "email_opened"
  | "email_clicked"
  | "email_failed"
  | "step_skipped"
  | "status_changed";
export type GrowthAutomationRunStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "skipped";

export interface GrowthLead {
  id: string;
  businessId: string;
  name: string;
  email: string;
  phone?: string;
  source: GrowthLeadSource;
  sourcePlatform?: GrowthLeadSourcePlatform;
  sourceAssetId?: string;
  sourceAssetTitle?: string;
  sourceExternalUrl?: string;
  status: GrowthLeadStatus;
  notes?: string;
  firstEmailSentAt?: string;
  lastContactedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GrowthLeadEvent {
  id: string;
  businessId: string;
  leadId: string;
  stepRunId?: string;
  providerMessageId?: string;
  eventType: GrowthLeadEventType;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface GrowthAutomationStep {
  id: string;
  flowId: string;
  dayOffset: number;
  channel: GrowthAutomationChannel;
  templateKey: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GrowthAutomationFlow {
  id: string;
  businessId: string;
  name: string;
  slug: string;
  trigger: GrowthAutomationTrigger;
  status: GrowthAutomationFlowStatus;
  createdAt: string;
  updatedAt: string;
  steps: GrowthAutomationStep[];
}

export interface GrowthLeadListQuery {
  businessId: string;
}

export interface GrowthLeadListResponse {
  leads: GrowthLead[];
}

export interface GrowthLeadEventListQuery {
  businessId: string;
}

export interface GrowthLeadEventListResponse {
  events: GrowthLeadEvent[];
}

export interface GrowthAutomationFlowListQuery {
  businessId: string;
}

export interface GrowthAutomationFlowListResponse {
  flows: GrowthAutomationFlow[];
}

export interface CreateGrowthLeadRequest {
  businessId: string;
  name: string;
  email: string;
  phone?: string;
  source?: GrowthLeadSource;
  sourcePlatform?: GrowthLeadSourcePlatform;
  sourceAssetId?: string;
  sourceAssetTitle?: string;
  sourceExternalUrl?: string;
  notes?: string;
}

export interface CreateGrowthLeadResponse {
  lead: GrowthLead;
  enrolledFlowIds: string[];
}

export interface UpdateGrowthLeadStatusRequest {
  businessId: string;
  status: GrowthLeadStatus;
}

export interface UpdateGrowthLeadStatusResponse {
  lead: GrowthLead;
}
