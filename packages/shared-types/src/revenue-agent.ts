export type RevenueAgentLeadSourceProvider = "google_business" | "mock" | "csv_import";
export type RevenueAgentWebsitePerformanceBand = "strong" | "moderate" | "weak" | "unknown";
export type RevenueAgentProspectStatus =
  | "new"
  | "researched"
  | "drafted"
  | "approved"
  | "sent"
  | "replied"
  | "follow_up_due"
  | "meeting_booked"
  | "not_interested"
  | "dead";
export type RevenueAgentMessageType = "initial" | "followup" | "value" | "breakup";
export type RevenueAgentMessageStatus = "draft" | "approved" | "sent" | "failed";
export type RevenueAgentTaskType =
  | "research"
  | "approve_draft"
  | "send_email"
  | "follow_up"
  | "value_follow_up"
  | "breakup"
  | "meeting_prep";
export type RevenueAgentTaskStatus = "open" | "done" | "skipped" | "failed";
export type RevenueAgentRunStatus = "queued" | "running" | "completed" | "failed";
export type RevenueAgentTimelineTone = "done" | "active" | "pending";
export type RevenueAgentTimelineEventType =
  | "lead_discovered"
  | "research_generated"
  | "draft_created"
  | "draft_approved"
  | "sent"
  | "reply_received"
  | "reply_analyzed"
  | "meeting_booked"
  | "follow_up_scheduled"
  | "meeting_prep_created"
  | "not_interested";

export interface RevenueAgentFeedConfig {
  industry: string;
  city: string;
  state: string;
  offer: string;
  dailyLeadLimit: number;
  provider?: RevenueAgentLeadSourceProvider;
  csvText?: string;
}

export interface RevenueAgentWebsiteSignals {
  bookingSoftware?: string;
  bookingSoftwareEvidence: string[];
  cms?: string;
  analytics: string[];
  marketingPixels: string[];
  contactForm: boolean;
  chatWidget: boolean;
  mobileResponsive: boolean;
  performanceBand: RevenueAgentWebsitePerformanceBand;
  https: boolean;
  socialLinks: string[];
  services: string[];
  notes: string[];
}

export type RevenueAgentCoverageStatus = "available" | "partial" | "missing" | "unknown";

export interface RevenueAgentSourceCoverage {
  status: RevenueAgentCoverageStatus;
  evidence: string[];
  note?: string;
}

export interface RevenueAgentBusinessProfile {
  businessHealthScore: number;
  websiteScore: number;
  reviewsScore: number;
  bookingScore: number;
  crmScore: number | null;
  aiReadinessScore: number;
  growthSignals: string[];
  ownerSignals: string[];
  sourceCoverage: {
    googleBusiness: RevenueAgentSourceCoverage;
    linkedinCompany: RevenueAgentSourceCoverage;
    facebookPage: RevenueAgentSourceCoverage;
    instagram: RevenueAgentSourceCoverage;
    yelp: RevenueAgentSourceCoverage;
    bbb: RevenueAgentSourceCoverage;
    whois: RevenueAgentSourceCoverage;
    techStack: RevenueAgentSourceCoverage;
  };
  techStack: RevenueAgentWebsiteSignals;
  notes: string[];
}

export interface RevenueAgentSalesObjection {
  objection: string;
  response: string;
}

export interface RevenueAgentSalesStrategy {
  primaryPain: string;
  recommendedOffer: string;
  openingHook: string;
  objections: RevenueAgentSalesObjection[];
  cta: string;
  strategyRationale: string[];
}

export interface RevenueAgentOpportunityReport {
  businessSummary: string;
  websiteSummary: string;
  painPoints: string[];
  automationOpportunities: string[];
  estimatedRoiHoursPerWeekMin: number;
  estimatedRoiHoursPerWeekMax: number;
  opportunityScore: number;
  opportunityScoreReasons: string[];
  suggestedOutreachAngle: string;
  businessProfile: RevenueAgentBusinessProfile;
  salesStrategy: RevenueAgentSalesStrategy;
  websiteSignals: RevenueAgentWebsiteSignals;
  generatedAt: string;
}

export interface RevenueAgentResearch {
  id: string;
  prospectId: string;
  businessId: string;
  websiteUrl?: string;
  painSummary: string;
  opportunityScore: number;
  opportunityTags: string[];
  suggestedOfferAngle: string;
  emailSubject: string;
  emailBody: string;
  report: RevenueAgentOpportunityReport;
  createdAt: string;
  updatedAt: string;
}

export type RevenueAgentReplyIntent =
  | "interested"
  | "meeting_request"
  | "price_objection"
  | "not_now"
  | "not_interested"
  | "needs_info"
  | "other";

export type RevenueAgentReplySentiment = "positive" | "neutral" | "negative";

export type RevenueAgentReplyNextStep = "book_meeting" | "send_more_info" | "handle_objection" | "close_loop";

export interface RevenueAgentReplyAnalysis {
  intent: RevenueAgentReplyIntent;
  sentiment: RevenueAgentReplySentiment;
  confidence: number;
  summary: string;
  suggestedReply: string;
  suggestedNextStep: RevenueAgentReplyNextStep;
  meetingAgenda: string[];
  reasons: string[];
  suggestedFollowUpDays?: number;
  meetingBrief?: RevenueAgentMeetingBrief;
}

export interface RevenueAgentMeetingBrief {
  objective: string;
  durationMinutes: number;
  agenda: string[];
  prepNotes: string[];
  suggestedCalendarMessage: string;
  followUpPlan: string[];
}

export interface RevenueAgentCalendarSuggestionSlot {
  startAt: string;
  endAt: string;
  label: string;
}

export type RevenueAgentWorkflowTrigger =
  | "lead_discovered"
  | "research_ready"
  | "reply_received"
  | "meeting_booked"
  | "manual_review";
export type RevenueAgentWorkflowStepStatus = "done" | "active" | "pending" | "blocked";
export type RevenueAgentWorkflowStepType =
  | "analyze_lead"
  | "research_account"
  | "draft_outreach"
  | "send_outreach"
  | "classify_reply"
  | "check_calendar"
  | "suggest_times"
  | "draft_confirmation"
  | "generate_meeting_brief"
  | "generate_proposal"
  | "follow_up"
  | "update_pipeline";

export interface RevenueAgentWorkflowStep {
  type: RevenueAgentWorkflowStepType;
  title: string;
  description: string;
  status: RevenueAgentWorkflowStepStatus;
}

export interface RevenueAgentProposalDraft {
  executiveSummary: string;
  painPoints: string[];
  currentWorkflow: string[];
  proposedWorkflow: string[];
  timeline: string[];
  deliverables: string[];
  pricingSuggestion: string;
  roiSummary: string;
  acceptancePrompt: string;
}

export interface RevenueAgentCalendarSuggestion {
  timezone: string;
  suggestedTimes: string[];
  suggestedSlots: RevenueAgentCalendarSuggestionSlot[];
  meetingDurationMinutes: number;
  inviteDraft: string;
}

export interface RevenueAgentGoogleCalendarConnection {
  connected: boolean;
  status: "connected" | "expired" | "revoked" | "error";
  accountEmail?: string;
  calendarId?: string;
  googleAccountId?: string;
  scopes: string[];
  connectedAt: string;
  updatedAt: string;
}

export interface GoogleCalendarDisconnectResponse {
  disconnectedBusinessId: string;
}

export interface RevenueAgentCalendarEventResult {
  created: boolean;
  eventId?: string;
  htmlLink?: string;
  calendarId?: string;
  status?: string;
  reason?: string;
}

export interface RevenueAgentWorkflow {
  key: string;
  title: string;
  trigger: RevenueAgentWorkflowTrigger;
  objective: string;
  confidence: number;
  nextBestAction: string;
  calendarNotes: string[];
  calendarSuggestion?: RevenueAgentCalendarSuggestion;
  meetingBrief?: RevenueAgentMeetingBrief;
  steps: RevenueAgentWorkflowStep[];
  proposalDraft?: RevenueAgentProposalDraft;
}

export interface RevenueAgentWorkflowResponse {
  businessId: string;
  prospectId: string;
  workflow: RevenueAgentWorkflow;
  generatedAt: string;
}

export interface RevenueAgentMessage {
  id: string;
  prospectId: string;
  businessId: string;
  researchId?: string;
  type: RevenueAgentMessageType;
  author: "ai" | "operator" | "lead";
  subject: string;
  body: string;
  status: RevenueAgentMessageStatus;
  approvedAt?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface RevenueAgentTask {
  id: string;
  prospectId: string;
  businessId: string;
  messageId?: string;
  runId?: string;
  type: RevenueAgentTaskType;
  status: RevenueAgentTaskStatus;
  dueAt: string;
  completedAt?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface RevenueAgentTimelineEvent {
  id: string;
  prospectId: string;
  businessId: string;
  type: RevenueAgentTimelineEventType;
  title: string;
  description: string;
  occurredAt: string;
  tone: RevenueAgentTimelineTone;
  payload: Record<string, unknown>;
}

export interface RevenueAgentProspect {
  id: string;
  businessId: string;
  leadSourceId?: string;
  businessName: string;
  website?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  industry: string;
  source: string;
  sourceUrl?: string;
  rating?: number;
  reviewCount: number;
  painSummary: string;
  opportunityScore: number;
  opportunityTags: string[];
  suggestedOfferAngle: string;
  status: RevenueAgentProspectStatus;
  lastContactedAt?: string;
  nextFollowUpAt?: string;
  approvedAt?: string;
  sentAt?: string;
  repliedAt?: string;
  meetingBookedAt?: string;
  createdAt: string;
  updatedAt?: string;
  research?: RevenueAgentResearch;
  latestMessage?: RevenueAgentMessage;
  tasks?: RevenueAgentTask[];
  timeline?: RevenueAgentTimelineEvent[];
}

export interface RevenueAgentRun {
  id: string;
  businessId: string;
  leadSourceId?: string;
  status: RevenueAgentRunStatus;
  industry: string;
  city: string;
  state: string;
  offer: string;
  dailyLeadLimit: number;
  provider: RevenueAgentLeadSourceProvider;
  prospectsFound: number;
  prospectsSaved: number;
  draftsGenerated: number;
  emailsSent: number;
  errorMessage?: string;
  input: RevenueAgentFeedConfig;
  output?: Record<string, unknown>;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt?: string;
}

export interface RevenueAgentStats {
  newProspects: number;
  researched: number;
  draftsReady: number;
  followUpsDue: number;
  replies: number;
  meetings: number;
}

export interface RevenueAgentSequenceStep {
  id: string;
  businessId: string;
  dayOffset: number;
  messageType: RevenueAgentMessageType;
  subjectTemplate: string;
  bodyTemplate: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface RevenueAgentWorkspaceResponse {
  businessId: string;
  feedConfig: RevenueAgentFeedConfig;
  stats: RevenueAgentStats;
  prospects: RevenueAgentProspect[];
  googleCalendarConnection?: RevenueAgentGoogleCalendarConnection;
  leadSources: {
    id: string;
    provider: RevenueAgentLeadSourceProvider;
    status: string;
    lastFetchedAt?: string;
    query: Record<string, unknown>;
  }[];
  runs: RevenueAgentRun[];
  sequence: RevenueAgentSequenceStep[];
}

export interface RevenueAgentFeedRequest extends RevenueAgentFeedConfig {
  businessId: string;
}

export interface RevenueAgentFeedResponse {
  run: RevenueAgentRun;
  workspace: RevenueAgentWorkspaceResponse;
}

export type RevenueAgentActionType =
  | "approve_draft"
  | "send_email"
  | "send_proposal"
  | "book_meeting"
  | "schedule_follow_up"
  | "mark_not_interested"
  | "mark_replied"
  | "mark_meeting_booked";

export interface RevenueAgentActionRequest {
  businessId: string;
  action: RevenueAgentActionType;
  followUpDays?: number;
}

export interface RevenueAgentActionResponse {
  prospect: RevenueAgentProspect;
  message?: RevenueAgentMessage;
  task?: RevenueAgentTask;
  calendarEvent?: RevenueAgentCalendarEventResult;
}

export interface RevenueAgentResearchResponse {
  prospect: RevenueAgentProspect;
  research: RevenueAgentResearch;
}

export interface RevenueAgentReplyAnalysisRequest {
  businessId: string;
  replyText: string;
}

export interface RevenueAgentReplyAnalysisResponse {
  prospect: RevenueAgentProspect;
  analysis: RevenueAgentReplyAnalysis;
}
