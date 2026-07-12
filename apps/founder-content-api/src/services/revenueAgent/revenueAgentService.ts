import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import type {
  RevenueAgentActionRequest,
  RevenueAgentActionResponse,
  RevenueAgentFeedConfig,
  RevenueAgentFeedRequest,
  RevenueAgentFeedResponse,
  RevenueAgentOpportunityReport,
  RevenueAgentLeadSourceProvider,
  RevenueAgentMessage,
  RevenueAgentMessageStatus,
  RevenueAgentMessageType,
  RevenueAgentProspect,
  RevenueAgentProspectStatus,
  RevenueAgentProposalDraft,
  RevenueAgentReplyAnalysis,
  RevenueAgentReplyAnalysisRequest,
  RevenueAgentReplyAnalysisResponse,
  RevenueAgentReplyIntent,
  RevenueAgentMeetingBrief,
  RevenueAgentCalendarSuggestion,
  RevenueAgentCalendarSuggestionSlot,
  RevenueAgentReplyNextStep,
  RevenueAgentReplySentiment,
  RevenueAgentResearch,
  RevenueAgentResearchResponse,
  RevenueAgentRun,
  RevenueAgentSequenceStep,
  RevenueAgentStats,
  RevenueAgentTimelineEvent,
  RevenueAgentTimelineEventType,
  RevenueAgentTimelineTone,
  RevenueAgentTask,
  RevenueAgentTaskStatus,
  RevenueAgentTaskType,
  RevenueAgentWorkflow,
  RevenueAgentWorkflowResponse,
  RevenueAgentWorkflowStep,
  RevenueAgentWorkflowStepStatus,
  RevenueAgentWorkflowStepType,
  RevenueAgentWorkflowTrigger,
  RevenueAgentWorkspaceResponse,
} from "../../../../../packages/shared-types/index.ts";
import { incrementBusinessDailyUsage } from "../adminControlService.ts";
import { queryDb, withDbTransaction } from "../db/client.ts";
import { sendPlatformEmail } from "../email/emailTransportService.ts";
import {
  analyzeProspectIntelligence,
  normalizeRevenueAgentWebsiteReport,
  type ProspectIntelligenceInput,
  type ProspectIntelligenceResult,
} from "./prospectIntelligenceService.ts";
import {
  buildLeadSourceQueryJson,
  resolveLeadSourceProvider,
  resolveLeadSourceProviderInstance,
  type LeadSourceLead,
} from "./leadProviderService.ts";
import {
  createGoogleCalendarMeetingEvent,
  getGoogleCalendarConnectionSummary,
} from "./googleCalendarService.ts";
import { HttpError } from "../../utils/http.ts";

interface BusinessRow extends QueryResultRow {
  id: string;
  name: string;
  brand_name: string;
  website_url: string | null;
  niche: string | null;
  timezone: string;
}

interface LeadSourceRow extends QueryResultRow {
  id: string;
  business_id: string;
  provider: RevenueAgentLeadSourceProvider;
  query_json: Record<string, unknown> | null;
  status: string;
  last_fetched_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProspectRow extends QueryResultRow {
  id: string;
  business_id: string;
  lead_source_id: string | null;
  business_name: string;
  website: string | null;
  website_normalized: string | null;
  email: string | null;
  email_normalized: string | null;
  phone: string | null;
  phone_normalized: string | null;
  city: string | null;
  state: string | null;
  industry: string;
  source: string;
  source_url: string | null;
  rating: string | number | null;
  review_count: string | number;
  pain_summary: string;
  opportunity_score: string | number;
  opportunity_tags_json: unknown;
  suggested_offer_angle: string;
  status: RevenueAgentProspectStatus;
  last_contacted_at: Date | string | null;
  next_follow_up_at: Date | string | null;
  approved_at: Date | string | null;
  sent_at: Date | string | null;
  replied_at: Date | string | null;
  meeting_booked_at: Date | string | null;
  unsubscribed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProspectResearchRow extends QueryResultRow {
  id: string;
  business_id: string;
  prospect_id: string;
  agent_run_id: string | null;
  pain_summary: string;
  opportunity_score: string | number;
  opportunity_tags_json: unknown;
  suggested_offer_angle: string;
  email_subject: string;
  email_body: string;
  research_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface OutreachMessageRow extends QueryResultRow {
  id: string;
  business_id: string;
  prospect_id: string;
  research_id: string | null;
  agent_run_id: string | null;
  type: RevenueAgentMessageType;
  author: RevenueAgentMessage["author"];
  subject: string;
  body: string;
  status: RevenueAgentMessageStatus;
  approved_at: Date | string | null;
  sent_at: Date | string | null;
  provider_message_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TaskRow extends QueryResultRow {
  id: string;
  business_id: string;
  prospect_id: string;
  message_id: string | null;
  run_id: string | null;
  task_type: RevenueAgentTaskType;
  status: RevenueAgentTaskStatus;
  due_at: Date | string;
  completed_at: Date | string | null;
  payload_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TimelineEventRow extends QueryResultRow {
  id: string;
  business_id: string;
  prospect_id: string | null;
  event_type: RevenueAgentTimelineEventType;
  provider_message_id: string | null;
  payload_json: unknown;
  occurred_at: Date | string;
  created_at: Date | string;
}

interface RunRow extends QueryResultRow {
  id: string;
  business_id: string;
  lead_source_id: string | null;
  status: string;
  industry: string;
  city: string;
  state: string;
  offer: string;
  daily_lead_limit: string | number;
  provider: RevenueAgentLeadSourceProvider;
  prospects_found: string | number;
  prospects_saved: string | number;
  drafts_generated: string | number;
  emails_sent: string | number;
  error_message: string | null;
  input_json: Record<string, unknown> | null;
  output_json: Record<string, unknown> | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const DEFAULT_SEQUENCE_STEPS: Array<{
  dayOffset: number;
  messageType: RevenueAgentMessageType;
  subjectTemplate: string;
  bodyTemplate: string;
}> = [
  {
    dayOffset: 0,
    messageType: "initial",
    subjectTemplate: "{{business_name}} quick audit",
    bodyTemplate:
      "Hi there,\n\nI noticed {{business_name}} and put together a quick note about the missed follow-up gap I keep seeing in local service businesses.\n\n{{pain_summary}}\n\nIf it helps, I can send a 2-minute audit showing where AI booking + follow-up automation could free up time and recover leads.\n\n{{signature}}",
  },
  {
    dayOffset: 3,
    messageType: "followup",
    subjectTemplate: "Quick follow-up for {{business_name}}",
    bodyTemplate:
      "Hi there,\n\nJust bumping this in case it got buried.\n\nI still think the biggest leverage at {{business_name}} is reducing missed lead follow-up and making booking easier.\n\nIf you want, I can send the 2-minute audit.\n\n{{signature}}",
  },
  {
    dayOffset: 7,
    messageType: "value",
    subjectTemplate: "A useful idea for {{business_name}}",
    bodyTemplate:
      "Hi there,\n\nOne thing I would test at {{business_name}} is a simple automation that responds to inbound leads fast, then nudges them if they go quiet.\n\nThat tends to recover meetings without adding front-desk work.\n\n{{signature}}",
  },
  {
    dayOffset: 14,
    messageType: "breakup",
    subjectTemplate: "Should I close the loop?",
    bodyTemplate:
      "Hi there,\n\nLast note from me. If improving missed follow-up and booking conversion is not a priority right now, I will close the loop.\n\nIf you do want the audit, reply and I will send it over.\n\n{{signature}}",
  },
];

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOptional(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textToHtml(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

function normalizeWebsite(value: string | undefined): { display?: string; normalized?: string } {
  const raw = normalizeOptional(value);

  if (!raw) {
    return {};
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(candidate);
    return {
      display: raw,
      normalized: url.hostname.replace(/^www\./i, "").toLowerCase(),
    };
  } catch {
    return {
      display: raw,
      normalized: raw.toLowerCase().replace(/^www\./i, ""),
    };
  }
}

function normalizeEmail(value: string | undefined): string | undefined {
  const raw = normalizeOptional(value);
  return raw ? raw.toLowerCase() : undefined;
}

function normalizePhone(value: string | undefined): string | undefined {
  const raw = normalizeOptional(value);
  return raw ? raw.replace(/[^0-9+]/g, "") : undefined;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildOpportunityTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))].slice(0, 8);
}

function parseJsonArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0)
    : [];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function normalizeTimelineEventType(value: string): RevenueAgentTimelineEventType {
  switch (value) {
    case "lead_discovered":
    case "research_generated":
    case "draft_created":
    case "draft_approved":
    case "sent":
    case "reply_received":
    case "reply_analyzed":
    case "meeting_booked":
    case "follow_up_scheduled":
    case "meeting_prep_created":
    case "not_interested":
      return value;
    default:
      return "research_generated";
  }
}

function normalizeTimelineTone(value: RevenueAgentTimelineEventType, payload: Record<string, unknown>): RevenueAgentTimelineTone {
  if (value === "follow_up_scheduled" || value === "meeting_prep_created") {
    const dueAt = typeof payload.dueAt === "string" ? new Date(payload.dueAt).getTime() : undefined;

    if (dueAt && dueAt > Date.now()) {
      return "pending";
    }
  }

  if (value === "reply_received" || value === "reply_analyzed" || value === "meeting_booked") {
    return "active";
  }

  return "done";
}

function labelTimelineEvent(eventType: RevenueAgentTimelineEventType): string {
  switch (eventType) {
    case "lead_discovered":
      return "Lead discovered";
    case "research_generated":
      return "Research completed";
    case "draft_created":
      return "Email draft created";
    case "draft_approved":
      return "Draft approved";
    case "sent":
      return "Email sent";
    case "reply_received":
      return "Lead replied";
    case "reply_analyzed":
      return "Reply analyzed";
    case "meeting_booked":
      return "Meeting booked";
    case "follow_up_scheduled":
      return "Follow-up scheduled";
    case "meeting_prep_created":
      return "Meeting prep created";
    case "not_interested":
      return "Marked not interested";
    default:
      return "Timeline event";
  }
}

function mapTimelineEvent(row: TimelineEventRow): RevenueAgentTimelineEvent {
  const payload = parseJsonObject(row.payload_json);
  const type = normalizeTimelineEventType(row.event_type);

  return {
    id: row.id,
    prospectId: row.prospect_id ?? "",
    businessId: row.business_id,
    type,
    title: typeof payload.title === "string" && payload.title.trim().length > 0 ? payload.title.trim() : labelTimelineEvent(type),
    description:
      typeof payload.description === "string" && payload.description.trim().length > 0
        ? payload.description.trim()
        : labelTimelineEvent(type),
    occurredAt: toIsoString(row.occurred_at) ?? toIsoString(row.created_at) ?? new Date().toISOString(),
    tone: normalizeTimelineTone(type, payload),
    payload,
  };
}

function scoreOpportunity(prospect: Pick<LeadSourceLead, "rating" | "reviewCount" | "painSignals">): number {
  let score = 2;

  if ((prospect.reviewCount ?? 0) < 50) {
    score += 1;
  }

  if ((prospect.rating ?? 0) <= 4.4) {
    score += 1;
  }

  if (prospect.painSignals.some((signal) => /manual|follow-up|response/i.test(signal))) {
    score += 1;
  }

  return Math.max(0, Math.min(100, Math.round((score / 5) * 100)));
}

function buildFallbackResearch(input: {
  businessName: string;
  industry: string;
  city?: string;
  state?: string;
  rating?: number;
  reviewCount?: number;
  painSignals: string[];
  offer: string;
}): {
  painSummary: string;
  opportunityScore: number;
  opportunityTags: string[];
  suggestedOfferAngle: string;
  emailSubject: string;
  emailBody: string;
} {
  const score = scoreOpportunity({
    rating: input.rating,
    reviewCount: input.reviewCount,
    painSignals: input.painSignals,
  });
  const tags = buildOpportunityTags([
    input.industry.toLowerCase().includes("salon") ? "salon" : "",
    input.industry.toLowerCase().includes("spa") ? "med-spa" : "",
    input.reviewCount && input.reviewCount < 100 ? "low-review-volume" : "demand-signals",
    "lead-follow-up",
    "booking-automation",
  ]);
  const painSummary =
    input.reviewCount && input.reviewCount < 50
      ? `${input.businessName} likely has enough demand signals, but missed follow-up and slow response times can still leak booked meetings in ${input.city}${input.state ? `, ${input.state}` : ""}.`
      : `${input.businessName} appears to have steady demand, but front-desk follow-up and booking recovery are probably still manual.`;
  const suggestedOfferAngle = input.offer.trim()
    ? input.offer.trim()
    : "AI booking + missed lead follow-up automation";

  return {
    painSummary,
    opportunityScore: score,
    opportunityTags: tags,
    suggestedOfferAngle,
    emailSubject: `${input.businessName} quick audit`,
    emailBody: [
      "Hi there,",
      "",
      `I took a quick look at ${input.businessName}.`,
      "",
      painSummary,
      "",
      `I think ${suggestedOfferAngle.toLowerCase()} could recover more meetings without adding front-desk work.`,
      "",
      "If it helps, I can send a short audit and show the exact gap I would test first.",
      "",
      "Best,",
      "Founder Content",
    ].join("\n"),
  };
}

function buildResearchPrompt(input: {
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
  reviewCount?: number;
  painSignals: string[];
  offer: string;
}): string {
  return [
    "You are a revenue operator drafting a local-business outreach note.",
    "Return a single JSON object only.",
    "Keep the copy specific, concrete, and practical.",
    "Do not mention that you are an AI model.",
    "Do not use hype or generic startup language.",
    "",
    "JSON SHAPE",
    JSON.stringify(
      {
        painSummary: "string",
        opportunityScore: 92,
        opportunityTags: ["string"],
        suggestedOfferAngle: "string",
        emailSubject: "string",
        emailBody: "string",
      },
      null,
      2,
    ),
    "",
    "RULES",
    "- opportunityScore must be an integer between 0 and 100.",
    "- Write the email as a short outreach message to the owner or manager.",
    "- Keep the subject under 65 characters if possible.",
    "- Make the body easy to approve and easy to personalize later.",
    "- Use the provided offer as the recommended angle when possible.",
    "",
    "PROSPECT",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

async function generateProspectResearch(input: ProspectIntelligenceInput): Promise<ProspectIntelligenceResult> {
  return analyzeProspectIntelligence(input);
}

function mapLeadSource(row: LeadSourceRow): {
  id: string;
  provider: RevenueAgentLeadSourceProvider;
  status: string;
  lastFetchedAt?: string;
  query: Record<string, unknown>;
} {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    lastFetchedAt: toIsoString(row.last_fetched_at),
    query: parseJsonObject(row.query_json),
  };
}

function buildDefaultResearchReport(row: ProspectResearchRow): RevenueAgentOpportunityReport {
  const defaultWebsiteSignals = {
    bookingSoftware: undefined,
    bookingSoftwareEvidence: [],
    cms: undefined,
    analytics: [],
    marketingPixels: [],
    contactForm: false,
    chatWidget: false,
    mobileResponsive: false,
    performanceBand: "unknown" as const,
    https: false,
    socialLinks: [],
    services: [],
    notes: [],
  };

  const defaultBusinessProfile = {
    businessHealthScore: toNumber(row.opportunity_score),
    websiteScore: 0,
    reviewsScore: 0,
    bookingScore: 0,
    crmScore: null,
    aiReadinessScore: 0,
    growthSignals: [],
    ownerSignals: [],
    sourceCoverage: {
      googleBusiness: { status: "unknown" as const, evidence: [], note: undefined },
      linkedinCompany: { status: "unknown" as const, evidence: [], note: undefined },
      facebookPage: { status: "unknown" as const, evidence: [], note: undefined },
      instagram: { status: "unknown" as const, evidence: [], note: undefined },
      yelp: { status: "unknown" as const, evidence: [], note: undefined },
      bbb: { status: "unknown" as const, evidence: [], note: undefined },
      whois: { status: "unknown" as const, evidence: [], note: undefined },
      techStack: { status: "unknown" as const, evidence: [], note: undefined },
    },
    techStack: defaultWebsiteSignals,
    notes: [],
  };

  const defaultSalesStrategy = {
    primaryPain: row.pain_summary || "The business still needs a sharper follow-up plan.",
    recommendedOffer: row.suggested_offer_angle || "AI booking and follow-up automation",
    openingHook: row.pain_summary || "I noticed there may be missed lead capture opportunities.",
    objections: [
      {
        objection: "We already have a team handling this.",
        response: "This is about reducing manual follow-up and missed leads, not replacing your staff.",
      },
    ],
    cta: "15-minute workflow audit",
    strategyRationale: row.pain_summary ? [row.pain_summary] : [],
  };

  return {
    businessSummary: row.pain_summary || "Prior research is available for this prospect.",
    websiteSummary: row.suggested_offer_angle || "No website intelligence has been recorded yet.",
    painPoints: row.pain_summary ? [row.pain_summary] : [],
    automationOpportunities: row.suggested_offer_angle ? [row.suggested_offer_angle] : [],
    estimatedRoiHoursPerWeekMin: 0,
    estimatedRoiHoursPerWeekMax: 0,
    opportunityScore: toNumber(row.opportunity_score),
    opportunityScoreReasons: row.pain_summary ? [row.pain_summary] : [],
    suggestedOutreachAngle: row.suggested_offer_angle,
    businessProfile: defaultBusinessProfile,
    salesStrategy: defaultSalesStrategy,
    websiteSignals: defaultWebsiteSignals,
    generatedAt: toIsoString(row.updated_at) ?? toIsoString(row.created_at) ?? new Date().toISOString(),
  };
}

function mapResearch(row: ProspectResearchRow): RevenueAgentResearch {
  const payload = parseJsonObject(row.research_json);
  const fallbackReport = buildDefaultResearchReport(row);
  const report = normalizeRevenueAgentWebsiteReport(payload.report, fallbackReport);

  return {
    id: row.id,
    prospectId: row.prospect_id,
    businessId: row.business_id,
    websiteUrl: typeof payload.websiteUrl === "string" ? normalizeOptional(payload.websiteUrl) || undefined : undefined,
    painSummary: row.pain_summary,
    opportunityScore: toNumber(row.opportunity_score),
    opportunityTags: parseJsonArray(row.opportunity_tags_json),
    suggestedOfferAngle: row.suggested_offer_angle,
    emailSubject: row.email_subject,
    emailBody: row.email_body,
    report,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? new Date().toISOString(),
  };
}

function mapMessage(row: OutreachMessageRow): RevenueAgentMessage {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    businessId: row.business_id,
    researchId: row.research_id ?? undefined,
    type: row.type,
    author: row.author,
    subject: row.subject,
    body: row.body,
    status: row.status,
    approvedAt: toIsoString(row.approved_at),
    sentAt: toIsoString(row.sent_at),
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? undefined,
  };
}

function mapTask(row: TaskRow): RevenueAgentTask {
  return {
    id: row.id,
    prospectId: row.prospect_id,
    businessId: row.business_id,
    messageId: row.message_id ?? undefined,
    runId: row.run_id ?? undefined,
    type: row.task_type,
    status: row.status,
    dueAt: toIsoString(row.due_at) ?? new Date().toISOString(),
    completedAt: toIsoString(row.completed_at),
    payload: parseJsonObject(row.payload_json),
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? undefined,
  };
}

function mapRun(row: RunRow): RevenueAgentRun {
  const inputJson = parseJsonObject(row.input_json);

  return {
    id: row.id,
    businessId: row.business_id,
    leadSourceId: row.lead_source_id ?? undefined,
    status: row.status as RevenueAgentRun["status"],
    industry: row.industry,
    city: row.city,
    state: row.state,
    offer: row.offer,
    dailyLeadLimit: toNumber(row.daily_lead_limit),
    provider: row.provider,
    prospectsFound: toNumber(row.prospects_found),
    prospectsSaved: toNumber(row.prospects_saved),
    draftsGenerated: toNumber(row.drafts_generated),
    emailsSent: toNumber(row.emails_sent),
    errorMessage: row.error_message ?? undefined,
    input: {
      industry: row.industry,
      city: row.city,
      state: row.state,
      offer: row.offer,
      dailyLeadLimit: toNumber(row.daily_lead_limit),
      provider: row.provider,
      csvText: typeof inputJson.csvText === "string" ? inputJson.csvText : undefined,
    },
    output: row.output_json ?? undefined,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    startedAt: toIsoString(row.started_at),
    finishedAt: toIsoString(row.finished_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapProspect(row: ProspectRow, extras: {
  research?: RevenueAgentResearch;
  latestMessage?: RevenueAgentMessage;
  tasks?: RevenueAgentTask[];
  timeline?: RevenueAgentTimelineEvent[];
} = {}): RevenueAgentProspect {
  return {
    id: row.id,
    businessId: row.business_id,
    leadSourceId: row.lead_source_id ?? undefined,
    businessName: row.business_name,
    website: row.website ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    industry: row.industry,
    source: row.source,
    sourceUrl: row.source_url ?? undefined,
    rating: row.rating === null ? undefined : toNumber(row.rating),
    reviewCount: toNumber(row.review_count),
    painSummary: row.pain_summary,
    opportunityScore: toNumber(row.opportunity_score),
    opportunityTags: parseJsonArray(row.opportunity_tags_json),
    suggestedOfferAngle: row.suggested_offer_angle,
    status: row.status,
    lastContactedAt: toIsoString(row.last_contacted_at),
    nextFollowUpAt: toIsoString(row.next_follow_up_at),
    approvedAt: toIsoString(row.approved_at),
    sentAt: toIsoString(row.sent_at),
    repliedAt: toIsoString(row.replied_at),
    meetingBookedAt: toIsoString(row.meeting_booked_at),
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updated_at) ?? undefined,
    research: extras.research,
    latestMessage: extras.latestMessage,
    tasks: extras.tasks,
    timeline: extras.timeline,
  };
}

function createEmptyWorkspaceResponse(businessId: string, feedConfig: RevenueAgentFeedConfig): RevenueAgentWorkspaceResponse {
  return {
    businessId,
    feedConfig,
    stats: {
      newProspects: 0,
      researched: 0,
      draftsReady: 0,
      followUpsDue: 0,
      replies: 0,
      meetings: 0,
    },
    prospects: [],
    leadSources: [],
    runs: [],
    sequence: [],
  };
}

function resolveFeedConfigFromBusiness(row: BusinessRow, runRow?: RunRow | null): RevenueAgentFeedConfig {
  if (runRow) {
    const inputJson = parseJsonObject(runRow.input_json);

    return {
      industry: runRow.industry,
      city: runRow.city,
      state: runRow.state,
      offer: runRow.offer,
      dailyLeadLimit: toNumber(runRow.daily_lead_limit) || 20,
      provider: runRow.provider,
      csvText: typeof inputJson.csvText === "string" ? inputJson.csvText : undefined,
    };
  }

  return {
    industry: normalizeOptional(row.niche) || "Salon",
    city: "",
    state: "",
    offer: "AI booking + follow-up automation",
    dailyLeadLimit: 20,
    provider: "mock",
  };
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

async function getBusinessRow(businessId: string, client?: PoolClient): Promise<BusinessRow> {
  const result = await executeQuery<BusinessRow>(
    `
      select id, name, brand_name, website_url, niche, timezone
      from businesses
      where id = $1::uuid
      limit 1
    `,
    [businessId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "business_not_found", "Workspace not found.");
  }

  return row;
}

async function ensureDefaultSequences(businessId: string, client?: PoolClient): Promise<void> {
  for (const step of DEFAULT_SEQUENCE_STEPS) {
    await executeQuery(
      `
        insert into revenue_agent_sequences (
          business_id,
          day_offset,
          message_type,
          subject_template,
          body_template
        ) values ($1::uuid, $2::int, $3, $4, $5)
        on conflict (business_id, day_offset) do update set
          message_type = excluded.message_type,
          subject_template = excluded.subject_template,
          body_template = excluded.body_template,
          updated_at = now()
      `,
      [businessId, step.dayOffset, step.messageType, step.subjectTemplate, step.bodyTemplate],
      client,
    );
  }
}

async function getLeadSourceOrCreate(
  businessId: string,
  provider: RevenueAgentLeadSourceProvider,
  queryJson: Record<string, unknown>,
  client?: PoolClient,
): Promise<LeadSourceRow> {
  const serializedQueryJson = JSON.stringify(queryJson);

  const existing = await executeQuery<LeadSourceRow>(
    `
      select
        id,
        business_id,
        provider,
        query_json,
        status,
        last_fetched_at,
        created_at,
        updated_at
      from lead_sources
      where business_id = $1::uuid
        and provider = $2
        and query_json = $3::jsonb
      limit 1
    `,
    [businessId, provider, serializedQueryJson],
    client,
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const inserted = await executeQuery<LeadSourceRow>(
    `
      insert into lead_sources (
        business_id,
        provider,
        query_json
      ) values ($1::uuid, $2, $3::jsonb)
      returning
        id,
        business_id,
        provider,
        query_json,
        status,
        last_fetched_at,
        created_at,
        updated_at
    `,
    [businessId, provider, serializedQueryJson],
    client,
  );

  return inserted.rows[0];
}

async function listWorkspaceProspects(
  businessId: string,
  client?: PoolClient,
): Promise<{
  prospects: RevenueAgentProspect[];
  leadSources: RevenueAgentWorkspaceResponse["leadSources"];
  runs: RevenueAgentRun[];
  sequence: RevenueAgentSequenceStep[];
  tasks: RevenueAgentTask[];
}> {
  const [prospectResult, researchResult, messageResult, taskResult, sourceResult, runResult, sequenceResult, eventResult] =
    await Promise.all([
      executeQuery<ProspectRow>(
        `
          select
            id,
            business_id,
            lead_source_id,
            business_name,
            website,
            website_normalized,
            email,
            email_normalized,
            phone,
            phone_normalized,
            city,
            state,
            industry,
            source,
            source_url,
            rating,
            review_count,
            pain_summary,
            opportunity_score,
            opportunity_tags_json,
            suggested_offer_angle,
            status,
            last_contacted_at,
            next_follow_up_at,
            approved_at,
            sent_at,
            replied_at,
            meeting_booked_at,
            unsubscribed_at,
            created_at,
            updated_at
          from prospects
          where business_id = $1::uuid
          order by
            case status
              when 'new' then 0
              when 'researched' then 1
              when 'drafted' then 2
              when 'approved' then 3
              when 'sent' then 4
              when 'follow_up_due' then 5
              when 'replied' then 6
              when 'meeting_booked' then 7
              when 'not_interested' then 8
              else 9
            end,
            coalesce(next_follow_up_at, updated_at, created_at) asc,
            updated_at desc
        `,
        [businessId],
        client,
      ),
      executeQuery<ProspectResearchRow>(
        `
          select
            id,
            business_id,
            prospect_id,
            agent_run_id,
            pain_summary,
            opportunity_score,
            opportunity_tags_json,
            suggested_offer_angle,
            email_subject,
            email_body,
            research_json,
            created_at,
            updated_at
          from prospect_research
          where business_id = $1::uuid
          order by updated_at desc
        `,
        [businessId],
        client,
      ),
      executeQuery<OutreachMessageRow>(
        `
          select
            id,
            business_id,
            prospect_id,
            research_id,
            agent_run_id,
            type,
            author,
            subject,
            body,
            status,
            approved_at,
            sent_at,
            provider_message_id,
            created_at,
            updated_at
          from revenue_agent_outreach_messages
          where business_id = $1::uuid
          order by created_at desc
        `,
        [businessId],
        client,
      ),
      executeQuery<TaskRow>(
        `
          select
            id,
            business_id,
            prospect_id,
            message_id,
            run_id,
            task_type,
            status,
            due_at,
            completed_at,
            payload_json,
            created_at,
            updated_at
          from revenue_agent_tasks
          where business_id = $1::uuid
          order by due_at asc, created_at desc
        `,
        [businessId],
        client,
      ),
      executeQuery<LeadSourceRow>(
        `
          select
            id,
            business_id,
            provider,
            query_json,
            status,
            last_fetched_at,
            created_at,
            updated_at
          from lead_sources
          where business_id = $1::uuid
          order by created_at desc
        `,
        [businessId],
        client,
      ),
      executeQuery<RunRow>(
        `
          select
            id,
            business_id,
            lead_source_id,
            status,
            industry,
            city,
            state,
            offer,
            daily_lead_limit,
            provider,
            prospects_found,
            prospects_saved,
            drafts_generated,
            emails_sent,
            error_message,
            input_json,
            output_json,
            started_at,
            finished_at,
            created_at,
            updated_at
          from revenue_agent_agent_runs
          where business_id = $1::uuid
          order by created_at desc
        `,
        [businessId],
        client,
      ),
      executeQuery<{
        id: string;
        business_id: string;
        day_offset: number;
        message_type: RevenueAgentMessageType;
        subject_template: string;
        body_template: string;
        is_active: boolean;
        created_at: Date | string;
        updated_at: Date | string;
      }>(
        `
          select
            id,
            business_id,
            day_offset,
            message_type,
            subject_template,
            body_template,
            is_active,
            created_at,
            updated_at
          from revenue_agent_sequences
          where business_id = $1::uuid
          order by day_offset asc
        `,
        [businessId],
        client,
      ),
      executeQuery<TimelineEventRow>(
        `
          select
            id,
            business_id,
            prospect_id,
            event_type,
            provider_message_id,
            payload_json,
            occurred_at,
            created_at
          from revenue_agent_email_events
          where business_id = $1::uuid
            and prospect_id is not null
          order by occurred_at asc, created_at asc
        `,
        [businessId],
        client,
      ),
    ]);

  const latestResearchByProspectId = new Map<string, RevenueAgentResearch>();
  for (const row of researchResult.rows) {
    if (!latestResearchByProspectId.has(row.prospect_id)) {
      latestResearchByProspectId.set(row.prospect_id, mapResearch(row));
    }
  }

  const latestMessageByProspectId = new Map<string, RevenueAgentMessage>();
  for (const row of messageResult.rows) {
    if (!latestMessageByProspectId.has(row.prospect_id)) {
      latestMessageByProspectId.set(row.prospect_id, mapMessage(row));
    }
  }

  const tasksByProspectId = new Map<string, RevenueAgentTask[]>();
  for (const row of taskResult.rows) {
    const nextTasks = tasksByProspectId.get(row.prospect_id) ?? [];
    nextTasks.push(mapTask(row));
    tasksByProspectId.set(row.prospect_id, nextTasks);
  }

  const timelineByProspectId = new Map<string, RevenueAgentTimelineEvent[]>();
  for (const row of eventResult.rows) {
    const nextTimeline = timelineByProspectId.get(row.prospect_id ?? "") ?? [];
    nextTimeline.push(mapTimelineEvent(row));
    timelineByProspectId.set(row.prospect_id ?? "", nextTimeline);
  }

  const prospects = prospectResult.rows.map((row) =>
    mapProspect(row, {
      research: latestResearchByProspectId.get(row.id),
      latestMessage: latestMessageByProspectId.get(row.id),
      tasks: tasksByProspectId.get(row.id),
      timeline: timelineByProspectId.get(row.id),
    }),
  );

  return {
    prospects,
    leadSources: sourceResult.rows.map(mapLeadSource),
    runs: runResult.rows.map(mapRun),
    sequence: sequenceResult.rows.map((row) => ({
      id: row.id,
      businessId: row.business_id,
      dayOffset: row.day_offset,
      messageType: row.message_type,
      subjectTemplate: row.subject_template,
      bodyTemplate: row.body_template,
      isActive: row.is_active,
      createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
      updatedAt: toIsoString(row.updated_at) ?? undefined,
    })),
    tasks: taskResult.rows.map(mapTask),
  };
}

function computeStats(prospects: RevenueAgentProspect[]): RevenueAgentStats {
  const now = Date.now();
  return {
    newProspects: prospects.filter((prospect) => prospect.status === "new").length,
    researched: prospects.filter((prospect) =>
      ["researched", "drafted", "approved", "sent", "replied", "follow_up_due", "meeting_booked"].includes(prospect.status),
    ).length,
    draftsReady: prospects.filter((prospect) => ["drafted", "approved"].includes(prospect.status)).length,
    followUpsDue: prospects.filter((prospect) => {
      if (prospect.status === "follow_up_due") {
        return true;
      }

      if (!prospect.nextFollowUpAt) {
        return false;
      }

      return new Date(prospect.nextFollowUpAt).getTime() <= now;
    }).length,
    replies: prospects.filter((prospect) => prospect.status === "replied").length,
    meetings: prospects.filter((prospect) => prospect.status === "meeting_booked").length,
  };
}

async function buildWorkspaceResponse(
  businessId: string,
  client?: PoolClient,
): Promise<RevenueAgentWorkspaceResponse> {
  await ensureDefaultSequences(businessId, client);
  const business = await getBusinessRow(businessId, client);
  const workspaceState = await listWorkspaceProspects(businessId, client);
  const googleCalendarConnection = await getGoogleCalendarConnectionSummary(businessId, client);
  const latestRun = workspaceState.runs[0];
  const feedConfig = resolveFeedConfigFromBusiness(
    business,
    latestRun ? (latestRun as unknown as RunRow) : null,
  );

  return {
    businessId,
    feedConfig,
    stats: computeStats(workspaceState.prospects),
    prospects: workspaceState.prospects,
    googleCalendarConnection,
    leadSources: workspaceState.leadSources,
    runs: workspaceState.runs,
    sequence: workspaceState.sequence,
  };
}

async function loadProspectForUpdate(
  prospectId: string,
  client?: PoolClient,
): Promise<ProspectRow> {
  const result = await executeQuery<ProspectRow>(
    `
      select
        id,
        business_id,
        lead_source_id,
        business_name,
        website,
        website_normalized,
        email,
        email_normalized,
        phone,
        phone_normalized,
        city,
        state,
        industry,
        source,
        source_url,
        rating,
        review_count,
        pain_summary,
        opportunity_score,
        opportunity_tags_json,
        suggested_offer_angle,
        status,
        last_contacted_at,
        next_follow_up_at,
        approved_at,
        sent_at,
        replied_at,
        meeting_booked_at,
        unsubscribed_at,
        created_at,
        updated_at
      from prospects
      where id = $1::uuid
      limit 1
    `,
    [prospectId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "prospect_not_found", "Prospect not found.");
  }

  return row;
}

async function loadLatestMessageForProspect(
  prospectId: string,
  client?: PoolClient,
): Promise<OutreachMessageRow | undefined> {
  const result = await executeQuery<OutreachMessageRow>(
    `
      select
        id,
        business_id,
        prospect_id,
        research_id,
        agent_run_id,
        type,
        author,
        subject,
        body,
        status,
        approved_at,
        sent_at,
        provider_message_id,
        created_at,
        updated_at
      from revenue_agent_outreach_messages
      where prospect_id = $1::uuid
      order by created_at desc
      limit 1
    `,
    [prospectId],
    client,
  );

  return result.rows[0];
}

async function loadLatestResearchForProspect(
  prospectId: string,
  client?: PoolClient,
): Promise<ProspectResearchRow | undefined> {
  const result = await executeQuery<ProspectResearchRow>(
    `
      select
        id,
        business_id,
        prospect_id,
        agent_run_id,
        pain_summary,
        opportunity_score,
        opportunity_tags_json,
        suggested_offer_angle,
        email_subject,
        email_body,
        research_json,
        created_at,
        updated_at
      from prospect_research
      where prospect_id = $1::uuid
      order by created_at desc
      limit 1
    `,
    [prospectId],
    client,
  );

  return result.rows[0];
}

function buildSignature(businessName: string): string {
  return businessName.trim() ? `${businessName.trim()} team` : "Founder Content";
}

function buildMessageHtml(body: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#241813;">${textToHtml(body)}</div>`;
}

function buildMessageText(body: string): string {
  return body;
}

function formatExportTimestamp(value?: string): string {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function readLatestReplyAnalysis(timeline: RevenueAgentTimelineEvent[] | undefined): RevenueAgentReplyAnalysis | null {
  const latestAnalysisEvent = [...(timeline ?? [])].reverse().find((event) => event.type === "reply_analyzed");

  if (!latestAnalysisEvent) {
    return null;
  }

  const analysis = latestAnalysisEvent.payload.analysis;

  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
    return null;
  }

  return analysis as RevenueAgentReplyAnalysis;
}

function buildRevenueAgentProspectExportHtml(prospect: RevenueAgentProspect): string {
  const report = prospect.research?.report;
  const analysis = readLatestReplyAnalysis(prospect.timeline);
  const score = Math.max(0, Math.min(100, Math.round(report?.opportunityScore ?? prospect.opportunityScore)));
  const location = [prospect.city, prospect.state].filter(Boolean).join(", ") || "Not available";
  const painPoints = report?.painPoints?.length ? report.painPoints : prospect.painSummary ? [prospect.painSummary] : [];
  const automationOpportunities = report?.automationOpportunities?.length
    ? report.automationOpportunities
    : prospect.suggestedOfferAngle
      ? [prospect.suggestedOfferAngle]
      : [];
  const opportunityReasons = report?.opportunityScoreReasons?.length ? report.opportunityScoreReasons : [];
  const businessProfile = report?.businessProfile;
  const sourceCoverage = businessProfile?.sourceCoverage;
  const timeline = [...(prospect.timeline ?? [])].sort(
    (left, right) => new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime(),
  );

  const renderList = (items: string[], emptyLabel: string): string =>
    items.length
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p class="empty">${escapeHtml(emptyLabel)}</p>`;

  const renderCoverageItem = (label: string, coverage?: { status: string; evidence: string[]; note?: string }): string => {
    if (!coverage) {
      return `<li><strong>${escapeHtml(label)}</strong><span>Unknown</span></li>`;
    }

    const details = [...coverage.evidence, coverage.note].filter((item): item is string => typeof item === "string" && item.trim().length > 0);

    return `<li><strong>${escapeHtml(label)}</strong><span>${escapeHtml(coverage.status)}</span><small>${escapeHtml(
      details.length ? details.join(" · ") : "No evidence available",
    )}</small></li>`;
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(prospect.businessName)} Opportunity Report</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #241813;
        --muted: #6a554b;
        --paper: #fff8f2;
        --panel: #ffffff;
        --line: rgba(78, 48, 34, 0.14);
        --accent: #cf6330;
        --accent-soft: rgba(207, 99, 48, 0.12);
        --shadow: 0 24px 54px rgba(50, 26, 16, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 0;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(207, 99, 48, 0.09), transparent 32%),
          radial-gradient(circle at top right, rgba(150, 93, 52, 0.08), transparent 26%),
          var(--paper);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .sheet {
        width: min(1120px, calc(100% - 48px));
        margin: 24px auto;
        padding: 32px;
        border: 1px solid var(--line);
        border-radius: 28px;
        background: var(--panel);
        box-shadow: var(--shadow);
      }
      .header {
        display: flex;
        gap: 24px;
        justify-content: space-between;
        align-items: flex-start;
        padding-bottom: 22px;
        border-bottom: 1px solid var(--line);
      }
      .eyebrow {
        margin: 0 0 10px;
        color: var(--muted);
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      h1, h2, h3, p { margin-top: 0; }
      h1 {
        margin-bottom: 10px;
        font-size: clamp(2.1rem, 4vw, 3rem);
        line-height: 1;
      }
      .lede {
        max-width: 74ch;
        margin: 0;
        color: var(--muted);
        line-height: 1.7;
      }
      .score {
        min-width: 240px;
        padding: 18px 20px;
        border: 1px solid var(--line);
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(207, 99, 48, 0.1), rgba(207, 99, 48, 0.04));
      }
      .score strong {
        display: block;
        margin-bottom: 10px;
        font-size: 2.4rem;
        line-height: 1;
      }
      .score p {
        margin: 6px 0 0;
        color: var(--muted);
        line-height: 1.5;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: #9a3412;
        font-size: 0.8rem;
        font-weight: 700;
      }
      .meta-grid,
      .two-col,
      .three-col,
      .four-col {
        display: grid;
        gap: 14px;
      }
      .meta-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin-top: 22px;
      }
      .two-col {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 16px;
      }
      .three-col {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-top: 16px;
      }
      .four-col {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin-top: 16px;
      }
      .card {
        padding: 18px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: #fff;
      }
      .label {
        display: block;
        margin-bottom: 8px;
        color: var(--muted);
        font-size: 0.76rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .card p,
      .card li,
      .card small {
        color: var(--muted);
        line-height: 1.6;
      }
      .card ul {
        margin: 0;
        padding-left: 18px;
      }
      .card li + li {
        margin-top: 8px;
      }
      .section {
        margin-top: 24px;
      }
      .section h2 {
        margin-bottom: 12px;
        font-size: 1.18rem;
      }
      .timeline {
        display: grid;
        gap: 12px;
      }
      .timeline-item {
        display: grid;
        grid-template-columns: 180px minmax(0, 1fr);
        gap: 14px;
        align-items: start;
        padding: 14px 16px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: #fff;
      }
      .timeline-item span {
        color: var(--muted);
        font-size: 0.84rem;
      }
      .timeline-item strong {
        display: block;
        margin-bottom: 4px;
      }
      .timeline-item p {
        margin: 0;
        color: var(--muted);
      }
      .coverage-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        gap: 10px;
      }
      .coverage-list li {
        display: grid;
        gap: 2px;
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: rgba(255, 248, 242, 0.55);
      }
      .coverage-list strong,
      .coverage-list span,
      .coverage-list small {
        display: block;
      }
      .coverage-list span {
        color: var(--ink);
        font-weight: 600;
      }
      .empty {
        margin: 0;
        color: var(--muted);
      }
      .footer {
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.84rem;
      }
      @media print {
        body {
          background: #fff;
        }
        .sheet {
          width: 100%;
          margin: 0;
          padding: 24px;
          border: none;
          border-radius: 0;
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <section class="header">
        <div>
          <p class="eyebrow">Revenue Agent Audit</p>
          <h1>${escapeHtml(prospect.businessName)}</h1>
          <p class="lede">${escapeHtml(report?.businessSummary || prospect.painSummary || "Waiting on research to complete.")}</p>
        </div>
        <aside class="score">
          <span class="badge">Opportunity score ${escapeHtml(`${score}/100`)}</span>
          <p><strong>${escapeHtml(location)}</strong></p>
          <p>Website: ${escapeHtml(prospect.website || "Not available")}</p>
          <p>Contact: ${escapeHtml(prospect.email || prospect.phone || "Not available")}</p>
        </aside>
      </section>

      <section class="meta-grid">
        <div class="card"><span class="label">Source</span><p>${escapeHtml(prospect.source)}</p></div>
        <div class="card"><span class="label">Website summary</span><p>${escapeHtml(report?.websiteSummary || prospect.suggestedOfferAngle || "No website summary yet.")}</p></div>
        <div class="card"><span class="label">Generated</span><p>${escapeHtml(formatExportTimestamp(report?.generatedAt || prospect.research?.createdAt))}</p></div>
        <div class="card"><span class="label">Status</span><p>${escapeHtml(prospect.status.replaceAll("_", " "))}</p></div>
      </section>

      <section class="three-col section">
        <div class="card">
          <span class="label">Pain points</span>
          ${renderList(painPoints, "Waiting on research.")}
        </div>
        <div class="card">
          <span class="label">Automation opportunities</span>
          ${renderList(automationOpportunities, "Waiting on research.")}
        </div>
        <div class="card">
          <span class="label">Why it scores</span>
          ${renderList(opportunityReasons, "No score reasoning yet.")}
        </div>
      </section>

      <section class="four-col section">
        <div class="card">
          <span class="label">Business profile</span>
          <p>${escapeHtml(
            businessProfile
              ? `Health ${Math.round(businessProfile.businessHealthScore)}/100 · Website ${Math.round(businessProfile.websiteScore)}/100 · Reviews ${Math.round(
                  businessProfile.reviewsScore,
                )}/100`
              : "Not available yet.",
          )}</p>
        </div>
        <div class="card">
          <span class="label">Booking readiness</span>
          <p>${escapeHtml(businessProfile ? `${Math.round(businessProfile.bookingScore)}/100` : "Not available yet.")}</p>
        </div>
        <div class="card">
          <span class="label">AI readiness</span>
          <p>${escapeHtml(businessProfile ? `${Math.round(businessProfile.aiReadinessScore)}/100` : "Not available yet.")}</p>
        </div>
        <div class="card">
          <span class="label">Contact signals</span>
          <p>${escapeHtml([prospect.email ? "Email" : null, prospect.phone ? "Phone" : null].filter(Boolean).join(" · ") || "Not available")}</p>
        </div>
      </section>

      <section class="two-col section">
        <div class="card">
          <span class="label">Source coverage</span>
          <ul class="coverage-list">
            ${renderCoverageItem("Google Business", sourceCoverage?.googleBusiness)}
            ${renderCoverageItem("LinkedIn", sourceCoverage?.linkedinCompany)}
            ${renderCoverageItem("Facebook", sourceCoverage?.facebookPage)}
            ${renderCoverageItem("Instagram", sourceCoverage?.instagram)}
            ${renderCoverageItem("Yelp", sourceCoverage?.yelp)}
            ${renderCoverageItem("BBB", sourceCoverage?.bbb)}
            ${renderCoverageItem("WHOIS", sourceCoverage?.whois)}
            ${renderCoverageItem("Tech stack", sourceCoverage?.techStack)}
          </ul>
        </div>
        <div class="card">
          <span class="label">Sales strategy</span>
          <p>${escapeHtml(report?.salesStrategy.primaryPain || prospect.suggestedOfferAngle || "Not enough signal yet.")}</p>
          <p>${escapeHtml(report?.salesStrategy.recommendedOffer || "No offer generated yet.")}</p>
          <p>${escapeHtml(report?.salesStrategy.cta || "No CTA generated yet.")}</p>
        </div>
      </section>

      <section class="section">
        <h2>Workflow timeline</h2>
        <div class="timeline">
          ${timeline
            .map(
              (item) => `
            <article class="timeline-item">
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(formatExportTimestamp(item.occurredAt))}</span>
              </div>
              <p>${escapeHtml(item.description)}</p>
            </article>`,
            )
            .join("") || `<p class="empty">No timeline items yet.</p>`}
        </div>
      </section>

      ${analysis ? `
      <section class="section">
        <h2>Reply intelligence</h2>
        <div class="two-col">
          <div class="card">
            <span class="label">Classification</span>
            <p>${escapeHtml(analysis.intent.replaceAll("_", " "))}</p>
            <p>${escapeHtml(`${analysis.sentiment} sentiment · ${Math.round(analysis.confidence)}% confidence`)}</p>
          </div>
          <div class="card">
            <span class="label">Suggested response</span>
            <p>${escapeHtml(analysis.suggestedReply)}</p>
          </div>
        </div>
      </section>` : ""}

      <p class="footer">Prepared for ${escapeHtml(prospect.businessName)} by Revenue Agent. This export is generated from the server-side prospect intelligence pipeline.</p>
    </main>
  </body>
</html>`;
}

function timelineIncludes(
  timeline: RevenueAgentTimelineEvent[] | undefined,
  type: RevenueAgentTimelineEventType,
): boolean {
  return Boolean(timeline?.some((event) => event.type === type));
}

function formatCalendarSuggestionTimestamp(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(value);
}

function buildCalendarSuggestion(
  prospect: RevenueAgentProspect,
  report: RevenueAgentOpportunityReport | undefined,
  analysis: RevenueAgentReplyAnalysis | null,
  timezone: string,
): RevenueAgentCalendarSuggestion | undefined {
  if (!analysis?.meetingBrief && prospect.status !== "meeting_booked" && prospect.status !== "replied") {
    return undefined;
  }

  const meetingMinutes = analysis?.meetingBrief?.durationMinutes ?? 20;
  const base = Date.now();
  const slots: RevenueAgentCalendarSuggestionSlot[] = [
    new Date(base + 24 * 60 * 60 * 1000 + 10 * 60 * 60 * 1000),
    new Date(base + 24 * 60 * 60 * 1000 + 13 * 60 * 60 * 1000),
    new Date(base + 2 * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000),
  ].map((slot) => ({
    startAt: slot.toISOString(),
    endAt: new Date(slot.getTime() + meetingMinutes * 60 * 1000).toISOString(),
    label: formatCalendarSuggestionTimestamp(slot, timezone),
  }));
  const suggestedTimes = slots.map((slot) => slot.label);
  const inviteDraft = [
    analysis?.meetingBrief?.suggestedCalendarMessage ||
      `Thanks for the reply. I’m happy to set up a ${meetingMinutes}-minute call to review the workflow and next steps.`,
    "",
    `Suggested times (${timezone}):`,
    ...suggestedTimes.map((slot) => `- ${slot}`),
    "",
    report?.salesStrategy.recommendedOffer || "We will walk through the recommended automation workflow.",
  ]
    .join("\n")
    .trim();

  return {
    timezone,
    suggestedTimes,
    suggestedSlots: slots,
    meetingDurationMinutes: meetingMinutes,
    inviteDraft,
  };
}

function workflowStep(
  type: RevenueAgentWorkflowStepType,
  title: string,
  description: string,
  status: RevenueAgentWorkflowStepStatus,
): RevenueAgentWorkflowStep {
  return {
    type,
    title,
    description,
    status,
  };
}

function buildWorkflowProposalDraft(
  prospect: RevenueAgentProspect,
  report: RevenueAgentOpportunityReport | undefined,
  analysis: RevenueAgentReplyAnalysis | null,
): RevenueAgentProposalDraft | undefined {
  if (!report && !analysis && prospect.status === "new") {
    return undefined;
  }

  const painPoints = report?.painPoints?.length ? report.painPoints : [prospect.painSummary].filter((item) => item.trim().length > 0);
  const currentWorkflow = [
    report?.websiteSignals.contactForm === false ? "Lead capture is manual or thin." : "Lead capture exists but still needs routing.",
    report?.websiteSignals.contactForm ? "Website has a contact form." : "No obvious contact form on the website.",
    report?.websiteSignals.mobileResponsive ? "Mobile experience is present." : "Mobile experience looks weak.",
    report?.websiteSignals.https ? "HTTPS is enabled." : "HTTPS needs attention.",
  ];
  const proposedWorkflow = [
    "Capture the lead and score the opportunity.",
    "Draft personalized outreach from research findings.",
    "Classify replies and route interested leads to scheduling.",
    "Generate a pre-meeting brief and proposal from the same account record.",
  ];
  const timeline = analysis?.meetingBrief?.followUpPlan?.length
    ? analysis.meetingBrief.followUpPlan
    : [
        "Day 0: run research and draft outreach.",
        "Day 1: approve and send the message.",
        "Day 3: classify replies and suggest a next step.",
        "Day 5: create the meeting brief and proposal.",
      ];
  const deliverables = [
    "Prospect intelligence report",
    "Reply classification workflow",
    "Meeting brief and scheduling handoff",
    "Proposal template and follow-up sequence",
  ];
  const pricingSuggestion =
    report && report.opportunityScore >= 85
      ? "Suggested package: $4,500 implementation + $750/month"
      : report && report.opportunityScore >= 70
        ? "Suggested package: $3,000 implementation + $500/month"
        : "Suggested package: $2,000 implementation + $350/month";
  const roiSummary =
    report
      ? `Estimated savings: ${report.estimatedRoiHoursPerWeekMin} - ${report.estimatedRoiHoursPerWeekMax} hours/week`
      : "Estimated savings: not available yet.";

  return {
    executiveSummary:
      report?.businessSummary ||
      `${prospect.businessName} looks like a fit for a focused revenue workflow that turns research, outreach, reply handling, and meeting prep into one process.`,
    painPoints,
    currentWorkflow,
    proposedWorkflow,
    timeline,
    deliverables,
    pricingSuggestion,
    roiSummary,
    acceptancePrompt:
      analysis?.meetingBrief?.suggestedCalendarMessage ||
      "Reply with a time that works and we will move to the next step.",
  };
}

function buildProposalEmailContent(
  prospect: RevenueAgentProspect,
  workflow: RevenueAgentWorkflow,
  business: BusinessRow,
): { subject: string; htmlBody: string; textBody: string } {
  const draft = workflow.proposalDraft;

  if (!draft) {
    throw new HttpError(400, "revenue_agent_missing_proposal", "No proposal draft is available.");
  }

  const formatList = (items: string[]): string =>
    items.length
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p class="empty">Not available.</p>`;
  const textList = (items: string[]): string =>
    items.length ? items.map((item) => `- ${item}`).join("\n") : "Not available.";
  const slotBlock =
    workflow.calendarSuggestion?.suggestedTimes?.length && workflow.calendarSuggestion.timezone
      ? `<div class="card"><span class="label">Suggested times (${escapeHtml(workflow.calendarSuggestion.timezone)})</span>${formatList(
          workflow.calendarSuggestion.suggestedTimes,
        )}</div>`
      : "";
  const slotText =
    workflow.calendarSuggestion?.suggestedTimes?.length && workflow.calendarSuggestion.timezone
      ? `Suggested times (${workflow.calendarSuggestion.timezone}):\n${textList(workflow.calendarSuggestion.suggestedTimes)}\n\n`
      : "";

  const subject = `Proposal for ${prospect.businessName}`;
  const htmlBody = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#fff8f2;color:#241813;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <main style="max-width:760px;margin:0 auto;padding:32px 20px;">
      <div style="padding:28px;border:1px solid rgba(78,48,34,0.14);border-radius:24px;background:#fff;box-shadow:0 20px 48px rgba(50,26,16,0.08);">
        <p style="margin:0 0 8px;color:#6a554b;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">${escapeHtml(
          business.brand_name || business.name,
        )}</p>
        <h1 style="margin:0 0 12px;font-size:30px;line-height:1.04;">Proposal for ${escapeHtml(prospect.businessName)}</h1>
        <p style="margin:0 0 20px;color:#6a554b;line-height:1.7;">${escapeHtml(draft.executiveSummary)}</p>

        <div style="display:grid;gap:14px;">
          <div style="padding:16px;border:1px solid rgba(78,48,34,0.14);border-radius:18px;background:rgba(255,248,242,.55);">
            <span style="display:block;margin-bottom:8px;color:#6a554b;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Pain points</span>
            ${formatList(draft.painPoints)}
          </div>
          <div style="padding:16px;border:1px solid rgba(78,48,34,0.14);border-radius:18px;background:rgba(255,248,242,.55);">
            <span style="display:block;margin-bottom:8px;color:#6a554b;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Current workflow</span>
            ${formatList(draft.currentWorkflow)}
          </div>
          <div style="padding:16px;border:1px solid rgba(78,48,34,0.14);border-radius:18px;background:rgba(255,248,242,.55);">
            <span style="display:block;margin-bottom:8px;color:#6a554b;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Proposed workflow</span>
            ${formatList(draft.proposedWorkflow)}
          </div>
          <div style="padding:16px;border:1px solid rgba(78,48,34,0.14);border-radius:18px;background:rgba(255,248,242,.55);">
            <span style="display:block;margin-bottom:8px;color:#6a554b;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Timeline</span>
            ${formatList(draft.timeline)}
          </div>
          <div style="padding:16px;border:1px solid rgba(78,48,34,0.14);border-radius:18px;background:rgba(255,248,242,.55);">
            <span style="display:block;margin-bottom:8px;color:#6a554b;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Deliverables</span>
            ${formatList(draft.deliverables)}
          </div>
          ${slotBlock}
          <div style="padding:16px;border:1px solid rgba(78,48,34,0.14);border-radius:18px;background:linear-gradient(180deg,rgba(207,99,48,.1),rgba(207,99,48,.04));">
            <span style="display:block;margin-bottom:8px;color:#6a554b;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">ROI and pricing</span>
            <p style="margin:0 0 8px;line-height:1.7;color:#6a554b;">${escapeHtml(draft.roiSummary)}</p>
            <p style="margin:0;line-height:1.7;color:#6a554b;">${escapeHtml(draft.pricingSuggestion)}</p>
          </div>
        </div>

        <p style="margin:20px 0 0;line-height:1.7;color:#6a554b;">${escapeHtml(draft.acceptancePrompt)}</p>
      </div>
    </main>
  </body>
</html>`;
  const textBody = [
    `Proposal for ${prospect.businessName}`,
    "",
    draft.executiveSummary,
    "",
    "Pain points:",
    textList(draft.painPoints),
    "",
    "Current workflow:",
    textList(draft.currentWorkflow),
    "",
    "Proposed workflow:",
    textList(draft.proposedWorkflow),
    "",
    "Timeline:",
    textList(draft.timeline),
    "",
    "Deliverables:",
    textList(draft.deliverables),
    "",
    draft.roiSummary,
    draft.pricingSuggestion,
    "",
    slotText.trimEnd(),
    "",
    draft.acceptancePrompt,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    subject,
    htmlBody,
    textBody,
  };
}

function buildMeetingConfirmationContent(
  prospect: RevenueAgentProspect,
  workflow: RevenueAgentWorkflow,
  business: BusinessRow,
): { subject: string; htmlBody: string; textBody: string } {
  const suggestion = workflow.calendarSuggestion;

  if (!suggestion) {
    throw new HttpError(400, "revenue_agent_missing_calendar_suggestion", "No calendar suggestion is available.");
  }

  const formatList = (items: string[]): string =>
    items.length
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p class="empty">Not available.</p>`;
  const textList = (items: string[]): string => (items.length ? items.map((item) => `- ${item}`).join("\n") : "Not available.");
  const meetingBrief = workflow.meetingBrief;
  const agendaItems = meetingBrief?.agenda?.length ? meetingBrief.agenda : workflow.proposalDraft?.proposedWorkflow ?? [];
  const prepNotes = meetingBrief?.prepNotes ?? [];
  const followUpPlan = meetingBrief?.followUpPlan ?? [];
  const confirmedSlot = suggestion.suggestedSlots?.[0]?.label ?? suggestion.suggestedTimes[0] ?? "the first available slot";

  const htmlBody = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#fff8f2;color:#241813;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <main style="max-width:760px;margin:0 auto;padding:32px 20px;">
      <div style="padding:28px;border:1px solid rgba(78,48,34,0.14);border-radius:24px;background:#fff;box-shadow:0 20px 48px rgba(50,26,16,0.08);">
        <p style="margin:0 0 8px;color:#6a554b;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;">${escapeHtml(
          business.brand_name || business.name,
        )}</p>
        <h1 style="margin:0 0 12px;font-size:30px;line-height:1.04;">Meeting confirmed for ${escapeHtml(prospect.businessName)}</h1>
        <p style="margin:0 0 12px;color:#6a554b;line-height:1.7;">${escapeHtml(
          `${confirmedSlot} · ${suggestion.meetingDurationMinutes} minutes · ${suggestion.timezone}`,
        )}</p>
        <p style="margin:0 0 20px;color:#6a554b;line-height:1.7;">${escapeHtml(
          meetingBrief?.suggestedCalendarMessage || suggestion.inviteDraft,
        )}</p>

        <div style="display:grid;gap:14px;">
          <div style="padding:16px;border:1px solid rgba(78,48,34,0.14);border-radius:18px;background:rgba(255,248,242,.55);">
            <span style="display:block;margin-bottom:8px;color:#6a554b;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Agenda</span>
            ${formatList(agendaItems)}
          </div>
          <div style="padding:16px;border:1px solid rgba(78,48,34,0.14);border-radius:18px;background:rgba(255,248,242,.55);">
            <span style="display:block;margin-bottom:8px;color:#6a554b;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Prep notes</span>
            ${formatList(prepNotes)}
          </div>
          <div style="padding:16px;border:1px solid rgba(78,48,34,0.14);border-radius:18px;background:rgba(255,248,242,.55);">
            <span style="display:block;margin-bottom:8px;color:#6a554b;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Follow-up plan</span>
            ${formatList(followUpPlan)}
          </div>
        </div>
      </div>
    </main>
  </body>
</html>`;

  const textBody = [
    `${business.brand_name || business.name}`,
    "",
    `Meeting confirmed for ${prospect.businessName}.`,
    `${confirmedSlot} · ${suggestion.meetingDurationMinutes} minutes · ${suggestion.timezone}`,
    "",
    meetingBrief?.suggestedCalendarMessage || suggestion.inviteDraft,
    "",
    "Agenda:",
    textList(agendaItems),
    "",
    "Prep notes:",
    textList(prepNotes),
    "",
    "Follow-up plan:",
    textList(followUpPlan),
  ]
    .join("\n")
    .trim();

  return {
    subject: `Meeting confirmed for ${prospect.businessName}`,
    htmlBody,
    textBody,
  };
}

function buildRevenueAgentWorkflowSnapshot(prospect: RevenueAgentProspect, timezone: string): RevenueAgentWorkflow {
  const report = prospect.research?.report;
  const analysis = readLatestReplyAnalysis(prospect.timeline);
  const hasResearch = Boolean(prospect.research);
  const hasReply = timelineIncludes(prospect.timeline, "reply_received") || timelineIncludes(prospect.timeline, "reply_analyzed");
  const hasMeeting = prospect.status === "meeting_booked" || timelineIncludes(prospect.timeline, "meeting_booked");
  const hasSent = prospect.status === "sent" || timelineIncludes(prospect.timeline, "sent");
  const hasApproved = prospect.status === "approved" || timelineIncludes(prospect.timeline, "draft_approved");
  const hasDraft = prospect.status === "drafted" || Boolean(prospect.latestMessage);
  const isReadyForReplyHandling = hasSent || hasReply || prospect.status === "replied";
  const proposalDraft = buildWorkflowProposalDraft(prospect, report, analysis);
  const calendarSuggestion = buildCalendarSuggestion(prospect, report, analysis, timezone);
  const stepStatus = (condition: boolean, active: boolean): RevenueAgentWorkflowStepStatus =>
    condition ? "done" : active ? "active" : "pending";

  const steps: RevenueAgentWorkflowStep[] = [
    workflowStep(
      "analyze_lead",
      "Analyze the account",
      "Collect signals from website, reviews, and business data.",
      stepStatus(hasResearch, !hasResearch),
    ),
    workflowStep(
      "research_account",
      "Research and score",
      "Build the opportunity report and score the account.",
      stepStatus(hasResearch, !hasResearch && prospect.status !== "new"),
    ),
    workflowStep(
      "draft_outreach",
      "Draft outreach",
      "Generate a personalized message from the research.",
      stepStatus(hasDraft, !hasDraft && hasResearch),
    ),
    workflowStep(
      "send_outreach",
      "Send outreach",
      "Wait for approval, send the email, and log the send.",
      stepStatus(hasSent || prospect.status === "approved", !hasSent && hasApproved),
    ),
    workflowStep(
      "classify_reply",
      "Classify reply",
      "Read the reply, detect intent, and route the next action.",
      stepStatus(hasReply, !hasReply && isReadyForReplyHandling),
    ),
    workflowStep(
      "check_calendar",
      "Check calendar",
      "Review calendar availability before proposing times.",
      stepStatus(hasMeeting, !hasMeeting && hasReply),
    ),
    workflowStep(
      "suggest_times",
      "Suggest times",
      "Offer three slots once the lead shows interest.",
      stepStatus(hasMeeting, !hasMeeting && hasReply),
    ),
    workflowStep(
      "draft_confirmation",
      "Draft confirmation",
      "Prepare the confirmation email and calendar invite copy.",
      stepStatus(hasMeeting, !hasMeeting && hasReply),
    ),
    workflowStep(
      "generate_meeting_brief",
      "Generate meeting brief",
      "Create the prep packet for the call.",
      stepStatus(Boolean(analysis?.meetingBrief) || hasMeeting, !hasMeeting && Boolean(analysis?.meetingBrief)),
    ),
    workflowStep(
      "generate_proposal",
      "Generate proposal",
      "Turn the research and meeting notes into a proposal draft.",
      stepStatus(hasMeeting, !hasMeeting && Boolean(proposalDraft)),
    ),
    workflowStep(
      "follow_up",
      "Follow up",
      "Keep the pipeline warm if the prospect does not book immediately.",
      stepStatus(prospect.status === "follow_up_due" || prospect.status === "meeting_booked", prospect.status === "replied"),
    ),
    workflowStep(
      "update_pipeline",
      "Update pipeline",
      "Move the deal stage and persist the outcome in the workspace memory.",
      stepStatus(prospect.status === "meeting_booked" || prospect.status === "not_interested", prospect.status === "replied"),
    ),
  ];

  const trigger: RevenueAgentWorkflowTrigger = hasMeeting
    ? "meeting_booked"
    : hasReply
      ? "reply_received"
      : hasResearch
        ? "research_ready"
        : "lead_discovered";

  const confidence =
    report && analysis
      ? Math.max(55, Math.min(98, Math.round((report.opportunityScore + analysis.confidence) / 2)))
      : report
        ? Math.max(50, Math.min(95, Math.round(report.opportunityScore)))
        : hasReply
          ? 62
          : 48;

  const nextBestAction = hasMeeting
    ? "Generate the proposal and prepare the meeting brief."
    : hasReply
      ? "Check calendar availability and suggest three times."
      : hasSent
        ? "Wait for the reply and keep the follow-up visible."
        : hasResearch
          ? "Approve the draft and send the first outreach."
          : "Finish research and write the outreach draft.";

  const calendarNotes = [
    hasReply ? "Reply handling is ready for calendar routing." : "Calendar routing starts after a reply shows buying intent.",
    hasMeeting ? "Meeting booked state detected in the prospect timeline." : "Google Calendar integration is still a pending connector.",
    report?.websiteSignals.bookingSoftware
      ? `Website shows booking software: ${report.websiteSignals.bookingSoftware}.`
      : "No booking software detected from the website signals.",
  ];

  return {
    key: `${prospect.businessId}:${prospect.id}:workflow`,
    title:
      hasMeeting
        ? "Meeting-to-proposal workflow"
        : hasReply
          ? "Reply-to-meeting workflow"
          : hasResearch
            ? "Research-to-outreach workflow"
            : "Lead discovery workflow",
    trigger,
    objective:
      hasMeeting
        ? "Convert the booked meeting into a proposal and a clear next step."
        : hasReply
          ? "Turn the reply into a scheduled meeting."
          : "Move the prospect from discovery to a qualified conversation.",
    confidence,
    nextBestAction,
    calendarNotes,
    calendarSuggestion,
    meetingBrief: analysis?.meetingBrief,
    steps,
    proposalDraft,
  };
}

function normalizeReplyText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function summarizeReplyIntent(intent: RevenueAgentReplyIntent): string {
  switch (intent) {
    case "meeting_request":
      return "The lead is asking to meet.";
    case "interested":
      return "The lead is interested and open to continuing the conversation.";
    case "price_objection":
      return "The lead is interested but concerned about cost.";
    case "not_now":
      return "The lead wants to revisit later.";
    case "not_interested":
      return "The lead does not want to continue.";
    case "needs_info":
      return "The lead wants more detail before moving forward.";
    default:
      return "The reply needs manual review.";
  }
}

function buildMeetingAgenda(report?: RevenueAgentOpportunityReport): string[] {
  const agenda = [
    report?.salesStrategy.primaryPain || "Confirm the main operational bottleneck.",
    report?.salesStrategy.recommendedOffer || "Walk through the recommended automation workflow.",
    "Agree on the next implementation step.",
  ];

  return [...new Set(agenda.map((item) => item.trim()).filter((item) => item.length > 0))];
}

function buildMeetingBrief(
  prospect: ProspectRow,
  report: RevenueAgentOpportunityReport | undefined,
  agenda: string[],
): RevenueAgentMeetingBrief {
  const objective =
    report?.salesStrategy.recommendedOffer || prospect.suggested_offer_angle || "book a short qualification call";

  return {
    objective,
    durationMinutes: 20,
    agenda: agenda.length > 0 ? agenda : buildMeetingAgenda(report),
    prepNotes: [
      report?.businessSummary || prospect.pain_summary || `${prospect.business_name} needs a clearer workflow.`,
      ...(report?.opportunityScoreReasons ?? []),
    ].filter((item, index, array) => item.trim().length > 0 && array.indexOf(item) === index),
    suggestedCalendarMessage: `Thanks for the reply. I’m happy to set up a quick 20-minute call to review ${objective.toLowerCase()} and make sure it fits your priorities.`,
    followUpPlan: [
      "Send a calendar invite with the agenda before the call.",
      "Bring the prospect research and the current draft.",
      "Summarize next steps immediately after the call.",
    ],
  };
}

function buildReplyResponse(prospect: ProspectRow, replyText: string, report?: RevenueAgentOpportunityReport): RevenueAgentReplyAnalysis {
  const normalized = replyText.toLowerCase();
  const reasons: string[] = [];
  let intent: RevenueAgentReplyIntent = "other";
  let sentiment: RevenueAgentReplySentiment = "neutral";
  let suggestedNextStep: RevenueAgentReplyNextStep = "send_more_info";
  let confidence = 46;
  let suggestedFollowUpDays: number | undefined = 3;

  const meetingIndicators = [
    /\b(book|schedule|calendar|availability|time|slot|zoom|call|meet)\b/i,
    /\bnext week|this week|tomorrow|monday|tuesday|wednesday|thursday|friday\b/i,
  ];
  const positiveIndicators = [/\b(interested|sounds good|yes|love to|let's do it|works for me)\b/i];
  const infoIndicators = [/\b(send|share|more info|details|learn more|how does it work|what does it do)\b/i];
  const priceIndicators = [/\b(price|cost|budget|too expensive|too much|cheaper|rate|monthly)\b/i];
  const notNowIndicators = [/\b(not now|later|next quarter|busy|circle back|follow up later)\b/i];
  const notInterestedIndicators = [/\b(not interested|don't need|no thanks|unsubscribe|stop reaching out|leave me alone)\b/i];

  if (notInterestedIndicators.some((pattern) => pattern.test(normalized))) {
    intent = "not_interested";
    sentiment = "negative";
    suggestedNextStep = "close_loop";
    confidence = 97;
    suggestedFollowUpDays = undefined;
    reasons.push("The reply explicitly says the lead is not interested.");
  } else if (meetingIndicators.some((pattern) => pattern.test(normalized))) {
    intent = "meeting_request";
    sentiment = "positive";
    suggestedNextStep = "book_meeting";
    confidence = 95;
    suggestedFollowUpDays = undefined;
    reasons.push("The reply includes scheduling or booking language.");
  } else if (priceIndicators.some((pattern) => pattern.test(normalized))) {
    intent = "price_objection";
    sentiment = "neutral";
    suggestedNextStep = "handle_objection";
    confidence = 88;
    reasons.push("The reply raises a pricing or budget concern.");
  } else if (notNowIndicators.some((pattern) => pattern.test(normalized))) {
    intent = "not_now";
    sentiment = "neutral";
    suggestedNextStep = "send_more_info";
    confidence = 84;
    suggestedFollowUpDays = 14;
    reasons.push("The reply asks to revisit the conversation later.");
  } else if (positiveIndicators.some((pattern) => pattern.test(normalized))) {
    intent = "interested";
    sentiment = "positive";
    suggestedNextStep = "book_meeting";
    confidence = 82;
    reasons.push("The reply signals interest.");
  } else if (infoIndicators.some((pattern) => pattern.test(normalized))) {
    intent = "needs_info";
    sentiment = "neutral";
    suggestedNextStep = "send_more_info";
    confidence = 80;
    reasons.push("The reply asks for more information.");
  } else {
    reasons.push("The reply did not match a stronger intent pattern.");
  }

  const primaryPain = report?.salesStrategy.primaryPain || prospect.pain_summary || "reduce manual follow-up";
  const recommendedOffer = report?.salesStrategy.recommendedOffer || prospect.suggested_offer_angle || "automation workflow";
  const meetingAgenda = buildMeetingAgenda(report);
  const meetingBrief =
    intent === "meeting_request" || intent === "interested"
      ? buildMeetingBrief(prospect, report, meetingAgenda)
      : undefined;

  const suggestedReply = (() => {
    if (intent === "not_interested") {
      return [
        "Thanks for letting me know.",
        "I’ll close the loop on my side.",
      ].join(" ");
    }

    if (intent === "meeting_request") {
      return [
        "Thanks for the reply.",
        "I can send over a few time options and a short agenda focused on",
        `${primaryPain.toLowerCase()}.`,
      ].join(" ");
    }

    if (intent === "price_objection") {
      return [
        "Appreciate the candor.",
        `The best way to judge fit is to walk through the ROI on ${recommendedOffer.toLowerCase()}.`,
        "If helpful, I can send a quick breakdown.",
      ].join(" ");
    }

    if (intent === "not_now") {
      return [
        "Understood.",
        "I can follow up later with a shorter overview and a concrete example if the timing improves.",
      ].join(" ");
    }

    if (intent === "needs_info" || intent === "interested") {
      return [
        "Thanks for the reply.",
        `I can send a tighter overview of how ${recommendedOffer.toLowerCase()} would address ${primaryPain.toLowerCase()}.`,
      ].join(" ");
    }

    return [
      "Thanks for the reply.",
      "I can send a tighter summary and a concrete next step if helpful.",
    ].join(" ");
  })();

  const summary = `${summarizeReplyIntent(intent)}${replyText.trim() ? ` Reply: ${normalizeReplyText(replyText).slice(0, 140)}${replyText.trim().length > 140 ? "…" : ""}` : ""}`;

  return {
    intent,
    sentiment,
    confidence,
    summary,
    suggestedReply,
    suggestedNextStep,
    meetingAgenda,
    reasons,
    suggestedFollowUpDays,
    meetingBrief,
  };
}

async function ensureEmailContact(
  businessId: string,
  email: string,
  prospect: ProspectRow,
  client?: PoolClient,
): Promise<void> {
  const existing = await executeQuery<{ id: string; status: string }>(
    `
      select id, status
      from email_contacts
      where business_id = $1::uuid
        and lower(email) = lower($2)
      limit 1
    `,
    [businessId, email],
    client,
  );

  if (existing.rows[0]) {
    if (existing.rows[0].status === "unsubscribed") {
      throw new HttpError(400, "revenue_agent_unsubscribed", "This contact is unsubscribed and cannot be emailed.");
    }

    return;
  }

  await executeQuery(
    `
      insert into email_contacts (
        business_id,
        email,
        first_name,
        last_name,
        tags_json,
        status,
        unsubscribed_at
      ) values (
        $1::uuid,
        $2,
        null,
        null,
        $3::jsonb,
        'active',
        null
      )
    `,
    [businessId, email, JSON.stringify([`revenue-agent:${slugify(prospect.industry)}`])],
    client,
  );
}

async function updateProspectStatus(
  prospectId: string,
  input: Partial<Pick<ProspectRow, "status" | "pain_summary" | "suggested_offer_angle" | "opportunity_score">> & {
    approvedAt?: string | null;
    sentAt?: string | null;
    nextFollowUpAt?: string | null;
    lastContactedAt?: string | null;
    repliedAt?: string | null;
    meetingBookedAt?: string | null;
    unsubscribedAt?: string | null;
    leadSourceId?: string | null;
    opportunityTags?: string[];
    clearNextFollowUp?: boolean;
  },
  client?: PoolClient,
): Promise<ProspectRow> {
  const result = await executeQuery<ProspectRow>(
    `
      update prospects
      set
        status = coalesce($2, status),
        pain_summary = coalesce($3, pain_summary),
        suggested_offer_angle = coalesce($4, suggested_offer_angle),
        opportunity_score = coalesce($5, opportunity_score),
        opportunity_tags_json = coalesce($6::jsonb, opportunity_tags_json),
        approved_at = coalesce($7::timestamptz, approved_at),
        sent_at = coalesce($8::timestamptz, sent_at),
        next_follow_up_at = case
          when $15::boolean and $9::timestamptz is null then null
          else coalesce($9::timestamptz, next_follow_up_at)
        end,
        last_contacted_at = coalesce($10::timestamptz, last_contacted_at),
        replied_at = coalesce($11::timestamptz, replied_at),
        meeting_booked_at = coalesce($12::timestamptz, meeting_booked_at),
        unsubscribed_at = coalesce($13::timestamptz, unsubscribed_at),
        lead_source_id = coalesce($14::uuid, lead_source_id),
        updated_at = now()
      where id = $1::uuid
      returning
        id,
        business_id,
        lead_source_id,
        business_name,
        website,
        website_normalized,
        email,
        email_normalized,
        phone,
        phone_normalized,
        city,
        state,
        industry,
        source,
        source_url,
        rating,
        review_count,
        pain_summary,
        opportunity_score,
        opportunity_tags_json,
        suggested_offer_angle,
        status,
        last_contacted_at,
        next_follow_up_at,
        approved_at,
        sent_at,
        replied_at,
        meeting_booked_at,
        unsubscribed_at,
        created_at,
        updated_at
    `,
    [
      prospectId,
      input.status ?? null,
      input.pain_summary ?? null,
      input.suggested_offer_angle ?? null,
      input.opportunity_score ?? null,
      input.opportunityTags ? JSON.stringify(input.opportunityTags) : null,
      input.approvedAt ?? null,
      input.sentAt ?? null,
      input.nextFollowUpAt ?? null,
      input.lastContactedAt ?? null,
      input.repliedAt ?? null,
      input.meetingBookedAt ?? null,
      input.unsubscribedAt ?? null,
      input.leadSourceId ?? null,
      Boolean(input.clearNextFollowUp),
    ],
    client,
  );

  return result.rows[0];
}

async function upsertProspectAndResearch(
  businessId: string,
  leadSource: LeadSourceRow,
  lead: LeadSourceLead,
  researchInput: ProspectIntelligenceResult,
  runId: string,
  client?: PoolClient,
): Promise<{ prospect: ProspectRow; research: ProspectResearchRow; isNewProspect: boolean }> {
  const website = normalizeWebsite(lead.website);
  const email = normalizeEmail(lead.email);
  const phone = normalizePhone(lead.phone);

  const conflictLookup = await executeQuery<{ id: string }>(
    `
      select id
      from prospects
      where business_id = $1::uuid
        and (
          ($2::text is not null and website_normalized = $2)
          or ($3::text is not null and email_normalized = $3)
          or ($4::text is not null and phone_normalized = $4)
        )
      order by updated_at desc
      limit 1
    `,
    [businessId, website.normalized ?? null, email ?? null, phone ?? null],
    client,
  );

  const existingProspectId = conflictLookup.rows[0]?.id;

  const prospectResult = existingProspectId
    ? await executeQuery<ProspectRow>(
        `
          update prospects
          set
            lead_source_id = $2::uuid,
            business_name = $3,
            website = coalesce($4, website),
            website_normalized = coalesce($5, website_normalized),
            email = coalesce($6, email),
            email_normalized = coalesce($7, email_normalized),
            phone = coalesce($8, phone),
            phone_normalized = coalesce($9, phone_normalized),
            city = coalesce($10, city),
            state = coalesce($11, state),
            industry = coalesce($12, industry),
            source = $13,
            source_url = coalesce($14, source_url),
            rating = $15,
            review_count = coalesce($16, review_count),
            pain_summary = $17,
            opportunity_score = $18,
            opportunity_tags_json = $19::jsonb,
            suggested_offer_angle = $20,
            status = case
              when status in ('not_interested', 'dead', 'meeting_booked') then status
              when status = 'sent' then 'sent'
              else 'researched'
            end,
            updated_at = now()
          where id = $1::uuid
          returning
            id,
            business_id,
            lead_source_id,
            business_name,
            website,
            website_normalized,
            email,
            email_normalized,
            phone,
            phone_normalized,
            city,
            state,
            industry,
            source,
            source_url,
            rating,
            review_count,
            pain_summary,
            opportunity_score,
            opportunity_tags_json,
            suggested_offer_angle,
            status,
            last_contacted_at,
            next_follow_up_at,
            approved_at,
            sent_at,
            replied_at,
            meeting_booked_at,
            unsubscribed_at,
            created_at,
            updated_at
        `,
        [
          existingProspectId,
          leadSource.id,
          lead.businessName,
          website.display ?? null,
          website.normalized ?? null,
          email ?? null,
          email ?? null,
          phone ?? null,
          phone ?? null,
          lead.city ?? null,
          lead.state ?? null,
          lead.industry,
          lead.source,
          lead.sourceUrl ?? null,
          lead.rating ?? null,
          lead.reviewCount ?? 0,
          researchInput.painSummary,
          researchInput.opportunityScore,
          JSON.stringify(researchInput.opportunityTags),
          researchInput.suggestedOfferAngle,
        ],
        client,
      )
    : await executeQuery<ProspectRow>(
        `
          insert into prospects (
            business_id,
            lead_source_id,
            business_name,
            website,
            website_normalized,
            email,
            email_normalized,
            phone,
            phone_normalized,
            city,
            state,
            industry,
            source,
            source_url,
            rating,
            review_count,
            pain_summary,
            opportunity_score,
            opportunity_tags_json,
            suggested_offer_angle,
            status
          ) values (
            $1::uuid,
            $2::uuid,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12,
            $13,
            $14,
            $15,
            $16,
            $17,
            $18,
            $19::jsonb,
            $20,
            'researched'
          )
          returning
            id,
            business_id,
            lead_source_id,
            business_name,
            website,
            website_normalized,
            email,
            email_normalized,
            phone,
            phone_normalized,
            city,
            state,
            industry,
            source,
            source_url,
            rating,
            review_count,
            pain_summary,
            opportunity_score,
            opportunity_tags_json,
            suggested_offer_angle,
            status,
            last_contacted_at,
            next_follow_up_at,
            approved_at,
            sent_at,
            replied_at,
            meeting_booked_at,
            unsubscribed_at,
            created_at,
            updated_at
        `,
        [
          businessId,
          leadSource.id,
          lead.businessName,
          website.display ?? null,
          website.normalized ?? null,
          email ?? null,
          email ?? null,
          phone ?? null,
          phone ?? null,
          lead.city ?? null,
          lead.state ?? null,
          lead.industry,
          lead.source,
          lead.sourceUrl ?? null,
          lead.rating ?? null,
          lead.reviewCount ?? 0,
          researchInput.painSummary,
          researchInput.opportunityScore,
          JSON.stringify(researchInput.opportunityTags),
          researchInput.suggestedOfferAngle,
        ],
        client,
      );

  const prospect = prospectResult.rows[0];
  const researchResult = await executeQuery<ProspectResearchRow>(
    `
      insert into prospect_research (
        business_id,
        prospect_id,
        agent_run_id,
        pain_summary,
        opportunity_score,
        opportunity_tags_json,
        suggested_offer_angle,
        email_subject,
        email_body,
        research_json
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4,
        $5,
        $6::jsonb,
        $7,
        $8,
        $9,
        $10::jsonb
      )
      on conflict (prospect_id) do update set
        agent_run_id = coalesce(excluded.agent_run_id, prospect_research.agent_run_id),
        pain_summary = excluded.pain_summary,
        opportunity_score = excluded.opportunity_score,
        opportunity_tags_json = excluded.opportunity_tags_json,
        suggested_offer_angle = excluded.suggested_offer_angle,
        email_subject = excluded.email_subject,
        email_body = excluded.email_body,
        research_json = excluded.research_json,
        updated_at = now()
      returning
        id,
        business_id,
        prospect_id,
        agent_run_id,
        pain_summary,
        opportunity_score,
        opportunity_tags_json,
        suggested_offer_angle,
        email_subject,
        email_body,
        research_json,
        created_at,
        updated_at
    `,
    [
      businessId,
      prospect.id,
      runId,
      researchInput.painSummary,
      researchInput.opportunityScore,
      JSON.stringify(researchInput.opportunityTags),
      researchInput.suggestedOfferAngle,
      researchInput.emailSubject,
      researchInput.emailBody,
      JSON.stringify({
        lead,
        sourceProvider: leadSource.provider,
        websiteUrl: researchInput.websiteUrl ?? lead.website ?? null,
        report: researchInput.report,
      }),
    ],
    client,
  );

  return {
    prospect,
    research: researchResult.rows[0],
    isNewProspect: !existingProspectId,
  };
}

async function upsertProspectResearchForSnapshot(
  prospect: Pick<
    ProspectRow,
    | "id"
    | "business_id"
    | "business_name"
    | "website"
    | "email"
    | "phone"
    | "city"
    | "state"
    | "industry"
    | "source"
    | "source_url"
    | "rating"
    | "review_count"
  >,
  researchInput: ProspectIntelligenceResult,
  runId: string | null,
  client?: PoolClient,
): Promise<ProspectResearchRow> {
  const researchResult = await executeQuery<ProspectResearchRow>(
    `
      insert into prospect_research (
        business_id,
        prospect_id,
        agent_run_id,
        pain_summary,
        opportunity_score,
        opportunity_tags_json,
        suggested_offer_angle,
        email_subject,
        email_body,
        research_json
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4,
        $5,
        $6::jsonb,
        $7,
        $8,
        $9,
        $10::jsonb
      )
      on conflict (prospect_id) do update set
        agent_run_id = coalesce(excluded.agent_run_id, prospect_research.agent_run_id),
        pain_summary = excluded.pain_summary,
        opportunity_score = excluded.opportunity_score,
        opportunity_tags_json = excluded.opportunity_tags_json,
        suggested_offer_angle = excluded.suggested_offer_angle,
        email_subject = excluded.email_subject,
        email_body = excluded.email_body,
        research_json = excluded.research_json,
        updated_at = now()
      returning
        id,
        business_id,
        prospect_id,
        agent_run_id,
        pain_summary,
        opportunity_score,
        opportunity_tags_json,
        suggested_offer_angle,
        email_subject,
        email_body,
        research_json,
        created_at,
        updated_at
    `,
    [
      prospect.business_id,
      prospect.id,
      runId,
      researchInput.painSummary,
      researchInput.opportunityScore,
      JSON.stringify(researchInput.opportunityTags),
      researchInput.suggestedOfferAngle,
      researchInput.emailSubject,
      researchInput.emailBody,
      JSON.stringify({
        websiteUrl: researchInput.websiteUrl ?? prospect.website ?? null,
        leadSnapshot: {
          businessName: prospect.business_name,
          website: prospect.website,
          email: prospect.email,
          phone: prospect.phone,
          city: prospect.city,
          state: prospect.state,
          industry: prospect.industry,
          source: prospect.source,
          sourceUrl: prospect.source_url,
          rating: prospect.rating,
          reviewCount: prospect.review_count,
        },
        report: researchInput.report,
      }),
    ],
    client,
  );

  return researchResult.rows[0];
}

async function createDraftMessage(
  prospect: ProspectRow,
  research: ProspectResearchRow,
  runId: string,
  client?: PoolClient,
): Promise<OutreachMessageRow> {
  const existing = await executeQuery<OutreachMessageRow>(
    `
      select
        id,
        business_id,
        prospect_id,
        research_id,
        agent_run_id,
        type,
        author,
        subject,
        body,
        status,
        approved_at,
        sent_at,
        provider_message_id,
        created_at,
        updated_at
      from revenue_agent_outreach_messages
      where prospect_id = $1::uuid
      order by created_at desc
      limit 1
    `,
    [prospect.id],
    client,
  );

  if (existing.rows[0]) {
    const current = existing.rows[0];
    const nextType: RevenueAgentMessageType = prospect.status === "sent" ? current.type : "initial";
    const result = await executeQuery<OutreachMessageRow>(
      `
        update revenue_agent_outreach_messages
        set
          research_id = $2::uuid,
          agent_run_id = $3::uuid,
          type = $4,
          subject = $5,
          body = $6,
          status = case when status = 'sent' then status else 'draft' end,
          updated_at = now()
        where id = $1::uuid
        returning
          id,
          business_id,
          prospect_id,
          research_id,
          agent_run_id,
          type,
          author,
          subject,
          body,
          status,
          approved_at,
          sent_at,
          provider_message_id,
          created_at,
          updated_at
      `,
      [current.id, research.id, runId, nextType, research.email_subject, research.email_body],
      client,
    );

    return result.rows[0];
  }

  const inserted = await executeQuery<OutreachMessageRow>(
    `
      insert into revenue_agent_outreach_messages (
        business_id,
        prospect_id,
        research_id,
        agent_run_id,
        type,
        author,
        subject,
        body,
        status
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4::uuid,
        'initial',
        'ai',
        $5,
        $6,
        'draft'
      )
      returning
        id,
        business_id,
        prospect_id,
        research_id,
        agent_run_id,
        type,
        author,
        subject,
        body,
        status,
        approved_at,
        sent_at,
        provider_message_id,
        created_at,
        updated_at
    `,
    [prospect.business_id, prospect.id, research.id, runId, research.email_subject, research.email_body],
    client,
  );

  return inserted.rows[0];
}

async function createFollowUpTasks(
  prospectId: string,
  businessId: string,
  runId: string | null | undefined,
  client?: PoolClient,
): Promise<void> {
  const now = Date.now();
  for (const step of DEFAULT_SEQUENCE_STEPS.filter((sequence) => sequence.dayOffset > 0)) {
    await executeQuery(
      `
        insert into revenue_agent_tasks (
          business_id,
          prospect_id,
          run_id,
          task_type,
          status,
          due_at,
          payload_json
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4,
          'open',
          $5::timestamptz,
          $6::jsonb
        )
        on conflict do nothing
      `,
      [
        businessId,
        prospectId,
        runId ?? null,
        step.messageType === "followup" ? "follow_up" : step.messageType === "value" ? "value_follow_up" : "breakup",
        new Date(now + step.dayOffset * 24 * 60 * 60 * 1000).toISOString(),
        JSON.stringify({
          dayOffset: step.dayOffset,
        }),
      ],
      client,
    );
  }
}

async function recordRevenueAgentTimelineEvent(
  businessId: string,
  prospectId: string | null,
  eventType: RevenueAgentTimelineEventType,
  title: string,
  description: string,
  payload: Record<string, unknown>,
  occurredAt: string,
  messageId: string | null,
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      insert into revenue_agent_email_events (
        business_id,
        prospect_id,
        message_id,
        event_type,
        payload_json,
        occurred_at
      ) values (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4,
        $5::jsonb,
        $6::timestamptz
      )
    `,
    [
      businessId,
      prospectId,
      messageId,
      eventType,
      JSON.stringify({ title, description, ...payload }),
      occurredAt,
    ],
    client,
  );
}

export async function getRevenueAgentWorkspace(
  businessId: string,
): Promise<RevenueAgentWorkspaceResponse> {
  return buildWorkspaceResponse(businessId);
}

export async function getRevenueAgentProspectExportHtml(
  businessId: string,
  prospectId: string,
): Promise<string> {
  const workspace = await getRevenueAgentWorkspace(businessId);
  const prospect = workspace.prospects.find((item) => item.id === prospectId);

  if (!prospect) {
    throw new HttpError(404, "prospect_not_found", "Prospect not found.");
  }

  return buildRevenueAgentProspectExportHtml(prospect);
}

export async function getRevenueAgentProspectWorkflow(
  businessId: string,
  prospectId: string,
): Promise<RevenueAgentWorkflowResponse> {
  const business = await getBusinessRow(businessId);
  const workspace = await getRevenueAgentWorkspace(businessId);
  const prospect = workspace.prospects.find((item) => item.id === prospectId);

  if (!prospect) {
    throw new HttpError(404, "prospect_not_found", "Prospect not found.");
  }

  return {
    businessId,
    prospectId,
    workflow: buildRevenueAgentWorkflowSnapshot(prospect, business.timezone),
    generatedAt: new Date().toISOString(),
  };
}

export async function regenerateRevenueAgentResearch(
  prospectId: string,
  input: { businessId: string },
): Promise<RevenueAgentResearchResponse> {
  return withDbTransaction(async (client) => {
    const prospect = await loadProspectForUpdate(prospectId, client);
    requireBusinessOwnership(prospect, input.businessId);

    const latestResearchRow = await loadLatestResearchForProspect(prospectId, client);
    const latestResearch = latestResearchRow ? mapResearch(latestResearchRow) : undefined;

    const research = await generateProspectResearch({
      businessName: prospect.business_name,
      website: prospect.website ?? undefined,
      email: prospect.email ?? undefined,
      phone: prospect.phone ?? undefined,
      city: prospect.city ?? undefined,
      state: prospect.state ?? undefined,
      industry: prospect.industry,
      source: prospect.source,
      sourceUrl: prospect.source_url ?? undefined,
      rating: prospect.rating === null ? undefined : toNumber(prospect.rating),
      reviewCount: toNumber(prospect.review_count),
      painSignals: [
        prospect.pain_summary,
        ...(latestResearch?.report.painPoints ?? []),
        ...(latestResearch?.report.automationOpportunities ?? []),
      ].filter((signal): signal is string => Boolean(signal && signal.trim().length > 0)),
      offer: latestResearch?.suggestedOfferAngle || prospect.suggested_offer_angle || "AI booking + follow-up automation",
    });

    const persistedResearch = await upsertProspectResearchForSnapshot(
      prospect,
      research,
      latestResearchRow?.agent_run_id ?? null,
      client,
    );

    await recordRevenueAgentTimelineEvent(
      prospect.business_id,
      prospect.id,
      "research_generated",
      "Research completed",
      `Opportunity score ${research.opportunityScore}/100.`,
      {
        report: research.report,
        regenerated: true,
      },
      new Date().toISOString(),
      null,
      client,
    );

    const updatedProspect = await updateProspectStatus(
      prospect.id,
      {
        status: prospect.status === "new" ? "researched" : prospect.status,
        pain_summary: research.painSummary,
        suggested_offer_angle: research.suggestedOfferAngle,
        opportunity_score: research.opportunityScore,
        opportunityTags: research.opportunityTags,
        leadSourceId: prospect.lead_source_id,
      },
      client,
    );

    return {
      prospect: mapProspect(updatedProspect, {
        research: mapResearch(persistedResearch),
      }),
      research: mapResearch(persistedResearch),
    };
  });
}

export async function analyzeRevenueAgentReply(
  prospectId: string,
  input: RevenueAgentReplyAnalysisRequest,
): Promise<RevenueAgentReplyAnalysisResponse> {
  return withDbTransaction(async (client) => {
    const prospect = await loadProspectForUpdate(prospectId, client);
    requireBusinessOwnership(prospect, input.businessId);

    const latestResearch = await loadLatestResearchForProspect(prospectId, client);
    const latestResearchReport = latestResearch ? mapResearch(latestResearch).report : undefined;
    const analysis = buildReplyResponse(prospect, input.replyText, latestResearchReport);
    const now = new Date().toISOString();

    const updatedProspect = await updateProspectStatus(
      prospect.id,
      {
        status:
          analysis.intent === "meeting_request"
            ? "meeting_booked"
            : analysis.intent === "not_interested"
              ? "not_interested"
              : "replied",
        repliedAt: now,
        meetingBookedAt: analysis.intent === "meeting_request" ? now : prospect.meeting_booked_at ? toIsoString(prospect.meeting_booked_at) : undefined,
        nextFollowUpAt:
          analysis.intent === "not_now" && analysis.suggestedFollowUpDays
            ? new Date(Date.now() + analysis.suggestedFollowUpDays * 24 * 60 * 60 * 1000).toISOString()
            : analysis.intent === "meeting_request" || analysis.intent === "not_interested"
              ? null
              : prospect.next_follow_up_at
                ? toIsoString(prospect.next_follow_up_at)
                : undefined,
        unsubscribedAt: analysis.intent === "not_interested" ? now : prospect.unsubscribed_at ? toIsoString(prospect.unsubscribed_at) : undefined,
        opportunityTags: latestResearch?.opportunityTags,
        clearNextFollowUp: analysis.intent === "meeting_request" || analysis.intent === "not_interested",
      },
      client,
    );

    await recordRevenueAgentTimelineEvent(
      prospect.business_id,
      prospect.id,
      "reply_received",
      "Lead replied",
      input.replyText.slice(0, 240),
      {
        replyText: input.replyText,
      },
      now,
      null,
      client,
    );

    await recordRevenueAgentTimelineEvent(
      prospect.business_id,
      prospect.id,
      "reply_analyzed",
      "Reply analyzed",
      `${analysis.intent.replaceAll("_", " ")} · ${Math.round(analysis.confidence)}% confidence.`,
      {
        analysis,
      },
      now,
      null,
      client,
    );

    if (analysis.meetingBrief) {
      await executeQuery(
        `
          insert into revenue_agent_tasks (
            business_id,
            prospect_id,
            run_id,
            task_type,
            status,
            due_at,
            payload_json
          ) values (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            'meeting_prep',
            'open',
            now(),
            $4::jsonb
          )
          on conflict do nothing
        `,
        [
          input.businessId,
          prospect.id,
          latestResearch?.agent_run_id ?? null,
          JSON.stringify({
            replyText: input.replyText,
            analysis,
            meetingBrief: analysis.meetingBrief,
          }),
        ],
        client,
      );

      await recordRevenueAgentTimelineEvent(
        prospect.business_id,
        prospect.id,
        "meeting_prep_created",
        "Meeting prep created",
        analysis.meetingBrief.objective,
        {
          meetingBrief: analysis.meetingBrief,
        },
        now,
        null,
        client,
      );
    }

    await executeQuery(
      `
        update revenue_agent_tasks
        set status = 'done', completed_at = coalesce(completed_at, now()), updated_at = now()
        where prospect_id = $1::uuid
          and status = 'open'
      `,
      [prospect.id],
      client,
    );

    return {
      prospect: mapProspect(updatedProspect, {
        research: latestResearch ? mapResearch(latestResearch) : undefined,
      }),
      analysis,
    };
  });
}

export async function runRevenueAgentFeed(
  input: RevenueAgentFeedRequest,
): Promise<RevenueAgentFeedResponse> {
  const provider = resolveLeadSourceProvider(input.provider);
  const sourceProvider = resolveLeadSourceProviderInstance(provider);
  const businessId = input.businessId;
  const feedConfig: RevenueAgentFeedConfig = {
    industry: input.industry.trim(),
    city: input.city.trim(),
    state: input.state.trim(),
    offer: input.offer.trim(),
    dailyLeadLimit: Math.max(1, Math.min(25, Math.floor(input.dailyLeadLimit || 20))),
    provider,
    csvText: typeof input.csvText === "string" ? input.csvText : undefined,
  };
  const leadSourceQueryJson = buildLeadSourceQueryJson(feedConfig, provider);

  const run = await withDbTransaction(async (client) => {
    const leadSource = await getLeadSourceOrCreate(businessId, provider, leadSourceQueryJson, client);
    const leadResult = await sourceProvider.search({
      industry: feedConfig.industry,
      city: feedConfig.city,
      state: feedConfig.state,
      limit: feedConfig.dailyLeadLimit,
      csvText: feedConfig.csvText,
    });
    const enrichedLeads = await Promise.all(leadResult.map((lead) => sourceProvider.enrich(lead)));

    const insertedRun = await executeQuery<RunRow>(
      `
        insert into revenue_agent_agent_runs (
          business_id,
          lead_source_id,
          status,
          industry,
          city,
          state,
          offer,
          daily_lead_limit,
          provider,
          prospects_found,
          prospects_saved,
          drafts_generated,
          emails_sent,
          input_json,
          output_json,
          started_at
        ) values (
          $1::uuid,
          $2::uuid,
          'running',
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          0,
          0,
          0,
          0,
          $9::jsonb,
          '{}'::jsonb,
          now()
        )
        returning
          id,
          business_id,
          lead_source_id,
          status,
          industry,
          city,
          state,
          offer,
          daily_lead_limit,
          provider,
          prospects_found,
          prospects_saved,
          drafts_generated,
          emails_sent,
          error_message,
          input_json,
          output_json,
          started_at,
          finished_at,
          created_at,
          updated_at
      `,
      [
        businessId,
        leadSource.id,
        feedConfig.industry,
        feedConfig.city,
        feedConfig.state,
        feedConfig.offer,
        feedConfig.dailyLeadLimit,
        provider,
        JSON.stringify(feedConfig),
      ],
      client,
    );

    const runRow = insertedRun.rows[0];
    let savedCount = 0;
    let draftsCount = 0;

    for (const lead of enrichedLeads) {
      const research = await generateProspectResearch({
        businessName: lead.businessName,
        website: lead.website,
        email: lead.email,
        phone: lead.phone,
        city: lead.city ?? "",
        state: lead.state ?? "",
        industry: lead.industry,
        source: lead.source,
        sourceUrl: lead.sourceUrl,
        rating: lead.rating,
        reviewCount: lead.reviewCount,
        painSignals: lead.painSignals,
        offer: feedConfig.offer,
      });

      const { prospect, research: persistedResearch, isNewProspect } = await upsertProspectAndResearch(
        businessId,
        leadSource,
        lead,
        research,
        runRow.id,
        client,
      );

      savedCount += 1;
      draftsCount += 1;

      if (isNewProspect) {
        await recordRevenueAgentTimelineEvent(
          businessId,
          prospect.id,
          "lead_discovered",
          "Lead discovered",
          `${lead.businessName} added from ${lead.source}.`,
          {
            lead: {
              businessName: lead.businessName,
              website: lead.website,
              email: lead.email,
              phone: lead.phone,
              city: lead.city,
              state: lead.state,
              industry: lead.industry,
              source: lead.source,
              sourceUrl: lead.sourceUrl,
              rating: lead.rating,
              reviewCount: lead.reviewCount,
            },
          },
          new Date().toISOString(),
          null,
          client,
        );
      }

      await recordRevenueAgentTimelineEvent(
        businessId,
        prospect.id,
        "research_generated",
        "Research completed",
        `Opportunity score ${research.opportunityScore}/100.`,
        {
          report: research.report,
          lead: {
            businessName: lead.businessName,
            website: lead.website,
            email: lead.email,
            phone: lead.phone,
            city: lead.city,
            state: lead.state,
            industry: lead.industry,
            source: lead.source,
            sourceUrl: lead.sourceUrl,
            rating: lead.rating,
            reviewCount: lead.reviewCount,
          },
        },
        new Date().toISOString(),
        null,
        client,
      );

      const draftMessage = await createDraftMessage(prospect, persistedResearch, runRow.id, client);
      await recordRevenueAgentTimelineEvent(
        businessId,
        prospect.id,
        "draft_created",
        "Email draft created",
        draftMessage.subject,
        {
          subject: draftMessage.subject,
          body: draftMessage.body,
        },
        new Date().toISOString(),
        draftMessage.id,
        client,
      );
      await updateProspectStatus(
        prospect.id,
        {
          status: ["new", "researched"].includes(prospect.status) ? "drafted" : prospect.status,
          opportunityTags: research.opportunityTags,
        },
        client,
      );
      await executeQuery(
        `
          insert into revenue_agent_tasks (
            business_id,
            prospect_id,
            run_id,
            task_type,
            status,
            due_at,
            payload_json
          ) values (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            'approve_draft',
            'open',
            now(),
            $4::jsonb
          )
        `,
        [
          businessId,
          prospect.id,
          runRow.id,
          JSON.stringify({
            type: "approve_draft",
            businessName: prospect.business_name,
          }),
        ],
        client,
      );
    }

    await executeQuery(
      `
        update lead_sources
        set last_fetched_at = now(),
            updated_at = now()
        where id = $1::uuid
      `,
      [leadSource.id],
      client,
    );

    const finalRunResult = await executeQuery<RunRow>(
      `
        update revenue_agent_agent_runs
        set
          status = 'completed',
          prospects_found = $2::int,
          prospects_saved = $3::int,
          drafts_generated = $4::int,
          emails_sent = 0,
          output_json = $5::jsonb,
          finished_at = now(),
          updated_at = now()
        where id = $1::uuid
        returning
          id,
          business_id,
          lead_source_id,
          status,
          industry,
          city,
          state,
          offer,
          daily_lead_limit,
          provider,
          prospects_found,
          prospects_saved,
          drafts_generated,
          emails_sent,
          error_message,
          input_json,
          output_json,
          started_at,
          finished_at,
          created_at,
          updated_at
      `,
      [
        runRow.id,
        enrichedLeads.length,
        savedCount,
        draftsCount,
        JSON.stringify({
          provider,
          leadsProcessed: enrichedLeads.length,
        }),
      ],
      client,
    );

    return finalRunResult.rows[0];
  });

  return {
    run: mapRun(run),
    workspace: await getRevenueAgentWorkspace(businessId),
  };
}

function requireBusinessOwnership(prospect: ProspectRow, businessId: string): void {
  if (prospect.business_id !== businessId) {
    throw new HttpError(403, "prospect_business_mismatch", "Prospect does not belong to this workspace.");
  }
}

export async function performRevenueAgentAction(
  prospectId: string,
  input: RevenueAgentActionRequest,
): Promise<RevenueAgentActionResponse> {
  const result = await withDbTransaction(async (client) => {
    const prospect = await loadProspectForUpdate(prospectId, client);
    requireBusinessOwnership(prospect, input.businessId);

    const latestResearch = await loadLatestResearchForProspect(prospectId, client);
    const latestMessage = await loadLatestMessageForProspect(prospectId, client);
    const business = await getBusinessRow(input.businessId, client);
    const now = new Date().toISOString();

    if (input.action === "approve_draft") {
      if (!latestMessage) {
        throw new HttpError(400, "revenue_agent_missing_draft", "No draft is available to approve.");
      }

      const messageResult = await executeQuery<OutreachMessageRow>(
        `
          update revenue_agent_outreach_messages
          set
            status = case when status = 'sent' then status else 'approved' end,
            approved_at = coalesce(approved_at, now()),
            updated_at = now()
          where id = $1::uuid
          returning
            id,
            business_id,
            prospect_id,
            research_id,
            agent_run_id,
            type,
            author,
            subject,
            body,
            status,
            approved_at,
            sent_at,
            provider_message_id,
            created_at,
            updated_at
        `,
        [latestMessage.id],
        client,
      );

      const updatedProspect = await updateProspectStatus(
        prospect.id,
        {
          status: "approved",
          approvedAt: now,
          opportunityTags: latestResearch?.opportunityTags,
        },
        client,
      );

      await recordRevenueAgentTimelineEvent(
        prospect.business_id,
        prospect.id,
        "draft_approved",
        "Draft approved",
        latestMessage.subject,
        {
          subject: latestMessage.subject,
          body: latestMessage.body,
        },
        now,
        latestMessage.id,
        client,
      );

      await executeQuery(
        `
          update revenue_agent_tasks
          set
            status = 'done',
            completed_at = coalesce(completed_at, now()),
            updated_at = now()
          where prospect_id = $1::uuid
            and task_type = 'approve_draft'
            and status = 'open'
        `,
        [prospect.id],
        client,
      );

      return {
        prospect: mapProspect(updatedProspect, {
          research: latestResearch ? mapResearch(latestResearch) : undefined,
          latestMessage: mapMessage(messageResult.rows[0]),
        }),
        message: mapMessage(messageResult.rows[0]),
      };
    }

    if (input.action === "send_email") {
      if (!latestMessage) {
        throw new HttpError(400, "revenue_agent_missing_draft", "Approve a draft before sending.");
      }

      if (latestMessage.status !== "approved") {
        throw new HttpError(400, "revenue_agent_send_requires_approval", "Approve the draft before sending.");
      }

      if (!prospect.email) {
        throw new HttpError(400, "revenue_agent_missing_email", "This prospect does not have an email address.");
      }

      if (prospect.status === "not_interested") {
        throw new HttpError(400, "revenue_agent_blocked", "This prospect is marked not interested.");
      }

      await ensureEmailContact(input.businessId, prospect.email, prospect, client);
      await incrementBusinessDailyUsage(input.businessId, "emails", 1);

      const fromEmailRow = await executeQuery<{ from_email: string | null; reply_to_email: string | null }>(
        `
          select from_email, reply_to_email
          from business_email_settings
          where business_id = $1::uuid
          limit 1
        `,
        [input.businessId],
        client,
      );
      const fromEmail = fromEmailRow.rows[0]?.from_email?.trim() || process.env.SYSTEM_FROM_EMAIL?.trim() || "hello@foundercontent.ai";
      const replyToEmail = fromEmailRow.rows[0]?.reply_to_email?.trim() || fromEmail;
      const sent = await sendPlatformEmail({
        fromEmail,
        replyToEmail,
        fromName: business.brand_name || business.name,
        toEmail: prospect.email,
        subject: latestMessage.subject,
        htmlBody: buildMessageHtml(latestMessage.body),
        textBody: buildMessageText(latestMessage.body),
        tags: {
          feature: "revenue_agent",
          business_id: input.businessId,
          prospect_id: prospect.id,
        },
      });

      const updatedMessageResult = await executeQuery<OutreachMessageRow>(
        `
          update revenue_agent_outreach_messages
          set
            status = 'sent',
            sent_at = coalesce(sent_at, now()),
            provider_message_id = coalesce(provider_message_id, $2),
            updated_at = now()
          where id = $1::uuid
          returning
            id,
            business_id,
            prospect_id,
            research_id,
            agent_run_id,
            type,
            author,
            subject,
            body,
            status,
            approved_at,
            sent_at,
            provider_message_id,
            created_at,
            updated_at
        `,
        [latestMessage.id, sent.messageId],
        client,
      );

      const nextFollowUpAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const updatedProspect = await updateProspectStatus(
        prospect.id,
        {
          status: "sent",
          lastContactedAt: now,
          sentAt: now,
          nextFollowUpAt,
          pain_summary: latestResearch?.pain_summary ?? prospect.pain_summary,
          suggested_offer_angle: latestResearch?.suggested_offer_angle ?? prospect.suggested_offer_angle,
          opportunity_score: latestResearch ? toNumber(latestResearch.opportunity_score) : prospect.opportunity_score,
          opportunityTags: latestResearch?.opportunityTags,
        },
        client,
      );

      await createFollowUpTasks(prospect.id, input.businessId, latestMessage.agent_run_id, client);
      await recordRevenueAgentTimelineEvent(
        input.businessId,
        prospect.id,
        "sent",
        "Email sent",
        `Sent to ${prospect.email}`,
        {
          messageId: sent.messageId,
          provider: sent.provider,
          subject: latestMessage.subject,
        },
        now,
        latestMessage.id,
        client,
      );
      await recordRevenueAgentTimelineEvent(
        input.businessId,
        prospect.id,
        "follow_up_scheduled",
        "Follow-up scheduled",
        `Next follow-up set for ${new Date(nextFollowUpAt).toLocaleDateString("en-US")}.`,
        {
          dueAt: nextFollowUpAt,
          days: 3,
          messageId: latestMessage.id,
        },
        now,
        latestMessage.id,
        client,
      );

      return {
        prospect: mapProspect(updatedProspect, {
          research: latestResearch ? mapResearch(latestResearch) : undefined,
          latestMessage: mapMessage(updatedMessageResult.rows[0]),
        }),
        message: mapMessage(updatedMessageResult.rows[0]),
      };
    }

    if (input.action === "send_proposal") {
      if (!prospect.email) {
        throw new HttpError(400, "revenue_agent_missing_email", "This prospect does not have an email address.");
      }

      await ensureEmailContact(input.businessId, prospect.email, prospect, client);
      await incrementBusinessDailyUsage(input.businessId, "emails", 1);

      const workspace = await buildWorkspaceResponse(input.businessId, client);
      const workspaceProspect =
        workspace.prospects.find((item) => item.id === prospect.id) ??
        mapProspect(prospect, {
          research: latestResearch ? mapResearch(latestResearch) : undefined,
          latestMessage: latestMessage ? mapMessage(latestMessage) : undefined,
        });
      const workflow = buildRevenueAgentWorkflowSnapshot(workspaceProspect, business.timezone);
      const proposalContent = buildProposalEmailContent(workspaceProspect, workflow, business);
      const fromEmailRow = await executeQuery<{ from_email: string | null; reply_to_email: string | null }>(
        `
          select from_email, reply_to_email
          from business_email_settings
          where business_id = $1::uuid
          limit 1
        `,
        [input.businessId],
        client,
      );
      const fromEmail = fromEmailRow.rows[0]?.from_email?.trim() || process.env.SYSTEM_FROM_EMAIL?.trim() || "hello@foundercontent.ai";
      const replyToEmail = fromEmailRow.rows[0]?.reply_to_email?.trim() || fromEmail;
      const sent = await sendPlatformEmail({
        fromEmail,
        replyToEmail,
        fromName: business.brand_name || business.name,
        toEmail: prospect.email,
        subject: proposalContent.subject,
        htmlBody: proposalContent.htmlBody,
        textBody: proposalContent.textBody,
        tags: {
          feature: "revenue_agent",
          business_id: input.businessId,
          prospect_id: prospect.id,
          proposal: "true",
        },
      });

      const proposalMessageResult = await executeQuery<OutreachMessageRow>(
        `
          insert into revenue_agent_outreach_messages (
            business_id,
            prospect_id,
            research_id,
            agent_run_id,
            type,
            author,
            subject,
            body,
            status,
            sent_at,
            provider_message_id
          ) values (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4::uuid,
            'value',
            'ai',
            $5,
            $6,
            'sent',
            now(),
            $7
          )
          returning
            id,
            business_id,
            prospect_id,
            research_id,
            agent_run_id,
            type,
            author,
            subject,
            body,
            status,
            approved_at,
            sent_at,
            provider_message_id,
            created_at,
            updated_at
        `,
        [
          input.businessId,
          prospect.id,
          latestResearch?.id ?? null,
          latestResearch?.agent_run_id ?? latestMessage?.agent_run_id ?? null,
          proposalContent.subject,
          proposalContent.textBody,
          sent.messageId,
        ],
        client,
      );

      const nextFollowUpAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
      const updatedProspect = await updateProspectStatus(
        prospect.id,
        {
          status: prospect.status,
          lastContactedAt: now,
          sentAt: now,
          nextFollowUpAt,
          pain_summary: latestResearch?.pain_summary ?? prospect.pain_summary,
          suggested_offer_angle: latestResearch?.suggested_offer_angle ?? prospect.suggested_offer_angle,
          opportunity_score: latestResearch ? toNumber(latestResearch.opportunity_score) : prospect.opportunity_score,
          opportunityTags: latestResearch?.opportunityTags,
        },
        client,
      );

      await recordRevenueAgentTimelineEvent(
        input.businessId,
        prospect.id,
        "sent",
        "Proposal sent",
        `Sent proposal to ${prospect.email}.`,
        {
          messageId: sent.messageId,
          provider: sent.provider,
          subject: proposalContent.subject,
          proposal: workflow.proposalDraft,
          calendarSuggestion: workflow.calendarSuggestion,
        },
        now,
        proposalMessageResult.rows[0].id,
        client,
      );
      await recordRevenueAgentTimelineEvent(
        input.businessId,
        prospect.id,
        "follow_up_scheduled",
        "Proposal follow-up scheduled",
        `Next follow-up set for ${new Date(nextFollowUpAt).toLocaleDateString("en-US")}.`,
        {
          dueAt: nextFollowUpAt,
          days: 5,
          messageId: proposalMessageResult.rows[0].id,
        },
        now,
        proposalMessageResult.rows[0].id,
        client,
      );

      return {
        prospect: mapProspect(updatedProspect, {
          research: latestResearch ? mapResearch(latestResearch) : undefined,
          latestMessage: mapMessage(proposalMessageResult.rows[0]),
        }),
        message: mapMessage(proposalMessageResult.rows[0]),
      };
    }

    if (input.action === "schedule_follow_up") {
      if (!latestResearch && !latestMessage) {
        throw new HttpError(400, "revenue_agent_no_context", "Create a draft before scheduling a follow-up.");
      }

      const days = Math.max(1, Math.min(30, Math.floor(input.followUpDays || 3)));
      const nextFollowUpAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const updatedProspect = await updateProspectStatus(
        prospect.id,
        {
          status: "follow_up_due",
          nextFollowUpAt,
          pain_summary: latestResearch?.pain_summary ?? prospect.pain_summary,
          suggested_offer_angle: latestResearch?.suggested_offer_angle ?? prospect.suggested_offer_angle,
          opportunity_score: latestResearch ? toNumber(latestResearch.opportunity_score) : prospect.opportunity_score,
          opportunityTags: latestResearch?.opportunityTags,
        },
        client,
      );

      const taskResult = await executeQuery<TaskRow>(
        `
          insert into revenue_agent_tasks (
            business_id,
            prospect_id,
            message_id,
            run_id,
            task_type,
            status,
            due_at,
            payload_json
          ) values (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4::uuid,
            'follow_up',
            'open',
            $5::timestamptz,
            $6::jsonb
          )
          returning
            id,
            business_id,
            prospect_id,
            message_id,
            run_id,
            task_type,
            status,
            due_at,
            completed_at,
            payload_json,
            created_at,
            updated_at
        `,
        [
          input.businessId,
          prospect.id,
          latestMessage?.id ?? null,
          latestMessage?.agent_run_id ?? null,
          nextFollowUpAt,
          JSON.stringify({ days }),
        ],
        client,
      );

      await recordRevenueAgentTimelineEvent(
        input.businessId,
        prospect.id,
        "follow_up_scheduled",
        "Follow-up scheduled",
        `Next follow-up set for ${new Date(nextFollowUpAt).toLocaleDateString("en-US")}.`,
        {
          dueAt: nextFollowUpAt,
          days,
          messageId: latestMessage?.id,
        },
        now,
        latestMessage?.id ?? null,
        client,
      );

      return {
        prospect: mapProspect(updatedProspect, {
          research: latestResearch ? mapResearch(latestResearch) : undefined,
          latestMessage: latestMessage ? mapMessage(latestMessage) : undefined,
          tasks: [mapTask(taskResult.rows[0])],
        }),
        task: mapTask(taskResult.rows[0]),
      };
    }

    if (input.action === "mark_not_interested") {
      const updatedProspect = await updateProspectStatus(
        prospect.id,
        {
          status: "not_interested",
          unsubscribedAt: now,
          nextFollowUpAt: null,
          opportunityTags: latestResearch?.opportunityTags,
          clearNextFollowUp: true,
        },
        client,
      );

      await executeQuery(
        `
          update revenue_agent_tasks
          set status = 'skipped', updated_at = now()
          where prospect_id = $1::uuid
            and status = 'open'
        `,
        [prospect.id],
        client,
      );

      await recordRevenueAgentTimelineEvent(
        prospect.business_id,
        prospect.id,
        "not_interested",
        "Marked not interested",
        "Prospect was closed out.",
        {
          reason: "manual update",
        },
        now,
        latestMessage?.id ?? null,
        client,
      );

      return {
        prospect: mapProspect(updatedProspect, {
          research: latestResearch ? mapResearch(latestResearch) : undefined,
          latestMessage: latestMessage ? mapMessage(latestMessage) : undefined,
        }),
      };
    }

    if (input.action === "book_meeting" || input.action === "mark_meeting_booked") {
      const workspace = await buildWorkspaceResponse(input.businessId, client);
      const workspaceProspect =
        workspace.prospects.find((item) => item.id === prospect.id) ??
        mapProspect(prospect, {
          research: latestResearch ? mapResearch(latestResearch) : undefined,
          latestMessage: latestMessage ? mapMessage(latestMessage) : undefined,
        });
      const workflow = buildRevenueAgentWorkflowSnapshot(
        workspaceProspect,
        business.timezone,
      );

      if (input.action === "book_meeting" && !workflow.calendarSuggestion) {
        throw new HttpError(400, "revenue_agent_missing_calendar_suggestion", "No calendar suggestion is available.");
      }

      let confirmationMessageResult: Pick<QueryResult<OutreachMessageRow>, "rows"> | undefined;
      let confirmationSent: { messageId: string; provider: string; subject: string } | undefined;

      if (input.action === "book_meeting" && prospect.email) {
        await ensureEmailContact(input.businessId, prospect.email, prospect, client);
        await incrementBusinessDailyUsage(input.businessId, "emails", 1);

        const confirmationContent = buildMeetingConfirmationContent(workspaceProspect, workflow, business);
        const fromEmailRow = await executeQuery<{ from_email: string | null; reply_to_email: string | null }>(
          `
            select from_email, reply_to_email
            from business_email_settings
            where business_id = $1::uuid
            limit 1
          `,
          [input.businessId],
          client,
        );
        const fromEmail =
          fromEmailRow.rows[0]?.from_email?.trim() || process.env.SYSTEM_FROM_EMAIL?.trim() || "hello@foundercontent.ai";
        const replyToEmail = fromEmailRow.rows[0]?.reply_to_email?.trim() || fromEmail;
        const sent = await sendPlatformEmail({
          fromEmail,
          replyToEmail,
          fromName: business.brand_name || business.name,
          toEmail: prospect.email,
          subject: confirmationContent.subject,
          htmlBody: confirmationContent.htmlBody,
          textBody: confirmationContent.textBody,
          tags: {
            feature: "revenue_agent",
            business_id: input.businessId,
            prospect_id: prospect.id,
            meeting: "true",
          },
        });

        confirmationSent = {
          messageId: sent.messageId,
          provider: sent.provider,
          subject: confirmationContent.subject,
        };
        confirmationMessageResult = await executeQuery<OutreachMessageRow>(
          `
            insert into revenue_agent_outreach_messages (
              business_id,
              prospect_id,
              research_id,
              agent_run_id,
              type,
              author,
              subject,
              body,
              status,
              sent_at,
              provider_message_id
            ) values (
              $1::uuid,
              $2::uuid,
              $3::uuid,
              $4::uuid,
              'value',
              'ai',
              $5,
              $6,
              'sent',
              now(),
              $7
            )
            returning
              id,
              business_id,
              prospect_id,
              research_id,
              agent_run_id,
              type,
              author,
              subject,
              body,
              status,
              approved_at,
              sent_at,
              provider_message_id,
              created_at,
              updated_at
          `,
          [
            input.businessId,
            prospect.id,
            latestResearch?.id ?? null,
            latestResearch?.agent_run_id ?? latestMessage?.agent_run_id ?? null,
            confirmationContent.subject,
            confirmationContent.textBody,
            sent.messageId,
          ],
          client,
        );
      }

      const calendarSuggestion =
        workflow.calendarSuggestion ??
        ({
          timezone: business.timezone,
          suggestedTimes: [],
          suggestedSlots: [],
          meetingDurationMinutes: 0,
          inviteDraft: "",
        } as NonNullable<RevenueAgentWorkflow["calendarSuggestion"]>);

      const calendarEventResult = await createGoogleCalendarMeetingEvent(
        {
          businessId: input.businessId,
          businessName: business.name,
          businessBrandName: business.brand_name || business.name,
          prospect: {
            businessName: workspaceProspect.businessName,
            email: workspaceProspect.email,
            city: workspaceProspect.city,
            state: workspaceProspect.state,
            source: workspaceProspect.source,
            sourceUrl: workspaceProspect.sourceUrl,
          },
          workflow,
          calendarSuggestion,
          meetingBrief: workflow.meetingBrief,
        },
        client,
      );

      let meetingPrepTaskResult: Pick<QueryResult<TaskRow>, "rows"> | undefined;
      const existingMeetingPrep = await executeQuery<{ id: string }>(
        `
          select id
          from revenue_agent_tasks
          where prospect_id = $1::uuid
            and task_type = 'meeting_prep'
            and status = 'open'
          limit 1
        `,
        [prospect.id],
        client,
      );

      if (!existingMeetingPrep.rows[0]) {
        meetingPrepTaskResult = await executeQuery<TaskRow>(
          `
            insert into revenue_agent_tasks (
              business_id,
              prospect_id,
              message_id,
              run_id,
              task_type,
              status,
              due_at,
              payload_json
            ) values (
              $1::uuid,
              $2::uuid,
              $3::uuid,
              $4::uuid,
              'meeting_prep',
              'open',
              now(),
              $5::jsonb
            )
            returning
              id,
              business_id,
              prospect_id,
              message_id,
              run_id,
              task_type,
              status,
              due_at,
              completed_at,
              payload_json,
              created_at,
              updated_at
          `,
          [
            input.businessId,
            prospect.id,
            confirmationMessageResult?.rows[0]?.id ?? latestMessage?.id ?? null,
            latestResearch?.agent_run_id ?? latestMessage?.agent_run_id ?? null,
            JSON.stringify({
              meetingBrief: workflow.meetingBrief,
              calendarSuggestion: workflow.calendarSuggestion,
              calendarEvent: calendarEventResult,
              confirmationMessageId: confirmationMessageResult?.rows[0]?.id ?? null,
              confirmedSlot:
                workflow.calendarSuggestion?.suggestedSlots?.[0]?.label ??
                workflow.calendarSuggestion?.suggestedTimes?.[0] ??
                null,
              manual: input.action === "mark_meeting_booked",
            }),
          ],
          client,
        );
      }

      const updatedProspect = await updateProspectStatus(
        prospect.id,
        {
          status: "meeting_booked",
          lastContactedAt: input.action === "book_meeting" ? now : undefined,
          meetingBookedAt: now,
          nextFollowUpAt: null,
          opportunityTags: latestResearch?.opportunityTags,
          clearNextFollowUp: true,
        },
        client,
      );

      if (confirmationSent) {
        await recordRevenueAgentTimelineEvent(
          prospect.business_id,
          prospect.id,
          "sent",
          "Meeting confirmation sent",
          `Sent meeting confirmation to ${prospect.email}.`,
          {
            messageId: confirmationSent.messageId,
            provider: confirmationSent.provider,
            subject: confirmationSent.subject,
          },
          now,
          confirmationMessageResult?.rows[0]?.id ?? null,
          client,
        );
      }

      await recordRevenueAgentTimelineEvent(
        prospect.business_id,
        prospect.id,
        "meeting_booked",
        "Meeting booked",
        input.action === "book_meeting"
          ? `Booked meeting for ${
              workflow.calendarSuggestion?.suggestedSlots?.[0]?.label ??
              workflow.calendarSuggestion?.suggestedTimes?.[0] ??
              "the first available slot"
            }${calendarEventResult.created ? " and created a Google Calendar event." : "."}`
          : "Manually marked as meeting booked.",
        {
          manual: input.action === "mark_meeting_booked",
          calendarSuggestion: workflow.calendarSuggestion,
          calendarEvent: calendarEventResult,
        },
        now,
        confirmationMessageResult?.rows[0]?.id ?? null,
        client,
      );

      if (meetingPrepTaskResult) {
        await recordRevenueAgentTimelineEvent(
          prospect.business_id,
          prospect.id,
          "meeting_prep_created",
          "Meeting prep created",
          workflow.meetingBrief?.objective || "Prepare for the upcoming meeting.",
          {
            meetingBrief: workflow.meetingBrief,
            taskId: meetingPrepTaskResult.rows[0].id,
          },
          now,
          meetingPrepTaskResult.rows[0].id,
          client,
        );
      }

      return {
        prospect: mapProspect(updatedProspect, {
          research: latestResearch ? mapResearch(latestResearch) : undefined,
          latestMessage: confirmationMessageResult
            ? mapMessage(confirmationMessageResult.rows[0])
            : latestMessage
              ? mapMessage(latestMessage)
              : undefined,
          tasks: meetingPrepTaskResult ? [mapTask(meetingPrepTaskResult.rows[0])] : undefined,
        }),
        message: confirmationMessageResult ? mapMessage(confirmationMessageResult.rows[0]) : undefined,
        task: meetingPrepTaskResult ? mapTask(meetingPrepTaskResult.rows[0]) : undefined,
      };
    }

    if (input.action === "mark_replied") {
      const updatedProspect = await updateProspectStatus(
        prospect.id,
        {
          status: "replied",
          repliedAt: now,
          opportunityTags: latestResearch?.opportunityTags,
          clearNextFollowUp: false,
        },
        client,
      );

      await executeQuery(
        `
          update revenue_agent_tasks
          set status = 'done', completed_at = coalesce(completed_at, now()), updated_at = now()
          where prospect_id = $1::uuid
            and status = 'open'
        `,
        [prospect.id],
        client,
      );

      await recordRevenueAgentTimelineEvent(
        prospect.business_id,
        prospect.id,
        "reply_received",
        "Lead replied",
        "Manually marked as replied.",
        {
          manual: true,
        },
        now,
        latestMessage?.id ?? null,
        client,
      );

      return {
        prospect: mapProspect(updatedProspect, {
          research: latestResearch ? mapResearch(latestResearch) : undefined,
          latestMessage: latestMessage ? mapMessage(latestMessage) : undefined,
        }),
      };
    }

    throw new HttpError(400, "revenue_agent_action_invalid", "Unsupported revenue agent action.");
  });

  return result;
}
