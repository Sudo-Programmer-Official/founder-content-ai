export type OutreachPlatform = "linkedin" | "reddit" | "x";
export type OutreachLeadStatus = "new" | "contacted" | "replied" | "activated";
export type OutreachPriority = "high" | "medium" | "low";
export type OutreachQueue = "new" | "followups";
export type OutreachMessageTone = "casual" | "direct" | "curious";
export type OutreachMessageType = "initial" | "followup" | "reply" | "draft";
export type OutreachReplySentiment = "positive" | "neutral" | "negative";

export interface OutreachMessage {
  id: string;
  leadId: string;
  businessId?: string;
  type: OutreachMessageType;
  author: "ai" | "operator" | "lead";
  content: string;
  tone?: OutreachMessageTone;
  createdAt: string;
  sentAt?: string;
}

export interface OutreachLead {
  id: string;
  businessId?: string;
  name: string;
  role: string;
  platform: OutreachPlatform;
  profileUrl: string;
  bio: string;
  recentPost: string;
  engagementLabel: "low" | "medium" | "high";
  postsFrequently: boolean;
  lowEngagement: boolean;
  founderKeyword: boolean;
  priorityScore: number;
  priority: OutreachPriority;
  status: OutreachLeadStatus;
  contactedAt?: string;
  repliedAt?: string;
  lastPostAt?: string;
  replyContent?: string;
  replySentiment?: OutreachReplySentiment;
  messageHistory: OutreachMessage[];
}

export interface OutreachMetrics {
  leads: number;
  sent: number;
  replies: number;
  conversions: number;
}

export interface OutreachPipelineStage {
  key: OutreachLeadStatus;
  label: string;
  count: number;
}

export interface OutreachOverview {
  metrics: OutreachMetrics;
  pipeline: OutreachPipelineStage[];
  followupsDue: number;
}

export interface OutreachLeadFilters {
  businessId?: string;
  platform?: OutreachPlatform | "all";
  status?: OutreachLeadStatus | "all";
  priority?: OutreachPriority | "all";
  queue?: OutreachQueue;
}

export interface OutreachOverviewResponse {
  overview: OutreachOverview;
}

export interface OutreachLeadListResponse {
  leads: OutreachLead[];
  filters: OutreachLeadFilters;
}

export interface OutreachMessageDraftRequest {
  leadId: string;
  tone: OutreachMessageTone;
}

export interface OutreachMessageDraftResponse {
  lead: OutreachLead;
  message: OutreachMessage;
}

export interface OutreachReplyDraftRequest {
  leadId: string;
  tone: OutreachMessageTone;
}

export interface OutreachReplyDraftResponse {
  lead: OutreachLead;
  message: OutreachMessage;
}

export interface UpdateOutreachLeadStatusRequest {
  status: OutreachLeadStatus;
  messageContent?: string;
  tone?: OutreachMessageTone;
}

export interface UpdateOutreachLeadStatusResponse {
  lead: OutreachLead;
}

export interface ImportOutreachLeadItem {
  name: string;
  role?: string;
  platform: OutreachPlatform;
  profileUrl: string;
  bio?: string;
  recentPost?: string;
  engagementLabel?: "low" | "medium" | "high";
  postsFrequently?: boolean;
  lowEngagement?: boolean;
  founderKeyword?: boolean;
  lastPostAt?: string;
}

export interface ImportOutreachLeadsRequest {
  businessId: string;
  leads: ImportOutreachLeadItem[];
}

export interface ImportOutreachLeadsResponse {
  leads: OutreachLead[];
  importedCount: number;
}

export interface CreateOutreachMessageRequest {
  businessId: string;
  leadId: string;
  content: string;
  tone?: OutreachMessageTone;
  type?: Exclude<OutreachMessageType, "draft">;
  markStatus?: OutreachLeadStatus;
}

export interface CreateOutreachMessageResponse {
  lead: OutreachLead;
  message: OutreachMessage;
}

export interface OutreachLeadHistoryResponse {
  lead: OutreachLead;
  history: OutreachMessage[];
}
