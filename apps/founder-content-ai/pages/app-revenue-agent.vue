<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type {
  BusinessMembership,
  RevenueAgentActionType,
  RevenueAgentFeedConfig,
  RevenueAgentOpportunityReport,
  RevenueAgentProspect,
  RevenueAgentResearch,
  RevenueAgentReplyAnalysis,
  RevenueAgentTimelineEvent,
  RevenueAgentWorkflowResponse,
  RevenueAgentWorkspaceResponse,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import { requestMyBusinesses } from "../services/admin-analytics-service";
import {
  requestDisconnectGoogleCalendar,
  requestGoogleCalendarAuthStart,
  requestRevenueAgentAction,
  requestRevenueAgentFeed,
  requestRevenueAgentReplyAnalysis,
  requestRevenueAgentProspectExport,
  requestRevenueAgentWorkflow,
  requestRevenueAgentResearchRegenerate,
  requestRevenueAgentWorkspace,
} from "../services/revenue-agent-service";
import { appRoutes } from "../utils/routes";

const { bootstrap, activeBusinessId, setActiveBusinessId } = useProductAccessContext();
const route = useRoute();
const CSV_IMPORT_SAMPLE = [
  "businessName,website,email,phone,city,state,industry,sourceUrl,rating,reviewCount,painSignals,tags",
  "Northstar Salon,https://northstarsalon.com,hello@northstarsalon.com,(555) 123-4567,Dallas,TX,Salon,https://maps.google.com/?q=Northstar+Salon+Dallas+TX,4.3,41,\"slow response|missed calls|manual follow-up\",\"salon|local-service\"",
].join("\n");

const businesses = ref<BusinessMembership[]>([]);
const selectedBusinessId = ref("");
const workspace = ref<RevenueAgentWorkspaceResponse | null>(null);
const prospects = ref<RevenueAgentProspect[]>([]);
const selectedProspectId = ref("");
const replyText = ref("");
const replyAnalysis = ref<RevenueAgentReplyAnalysis | null>(null);
const workflowSnapshot = ref<RevenueAgentWorkflowResponse | null>(null);
const isLoading = ref(true);
const isRunningFeed = ref(false);
const isAnalyzingReply = ref(false);
const isLoadingWorkflow = ref(false);
const isExportingReport = ref(false);
const actionLoadingId = ref("");
const errorMessage = ref("");
const feedbackMessage = ref("");

const feedForm = ref<RevenueAgentFeedConfig>({
  industry: "Salon",
  city: "Dallas",
  state: "TX",
  offer: "AI booking + follow-up automation",
  dailyLeadLimit: 20,
  provider: "mock",
  csvText: "",
});

const selectedProspect = computed(
  () => prospects.value.find((prospect) => prospect.id === selectedProspectId.value) ?? null,
);

const selectedResearch = computed(() => selectedProspect.value?.research ?? null);
const selectedReport = computed(() => selectedResearch.value?.report ?? null);
const selectedTimeline = computed(() => selectedProspect.value?.timeline ?? []);
const recentTimelineEvents = computed(() => [...selectedTimeline.value].slice(-4).reverse());
const timelineStats = computed(() => ({
  total: selectedTimeline.value.length,
  replies: selectedTimeline.value.filter((item) => item.type === "reply_received" || item.type === "reply_analyzed").length,
  meetings: selectedTimeline.value.filter((item) => item.type === "meeting_booked" || item.type === "meeting_prep_created").length,
  followUps: selectedTimeline.value.filter((item) => item.type === "follow_up_scheduled").length,
}));
const timelineEventFilter = ref<RevenueAgentTimelineEvent["type"] | "all">("all");
const displayedTimeline = computed(() =>
  timelineEventFilter.value === "all"
    ? selectedTimeline.value
    : selectedTimeline.value.filter((item) => item.type === timelineEventFilter.value),
);
const isGoogleBusinessSelected = computed(() => feedForm.value.provider === "google_business");
const isCsvImportSelected = computed(() => feedForm.value.provider === "csv_import");
const googleCalendarConnection = computed(() => workspace.value?.googleCalendarConnection ?? null);
const isGoogleCalendarConnected = computed(() => googleCalendarConnection.value?.connected === true);
const sourceCoverageRows = computed(() => {
  const coverage = selectedReport.value?.businessProfile.sourceCoverage;
  return [
    { label: "Google Business", coverage: coverage?.googleBusiness },
    { label: "LinkedIn", coverage: coverage?.linkedinCompany },
    { label: "Facebook", coverage: coverage?.facebookPage },
    { label: "Instagram", coverage: coverage?.instagram },
    { label: "Yelp", coverage: coverage?.yelp },
    { label: "BBB", coverage: coverage?.bbb },
    { label: "WHOIS", coverage: coverage?.whois },
    { label: "Tech stack", coverage: coverage?.techStack },
  ];
});

const workspaceName = computed(
  () =>
    businesses.value.find((membership) => membership.businessId === selectedBusinessId.value)?.business.brandName ||
    businesses.value.find((membership) => membership.businessId === selectedBusinessId.value)?.business.name ||
    "Revenue Agent",
);

const stats = computed(() => ({
  newProspects: prospects.value.filter((prospect) => prospect.status === "new").length,
  researched: prospects.value.filter((prospect) =>
    ["researched", "drafted", "approved", "sent", "follow_up_due", "replied", "meeting_booked"].includes(prospect.status),
  ).length,
  draftsReady: prospects.value.filter((prospect) => ["drafted", "approved"].includes(prospect.status)).length,
  followUpsDue: prospects.value.filter((prospect) => prospect.status === "follow_up_due" || Boolean(prospect.nextFollowUpAt)).length,
  replies: prospects.value.filter((prospect) => prospect.status === "replied").length,
  meetings: prospects.value.filter((prospect) => prospect.status === "meeting_booked").length,
}));

function formatScore(score: number): string {
  return `${Math.max(0, Math.min(100, Math.round(score)))} / 100`;
}

function formatHoursRange(minHours: number, maxHours: number): string {
  if (minHours <= 0 && maxHours <= 0) {
    return "Not available";
  }

  return `${minHours} - ${maxHours} hours/week`;
}

function formatCoverageStatus(status: string): string {
  switch (status) {
    case "available":
      return "Available";
    case "partial":
      return "Partial";
    case "missing":
      return "Missing";
    default:
      return "Unknown";
  }
}

function formatNullableScore(score?: number | null): string {
  if (score === null || score === undefined) {
    return "Unknown";
  }

  return formatScore(score);
}

function statusLabel(status: RevenueAgentProspect["status"]): string {
  switch (status) {
    case "new":
      return "New";
    case "researched":
      return "Researched";
    case "drafted":
      return "Draft ready";
    case "approved":
      return "Approved";
    case "sent":
      return "Sent";
    case "replied":
      return "Replied";
    case "follow_up_due":
      return "Follow-up due";
    case "meeting_booked":
      return "Meeting booked";
    case "not_interested":
      return "Not interested";
    case "dead":
      return "Dead";
    default:
      return status;
  }
}

function nextActionLabel(prospect: RevenueAgentProspect): string {
  if (prospect.status === "new") {
    return "Research";
  }

  if (prospect.status === "researched" || prospect.status === "drafted") {
    return "Approve draft";
  }

  if (prospect.status === "approved") {
    return "Send email";
  }

  if (prospect.status === "sent" && prospect.nextFollowUpAt) {
    return "Follow up due soon";
  }

  if (prospect.status === "follow_up_due") {
    return "Schedule follow-up";
  }

  if (prospect.status === "replied") {
    return "Review reply";
  }

  return "Review";
}

function formatFollowUp(value?: string): string {
  if (!value) {
    return "No follow-up scheduled";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTimelineTimestamp(value?: string): string {
  if (!value) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function sanitizeFilenameFragment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimelineTaskLabel(type: string): string {
  switch (type) {
    case "research":
      return "Research";
    case "approve_draft":
      return "Draft approval";
    case "send_email":
      return "Email send";
    case "follow_up":
      return "Follow-up";
    case "value_follow_up":
      return "Value follow-up";
    case "breakup":
      return "Breakup";
    case "meeting_prep":
      return "Meeting prep";
    default:
      return type.replaceAll("_", " ");
  }
}

function formatTimelineEventLabel(type: RevenueAgentTimelineEvent["type"]): string {
  switch (type) {
    case "lead_discovered":
      return "Lead discovered";
    case "research_generated":
      return "Research completed";
    case "draft_created":
      return "Draft created";
    case "draft_approved":
      return "Draft approved";
    case "sent":
      return "Email sent";
    case "reply_received":
      return "Reply received";
    case "reply_analyzed":
      return "Reply analyzed";
    case "meeting_booked":
      return "Meeting booked";
    case "follow_up_scheduled":
      return "Follow-up scheduled";
    case "meeting_prep_created":
      return "Meeting prep created";
    case "not_interested":
      return "Not interested";
    default:
      return String(type).replaceAll("_", " ");
  }
}

function formatWorkflowStepStatus(status: "done" | "active" | "pending" | "blocked"): string {
  switch (status) {
    case "done":
      return "Done";
    case "active":
      return "Active";
    case "blocked":
      return "Blocked";
    default:
      return "Pending";
  }
}

function formatWorkflowStepType(type: string): string {
  switch (type) {
    case "analyze_lead":
      return "Analyze lead";
    case "research_account":
      return "Research account";
    case "draft_outreach":
      return "Draft outreach";
    case "send_outreach":
      return "Send outreach";
    case "classify_reply":
      return "Classify reply";
    case "check_calendar":
      return "Check calendar";
    case "suggest_times":
      return "Suggest times";
    case "draft_confirmation":
      return "Draft confirmation";
    case "generate_meeting_brief":
      return "Generate meeting brief";
    case "generate_proposal":
      return "Generate proposal";
    case "follow_up":
      return "Follow up";
    case "update_pipeline":
      return "Update pipeline";
    default:
      return type.replaceAll("_", " ");
  }
}

function buildProspectTimeline(
  prospect: RevenueAgentProspect | null,
  research: RevenueAgentResearch | null,
  analysis: RevenueAgentReplyAnalysis | null,
): Array<{
  id: string;
  label: string;
  description: string;
  timestamp?: string;
  tone: "done" | "active" | "pending";
}> {
  if (!prospect) {
    return [];
  }

  const items: Array<{
    id: string;
    label: string;
    description: string;
    timestamp?: string;
    tone: "done" | "active" | "pending";
  }> = [];
  const seen = new Set<string>();
  const pushItem = (item: (typeof items)[number]) => {
    if (seen.has(item.id)) {
      return;
    }

    seen.add(item.id);
    items.push(item);
  };

  pushItem({
    id: "discovered",
    label: "Lead discovered",
    description: `${prospect.source} lead added for ${prospect.businessName}.`,
    timestamp: prospect.createdAt,
    tone: "done",
  });

  if (research) {
    pushItem({
      id: "research",
      label: "Research completed",
      description: `${formatScore(research.report.opportunityScore)} report generated with ${research.report.automationOpportunities.length} automation opportunities.`,
      timestamp: research.createdAt,
      tone: "done",
    });
  }

  if (prospect.latestMessage) {
    pushItem({
      id: "draft",
      label: "Email draft created",
      description: prospect.latestMessage.subject || "Generated outreach draft",
      timestamp: prospect.latestMessage.createdAt,
      tone: prospect.latestMessage.status === "draft" ? "active" : "done",
    });
  }

  if (prospect.approvedAt) {
    pushItem({
      id: "approved",
      label: "Draft approved",
      description: "Human approval captured before send.",
      timestamp: prospect.approvedAt,
      tone: "done",
    });
  }

  if (prospect.sentAt) {
    pushItem({
      id: "sent",
      label: "Email sent",
      description: prospect.latestMessage?.subject || "Outbound email logged.",
      timestamp: prospect.sentAt,
      tone: "done",
    });
  }

  if (prospect.repliedAt) {
    pushItem({
      id: "replied",
      label: "Lead replied",
      description: analysis?.summary || "Incoming reply detected and ready for classification.",
      timestamp: prospect.repliedAt,
      tone: analysis ? "active" : "done",
    });
  }

  if (analysis) {
    pushItem({
      id: "reply-analysis",
      label: "Reply analyzed",
      description: `${analysis.intent.replaceAll("_", " ")} · ${Math.round(analysis.confidence)}% confidence.`,
      timestamp: new Date().toISOString(),
      tone: "active",
    });
  }

  if (prospect.meetingBookedAt) {
    pushItem({
      id: "meeting-booked",
      label: "Meeting booked",
      description: "Qualification call is on the calendar.",
      timestamp: prospect.meetingBookedAt,
      tone: "done",
    });
  }

  if (prospect.nextFollowUpAt) {
    const followUpTime = new Date(prospect.nextFollowUpAt).getTime();

    pushItem({
      id: "follow-up",
      label: prospect.status === "follow_up_due" ? "Follow-up due" : "Next follow-up scheduled",
      description: prospect.status === "follow_up_due" ? "Ready for the next touchpoint." : "Follow-up is queued for later.",
      timestamp: prospect.nextFollowUpAt,
      tone: followUpTime <= Date.now() ? "active" : "pending",
    });
  }

  for (const task of [...(prospect.tasks ?? [])].sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime())) {
    pushItem({
      id: `task-${task.id}`,
      label: formatTimelineTaskLabel(task.type),
      description: task.status === "done" ? "Completed task" : task.status === "skipped" ? "Skipped task" : "Open task from the workflow engine.",
      timestamp: task.dueAt,
      tone: task.status === "open" ? "pending" : "done",
    });
  }

  return items.sort((left, right) => {
    const leftTime = left.timestamp ? new Date(left.timestamp).getTime() : Number.POSITIVE_INFINITY;
    const rightTime = right.timestamp ? new Date(right.timestamp).getTime() : Number.POSITIVE_INFINITY;
    return leftTime - rightTime;
  });
}

function buildAuditReportMarkdown(
  prospect: RevenueAgentProspect,
  report: RevenueAgentOpportunityReport | null,
  analysis: RevenueAgentReplyAnalysis | null,
  timeline: RevenueAgentTimelineEvent[],
): string {
  const lines: string[] = [];
  const location = [prospect.city, prospect.state].filter(Boolean).join(", ") || "Unknown";
  const opportunityScore = formatScore(prospect.opportunityScore);

  lines.push(`# ${prospect.businessName} Opportunity Report`);
  lines.push("");
  lines.push(`- Source: ${prospect.source}`);
  lines.push(`- Location: ${location}`);
  lines.push(`- Website: ${prospect.website || "Not available"}`);
  lines.push(`- Contact: ${prospect.email || prospect.phone || "Not available"}`);
  lines.push(`- Opportunity score: ${opportunityScore}`);
  lines.push(`- Generated: ${report?.generatedAt ? formatTimelineTimestamp(report.generatedAt) : "Not available"}`);
  lines.push("");
  lines.push("## Business summary");
  lines.push(report?.businessSummary || prospect.painSummary || "Waiting on research.");
  lines.push("");
  lines.push("## Website summary");
  lines.push(report?.websiteSummary || prospect.suggestedOfferAngle || "No website summary yet.");
  lines.push("");
  lines.push("## Pain points");
  const painPoints = report?.painPoints?.length ? report.painPoints : prospect.painSummary ? [prospect.painSummary] : [];
  for (const item of painPoints) {
    lines.push(`- ${item}`);
  }
  if (painPoints.length === 0) {
    lines.push("- Waiting on research.");
  }
  lines.push("");
  lines.push("## Automation opportunities");
  const automationOpportunities = report?.automationOpportunities?.length
    ? report.automationOpportunities
    : prospect.suggestedOfferAngle
      ? [prospect.suggestedOfferAngle]
      : [];
  for (const item of automationOpportunities) {
    lines.push(`- ${item}`);
  }
  if (automationOpportunities.length === 0) {
    lines.push("- Waiting on research.");
  }
  lines.push("");
  lines.push("## Timeline");
  for (const item of timeline) {
    lines.push(`- ${formatTimelineTimestamp(item.occurredAt)} - ${item.title}: ${item.description}`);
  }
  if (timeline.length === 0) {
    lines.push("- No timeline items yet.");
  }
  lines.push("");
  lines.push("## Generated email");
  lines.push(`Subject: ${prospect.latestMessage?.subject || prospect.research?.emailSubject || "No draft yet."}`);
  lines.push("");
  lines.push("```text");
  lines.push(prospect.latestMessage?.body || prospect.research?.emailBody || "Run the feed to generate the first draft.");
  lines.push("```");
  lines.push("");

  if (analysis) {
    lines.push("## Reply intelligence");
    lines.push(`- Intent: ${analysis.intent.replaceAll("_", " ")}`);
    lines.push(`- Sentiment: ${analysis.sentiment}`);
    lines.push(`- Confidence: ${Math.round(analysis.confidence)}%`);
    lines.push(`- Next step: ${analysis.suggestedNextStep.replaceAll("_", " ")}`);
    lines.push("");
    lines.push("### Suggested reply");
    lines.push("```text");
    lines.push(analysis.suggestedReply);
    lines.push("```");
    lines.push("");
  }

  if (report?.salesStrategy) {
    lines.push("## Sales strategy");
    lines.push(`- Primary pain: ${report.salesStrategy.primaryPain}`);
    lines.push(`- Recommended offer: ${report.salesStrategy.recommendedOffer}`);
    lines.push(`- CTA: ${report.salesStrategy.cta}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function buildAuditReportHtml(
  prospect: RevenueAgentProspect,
  report: RevenueAgentOpportunityReport | null,
  analysis: RevenueAgentReplyAnalysis | null,
  timeline: RevenueAgentTimelineEvent[],
): string {
  const location = [prospect.city, prospect.state].filter(Boolean).join(", ") || "Unknown";
  const painPoints = report?.painPoints?.length ? report.painPoints : prospect.painSummary ? [prospect.painSummary] : [];
  const automationOpportunities = report?.automationOpportunities?.length
    ? report.automationOpportunities
    : prospect.suggestedOfferAngle
      ? [prospect.suggestedOfferAngle]
      : [];
  const score = formatScore(prospect.opportunityScore);
  const formatSectionList = (items: string[], emptyLabel: string): string =>
    items.length
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : `<p class="empty">${escapeHtml(emptyLabel)}</p>`;

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
        --muted: #6b584f;
        --paper: #fffaf5;
        --panel: #ffffff;
        --line: rgba(73, 47, 34, 0.14);
        --accent: #d76634;
        --accent-soft: rgba(215, 102, 52, 0.12);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(215, 102, 52, 0.08), transparent 30%),
          radial-gradient(circle at top right, rgba(139, 92, 46, 0.08), transparent 28%),
          var(--paper);
        color: var(--ink);
      }
      .sheet {
        width: min(1000px, calc(100% - 48px));
        margin: 24px auto;
        padding: 32px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: 0 22px 54px rgba(46, 24, 14, 0.08);
      }
      .header {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: start;
        padding-bottom: 20px;
        border-bottom: 1px solid var(--line);
      }
      .eyebrow {
        margin: 0 0 10px;
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      h1, h2, h3, p { margin-top: 0; }
      h1 {
        margin-bottom: 10px;
        font-size: 2.25rem;
        line-height: 1.04;
      }
      .lede {
        margin: 0;
        max-width: 68ch;
        color: var(--muted);
        line-height: 1.65;
      }
      .score {
        min-width: 210px;
        padding: 18px 20px;
        border: 1px solid var(--line);
        border-radius: 20px;
        background: linear-gradient(180deg, rgba(215, 102, 52, 0.1), rgba(215, 102, 52, 0.04));
      }
      .score strong {
        display: block;
        font-size: 2.2rem;
        line-height: 1;
        margin-bottom: 8px;
      }
      .score p {
        margin: 6px 0 0;
        color: var(--muted);
        line-height: 1.5;
      }
      .meta-grid,
      .two-col,
      .three-col {
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
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .card p,
      .card li {
        color: var(--muted);
        line-height: 1.6;
      }
      .card ul {
        margin: 0;
        padding-left: 18px;
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
        grid-template-columns: 140px minmax(0, 1fr);
        gap: 14px;
        align-items: start;
        padding: 14px 16px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: #fff;
      }
      .timeline-item span {
        color: var(--muted);
        font-size: 0.85rem;
      }
      .timeline-item strong {
        display: block;
        margin-bottom: 4px;
      }
      .timeline-item p {
        margin: 0;
        color: var(--muted);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        background: var(--accent-soft);
        color: #9a3412;
        font-size: 0.8rem;
        font-weight: 700;
      }
      .footer {
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.84rem;
      }
      .empty {
        margin: 0;
        color: var(--muted);
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
          <p class="lede">${escapeHtml(report?.businessSummary || prospect.painSummary || "Waiting on research.")}</p>
        </div>
        <aside class="score">
          <span class="badge">Opportunity score ${escapeHtml(score)}</span>
          <p><strong>${escapeHtml(location)}</strong></p>
          <p>Website: ${escapeHtml(prospect.website || "Not available")}</p>
          <p>Contact: ${escapeHtml(prospect.email || prospect.phone || "Not available")}</p>
        </aside>
      </section>

      <section class="meta-grid">
        <div class="card"><span class="label">Source</span><p>${escapeHtml(prospect.source)}</p></div>
        <div class="card"><span class="label">Website summary</span><p>${escapeHtml(report?.websiteSummary || prospect.suggestedOfferAngle || "No website summary yet.")}</p></div>
        <div class="card"><span class="label">Generated</span><p>${escapeHtml(report?.generatedAt ? formatTimelineTimestamp(report.generatedAt) : "Not available")}</p></div>
        <div class="card"><span class="label">Next step</span><p>${escapeHtml(analysis?.suggestedNextStep?.replaceAll("_", " ") || "Review the audit and send outreach.")}</p></div>
      </section>

      <section class="two-col section">
        <div class="card">
          <span class="label">Pain points</span>
          ${formatSectionList(painPoints, "Waiting on research.")}
        </div>
        <div class="card">
          <span class="label">Automation opportunities</span>
          ${formatSectionList(automationOpportunities, "Waiting on research.")}
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
                <span>${escapeHtml(formatTimelineTimestamp(item.occurredAt))}</span>
              </div>
              <p>${escapeHtml(item.description)}</p>
            </article>`,
            )
            .join("") || `<p class="empty">No timeline items yet.</p>`}
        </div>
      </section>

      <section class="three-col section">
        <div class="card">
          <span class="label">Sales strategy</span>
          <p>${escapeHtml(report?.salesStrategy.primaryPain || "Not enough signal yet.")}</p>
        </div>
        <div class="card">
          <span class="label">Recommended offer</span>
          <p>${escapeHtml(report?.salesStrategy.recommendedOffer || "No offer yet.")}</p>
        </div>
        <div class="card">
          <span class="label">CTA</span>
          <p>${escapeHtml(report?.salesStrategy.cta || "No CTA yet.")}</p>
        </div>
      </section>

      ${analysis ? `
      <section class="section">
        <h2>Reply intelligence</h2>
        <div class="two-col">
          <div class="card">
            <span class="label">Classification</span>
            <p>${escapeHtml(analysis.intent.replaceAll("_", " "))}</p>
            <p>${escapeHtml(analysis.sentiment)} sentiment · ${Math.round(analysis.confidence)}% confidence</p>
          </div>
          <div class="card">
            <span class="label">Suggested response</span>
            <p>${escapeHtml(analysis.suggestedReply)}</p>
          </div>
        </div>
      </section>` : ""}

      <p class="footer">Prepared for ${escapeHtml(prospect.businessName)} by Revenue Agent. Print this page to save it as a PDF.</p>
    </main>
  </body>
</html>`;
}

async function copyAuditReport(): Promise<void> {
  if (!selectedProspect.value) {
    errorMessage.value = "Select a prospect first.";
    return;
  }

  const content = buildAuditReportMarkdown(selectedProspect.value, selectedReport.value, replyAnalysis.value, selectedTimeline.value);

  if (typeof navigator === "undefined" || !navigator.clipboard) {
    errorMessage.value = "Clipboard access is unavailable in this browser.";
    return;
  }

  try {
    await navigator.clipboard.writeText(content);
    feedbackMessage.value = "Audit report copied to clipboard.";
  } catch {
    feedbackMessage.value = "Audit report ready. Clipboard permissions blocked the copy action.";
  }
}

function printAuditReport(): void {
  if (!selectedProspect.value) {
    errorMessage.value = "Select a prospect first.";
    return;
  }

  const content = buildAuditReportHtml(selectedProspect.value, selectedReport.value, replyAnalysis.value, selectedTimeline.value);
  const popup = window.open("", "_blank", "width=1100,height=1300");

  if (!popup) {
    errorMessage.value = "Pop-up blocked the printable report.";
    return;
  }

  popup.document.open();
  popup.document.write(content);
  popup.document.close();
  popup.focus();
  feedbackMessage.value = "Printable audit opened. Use the browser print dialog to save it as PDF.";
  window.setTimeout(() => {
    popup.print();
  }, 250);
}

function downloadAuditReport(): void {
  if (!selectedProspect.value) {
    errorMessage.value = "Select a prospect first.";
    return;
  }

  const content = buildAuditReportMarkdown(selectedProspect.value, selectedReport.value, replyAnalysis.value, selectedTimeline.value);
  const fileName = `${sanitizeFilenameFragment(selectedProspect.value.businessName) || "revenue-agent"}-audit-report.md`;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
  feedbackMessage.value = "Audit report download started.";
}

async function downloadServerExport(): Promise<void> {
  if (!selectedProspect.value) {
    errorMessage.value = "Select a prospect first.";
    return;
  }

  if (!selectedBusinessId.value) {
    errorMessage.value = "Select a workspace first.";
    return;
  }

  isExportingReport.value = true;

  try {
    const content = await requestRevenueAgentProspectExport(selectedProspect.value.id, selectedBusinessId.value);
    const fileName = `${sanitizeFilenameFragment(selectedProspect.value.businessName) || "revenue-agent"}-server-export.html`;
    const blob = new Blob([content], { type: "text/html;charset=utf-8" });
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
    feedbackMessage.value = "Server export download started.";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to export the selected prospect.";
  } finally {
    isExportingReport.value = false;
  }
}

function selectProspect(prospect: RevenueAgentProspect | null, options: { resetReplyDraft?: boolean } = {}): void {
  selectedProspectId.value = prospect?.id ?? "";

  if (options.resetReplyDraft !== false) {
    replyText.value = "";
    replyAnalysis.value = null;
  }

  void loadWorkflowSnapshot();
}

function loadFeedFormFromWorkspace(): void {
  feedForm.value = {
    industry: feedForm.value.industry || "Salon",
    city: feedForm.value.city || "Dallas",
    state: feedForm.value.state || "TX",
    offer: feedForm.value.offer || "AI booking + follow-up automation",
    dailyLeadLimit: feedForm.value.dailyLeadLimit || 20,
    provider: feedForm.value.provider || "mock",
    csvText: feedForm.value.csvText || "",
  };
}

function applyCalendarConnectionFeedback(): void {
  const status = typeof route.query.google_calendar === "string" ? route.query.google_calendar : "";
  const detail = typeof route.query.message === "string" ? route.query.message : "";

  if (!status) {
    return;
  }

  if (status === "connected") {
    feedbackMessage.value = "Google Calendar connected.";
  } else if (status === "disconnected") {
    feedbackMessage.value = "Google Calendar disconnected.";
  } else {
    feedbackMessage.value = detail ? `Google Calendar connection failed: ${detail}.` : "Google Calendar connection failed.";
  }
}

function loadSampleCsv(): void {
  feedForm.value.csvText = CSV_IMPORT_SAMPLE;
  feedForm.value.provider = "csv_import";
}

async function loadBusinesses(): Promise<void> {
  const response = await requestMyBusinesses();
  businesses.value = response.businesses;
  selectedBusinessId.value =
    bootstrap.value?.activeBusinessId ||
    activeBusinessId.value ||
    response.businesses[0]?.businessId ||
    "";

  if (!bootstrap.value?.activeBusinessId && selectedBusinessId.value) {
    await setActiveBusinessId(selectedBusinessId.value);
  }
}

async function loadWorkspace(): Promise<void> {
  if (!selectedBusinessId.value) {
    workspace.value = null;
    prospects.value = [];
    selectedProspectId.value = "";
    workflowSnapshot.value = null;
    return;
  }

  const response = await requestRevenueAgentWorkspace(selectedBusinessId.value);
  workspace.value = response;
  prospects.value = response.prospects;
  feedForm.value = {
    ...response.feedConfig,
    provider: response.feedConfig.provider ?? "mock",
  };
  replyText.value = "";
  replyAnalysis.value = null;

  const preferredProspect =
    response.prospects.find((prospect) => prospect.id === selectedProspectId.value) ?? response.prospects[0] ?? null;
  selectProspect(preferredProspect);
}

async function connectGoogleCalendar(): Promise<void> {
  if (!selectedBusinessId.value) {
    errorMessage.value = "Select a workspace first.";
    return;
  }

  try {
    const response = await requestGoogleCalendarAuthStart({
      businessId: selectedBusinessId.value,
      returnPath: route.path,
    });
    window.location.assign(response.authorizationUrl);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to start Google Calendar connect.";
  }
}

async function disconnectGoogleCalendar(): Promise<void> {
  if (!selectedBusinessId.value) {
    errorMessage.value = "Select a workspace first.";
    return;
  }

  try {
    await requestDisconnectGoogleCalendar({ businessId: selectedBusinessId.value });
    await loadWorkspace();
    feedbackMessage.value = "Google Calendar disconnected.";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to disconnect Google Calendar.";
  }
}

async function loadWorkflowSnapshot(): Promise<void> {
  if (!selectedBusinessId.value || !selectedProspect.value) {
    workflowSnapshot.value = null;
    return;
  }

  isLoadingWorkflow.value = true;

  try {
    workflowSnapshot.value = await requestRevenueAgentWorkflow(selectedProspect.value.id, selectedBusinessId.value);
  } catch (error) {
    workflowSnapshot.value = null;
    errorMessage.value = error instanceof Error ? error.message : "Unable to load the workflow snapshot.";
  } finally {
    isLoadingWorkflow.value = false;
  }
}

async function initializePage(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    await loadBusinesses();
    await loadWorkspace();
    loadFeedFormFromWorkspace();
    applyCalendarConnectionFeedback();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to load the revenue agent workspace.";
  } finally {
    isLoading.value = false;
  }
}

async function runFeed(): Promise<void> {
  if (!selectedBusinessId.value) {
    errorMessage.value = "Select a workspace first.";
    return;
  }

  isRunningFeed.value = true;
  errorMessage.value = "";

  try {
    const response = await requestRevenueAgentFeed({
      businessId: selectedBusinessId.value,
      ...feedForm.value,
    });
    prospects.value = response.workspace.prospects;
    feedForm.value = {
      ...response.workspace.feedConfig,
      provider: response.workspace.feedConfig.provider ?? "mock",
    };
    selectProspect(response.workspace.prospects[0] ?? null);
    feedbackMessage.value = `Daily feed completed for ${response.run.prospectsFound} prospects.`;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to run the daily feed.";
  } finally {
    isRunningFeed.value = false;
  }
}

async function performAction(action: RevenueAgentActionType, followUpDays?: number): Promise<void> {
  if (!selectedBusinessId.value || !selectedProspect.value) {
    errorMessage.value = "Select a prospect first.";
    return;
  }

  actionLoadingId.value = `${selectedProspect.value.id}:${action}`;
  errorMessage.value = "";

  try {
    const response = await requestRevenueAgentAction(selectedProspect.value.id, {
      businessId: selectedBusinessId.value,
      action,
      followUpDays,
    });

    const updated = response.prospect;
    prospects.value = prospects.value.map((prospect) => (prospect.id === updated.id ? updated : prospect));
    selectProspect(updated);

    if (action === "send_email") {
      feedbackMessage.value = "Email sent and logged.";
    } else if (action === "approve_draft") {
      feedbackMessage.value = "Draft approved.";
    } else if (action === "schedule_follow_up") {
      feedbackMessage.value = "Follow-up scheduled.";
    } else if (action === "mark_not_interested") {
      feedbackMessage.value = "Marked not interested.";
    } else if (action === "mark_replied") {
      feedbackMessage.value = "Marked replied.";
    } else if (action === "mark_meeting_booked") {
      feedbackMessage.value = "Marked meeting booked.";
    } else if (action === "book_meeting") {
      if (response.calendarEvent?.created) {
        feedbackMessage.value = "Meeting booked. Confirmation email sent and Google Calendar event created.";
      } else if (response.calendarEvent?.reason === "not_connected") {
        feedbackMessage.value = "Meeting booked. Confirmation email sent, but Google Calendar is not connected yet.";
      } else if (response.calendarEvent?.reason === "missing_slot") {
        feedbackMessage.value = "Meeting booked. Confirmation email sent, but no schedulable calendar slot was available.";
      } else {
        feedbackMessage.value = "Meeting booked. Confirmation email sent, but Google Calendar sync did not complete.";
      }
    } else if (action === "send_proposal") {
      feedbackMessage.value = "Proposal sent.";
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to update the prospect.";
  } finally {
    actionLoadingId.value = "";
  }
}

async function regenerateResearch(): Promise<void> {
  if (!selectedBusinessId.value || !selectedProspect.value) {
    errorMessage.value = "Select a prospect first.";
    return;
  }

  actionLoadingId.value = `${selectedProspect.value.id}:regenerate_research`;
  errorMessage.value = "";

  try {
    const response = await requestRevenueAgentResearchRegenerate(selectedProspect.value.id, {
      businessId: selectedBusinessId.value,
    });

    const updated = response.prospect;
    prospects.value = prospects.value.map((prospect) => (prospect.id === updated.id ? updated : prospect));
    selectProspect(updated);
    feedbackMessage.value = "Opportunity report regenerated.";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to regenerate the opportunity report.";
  } finally {
    actionLoadingId.value = "";
  }
}

async function analyzeReply(): Promise<void> {
  if (!selectedBusinessId.value || !selectedProspect.value) {
    errorMessage.value = "Select a prospect first.";
    return;
  }

  if (!replyText.value.trim()) {
    errorMessage.value = "Paste the lead reply before analyzing it.";
    return;
  }

  isAnalyzingReply.value = true;
  errorMessage.value = "";

  try {
    const response = await requestRevenueAgentReplyAnalysis(selectedProspect.value.id, {
      businessId: selectedBusinessId.value,
      replyText: replyText.value,
    });
    const updated = response.prospect;
    prospects.value = prospects.value.map((prospect) => (prospect.id === updated.id ? updated : prospect));
    selectProspect(updated, { resetReplyDraft: false });
    replyAnalysis.value = response.analysis;
    feedbackMessage.value = `Reply classified as ${response.analysis.intent.replaceAll("_", " ")}.`;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to analyze the reply.";
  } finally {
    isAnalyzingReply.value = false;
  }
}

watch(
  () => bootstrap.value?.activeBusinessId || activeBusinessId.value,
  (nextBusinessId, previousBusinessId) => {
    if (!nextBusinessId || nextBusinessId === previousBusinessId) {
      return;
    }

    selectedBusinessId.value = nextBusinessId;

    void (async () => {
      await loadBusinesses();
      await loadWorkspace();
    })();
  },
);

onMounted(() => {
  void initializePage();
});
</script>

<template>
  <main class="revenue-shell">
    <section class="revenue-hero">
      <div class="revenue-hero-copy">
        <p class="revenue-eyebrow">/app/revenue-agent</p>
        <h1>Revenue Agent</h1>
        <p class="revenue-description">
          Find prospects, research pain points, draft outreach, and book meetings without turning the product into a
          soft content tool.
        </p>
        <div class="revenue-chip-row">
          <span class="revenue-chip">Human approval first</span>
          <span class="revenue-chip">Signal-based cards</span>
          <span class="revenue-chip">Daily feed workflow</span>
        </div>
      </div>
      <div class="revenue-hero-card">
        <p class="hero-card-label">Goal</p>
        <strong>Get 5-10 qualified meetings per month.</strong>
        <p>Start with lead to research to personalized email to follow-up to meeting booked.</p>
      </div>
    </section>

    <p v-if="errorMessage" class="revenue-feedback error">{{ errorMessage }}</p>
    <p v-else-if="feedbackMessage" class="revenue-feedback">{{ feedbackMessage }}</p>

    <section v-if="isLoading" class="revenue-card">
      <p class="revenue-muted">Loading revenue workspace...</p>
    </section>

    <template v-else>
      <section v-if="!selectedBusinessId" class="revenue-card empty-state">
        <h2>Revenue Agent needs a workspace.</h2>
        <p>Create or select a workspace first, then run the daily feed.</p>
        <router-link class="primary-action" :to="appRoutes.onboardingWorkspace">Create workspace</router-link>
      </section>

      <template v-else>
        <section class="revenue-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">ICP</p>
              <h2>Run the daily feed</h2>
              <p class="panel-note">{{ workspaceName }}</p>
            </div>
            <button type="button" class="primary-action" :disabled="isRunningFeed" @click="runFeed">
              {{ isRunningFeed ? "Running feed..." : "Run Daily Feed" }}
            </button>
          </div>

          <div class="feed-grid">
            <label class="field">
              <span>Industry</span>
              <input v-model="feedForm.industry" type="text" placeholder="Salon" />
            </label>
            <label class="field">
              <span>City</span>
              <input v-model="feedForm.city" type="text" placeholder="Dallas" />
            </label>
            <label class="field">
              <span>State</span>
              <input v-model="feedForm.state" type="text" placeholder="TX" />
            </label>
            <label class="field">
              <span>Offer</span>
              <input v-model="feedForm.offer" type="text" placeholder="AI booking + follow-up automation" />
            </label>
            <label class="field">
              <span>Daily lead limit</span>
              <input v-model.number="feedForm.dailyLeadLimit" type="number" min="1" max="25" />
            </label>
            <label class="field">
              <span>Provider</span>
              <select v-model="feedForm.provider">
                <option value="mock">Mock provider</option>
                <option value="google_business">Google Business</option>
                <option value="csv_import">CSV import</option>
              </select>
              <small v-if="isGoogleBusinessSelected" class="muted-copy">
                Requires `GOOGLE_PLACES_API_KEY` on the backend.
              </small>
            </label>
          </div>

          <div v-if="isCsvImportSelected" class="csv-import-block">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Lead import</p>
                <h3>Paste real businesses</h3>
                <p class="panel-note">Use CSV rows with businessName, website, email, phone, city, state, industry, sourceUrl, rating, reviewCount, painSignals, and tags.</p>
              </div>
              <button type="button" class="secondary-action" @click="loadSampleCsv">Load sample CSV</button>
            </div>
            <label class="field">
              <span>CSV text</span>
              <textarea
                v-model="feedForm.csvText"
                rows="8"
                spellcheck="false"
                placeholder="businessName,website,email,phone,city,state,industry,sourceUrl,rating,reviewCount,painSignals,tags"
              ></textarea>
            </label>
          </div>
        </section>

        <section class="stats-grid">
          <article class="stat-card">
            <span>New Prospects</span>
            <strong>{{ stats.newProspects }}</strong>
          </article>
          <article class="stat-card">
            <span>Researched</span>
            <strong>{{ stats.researched }}</strong>
          </article>
          <article class="stat-card">
            <span>Drafts Ready</span>
            <strong>{{ stats.draftsReady }}</strong>
          </article>
          <article class="stat-card">
            <span>Follow-ups Due</span>
            <strong>{{ stats.followUpsDue }}</strong>
          </article>
          <article class="stat-card">
            <span>Replies</span>
            <strong>{{ stats.replies }}</strong>
          </article>
          <article class="stat-card">
            <span>Meetings</span>
            <strong>{{ stats.meetings }}</strong>
          </article>
        </section>

        <section class="revenue-grid">
          <article class="revenue-card table-card">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Today</p>
                <h2>Prospects</h2>
              </div>
            </div>

            <div v-if="prospects.length === 0" class="empty-note">
              No prospects yet. Run the feed to populate the workspace.
            </div>

            <div v-else class="prospect-table">
              <button
                v-for="prospect in prospects"
                :key="prospect.id"
                type="button"
                class="prospect-row"
                :class="{ active: selectedProspectId === prospect.id }"
                @click="selectProspect(prospect)"
              >
                <span class="row-main">
                  <strong>{{ prospect.businessName }}</strong>
                  <small>{{ prospect.source }}</small>
                </span>
                <span class="row-secondary">
                  <strong>{{ prospect.painSummary || "No pain summary yet." }}</strong>
                  <small>{{ prospect.city }}{{ prospect.state ? `, ${prospect.state}` : "" }}</small>
                </span>
                <span>{{ formatScore(prospect.opportunityScore) }}</span>
                <span>{{ nextActionLabel(prospect) }}</span>
                <span>{{ statusLabel(prospect.status) }}</span>
              </button>
            </div>
          </article>

          <article class="revenue-card detail-card">
            <div class="panel-header">
              <div>
                <p class="panel-meta">Lead detail</p>
                <h2>{{ selectedProspect?.businessName || "Pick a prospect" }}</h2>
              </div>
              <div v-if="selectedProspect" class="detail-actions">
                <button
                  type="button"
                  class="secondary-action"
                  :disabled="actionLoadingId === `${selectedProspect.id}:regenerate_research`"
                  @click="regenerateResearch"
                >
                  {{ actionLoadingId === `${selectedProspect.id}:regenerate_research` ? "Regenerating..." : "Regenerate Report" }}
                </button>
                <button type="button" class="secondary-action" @click="copyAuditReport">Copy Audit</button>
                <button type="button" class="secondary-action" @click="downloadAuditReport">Download Audit</button>
                <button type="button" class="secondary-action" @click="printAuditReport">Print / Save PDF</button>
                <button
                  type="button"
                  class="secondary-action"
                  :disabled="isExportingReport"
                  @click="downloadServerExport"
                >
                  {{ isExportingReport ? "Exporting..." : "Server Export" }}
                </button>
              </div>
            </div>

            <div v-if="!selectedProspect" class="empty-note">
              Select a prospect to see research, the generated email, and approval controls.
            </div>

            <template v-else>
              <div class="detail-meta">
                <div>
                  <span>Website</span>
                  <strong>{{ selectedProspect.website || "Not available" }}</strong>
                </div>
                <div>
                  <span>Contact</span>
                  <strong>{{ selectedProspect.email || selectedProspect.phone || "Not available" }}</strong>
                </div>
                <div>
                  <span>Rating</span>
                  <strong>{{ selectedProspect.rating ? `${selectedProspect.rating.toFixed(1)} / 5` : "n/a" }}</strong>
                </div>
                <div>
                  <span>Reviews</span>
                  <strong>{{ selectedProspect.reviewCount }}</strong>
                </div>
              </div>

              <div class="tag-row">
                <span v-for="tag in selectedProspect.opportunityTags" :key="tag" class="tag-pill">{{ tag }}</span>
              </div>

              <div class="insight-card activity-card">
                <div class="panel-header">
                  <div>
                    <p class="panel-meta">Activity</p>
                    <h3>Current account pulse</h3>
                    <p class="panel-note">A compact view of the latest persisted actions on this prospect.</p>
                  </div>
                </div>

                <div class="activity-stats">
                  <div class="activity-stat">
                    <span>Total events</span>
                    <strong>{{ timelineStats.total }}</strong>
                  </div>
                  <div class="activity-stat">
                    <span>Replies</span>
                    <strong>{{ timelineStats.replies }}</strong>
                  </div>
                  <div class="activity-stat">
                    <span>Meetings</span>
                    <strong>{{ timelineStats.meetings }}</strong>
                  </div>
                  <div class="activity-stat">
                    <span>Follow-ups</span>
                    <strong>{{ timelineStats.followUps }}</strong>
                  </div>
                </div>

                <div v-if="recentTimelineEvents.length === 0" class="empty-note">
                  No persisted activity yet.
                </div>

                <div v-else class="activity-feed">
                  <article v-for="item in recentTimelineEvents" :key="`recent-${item.id}`" class="activity-feed-item">
                    <div>
                      <strong>{{ item.title }}</strong>
                      <p>{{ item.description }}</p>
                    </div>
                    <span>{{ formatTimelineTimestamp(item.occurredAt) }}</span>
                  </article>
                </div>
              </div>

              <div class="insight-card workflow-card">
                <div class="panel-header">
                  <div>
                    <p class="panel-meta">Orchestration</p>
                    <h3>Revenue workflow</h3>
                    <p class="panel-note">A server-generated playbook for the selected prospect.</p>
                  </div>
                  <button type="button" class="secondary-action" :disabled="isLoadingWorkflow" @click="loadWorkflowSnapshot">
                    {{ isLoadingWorkflow ? "Loading..." : "Refresh workflow" }}
                  </button>
                </div>

                <div v-if="!workflowSnapshot" class="empty-note">
                  Select a prospect to generate the workflow snapshot.
                </div>

                <template v-else>
                  <div class="workflow-summary">
                    <div>
                      <span>Trigger</span>
                      <strong>{{ workflowSnapshot.workflow.trigger.replaceAll("_", " ") }}</strong>
                    </div>
                    <div>
                      <span>Confidence</span>
                      <strong>{{ Math.round(workflowSnapshot.workflow.confidence) }}%</strong>
                    </div>
                    <div>
                      <span>Next best action</span>
                      <strong>{{ workflowSnapshot.workflow.nextBestAction }}</strong>
                    </div>
                  </div>

                  <div class="workflow-notes">
                    <span v-for="note in workflowSnapshot.workflow.calendarNotes" :key="note">{{ note }}</span>
                  </div>

                  <div v-if="workflowSnapshot.workflow.calendarSuggestion" class="workflow-calendar">
                    <div class="panel-header">
                      <div>
                        <p class="panel-meta">Calendar handoff</p>
                        <h4>Suggested meeting times</h4>
                        <p class="panel-note">
                          {{ workflowSnapshot.workflow.calendarSuggestion.timezone }} ·
                          {{ workflowSnapshot.workflow.calendarSuggestion.meetingDurationMinutes }} minute call
                        </p>
                      </div>
                      <button
                        v-if="!isGoogleCalendarConnected"
                        type="button"
                        class="secondary-action"
                        :disabled="isLoadingWorkflow"
                        @click="connectGoogleCalendar"
                      >
                        Connect Google Calendar
                      </button>
                      <button
                        v-else
                        type="button"
                        class="secondary-action"
                        :disabled="isLoadingWorkflow"
                        @click="disconnectGoogleCalendar"
                      >
                        Disconnect Google Calendar
                      </button>
                    </div>
                    <div class="calendar-connection-status">
                      <span v-if="googleCalendarConnection?.connected">
                        Connected as {{ googleCalendarConnection.accountEmail || googleCalendarConnection.googleAccountId }}.
                      </span>
                      <span v-else-if="googleCalendarConnection">
                        Google Calendar is {{ googleCalendarConnection.status }}.
                      </span>
                      <span v-else>Connect Google Calendar to create a real event when the meeting is booked.</span>
                    </div>
                    <div class="workflow-notes">
                      <span v-for="slot in workflowSnapshot.workflow.calendarSuggestion.suggestedTimes" :key="slot">{{ slot }}</span>
                    </div>
                    <p class="workflow-summary-text">{{ workflowSnapshot.workflow.calendarSuggestion.inviteDraft }}</p>
                    <button
                      type="button"
                      class="primary-action"
                      :disabled="actionLoadingId === `${selectedProspect.id}:book_meeting`"
                      @click="performAction('book_meeting')"
                    >
                      {{ actionLoadingId === `${selectedProspect.id}:book_meeting` ? "Booking..." : "Book Meeting" }}
                    </button>
                  </div>

                  <ol class="workflow-steps">
                    <li v-for="step in workflowSnapshot.workflow.steps" :key="step.type" class="workflow-step">
                      <div class="workflow-step-head">
                        <strong>{{ formatWorkflowStepType(step.type) }}</strong>
                        <span :class="`workflow-step-status ${step.status}`">{{ formatWorkflowStepStatus(step.status) }}</span>
                      </div>
                      <p>{{ step.description }}</p>
                    </li>
                  </ol>

                  <div v-if="workflowSnapshot.workflow.proposalDraft" class="workflow-proposal">
                    <div class="panel-header">
                      <div>
                        <p class="panel-meta">Proposal draft</p>
                        <h4>{{ workflowSnapshot.workflow.proposalDraft.pricingSuggestion }}</h4>
                      </div>
                      <button
                        type="button"
                        class="secondary-action"
                        :disabled="actionLoadingId === `${selectedProspect.id}:send_proposal` || !selectedProspect.email"
                        @click="performAction('send_proposal')"
                      >
                        {{ actionLoadingId === `${selectedProspect.id}:send_proposal` ? "Sending..." : "Send Proposal" }}
                      </button>
                    </div>
                    <p class="workflow-summary-text">{{ workflowSnapshot.workflow.proposalDraft.executiveSummary }}</p>
                    <p class="workflow-summary-text">{{ workflowSnapshot.workflow.proposalDraft.roiSummary }}</p>
                    <p class="workflow-summary-text">{{ workflowSnapshot.workflow.proposalDraft.acceptancePrompt }}</p>
                    <div class="workflow-two-col">
                      <div>
                        <span>Current workflow</span>
                        <ul>
                          <li v-for="item in workflowSnapshot.workflow.proposalDraft.currentWorkflow" :key="item">{{ item }}</li>
                        </ul>
                      </div>
                      <div>
                        <span>Proposed workflow</span>
                        <ul>
                          <li v-for="item in workflowSnapshot.workflow.proposalDraft.proposedWorkflow" :key="item">{{ item }}</li>
                        </ul>
                      </div>
                    </div>
                    <div class="workflow-two-col">
                      <div>
                        <span>Timeline</span>
                        <ul>
                          <li v-for="item in workflowSnapshot.workflow.proposalDraft.timeline" :key="item">{{ item }}</li>
                        </ul>
                      </div>
                      <div>
                        <span>Deliverables</span>
                        <ul>
                          <li v-for="item in workflowSnapshot.workflow.proposalDraft.deliverables" :key="item">{{ item }}</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </template>
              </div>

              <div class="report-grid">
                <article class="insight-card report-card">
                  <p class="card-kicker">Business summary</p>
                  <p>{{ selectedReport?.businessSummary || selectedProspect.research?.painSummary || selectedProspect.painSummary || "Waiting on research." }}</p>
                </article>
                <article class="insight-card report-card">
                  <p class="card-kicker">Website summary</p>
                  <p>{{ selectedReport?.websiteSummary || selectedProspect.research?.suggestedOfferAngle || selectedProspect.suggestedOfferAngle || "No website summary yet." }}</p>
                  <p class="muted-copy">{{ selectedResearch?.websiteUrl || selectedProspect.website || "Website not available." }}</p>
                </article>
              </div>

              <div class="report-grid report-grid-wide">
                <article class="insight-card score-card">
                  <p class="card-kicker">Opportunity score</p>
                  <strong class="score-value">{{ formatScore(selectedProspect.opportunityScore) }}</strong>
                  <p class="muted-copy">
                    Estimated ROI:
                    {{ formatHoursRange(selectedReport?.estimatedRoiHoursPerWeekMin ?? 0, selectedReport?.estimatedRoiHoursPerWeekMax ?? 0) }}
                  </p>
                  <p class="muted-copy">
                    {{ selectedReport?.suggestedOutreachAngle || selectedProspect.research?.suggestedOfferAngle || selectedProspect.suggestedOfferAngle || "No outreach angle yet." }}
                  </p>
                </article>

                <article class="insight-card report-list-card">
                  <p class="card-kicker">Pain points</p>
                  <ul class="report-list">
                    <li v-for="item in selectedReport?.painPoints || []" :key="`pain-${item}`">
                      {{ item }}
                    </li>
                    <li v-if="(selectedReport?.painPoints?.length ?? 0) === 0">Waiting on research.</li>
                  </ul>
                </article>

                <article class="insight-card report-list-card">
                  <p class="card-kicker">Automation opportunities</p>
                  <ul class="report-list">
                    <li v-for="item in selectedReport?.automationOpportunities || []" :key="`auto-${item}`">
                      {{ item }}
                    </li>
                    <li v-if="(selectedReport?.automationOpportunities?.length ?? 0) === 0">Waiting on research.</li>
                  </ul>
                </article>

                <article class="insight-card report-list-card">
                  <p class="card-kicker">Why it scores</p>
                  <ul class="report-list">
                    <li v-for="item in selectedReport?.opportunityScoreReasons || []" :key="`reason-${item}`">
                      {{ item }}
                    </li>
                    <li v-if="(selectedReport?.opportunityScoreReasons?.length ?? 0) === 0">No score reasoning yet.</li>
                  </ul>
                </article>
              </div>

              <div class="insight-card website-signals-card">
                <h3>Website signals</h3>
                <div class="signal-grid">
                  <div>
                    <span>Booking software</span>
                    <strong>{{ selectedReport?.websiteSignals.bookingSoftware || "None detected" }}</strong>
                  </div>
                  <div>
                    <span>Contact form</span>
                    <strong>{{ selectedReport?.websiteSignals.contactForm ? "Yes" : "No" }}</strong>
                  </div>
                  <div>
                    <span>Chat widget</span>
                    <strong>{{ selectedReport?.websiteSignals.chatWidget ? "Yes" : "No" }}</strong>
                  </div>
                  <div>
                    <span>Mobile responsive</span>
                    <strong>{{ selectedReport?.websiteSignals.mobileResponsive ? "Yes" : "No" }}</strong>
                  </div>
                  <div>
                    <span>HTTPS</span>
                    <strong>{{ selectedReport?.websiteSignals.https ? "Yes" : "No" }}</strong>
                  </div>
                  <div>
                    <span>Performance</span>
                    <strong>{{ selectedReport?.websiteSignals.performanceBand || "unknown" }}</strong>
                  </div>
                </div>

                <div class="signal-group" v-if="(selectedReport?.websiteSignals.services?.length ?? 0) > 0">
                  <span>Services</span>
                  <div class="tag-row">
                    <span v-for="service in selectedReport?.websiteSignals.services || []" :key="`service-${service}`" class="tag-pill">
                      {{ service }}
                    </span>
                  </div>
                </div>

                <div class="signal-group" v-if="(selectedReport?.websiteSignals.socialLinks?.length ?? 0) > 0">
                  <span>Social links</span>
                  <div class="tag-row">
                    <span v-for="social in selectedReport?.websiteSignals.socialLinks || []" :key="`social-${social}`" class="tag-pill">
                      {{ social }}
                    </span>
                  </div>
                </div>

              <div v-if="(selectedReport?.websiteSignals.notes?.length ?? 0) > 0" class="signal-notes">
                <span v-for="note in selectedReport?.websiteSignals.notes || []" :key="`note-${note}`" class="signal-note">
                  {{ note }}
                </span>
              </div>
            </div>

              <div class="report-grid report-grid-wide">
                <article class="insight-card profile-card">
                  <h3>Business profile</h3>
                  <div class="profile-score-grid">
                    <div>
                      <span>Business health</span>
                      <strong>{{ formatScore(selectedReport?.businessProfile.businessHealthScore || 0) }}</strong>
                    </div>
                    <div>
                      <span>Website</span>
                      <strong>{{ formatScore(selectedReport?.businessProfile.websiteScore || 0) }}</strong>
                    </div>
                    <div>
                      <span>Reviews</span>
                      <strong>{{ formatScore(selectedReport?.businessProfile.reviewsScore || 0) }}</strong>
                    </div>
                    <div>
                      <span>Booking</span>
                      <strong>{{ formatScore(selectedReport?.businessProfile.bookingScore || 0) }}</strong>
                    </div>
                    <div>
                      <span>CRM</span>
                      <strong>{{ formatNullableScore(selectedReport?.businessProfile.crmScore) }}</strong>
                    </div>
                    <div>
                      <span>AI readiness</span>
                      <strong>{{ formatScore(selectedReport?.businessProfile.aiReadinessScore || 0) }}</strong>
                    </div>
                  </div>

                  <div class="profile-section">
                    <span>Growth signals</span>
                    <div class="tag-row">
                      <span v-for="signal in selectedReport?.businessProfile.growthSignals || []" :key="`growth-${signal}`" class="tag-pill">
                        {{ signal }}
                      </span>
                      <span v-if="(selectedReport?.businessProfile.growthSignals?.length ?? 0) === 0" class="tag-pill">None detected</span>
                    </div>
                  </div>

                  <div class="profile-section">
                    <span>Owner signals</span>
                    <div class="tag-row">
                      <span v-for="signal in selectedReport?.businessProfile.ownerSignals || []" :key="`owner-${signal}`" class="tag-pill">
                        {{ signal }}
                      </span>
                      <span v-if="(selectedReport?.businessProfile.ownerSignals?.length ?? 0) === 0" class="tag-pill">Unknown</span>
                    </div>
                  </div>

                  <div class="profile-section">
                    <span>Source coverage</span>
                    <div class="coverage-grid">
                      <div v-for="item in sourceCoverageRows" :key="item.label" class="coverage-item">
                        <strong>{{ item.label }}</strong>
                        <span>{{ formatCoverageStatus(item.coverage?.status || 'unknown') }}</span>
                        <small v-if="item.coverage?.note">{{ item.coverage.note }}</small>
                      </div>
                    </div>
                  </div>
                </article>

                <article class="insight-card strategy-card">
                  <h3>AI sales strategy</h3>
                  <div class="strategy-block">
                    <span>Primary pain</span>
                    <p>{{ selectedReport?.salesStrategy.primaryPain || "Not enough signal yet." }}</p>
                  </div>
                  <div class="strategy-block">
                    <span>Recommended offer</span>
                    <p>{{ selectedReport?.salesStrategy.recommendedOffer || "No offer yet." }}</p>
                  </div>
                  <div class="strategy-block">
                    <span>Opening hook</span>
                    <p>{{ selectedReport?.salesStrategy.openingHook || "No opening hook yet." }}</p>
                  </div>
                  <div class="strategy-block">
                    <span>Objection handling</span>
                    <div class="objection-list">
                      <div v-for="objection in selectedReport?.salesStrategy.objections || []" :key="`objection-${objection.objection}`" class="objection-item">
                        <strong>{{ objection.objection }}</strong>
                        <p>{{ objection.response }}</p>
                      </div>
                      <div v-if="(selectedReport?.salesStrategy.objections?.length ?? 0) === 0" class="objection-item">
                        <strong>No objections yet.</strong>
                        <p>Regenerate the report to create a sales plan.</p>
                      </div>
                    </div>
                  </div>
                  <div class="strategy-block">
                    <span>CTA</span>
                    <p>{{ selectedReport?.salesStrategy.cta || "No CTA yet." }}</p>
                  </div>
                  <div class="strategy-block">
                    <span>Strategy rationale</span>
                    <ul class="report-list">
                      <li v-for="item in selectedReport?.salesStrategy.strategyRationale || []" :key="`strategy-${item}`">
                        {{ item }}
                      </li>
                      <li v-if="(selectedReport?.salesStrategy.strategyRationale?.length ?? 0) === 0">No rationale yet.</li>
                    </ul>
                  </div>
                </article>
              </div>

              <div class="insight-card timeline-card">
                <div class="panel-header">
                  <div>
                    <h3>Workflow timeline</h3>
                    <p class="panel-note">Persisted activity from research, outreach, replies, and follow-up work.</p>
                  </div>
                  <label class="timeline-filter">
                    <span>Filter</span>
                    <select v-model="timelineEventFilter">
                      <option value="all">All events</option>
                      <option value="lead_discovered">{{ formatTimelineEventLabel("lead_discovered") }}</option>
                      <option value="research_generated">{{ formatTimelineEventLabel("research_generated") }}</option>
                      <option value="draft_created">{{ formatTimelineEventLabel("draft_created") }}</option>
                      <option value="draft_approved">{{ formatTimelineEventLabel("draft_approved") }}</option>
                      <option value="sent">{{ formatTimelineEventLabel("sent") }}</option>
                      <option value="reply_received">{{ formatTimelineEventLabel("reply_received") }}</option>
                      <option value="reply_analyzed">{{ formatTimelineEventLabel("reply_analyzed") }}</option>
                      <option value="meeting_booked">{{ formatTimelineEventLabel("meeting_booked") }}</option>
                      <option value="follow_up_scheduled">{{ formatTimelineEventLabel("follow_up_scheduled") }}</option>
                      <option value="meeting_prep_created">{{ formatTimelineEventLabel("meeting_prep_created") }}</option>
                      <option value="not_interested">{{ formatTimelineEventLabel("not_interested") }}</option>
                    </select>
                  </label>
                </div>

                <div v-if="selectedTimeline.length === 0" class="empty-note">
                  No timeline yet. Research, send a draft, or analyze a reply to start the chronology.
                </div>

                <div v-else-if="displayedTimeline.length === 0" class="empty-note">
                  No events match the current filter.
                </div>

                <div v-else class="timeline-list">
                  <article
                    v-for="item in displayedTimeline"
                    :key="item.id"
                    class="timeline-item"
                    :class="item.tone"
                  >
                    <div class="timeline-marker"></div>
                    <div class="timeline-content">
                      <div class="timeline-meta">
                        <strong>{{ item.title }}</strong>
                        <span>{{ formatTimelineTimestamp(item.occurredAt) }}</span>
                      </div>
                      <p>{{ item.description }}</p>
                    </div>
                  </article>
                </div>
              </div>

              <div class="insight-card email-card">
                <h3>Generated email draft</h3>
                <p class="subject-line">{{ selectedProspect.latestMessage?.subject || selectedProspect.research?.emailSubject || "No draft yet." }}</p>
                <pre>{{ selectedProspect.latestMessage?.body || selectedProspect.research?.emailBody || "Run the feed to generate the first draft." }}</pre>
              </div>

              <div class="insight-card reply-card">
                <div class="panel-header reply-header">
                  <div>
                    <h3>Reply intelligence</h3>
                    <p class="panel-note">Paste the lead's reply and classify whether this is interest, an objection, or a meeting ask.</p>
                  </div>
                  <button
                    type="button"
                    class="primary-action"
                    :disabled="isAnalyzingReply || !replyText.trim()"
                    @click="analyzeReply"
                  >
                    {{ isAnalyzingReply ? "Analyzing..." : "Analyze Reply" }}
                  </button>
                </div>

                <label class="field">
                  <span>Inbound reply</span>
                  <textarea
                    v-model="replyText"
                    rows="6"
                    spellcheck="false"
                    placeholder="Thanks for the note. I’m interested, but can we see more details?"
                  ></textarea>
                </label>

                <div v-if="replyAnalysis" class="reply-analysis-grid">
                  <div class="reply-stat">
                    <span>Intent</span>
                    <strong>{{ replyAnalysis.intent.replaceAll("_", " ") }}</strong>
                  </div>
                  <div class="reply-stat">
                    <span>Sentiment</span>
                    <strong>{{ replyAnalysis.sentiment }}</strong>
                  </div>
                  <div class="reply-stat">
                    <span>Confidence</span>
                    <strong>{{ Math.round(replyAnalysis.confidence) }}%</strong>
                  </div>
                  <div class="reply-stat">
                    <span>Next step</span>
                    <strong>{{ replyAnalysis.suggestedNextStep.replaceAll("_", " ") }}</strong>
                  </div>
                </div>

                <div v-if="replyAnalysis" class="strategy-block">
                  <span>Reply summary</span>
                  <p>{{ replyAnalysis.summary }}</p>
                </div>

                <div v-if="replyAnalysis" class="strategy-block">
                  <span>Suggested response</span>
                  <pre>{{ replyAnalysis.suggestedReply }}</pre>
                </div>

                <div v-if="replyAnalysis?.meetingBrief" class="strategy-block">
                  <span>Meeting brief</span>
                  <p>{{ replyAnalysis.meetingBrief.objective }}</p>
                  <p class="muted-copy">{{ replyAnalysis.meetingBrief.durationMinutes }} minute call</p>
                  <ul class="report-list">
                    <li v-for="item in replyAnalysis.meetingBrief.agenda" :key="`brief-agenda-${item}`">
                      {{ item }}
                    </li>
                  </ul>
                  <p class="muted-copy">{{ replyAnalysis.meetingBrief.suggestedCalendarMessage }}</p>
                </div>

                <div v-if="replyAnalysis?.meetingBrief?.followUpPlan?.length" class="strategy-block">
                  <span>Post-call plan</span>
                  <ul class="report-list">
                    <li v-for="item in replyAnalysis.meetingBrief.followUpPlan" :key="`follow-${item}`">
                      {{ item }}
                    </li>
                  </ul>
                </div>

                <div v-if="replyAnalysis?.meetingAgenda?.length" class="strategy-block">
                  <span>Meeting agenda</span>
                  <ul class="report-list">
                    <li v-for="item in replyAnalysis.meetingAgenda" :key="`agenda-${item}`">{{ item }}</li>
                  </ul>
                </div>

                <div v-if="replyAnalysis?.reasons?.length" class="strategy-block">
                  <span>Why it classified this way</span>
                  <ul class="report-list">
                    <li v-for="item in replyAnalysis.reasons" :key="`reason-${item}`">{{ item }}</li>
                  </ul>
                </div>

                <div v-if="replyAnalysis" class="action-row reply-actions">
                  <button
                    type="button"
                    class="primary-action"
                    :disabled="actionLoadingId === `${selectedProspect.id}:mark_replied`"
                    @click="performAction('mark_replied')"
                  >
                    {{ actionLoadingId === `${selectedProspect.id}:mark_replied` ? "Updating..." : "Mark Replied" }}
                  </button>
                  <button
                    type="button"
                    class="secondary-action"
                    :disabled="actionLoadingId === `${selectedProspect.id}:mark_meeting_booked`"
                    @click="performAction('mark_meeting_booked')"
                  >
                    {{ actionLoadingId === `${selectedProspect.id}:mark_meeting_booked` ? "Updating..." : "Mark Meeting Booked" }}
                  </button>
                </div>
              </div>

              <div class="follow-up-strip">
                <span>Next follow-up</span>
                <strong>{{ formatFollowUp(selectedProspect.nextFollowUpAt) }}</strong>
              </div>

              <div class="action-row">
                <button
                  type="button"
                  class="primary-action"
                  :disabled="actionLoadingId === `${selectedProspect.id}:approve_draft` || selectedProspect.status === 'not_interested'"
                  @click="performAction('approve_draft')"
                >
                  {{ actionLoadingId === `${selectedProspect.id}:approve_draft` ? "Approving..." : "Approve Draft" }}
                </button>
                <button
                  type="button"
                  class="primary-action"
                  :disabled="actionLoadingId === `${selectedProspect.id}:send_email` || selectedProspect.status === 'not_interested'"
                  @click="performAction('send_email')"
                >
                  {{ actionLoadingId === `${selectedProspect.id}:send_email` ? "Sending..." : "Send Email" }}
                </button>
                <button
                  type="button"
                  class="secondary-action"
                  :disabled="actionLoadingId === `${selectedProspect.id}:schedule_follow_up` || selectedProspect.status === 'not_interested'"
                  @click="performAction('schedule_follow_up', 3)"
                >
                  {{ actionLoadingId === `${selectedProspect.id}:schedule_follow_up` ? "Scheduling..." : "Schedule Follow-up" }}
                </button>
                <button
                  type="button"
                  class="secondary-action danger"
                  :disabled="actionLoadingId === `${selectedProspect.id}:mark_not_interested`"
                  @click="performAction('mark_not_interested')"
                >
                  {{ actionLoadingId === `${selectedProspect.id}:mark_not_interested` ? "Updating..." : "Mark Not Interested" }}
                </button>
              </div>
            </template>
          </article>
        </section>
      </template>
    </template>
  </main>
</template>

<style scoped>
.revenue-shell {
  width: min(100%, 1260px);
  margin: 0 auto;
  padding: 48px 20px 80px;
}

.revenue-hero {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
  align-items: stretch;
  margin-bottom: 24px;
}

.revenue-hero-copy,
.revenue-hero-card,
.revenue-card,
.stat-card {
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: linear-gradient(180deg, var(--fc-surface-strong) 0%, var(--fc-surface) 100%);
  box-shadow: var(--fc-panel-shadow);
}

.revenue-hero-copy {
  padding: 32px;
}

.revenue-hero-card {
  padding: 28px;
  display: grid;
  align-content: space-between;
  background:
    radial-gradient(circle at top right, rgba(215, 102, 52, 0.18), transparent 42%),
    linear-gradient(180deg, var(--fc-surface-strong) 0%, var(--fc-surface) 100%);
}

.revenue-eyebrow,
.panel-meta,
.hero-card-label {
  margin: 0 0 10px;
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.revenue-hero h1 {
  margin: 0;
  font-size: clamp(2.4rem, 5vw, 4rem);
  line-height: 1.02;
  font-family: var(--fc-font-family-display);
}

.revenue-description {
  margin: 16px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
  max-width: 64ch;
}

.revenue-chip-row,
.tag-row,
.action-row,
.follow-up-strip,
.detail-meta,
.feed-grid,
.stats-grid,
.revenue-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.revenue-chip {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: color-mix(in srgb, var(--fc-surface-strong) 72%, var(--fc-surface-muted));
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.revenue-feedback {
  margin: 0 0 18px;
  font-weight: 700;
}

.revenue-feedback.error {
  color: var(--fc-error-text);
}

.revenue-card {
  padding: clamp(22px, 3vw, 30px);
}

.empty-state {
  text-align: center;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border-radius: 999px;
  font-weight: 800;
  text-decoration: none;
  cursor: pointer;
}

.primary-action {
  border: none;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
  box-shadow: var(--fc-accent-shadow);
}

.primary-action:disabled,
.secondary-action:disabled {
  opacity: 0.7;
  cursor: wait;
}

.secondary-action {
  border: 1px solid var(--fc-border);
  background: transparent;
  color: var(--fc-text);
}

.secondary-action.danger {
  color: #9a3412;
  border-color: rgba(215, 102, 52, 0.28);
  background: rgba(215, 102, 52, 0.08);
}

.panel-header {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
}

.panel-header h2 {
  margin: 0;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}

.timeline-filter {
  display: grid;
  gap: 6px;
  min-width: 210px;
}

.timeline-filter span {
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.timeline-filter select {
  min-height: 44px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid var(--fc-input-border);
  background: var(--fc-input-bg);
  color: var(--fc-text);
}

.panel-note,
.revenue-muted {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.feed-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 20px;
}

.csv-import-block {
  margin-top: 20px;
  display: grid;
  gap: 16px;
}

.field {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.field span {
  color: var(--fc-text-muted);
  font-size: 0.88rem;
  font-weight: 700;
}

.field input,
.field select,
.field textarea {
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  border-radius: 16px;
  border: 1px solid var(--fc-input-border);
  background: var(--fc-input-bg);
}

.field textarea {
  min-height: 180px;
  padding: 14px;
  resize: vertical;
  line-height: 1.5;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  margin: 20px 0;
}

.stat-card {
  padding: 18px;
  display: grid;
  gap: 8px;
}

.stat-card span {
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.stat-card strong {
  font-size: 1.8rem;
  line-height: 1;
}

.revenue-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
  gap: 20px;
}

.table-card,
.detail-card {
  min-height: 100%;
}

.prospect-table {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}

.prospect-row {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(220px, 1.4fr) 90px 130px 140px;
  gap: 14px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-surface-strong) 78%, var(--fc-surface-muted));
  text-align: left;
  cursor: pointer;
  color: var(--fc-text);
}

.prospect-row.active {
  border-color: color-mix(in srgb, var(--fc-accent) 50%, var(--fc-border));
  box-shadow: 0 0 0 1px rgba(215, 102, 52, 0.14);
}

.row-main,
.row-secondary {
  display: grid;
  gap: 4px;
}

.row-main small,
.row-secondary small {
  color: var(--fc-text-muted);
}

.row-secondary strong {
  font-weight: 600;
}

.detail-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 18px;
}

.detail-meta div {
  padding: 14px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-surface-strong) 86%, var(--fc-surface-muted));
}

.detail-meta span,
.muted-copy {
  color: var(--fc-text-muted);
  font-size: 0.84rem;
}

.detail-meta strong {
  display: block;
  margin-top: 6px;
}

.tag-pill {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(215, 102, 52, 0.2);
  background: rgba(215, 102, 52, 0.08);
  color: var(--fc-accent-dark);
  font-size: 0.84rem;
  font-weight: 700;
}

.card-kicker {
  margin: 0 0 10px;
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.report-grid,
.report-grid-wide {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 18px;
}

.report-card,
.report-list-card,
.score-card,
.website-signals-card {
  margin-top: 0;
}

.report-list,
.signal-notes {
  display: grid;
  gap: 10px;
}

.report-list {
  margin: 0;
  padding-left: 18px;
  color: var(--fc-text-muted);
}

.report-list li {
  line-height: 1.6;
}

.score-card {
  gap: 10px;
}

.score-value {
  display: block;
  font-size: clamp(2.2rem, 5vw, 3.6rem);
  line-height: 1;
  font-weight: 800;
  color: var(--fc-text);
}

.profile-card,
.strategy-card,
.reply-card,
.timeline-card,
.activity-card {
  display: grid;
  gap: 16px;
}

.profile-score-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.profile-score-grid div,
.coverage-item,
.strategy-block,
.objection-item {
  display: grid;
  gap: 6px;
}

.profile-score-grid span,
.profile-section > span,
.strategy-block > span,
.coverage-item span,
.coverage-item small {
  color: var(--fc-text-muted);
  font-size: 0.84rem;
}

.profile-score-grid strong {
  font-size: 1.05rem;
}

.profile-section {
  display: grid;
  gap: 10px;
}

.coverage-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.coverage-item {
  padding: 12px;
  border: 1px solid var(--fc-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--fc-surface-strong) 86%, var(--fc-surface-muted));
}

.coverage-item strong {
  font-size: 0.98rem;
}

.strategy-block p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.timeline-list {
  display: grid;
  gap: 12px;
}

.timeline-item {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.timeline-marker {
  width: 12px;
  height: 12px;
  margin-top: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-text-muted) 40%, var(--fc-surface-muted));
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--fc-surface-strong) 88%, var(--fc-surface-muted));
}

.timeline-item.done .timeline-marker {
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
}

.timeline-item.active .timeline-marker {
  background: #b45309;
}

.timeline-item.pending .timeline-marker {
  background: #6b7280;
}

.timeline-content {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-surface-strong) 88%, var(--fc-surface-muted));
}

.timeline-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.timeline-meta strong {
  font-size: 0.98rem;
}

.timeline-meta span {
  color: var(--fc-text-muted);
  font-size: 0.84rem;
}

.timeline-content p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.activity-stats {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.activity-stat {
  padding: 12px 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-surface-strong) 88%, var(--fc-surface-muted));
}

.activity-stat span {
  display: block;
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.activity-stat strong {
  display: block;
  margin-top: 8px;
  font-size: 1.2rem;
}

.activity-feed {
  display: grid;
  gap: 10px;
}

.activity-feed-item {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 12px 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-surface-strong) 92%, var(--fc-surface-muted));
}

.activity-feed-item strong {
  display: block;
  font-size: 0.96rem;
}

.activity-feed-item p {
  margin: 4px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.activity-feed-item span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  white-space: nowrap;
}

.workflow-card {
  display: grid;
  gap: 16px;
  margin-top: 18px;
}

.workflow-summary,
.workflow-two-col {
  display: grid;
  gap: 12px;
}

.workflow-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.workflow-summary div,
.workflow-calendar,
.workflow-proposal,
.workflow-step {
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-surface-strong) 92%, var(--fc-surface-muted));
}

.workflow-summary span,
.workflow-notes span,
.workflow-proposal span {
  display: block;
  color: var(--fc-text-muted);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.workflow-summary strong,
.workflow-step strong,
.workflow-proposal h4 {
  display: block;
  margin-top: 6px;
  margin-bottom: 0;
}

.workflow-notes {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.workflow-notes span {
  padding: 8px 10px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: color-mix(in srgb, var(--fc-surface-strong) 88%, var(--fc-surface-muted));
  text-transform: none;
  letter-spacing: 0;
  font-size: 0.8rem;
}

.workflow-steps {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.workflow-step {
  display: grid;
  gap: 8px;
}

.workflow-step-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.workflow-step p,
.workflow-summary-text,
.workflow-proposal li {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.workflow-step-status {
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 700;
  text-transform: uppercase;
}

.workflow-step-status.done {
  background: rgba(34, 197, 94, 0.12);
  color: #15803d;
}

.workflow-step-status.active {
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
}

.workflow-step-status.pending {
  background: rgba(148, 163, 184, 0.16);
  color: #475569;
}

.workflow-step-status.blocked {
  background: rgba(239, 68, 68, 0.14);
  color: #b91c1c;
}

.workflow-proposal {
  display: grid;
  gap: 12px;
}

.workflow-calendar {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.calendar-connection-status {
  color: var(--fc-text-muted);
  font-size: 0.92rem;
  line-height: 1.5;
}

.workflow-proposal h4 {
  font-size: 1.02rem;
}

.workflow-two-col {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.workflow-two-col ul {
  margin: 8px 0 0;
  padding-left: 18px;
  color: var(--fc-text-muted);
}

.objection-list {
  display: grid;
  gap: 10px;
}

.objection-item {
  padding: 12px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-surface-strong) 88%, var(--fc-surface-muted));
}

.objection-item strong {
  font-size: 0.96rem;
}

.objection-item p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.website-signals-card {
  display: grid;
  gap: 16px;
}

.signal-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.signal-grid div,
.signal-group,
.signal-note {
  display: grid;
  gap: 6px;
}

.signal-grid span,
.signal-group > span,
.signal-note {
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  line-height: 1.5;
}

.signal-grid strong {
  font-size: 0.98rem;
}

.signal-group {
  gap: 10px;
}

.signal-notes {
  gap: 8px;
}

.signal-note {
  padding: 10px 12px;
  border: 1px solid var(--fc-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--fc-surface-strong) 84%, var(--fc-surface-muted));
}

.insight-card {
  margin-top: 18px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--fc-surface-strong) 82%, var(--fc-surface-muted));
}

.insight-card h3 {
  margin: 0 0 10px;
}

.insight-card p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.email-card pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.reply-header {
  align-items: center;
}

.reply-analysis-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.reply-stat {
  padding: 12px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-surface-strong) 88%, var(--fc-surface-muted));
  display: grid;
  gap: 6px;
}

.reply-stat span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.reply-stat strong {
  font-size: 0.98rem;
}

.reply-card pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.subject-line {
  margin: 0 0 10px !important;
  font-weight: 800;
  color: var(--fc-text) !important;
}

.follow-up-strip {
  justify-content: space-between;
  align-items: center;
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: color-mix(in srgb, var(--fc-surface-strong) 86%, var(--fc-surface-muted));
}

.follow-up-strip span {
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.action-row {
  margin-top: 18px;
}

.empty-note {
  margin-top: 18px;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

@media (max-width: 1120px) {
  .stats-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .revenue-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 860px) {
  .revenue-hero,
  .feed-grid,
  .prospect-row {
    grid-template-columns: 1fr;
  }

  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .report-grid,
  .report-grid-wide,
  .signal-grid,
  .reply-analysis-grid,
  .profile-score-grid,
  .coverage-grid,
  .workflow-summary,
  .workflow-two-col {
    grid-template-columns: 1fr;
  }

  .detail-meta {
    grid-template-columns: 1fr;
  }

  .action-row {
    display: grid;
  }
}

@media (max-width: 640px) {
  .revenue-shell {
    padding-inline: 16px;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
