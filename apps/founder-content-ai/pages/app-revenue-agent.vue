<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type Component } from "vue";
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
import { actionIcons, iconSizes, iconStrokeWidth, resolveProspectStatusIcon } from "../src/icons";
import {
  requestDisconnectGoogleCalendar,
  requestGoogleCalendarAuthStart,
  requestRevenueAgentAction,
  requestRevenueAgentFeedConfigUpdate,
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
const DEFAULT_REVENUE_FEED_CONFIG: RevenueAgentFeedConfig = {
  industry: "Salon",
  city: "Dallas",
  state: "TX",
  offer: "AI booking + follow-up automation",
  dailyLeadLimit: 20,
  provider: "google_business",
  csvText: "",
};
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
const isHydratingFeedForm = ref(false);

const feedForm = ref<RevenueAgentFeedConfig>({
  ...DEFAULT_REVENUE_FEED_CONFIG,
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
const workspaceKnowledge = computed(() => workspace.value?.workspaceKnowledge ?? null);
const workspaceKnowledgeProfile = computed(() => workspaceKnowledge.value?.profile ?? null);
const workspaceKnowledgeSources = computed(() => workspaceKnowledge.value?.sources ?? []);
const workspaceKnowledgeEmailIdentity = computed(() => workspaceKnowledge.value?.emailIdentity ?? null);
const workspaceKnowledgeStatusLabel = computed(() => {
  if (workspaceKnowledgeProfile.value?.processingStatus === "completed") {
    return "Profile ready";
  }

  if (workspaceKnowledgeProfile.value?.processingStatus === "processing" || workspaceKnowledgeProfile.value?.processingStatus === "queued") {
    return "Building profile";
  }

  if (workspaceKnowledgeSources.value.length > 0) {
    return "Sources ready";
  }

  return "No profile yet";
});
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

const searchQuery = ref("");
const sortKey = ref<"score" | "business" | "status" | "activity">("score");
const sortDirection = ref<"desc" | "asc">("desc");
const currentPage = ref(1);
const tablePageSize = ref(12);
const activeTab = ref<"overview" | "email" | "activity" | "notes">("overview");
const selectedProspectIds = ref<string[]>([]);
const focusedRowIndex = ref(0);
const bulkActionLoading = ref("");
const noteDraft = ref("");

const filterState = reactive({
  industry: "",
  city: "",
  state: "",
  leadSource: "all" as "all" | RevenueAgentProspect["source"],
  minScore: 0,
  status: "all" as
    | "all"
    | "new"
    | "researching"
    | "research_ready"
    | "draft_ready"
    | "approved"
    | "sent"
    | "replied"
    | "meeting"
    | "closed_won"
    | "closed_lost",
  hasEmail: "all" as "all" | "yes" | "no",
  hasWebsite: "all" as "all" | "yes" | "no",
  hasBooking: "all" as "all" | "yes" | "no",
  dateWindow: "all" as "all" | "today" | "7d" | "30d",
});

type RevenueAgentFilterPreset = {
  name: string;
  searchQuery: string;
  sortKey: "score" | "business" | "status" | "activity";
  sortDirection: "desc" | "asc";
  tablePageSize: number;
  filterState: typeof filterState;
};

const FILTER_STORAGE_KEY = "founder-content-revenue-agent-filters-v2";
const FILTER_PRESETS_KEY = "founder-content-revenue-agent-filter-presets-v1";
const savedFilterPresets = ref<RevenueAgentFilterPreset[]>([]);
const FEED_CONFIG_SAVE_DEBOUNCE_MS = 500;
let feedFormHydrationToken = 0;
let feedConfigSaveTimer: ReturnType<typeof setTimeout> | null = null;
let feedConfigSaveNonce = 0;
let hasHydratedFeedForm = false;

function normalizeFeedFormConfig(
  input: Partial<RevenueAgentFeedConfig> | null | undefined,
  fallback: RevenueAgentFeedConfig = DEFAULT_REVENUE_FEED_CONFIG,
): RevenueAgentFeedConfig {
  const merged = {
    ...fallback,
    ...(input ?? {}),
  };

  return {
    industry: typeof merged.industry === "string" ? merged.industry.trim() : fallback.industry,
    city: typeof merged.city === "string" ? merged.city.trim() : fallback.city,
    state: typeof merged.state === "string" ? merged.state.trim() : fallback.state,
    offer: typeof merged.offer === "string" ? merged.offer.trim() : fallback.offer,
    dailyLeadLimit: Math.min(25, Math.max(1, Math.floor(Number(merged.dailyLeadLimit) || fallback.dailyLeadLimit))),
    provider: merged.provider === "csv_import" ? "csv_import" : merged.provider === "google_business" ? "google_business" : fallback.provider,
    csvText: typeof merged.csvText === "string" ? merged.csvText : fallback.csvText ?? "",
  };
}

function hydrateFeedFormForWorkspace(feedConfig: RevenueAgentFeedConfig): void {
  const nextConfig = normalizeFeedFormConfig(feedConfig, feedConfig);
  const hydrationToken = ++feedFormHydrationToken;

  isHydratingFeedForm.value = true;
  feedForm.value = nextConfig;

  void nextTick(() => {
    if (hydrationToken !== feedFormHydrationToken) {
      return;
    }

    isHydratingFeedForm.value = false;
    hasHydratedFeedForm = true;
  });
}

function cancelFeedConfigSave(): void {
  if (feedConfigSaveTimer) {
    clearTimeout(feedConfigSaveTimer);
    feedConfigSaveTimer = null;
  }
}

async function persistFeedConfigToWorkspace(businessId: string): Promise<void> {
  if (!businessId) {
    return;
  }

  const response = await requestRevenueAgentFeedConfigUpdate({
    businessId,
    ...normalizeFeedFormConfig(feedForm.value),
  });
  void response;
}

function scheduleFeedConfigSave(): void {
  const businessId = selectedBusinessId.value;

  if (typeof window === "undefined" || !businessId || isHydratingFeedForm.value || !hasHydratedFeedForm) {
    return;
  }

  cancelFeedConfigSave();
  const saveNonce = ++feedConfigSaveNonce;

  feedConfigSaveTimer = window.setTimeout(() => {
    feedConfigSaveTimer = null;

    void (async () => {
      try {
        await persistFeedConfigToWorkspace(businessId);
      } catch {
        if (saveNonce === feedConfigSaveNonce) {
          // Background save failed; a later edit will retry.
        }
      }
    })();
  }, FEED_CONFIG_SAVE_DEBOUNCE_MS);
}

function cloneFilterState(): RevenueAgentFilterPreset["filterState"] {
  return {
    industry: filterState.industry,
    city: filterState.city,
    state: filterState.state,
    leadSource: filterState.leadSource,
    minScore: filterState.minScore,
    status: filterState.status,
    hasEmail: filterState.hasEmail,
    hasWebsite: filterState.hasWebsite,
    hasBooking: filterState.hasBooking,
    dateWindow: filterState.dateWindow,
  };
}

function saveFiltersToStorage(): void {
  if (typeof window === "undefined") {
    return;
  }

  const payload = {
    searchQuery: searchQuery.value,
    sortKey: sortKey.value,
    sortDirection: sortDirection.value,
    tablePageSize: tablePageSize.value,
    filterState: cloneFilterState(),
  };

  window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(payload));
}

function loadFiltersFromStorage(): void {
  if (typeof window === "undefined") {
    return;
  }

  const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);

  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RevenueAgentFilterPreset>;

    searchQuery.value = typeof parsed.searchQuery === "string" ? parsed.searchQuery : searchQuery.value;
    sortKey.value = parsed.sortKey === "business" || parsed.sortKey === "status" || parsed.sortKey === "activity" ? parsed.sortKey : "score";
    sortDirection.value = parsed.sortDirection === "asc" ? "asc" : "desc";
    tablePageSize.value = Number.isFinite(parsed.tablePageSize as number) && (parsed.tablePageSize as number) > 0 ? Math.min(50, Math.max(6, Math.floor(parsed.tablePageSize as number))) : tablePageSize.value;

    const savedFilters = parsed.filterState as Partial<typeof filterState> | undefined;
    if (savedFilters) {
      filterState.industry = typeof savedFilters.industry === "string" ? savedFilters.industry : filterState.industry;
      filterState.city = typeof savedFilters.city === "string" ? savedFilters.city : filterState.city;
      filterState.state = typeof savedFilters.state === "string" ? savedFilters.state : filterState.state;
      filterState.leadSource = savedFilters.leadSource === "csv_import" ? "csv_import" : savedFilters.leadSource === "google_business" ? "google_business" : "all";
      filterState.minScore = Number.isFinite(savedFilters.minScore as number) ? Math.max(0, Math.min(100, Math.floor(savedFilters.minScore as number))) : filterState.minScore;
      filterState.status =
        savedFilters.status === "researching" ||
        savedFilters.status === "research_ready" ||
        savedFilters.status === "draft_ready" ||
        savedFilters.status === "approved" ||
        savedFilters.status === "sent" ||
        savedFilters.status === "replied" ||
        savedFilters.status === "meeting" ||
        savedFilters.status === "closed_won" ||
        savedFilters.status === "closed_lost" ||
        savedFilters.status === "new"
          ? savedFilters.status
          : "all";
      filterState.hasEmail = savedFilters.hasEmail === "yes" || savedFilters.hasEmail === "no" ? savedFilters.hasEmail : "all";
      filterState.hasWebsite = savedFilters.hasWebsite === "yes" || savedFilters.hasWebsite === "no" ? savedFilters.hasWebsite : "all";
      filterState.hasBooking = savedFilters.hasBooking === "yes" || savedFilters.hasBooking === "no" ? savedFilters.hasBooking : "all";
      filterState.dateWindow =
        savedFilters.dateWindow === "today" || savedFilters.dateWindow === "7d" || savedFilters.dateWindow === "30d"
          ? savedFilters.dateWindow
          : "all";
    }
  } catch {
    // Ignore malformed local state.
  }

  const presetRaw = window.localStorage.getItem(FILTER_PRESETS_KEY);
  if (!presetRaw) {
    return;
  }

  try {
    const parsed = JSON.parse(presetRaw) as RevenueAgentFilterPreset[];
    savedFilterPresets.value = Array.isArray(parsed) ? parsed : [];
  } catch {
    savedFilterPresets.value = [];
  }
}

function saveCurrentFilterPreset(): void {
  if (typeof window === "undefined") {
    return;
  }

  const defaultName = [filterState.industry, filterState.city, filterState.state].filter(Boolean).join(" - ") || "Revenue Agent filter";
  const presetName = window.prompt("Save this filter as:", defaultName)?.trim();

  if (!presetName) {
    return;
  }

  const nextPreset: RevenueAgentFilterPreset = {
    name: presetName,
    searchQuery: searchQuery.value,
    sortKey: sortKey.value,
    sortDirection: sortDirection.value,
    tablePageSize: tablePageSize.value,
    filterState: cloneFilterState(),
  };

  const nextPresets = [...savedFilterPresets.value.filter((preset) => preset.name !== presetName), nextPreset];
  savedFilterPresets.value = nextPresets;
  window.localStorage.setItem(FILTER_PRESETS_KEY, JSON.stringify(nextPresets));
  saveFiltersToStorage();
  feedbackMessage.value = `Saved filter "${presetName}".`;
}

function applyFilterPreset(preset: RevenueAgentFilterPreset): void {
  searchQuery.value = preset.searchQuery;
  sortKey.value = preset.sortKey;
  sortDirection.value = preset.sortDirection;
  tablePageSize.value = preset.tablePageSize;
  filterState.industry = preset.filterState.industry;
  filterState.city = preset.filterState.city;
  filterState.state = preset.filterState.state;
  filterState.leadSource = preset.filterState.leadSource;
  filterState.minScore = preset.filterState.minScore;
  filterState.status = preset.filterState.status;
  filterState.hasEmail = preset.filterState.hasEmail;
  filterState.hasWebsite = preset.filterState.hasWebsite;
  filterState.hasBooking = preset.filterState.hasBooking;
  filterState.dateWindow = preset.filterState.dateWindow;
  currentPage.value = 1;
}

function toggleBulkSelection(prospectId: string): void {
  const next = new Set(selectedProspectIds.value);
  if (next.has(prospectId)) {
    next.delete(prospectId);
  } else {
    next.add(prospectId);
  }
  selectedProspectIds.value = [...next];
}

function setBulkSelection(ids: string[]): void {
  selectedProspectIds.value = [...new Set(ids)];
}

function clearBulkSelection(): void {
  selectedProspectIds.value = [];
}

function toggleVisibleSelection(): void {
  if (allVisibleSelected.value) {
    const visible = new Set(visibleRowIds.value);
    selectedProspectIds.value = selectedProspectIds.value.filter((id) => !visible.has(id));
    return;
  }

  setBulkSelection([...selectedProspectIds.value, ...visibleRowIds.value]);
}

function isBulkSelected(prospectId: string): boolean {
  return selectedProspectIds.value.includes(prospectId);
}

function isProspectSelectedForDetail(prospectId: string): boolean {
  return selectedProspectId.value === prospectId;
}

function normalizeText(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function getProspectWebsiteValue(prospect: RevenueAgentProspect): string {
  return prospect.website || prospect.research?.websiteUrl || "";
}

function getLastActivityAt(prospect: RevenueAgentProspect): string | undefined {
  const timestamps = [
    prospect.meetingBookedAt,
    prospect.repliedAt,
    prospect.sentAt,
    prospect.approvedAt,
    prospect.updatedAt,
    prospect.createdAt,
  ].filter((value): value is string => Boolean(value));

  if (timestamps.length === 0) {
    return undefined;
  }

  return [...timestamps].sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function formatRelativeTime(value?: string): string {
  if (!value) {
    return "Never";
  }

  const deltaMs = Date.now() - new Date(value).getTime();
  const deltaMinutes = Math.max(1, Math.floor(Math.abs(deltaMs) / 60_000));

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function toggleSort(nextKey: "score" | "business" | "status" | "activity"): void {
  if (sortKey.value === nextKey) {
    sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
    return;
  }

  sortKey.value = nextKey;
  sortDirection.value = nextKey === "business" ? "asc" : "desc";
}

function sortIndicatorIcon(key: "score" | "business" | "status" | "activity"): Component {
  if (sortKey.value !== key) {
    return actionIcons.arrowUpDown;
  }

  return sortDirection.value === "asc" ? actionIcons.chevronUp : actionIcons.chevronDown;
}

function rowStatusLabel(prospect: RevenueAgentProspect): string {
  if (prospect.status === "new" && prospect.research) {
    return "Researching";
  }

  switch (prospect.status) {
    case "new":
      return "New";
    case "researched":
      return "Research Ready";
    case "drafted":
      return "Draft Ready";
    case "approved":
      return "Approved";
    case "sent":
      return "Sent";
    case "replied":
      return "Replied";
    case "follow_up_due":
      return "Follow-up";
    case "meeting_booked":
      return "Closed Won";
    case "not_interested":
    case "dead":
      return "Closed Lost";
    default:
      return prospect.status;
  }
}

function rowStatusToneClass(prospect: RevenueAgentProspect): string {
  switch (rowStatusLabel(prospect)) {
    case "Researching":
      return "tone-researching";
    case "Research Ready":
      return "tone-research-ready";
    case "Draft Ready":
      return "tone-draft-ready";
    case "Approved":
      return "tone-approved";
    case "Sent":
      return "tone-sent";
    case "Replied":
      return "tone-replied";
    case "Follow-up":
      return "tone-follow-up";
    case "Closed Won":
      return "tone-won";
    case "Closed Lost":
      return "tone-lost";
    default:
      return "tone-new";
  }
}

function matchesStatusFilter(prospect: RevenueAgentProspect): boolean {
  switch (filterState.status) {
    case "all":
      return true;
    case "researching":
      return prospect.status === "new" && Boolean(prospect.research);
    case "research_ready":
      return prospect.status === "researched";
    case "draft_ready":
      return prospect.status === "drafted";
    case "approved":
      return prospect.status === "approved";
    case "sent":
      return prospect.status === "sent";
    case "replied":
      return prospect.status === "replied";
    case "meeting":
      return prospect.status === "meeting_booked" || prospect.status === "follow_up_due";
    case "closed_won":
      return prospect.status === "meeting_booked";
    case "closed_lost":
      return prospect.status === "not_interested" || prospect.status === "dead";
    case "new":
      return prospect.status === "new" && !prospect.research;
    default:
      return true;
  }
}

function matchesDateFilter(prospect: RevenueAgentProspect): boolean {
  if (filterState.dateWindow === "all") {
    return true;
  }

  const compareDate = new Date(prospect.createdAt).getTime();
  const now = Date.now();
  const deltaDays =
    filterState.dateWindow === "today" ? 0 : filterState.dateWindow === "7d" ? 7 : 30;

  if (deltaDays === 0) {
    const today = new Date();
    return new Date(prospect.createdAt).toDateString() === today.toDateString();
  }

  return now - compareDate <= deltaDays * 24 * 60 * 60 * 1000;
}

const filteredProspects = computed(() => {
  const query = normalizeText(searchQuery.value);

  return prospects.value.filter((prospect) => {
    const score = prospect.opportunityScore ?? 0;
    const website = getProspectWebsiteValue(prospect);
    const hasBooking = Boolean(prospect.research?.report.websiteSignals.bookingSoftware || prospect.meetingBookedAt);
    const haystack = [
      prospect.businessName,
      prospect.email,
      prospect.phone,
      prospect.city,
      prospect.state,
      prospect.source,
      website,
      prospect.painSummary,
      prospect.suggestedOfferAngle,
      ...(prospect.opportunityTags ?? []),
    ]
      .map((value) => normalizeText(value))
      .join(" ");

    if (query && !haystack.includes(query)) {
      return false;
    }

    if (filterState.industry && !normalizeText(prospect.industry).includes(normalizeText(filterState.industry))) {
      return false;
    }

    if (filterState.city && !normalizeText(prospect.city).includes(normalizeText(filterState.city))) {
      return false;
    }

    if (filterState.state && !normalizeText(prospect.state).includes(normalizeText(filterState.state))) {
      return false;
    }

    if (filterState.leadSource !== "all" && prospect.source !== filterState.leadSource) {
      return false;
    }

    if (score < filterState.minScore) {
      return false;
    }

    if (!matchesStatusFilter(prospect)) {
      return false;
    }

    if (filterState.hasEmail !== "all") {
      const hasEmail = Boolean(prospect.email);
      if ((filterState.hasEmail === "yes" && !hasEmail) || (filterState.hasEmail === "no" && hasEmail)) {
        return false;
      }
    }

    if (filterState.hasWebsite !== "all") {
      const hasWebsite = Boolean(website);
      if ((filterState.hasWebsite === "yes" && !hasWebsite) || (filterState.hasWebsite === "no" && hasWebsite)) {
        return false;
      }
    }

    if (filterState.hasBooking !== "all") {
      const booking = hasBooking;
      if ((filterState.hasBooking === "yes" && !booking) || (filterState.hasBooking === "no" && booking)) {
        return false;
      }
    }

    if (!matchesDateFilter(prospect)) {
      return false;
    }

    return true;
  });
});

const sortedProspects = computed(() => {
  const list = [...filteredProspects.value];

  list.sort((left, right) => {
    const compare =
      sortKey.value === "business"
        ? left.businessName.localeCompare(right.businessName)
        : sortKey.value === "status"
          ? rowStatusLabel(left).localeCompare(rowStatusLabel(right))
          : sortKey.value === "activity"
            ? new Date(getLastActivityAt(left) ?? left.createdAt).getTime() -
              new Date(getLastActivityAt(right) ?? right.createdAt).getTime()
            : Number(right.opportunityScore) - Number(left.opportunityScore);

    return sortDirection.value === "asc" ? compare : -compare;
  });

  return list;
});

const totalFilteredProspects = computed(() => sortedProspects.value.length);
const pageCount = computed(() => Math.max(1, Math.ceil(totalFilteredProspects.value / tablePageSize.value)));
const paginatedProspects = computed(() => {
  const start = (currentPage.value - 1) * tablePageSize.value;
  return sortedProspects.value.slice(start, start + tablePageSize.value);
});
const selectedCount = computed(() => selectedProspectIds.value.length);
const visibleRowIds = computed(() => paginatedProspects.value.map((prospect) => prospect.id));
const allVisibleSelected = computed(
  () => visibleRowIds.value.length > 0 && visibleRowIds.value.every((id) => selectedProspectIds.value.includes(id)),
);
const selectedVisibleCount = computed(
  () => visibleRowIds.value.filter((id) => selectedProspectIds.value.includes(id)).length,
);
const currentPageRangeLabel = computed(() => {
  if (sortedProspects.value.length === 0) {
    return "0 results";
  }

  const start = (currentPage.value - 1) * tablePageSize.value + 1;
  const end = Math.min(sortedProspects.value.length, currentPage.value * tablePageSize.value);
  return `Showing ${start}-${end} of ${sortedProspects.value.length}`;
});
const workspaceSummaryCards = computed(() => [
  { label: "Total Prospects", value: prospects.value.length },
  { label: "Research Complete", value: prospects.value.filter((prospect) =>
    ["researched", "drafted", "approved", "sent", "replied", "follow_up_due", "meeting_booked"].includes(prospect.status),
  ).length },
  { label: "Drafts Ready", value: stats.value.draftsReady },
  { label: "Sent Today", value: prospects.value.filter((prospect) => prospect.status === "sent").length },
  { label: "Replies", value: stats.value.replies },
  { label: "Meetings", value: stats.value.meetings },
]);
const selectedNoteKey = computed(() => (selectedProspect.value ? `founder-content-revenue-agent-note:${selectedProspect.value.id}` : ""));
const selectedWebsite = computed(() => (selectedProspect.value ? getProspectWebsiteValue(selectedProspect.value) : ""));
const selectedEmailSubject = computed(
  () => selectedResearch.value?.emailSubject || selectedProspect.value?.latestMessage?.subject || "No draft yet.",
);
const selectedEmailBody = computed(
  () => selectedResearch.value?.emailBody || selectedProspect.value?.latestMessage?.body || "Run the feed to generate the first draft.",
);
const selectedLastActivity = computed(() => (selectedProspect.value ? getLastActivityAt(selectedProspect.value) : undefined));
const selectedMissingFeatures = computed(() => {
  if (!selectedProspect.value) {
    return [];
  }

  const report = selectedProspect.value.research?.report;
  const websiteSignals = report?.websiteSignals;
  const missing: string[] = [];

  if (!websiteSignals?.bookingSoftware) {
    missing.push("Booking software");
  }
  if (!websiteSignals?.contactForm) {
    missing.push("Contact form");
  }
  if (!websiteSignals?.chatWidget) {
    missing.push("Chat widget");
  }
  if (!websiteSignals?.https) {
    missing.push("HTTPS");
  }
  if (!websiteSignals?.analytics?.length) {
    missing.push("Analytics");
  }

  return missing.slice(0, 4);
});
const selectedOpportunityReasons = computed(() => {
  const report = selectedProspect.value?.research?.report;
  return report?.opportunityScoreReasons?.length
    ? report.opportunityScoreReasons
    : selectedProspect.value?.painSummary
      ? [selectedProspect.value.painSummary]
      : [];
});
const selectedQuickStats = computed(() => {
  const report = selectedProspect.value?.research?.report;
  return [
    { label: "Google Rating", value: selectedProspect.value?.rating ? `${selectedProspect.value.rating.toFixed(1)} / 5` : "n/a" },
    { label: "Review Count", value: selectedProspect.value?.reviewCount ?? "0" },
    { label: "AI Readiness", value: report ? `${report.businessProfile.aiReadinessScore} / 100` : "n/a" },
    { label: "Opportunity", value: selectedProspect.value ? formatScore(selectedProspect.value.opportunityScore) : "n/a" },
  ];
});

watch(
  [searchQuery, sortKey, sortDirection, tablePageSize, () => ({ ...filterState })],
  () => {
    currentPage.value = 1;
    saveFiltersToStorage();
  },
  { deep: true },
);

watch(
  feedForm,
  () => {
    scheduleFeedConfigSave();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  cancelFeedConfigSave();
});

watch(selectedProspectId, () => {
  loadNoteDraft();
  if (selectedProspect.value) {
    activeTab.value = "overview";
  }
});

watch(
  paginatedProspects,
  (rows) => {
    if (rows.length === 0) {
      return;
    }

    if (!rows.some((row) => row.id === selectedProspectId.value)) {
      selectProspect(rows[0], { resetReplyDraft: false });
    }
  },
  { immediate: true },
);

function loadNoteDraft(): void {
  if (typeof window === "undefined" || !selectedProspect.value) {
    noteDraft.value = "";
    return;
  }

  const key = `founder-content-revenue-agent-note:${selectedProspect.value.id}`;
  noteDraft.value = window.localStorage.getItem(key) ?? "";
}

function saveNoteDraft(): void {
  if (typeof window === "undefined" || !selectedProspect.value) {
    return;
  }

  const key = `founder-content-revenue-agent-note:${selectedProspect.value.id}`;
  window.localStorage.setItem(key, noteDraft.value);
}

watch(noteDraft, () => {
  saveNoteDraft();
});

function syncUpdatedProspect(updated: RevenueAgentProspect, resetReplyDraft = false): void {
  prospects.value = prospects.value.map((prospect) => (prospect.id === updated.id ? updated : prospect));
  selectProspect(updated, { resetReplyDraft });
}

async function submitProspectAction(
  prospectId: string,
  action: RevenueAgentActionType,
  followUpDays?: number,
): Promise<RevenueAgentProspect> {
  const response = await requestRevenueAgentAction(prospectId, {
    businessId: selectedBusinessId.value,
    action,
    followUpDays,
  });

  return response.prospect;
}

async function runBulkAction(
  action: RevenueAgentActionType,
  options: { followUpDays?: number; label: string },
): Promise<void> {
  if (selectedProspectIds.value.length === 0) {
    errorMessage.value = "Select at least one prospect first.";
    return;
  }

  bulkActionLoading.value = action;
  errorMessage.value = "";

  let successCount = 0;
  let failureCount = 0;

  try {
    for (const prospectId of selectedProspectIds.value) {
      try {
        const updated = await submitProspectAction(prospectId, action, options.followUpDays);
        prospects.value = prospects.value.map((prospect) => (prospect.id === updated.id ? updated : prospect));
        successCount += 1;
      } catch {
        failureCount += 1;
      }
    }

    if (selectedProspect.value) {
      const refreshed = prospects.value.find((prospect) => prospect.id === selectedProspect.value?.id);
      if (refreshed) {
        selectProspect(refreshed, { resetReplyDraft: false });
      }
    }

    feedbackMessage.value =
      failureCount === 0
        ? `${options.label} completed for ${successCount} prospect${successCount === 1 ? "" : "s"}.`
        : `${options.label} completed for ${successCount} prospect${successCount === 1 ? "" : "s"} with ${failureCount} failure${failureCount === 1 ? "" : "s"}.`;
  } finally {
    bulkActionLoading.value = "";
  }
}

async function runBulkGenerateDrafts(): Promise<void> {
  if (selectedProspectIds.value.length === 0) {
    errorMessage.value = "Select at least one prospect first.";
    return;
  }

  bulkActionLoading.value = "generate_drafts";
  errorMessage.value = "";

  let successCount = 0;

  try {
    for (const prospectId of selectedProspectIds.value) {
      try {
        const response = await requestRevenueAgentResearchRegenerate(prospectId, {
          businessId: selectedBusinessId.value,
        });
        prospects.value = prospects.value.map((prospect) => (prospect.id === response.prospect.id ? response.prospect : prospect));
        successCount += 1;
      } catch {
        // Keep going so one bad record does not block the rest.
      }
    }

    const refreshed = selectedProspect.value
      ? prospects.value.find((prospect) => prospect.id === selectedProspect.value?.id)
      : null;
    if (refreshed) {
      selectProspect(refreshed, { resetReplyDraft: false });
    }

    feedbackMessage.value = `Generated or refreshed drafts for ${successCount} prospect${successCount === 1 ? "" : "s"}.`;
  } finally {
    bulkActionLoading.value = "";
  }
}

function exportSelectedProspects(): void {
  if (selectedProspectIds.value.length === 0) {
    errorMessage.value = "Select at least one prospect first.";
    return;
  }

  const rows = prospects.value.filter((prospect) => selectedProspectIds.value.includes(prospect.id));
  const header = [
    "businessName",
    "email",
    "phone",
    "website",
    "status",
    "opportunityScore",
    "source",
    "lastActivity",
  ];
  const csv = [
    header.join(","),
    ...rows.map((prospect) =>
      [
        prospect.businessName,
        prospect.email ?? "",
        prospect.phone ?? "",
        getProspectWebsiteValue(prospect),
        rowStatusLabel(prospect),
        String(prospect.opportunityScore),
        prospect.source,
        getLastActivityAt(prospect) ?? "",
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const objectUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "revenue-agent-selected-prospects.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
  feedbackMessage.value = "Selected prospects exported.";
}

function moveDetailSelection(direction: 1 | -1): void {
  const rows = paginatedProspects.value;
  if (rows.length === 0) {
    return;
  }

  const currentIndex = rows.findIndex((row) => row.id === selectedProspectId.value);
  const nextIndex = currentIndex >= 0 ? Math.min(rows.length - 1, Math.max(0, currentIndex + direction)) : 0;
  selectProspect(rows[nextIndex], { resetReplyDraft: false });
}

function handleRowKeydown(event: KeyboardEvent, prospect: RevenueAgentProspect): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveDetailSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveDetailSelection(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    selectProspect(prospect);
  } else if (event.key === " ") {
    event.preventDefault();
    toggleBulkSelection(prospect.id);
  }
}

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
      description: `${analysis.intent.replaceAll("_", " ")} - ${Math.round(analysis.confidence)}% confidence.`,
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
            <p>${escapeHtml(analysis.sentiment)} sentiment - ${Math.round(analysis.confidence)}% confidence</p>
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

function openAuditPreview(): void {
  if (!selectedProspect.value) {
    errorMessage.value = "Select a prospect first.";
    return;
  }

  const content = buildAuditReportHtml(selectedProspect.value, selectedReport.value, replyAnalysis.value, selectedTimeline.value);
  const popup = window.open("", "_blank", "width=1280,height=1400");

  if (!popup) {
    errorMessage.value = "Pop-up blocked the audit preview.";
    return;
  }

  popup.document.open();
  popup.document.write(content);
  popup.document.close();
  popup.focus();
  feedbackMessage.value = "Full audit preview opened.";
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
  cancelFeedConfigSave();
  hasHydratedFeedForm = false;

  if (!selectedBusinessId.value) {
    workspace.value = null;
    prospects.value = [];
    selectedProspectId.value = "";
    workflowSnapshot.value = null;
    feedForm.value = { ...DEFAULT_REVENUE_FEED_CONFIG };
    isHydratingFeedForm.value = false;
    return;
  }

  const response = await requestRevenueAgentWorkspace(selectedBusinessId.value);
  workspace.value = response;
  prospects.value = response.prospects;
  hydrateFeedFormForWorkspace(response.feedConfig);
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
    loadFiltersFromStorage();
    await loadBusinesses();
    await loadWorkspace();
    applyCalendarConnectionFeedback();
    loadNoteDraft();
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
    hydrateFeedFormForWorkspace(response.workspace.feedConfig);
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
    <section class="revenue-header">
      <div class="revenue-header-copy">
        <p class="eyebrow">Revenue Agent - Sales operating system</p>
        <h1>Revenue Agent</h1>
        <p class="lede">
          Find leads, research them, draft outreach, and move prospects from discovery to sent emails without
          leaving the table.
        </p>
      </div>
      <div class="header-meta">
        <div class="workspace-pill">
          <span>Workspace</span>
          <strong>{{ workspaceName }}</strong>
          <small>{{ selectedBusinessId ? "Live workspace" : "No workspace selected" }}</small>
        </div>
        <div class="workspace-pill">
          <span>Knowledge</span>
          <strong>{{ workspaceKnowledgeStatusLabel }}</strong>
          <small>
            {{ workspaceKnowledgeProfile?.voiceSummary || `${workspaceKnowledgeSources.length} source${workspaceKnowledgeSources.length === 1 ? "" : "s"} in DB` }}
          </small>
        </div>
        <div class="workspace-pill">
          <span>Calendar</span>
          <strong>{{ googleCalendarConnection?.connected ? "Connected" : "Disconnected" }}</strong>
          <small>{{ googleCalendarConnection?.accountEmail || "Use Google Calendar for booking handoff" }}</small>
        </div>
      </div>
    </section>

    <p v-if="errorMessage" class="flash error">{{ errorMessage }}</p>
    <p v-else-if="feedbackMessage" class="flash">{{ feedbackMessage }}</p>

    <section v-if="isLoading" class="empty-shell">
      <p>Loading revenue workspace...</p>
    </section>

    <template v-else>
      <section v-if="!selectedBusinessId" class="empty-shell">
        <h2>Revenue Agent needs a workspace.</h2>
        <p>Create or select a workspace first, then run the daily feed.</p>
        <router-link class="primary-action" :to="appRoutes.onboardingWorkspace">Create workspace</router-link>
      </section>

      <template v-else>
        <section class="summary-grid">
          <article v-for="card in workspaceSummaryCards" :key="card.label" class="summary-card">
            <span>{{ card.label }}</span>
            <strong>{{ card.value }}</strong>
          </article>
        </section>

        <section v-if="workspaceKnowledge" class="toolbar-card knowledge-panel">
          <div class="section-head">
            <div>
              <p class="panel-kicker">Workspace knowledge</p>
              <h2>Use the same voice, CTA, and signature in every draft</h2>
              <p class="panel-note">
                This pulls from the workspace knowledge base, the email settings table, and the connected sources in the database.
              </p>
            </div>
            <router-link class="secondary-action link-action" :to="appRoutes.settingsPreferences">
              Manage knowledge
            </router-link>
          </div>

          <div class="knowledge-grid">
            <article class="mini-card">
              <span>Voice</span>
              <strong>{{ workspaceKnowledgeProfile?.voiceSummary || "Not defined" }}</strong>
            </article>
            <article class="mini-card">
              <span>Audience</span>
              <strong>{{ workspaceKnowledgeProfile?.audienceSummary || "Not defined" }}</strong>
            </article>
            <article class="mini-card">
              <span>Positioning</span>
              <strong>{{ workspaceKnowledgeProfile?.positioningSummary || "Not defined" }}</strong>
            </article>
            <article class="mini-card">
              <span>Email identity</span>
              <strong>{{ workspaceKnowledgeEmailIdentity?.fromName || workspaceKnowledgeEmailIdentity?.replyToEmail || "Not defined" }}</strong>
            </article>
          </div>

          <div class="knowledge-source-row">
            <span v-for="source in workspaceKnowledgeSources.slice(0, 4)" :key="source.id" class="tag-pill">
              {{ source.title || source.sourceType }}
            </span>
            <span v-if="workspaceKnowledgeSources.length === 0" class="tag-pill">No knowledge sources yet</span>
          </div>
        </section>

        <section class="toolbar-stack">
          <div class="toolbar-card search-toolbar">
            <label class="field search-field">
              <span>Search</span>
              <input v-model="searchQuery" type="search" placeholder="Business, email, phone, note, tag" />
            </label>
            <div class="toolbar-actions">
              <button type="button" class="secondary-action" @click="saveCurrentFilterPreset">Save Filter</button>
            </div>
            <div v-if="savedFilterPresets.length" class="preset-chips">
              <button
                v-for="preset in savedFilterPresets"
                :key="preset.name"
                type="button"
                class="chip-button"
                @click="applyFilterPreset(preset)"
              >
                {{ preset.name }}
              </button>
            </div>
          </div>

          <div class="toolbar-card filter-toolbar">
            <label class="field">
              <span>Industry</span>
              <input v-model="filterState.industry" type="text" placeholder="Med Spa" />
            </label>
            <label class="field">
              <span>City</span>
              <input v-model="filterState.city" type="text" placeholder="Salt Lake City" />
            </label>
            <label class="field">
              <span>State</span>
              <input v-model="filterState.state" type="text" placeholder="UT" />
            </label>
            <label class="field">
              <span>Lead Source</span>
              <select v-model="filterState.leadSource">
                <option value="all">All</option>
                <option value="google_business">Google Business</option>
                <option value="csv_import">CSV import</option>
              </select>
            </label>
            <label class="field">
              <span>Min Score</span>
              <input v-model.number="filterState.minScore" type="number" min="0" max="100" />
            </label>
            <label class="field">
              <span>Status</span>
              <select v-model="filterState.status">
                <option value="all">All</option>
                <option value="new">New</option>
                <option value="researching">Researching</option>
                <option value="research_ready">Research Ready</option>
                <option value="draft_ready">Draft Ready</option>
                <option value="approved">Approved</option>
                <option value="sent">Sent</option>
                <option value="replied">Replied</option>
                <option value="meeting">Meeting</option>
                <option value="closed_won">Closed Won</option>
                <option value="closed_lost">Closed Lost</option>
              </select>
            </label>
            <label class="field">
              <span>Has Email</span>
              <select v-model="filterState.hasEmail">
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label class="field">
              <span>Has Website</span>
              <select v-model="filterState.hasWebsite">
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label class="field">
              <span>Has Booking</span>
              <select v-model="filterState.hasBooking">
                <option value="all">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label class="field">
              <span>Date</span>
              <select v-model="filterState.dateWindow">
                <option value="all">All</option>
                <option value="today">Today</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
            </label>
          </div>

          <div class="toolbar-card feed-toolbar">
            <div class="feed-fields">
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
                <span>Limit</span>
                <input v-model.number="feedForm.dailyLeadLimit" type="number" min="1" max="25" />
              </label>
              <label class="field">
                <span>Provider</span>
                <select v-model="feedForm.provider">
                  <option value="google_business">Google Business</option>
                  <option value="csv_import">CSV import</option>
                </select>
              </label>
            </div>
            <div class="feed-actions">
              <button v-if="isCsvImportSelected" type="button" class="secondary-action" @click="loadSampleCsv">
                Load sample CSV
              </button>
              <p v-if="isGoogleBusinessSelected" class="helper-copy">Requires `GOOGLE_PLACES_API_KEY` on the backend.</p>
              <button type="button" class="primary-action" :disabled="isRunningFeed" @click="runFeed">
                {{ isRunningFeed ? "Running feed..." : "Run Daily Feed" }}
              </button>
            </div>
          </div>

          <div v-if="isCsvImportSelected" class="toolbar-card csv-card">
            <label class="field">
              <span>CSV text</span>
              <textarea
                v-model="feedForm.csvText"
                rows="5"
                spellcheck="false"
                placeholder="businessName,website,email,phone,city,state,industry,sourceUrl,rating,reviewCount,painSignals,tags"
              ></textarea>
            </label>
          </div>
        </section>

        <section class="workspace-grid">
          <article class="table-panel">
            <div class="panel-head">
              <div>
                <p class="panel-kicker">Prospect table</p>
                <h2>{{ currentPageRangeLabel }}</h2>
                <p class="panel-note">{{ totalFilteredProspects }} matched - {{ selectedCount }} selected</p>
              </div>
              <div class="panel-head-actions">
                <label class="field page-size-field">
                  <span>Page size</span>
                  <select v-model="tablePageSize">
                    <option :value="12">12</option>
                    <option :value="24">24</option>
                    <option :value="50">50</option>
                  </select>
                </label>
              </div>
            </div>

            <div v-if="selectedCount > 0" class="bulk-toolbar">
              <div class="bulk-summary">
                <strong>{{ selectedCount }} Selected</strong>
                <span>{{ selectedVisibleCount }} on this page</span>
              </div>
              <div class="bulk-actions">
                <button
                  type="button"
                  class="primary-action"
                  :disabled="bulkActionLoading === 'generate_drafts'"
                  @click="runBulkGenerateDrafts"
                >
                  {{ bulkActionLoading === 'generate_drafts' ? "Generating..." : "Generate Drafts" }}
                </button>
                <button
                  type="button"
                  class="secondary-action"
                  :disabled="bulkActionLoading === 'approve_draft'"
                  @click="runBulkAction('approve_draft', { label: 'Approve' })"
                >
                  {{ bulkActionLoading === 'approve_draft' ? "Approving..." : "Approve" }}
                </button>
                <button
                  type="button"
                  class="secondary-action"
                  :disabled="bulkActionLoading === 'send_email'"
                  @click="runBulkAction('send_email', { label: 'Send emails' })"
                >
                  {{ bulkActionLoading === 'send_email' ? "Sending..." : "Send Emails" }}
                </button>
                <button
                  type="button"
                  class="secondary-action"
                  :disabled="bulkActionLoading === 'schedule_follow_up'"
                  @click="runBulkAction('schedule_follow_up', { followUpDays: 3, label: 'Schedule follow-up' })"
                >
                  {{ bulkActionLoading === 'schedule_follow_up' ? "Scheduling..." : "Schedule Follow-up" }}
                </button>
                <button type="button" class="secondary-action" @click="exportSelectedProspects">Export</button>
                <details class="more-menu">
                  <summary>More</summary>
                  <div class="more-menu-panel">
                    <button type="button" @click="openAuditPreview">Open audit</button>
                    <button type="button" @click="copyAuditReport">Copy audit</button>
                    <button type="button" @click="downloadAuditReport">Download audit</button>
                    <button type="button" @click="clearBulkSelection">Clear selection</button>
                  </div>
                </details>
              </div>
            </div>

            <div class="table-shell">
              <table class="prospect-table">
                <thead>
                  <tr>
                    <th class="checkbox-col">
                      <input type="checkbox" :checked="allVisibleSelected" @change="toggleVisibleSelection" />
                    </th>
                    <th>
                      <button type="button" class="column-sort" @click="toggleSort('business')">
                        Business
                        <span class="sort-indicator">
                          <component :is="sortIndicatorIcon('business')" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                        </span>
                      </button>
                    </th>
                    <th>
                      <button type="button" class="column-sort" @click="toggleSort('score')">
                        Opportunity Score
                        <span class="sort-indicator">
                          <component :is="sortIndicatorIcon('score')" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                        </span>
                      </button>
                    </th>
                    <th>
                      <button type="button" class="column-sort" @click="toggleSort('status')">
                        Status
                        <span class="sort-indicator">
                          <component :is="sortIndicatorIcon('status')" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                        </span>
                      </button>
                    </th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Website</th>
                    <th>
                      <button type="button" class="column-sort" @click="toggleSort('activity')">
                        Last Activity
                        <span class="sort-indicator">
                          <component :is="sortIndicatorIcon('activity')" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                        </span>
                      </button>
                    </th>
                    <th class="actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="paginatedProspects.length === 0" class="table-empty-row">
                    <td colspan="9">No prospects match the current filters.</td>
                  </tr>
                  <tr
                    v-for="(prospect, index) in paginatedProspects"
                    :key="prospect.id"
                    :class="{ selected: isProspectSelectedForDetail(prospect.id), bulk: isBulkSelected(prospect.id) }"
                    tabindex="0"
                    :aria-selected="isProspectSelectedForDetail(prospect.id)"
                    @click="selectProspect(prospect)"
                    @keydown="handleRowKeydown($event, prospect)"
                  >
                    <td class="checkbox-col" @click.stop>
                      <input
                        type="checkbox"
                        :checked="isBulkSelected(prospect.id)"
                        :aria-label="`Select ${prospect.businessName}`"
                        @change="toggleBulkSelection(prospect.id)"
                      />
                    </td>
                    <td class="business-cell">
                      <strong>{{ prospect.businessName }}</strong>
                      <span>{{ prospect.industry }} - {{ prospect.city || "Unknown city" }}{{ prospect.state ? `, ${prospect.state}` : "" }}</span>
                    </td>
                    <td><strong>{{ formatScore(prospect.opportunityScore) }}</strong></td>
                    <td>
                      <span class="status-badge" :class="rowStatusToneClass(prospect)">
                        <component
                          :is="resolveProspectStatusIcon(prospect.status)"
                          :size="iconSizes.dense"
                          :stroke-width="iconStrokeWidth"
                        />
                        {{ rowStatusLabel(prospect) }}
                      </span>
                    </td>
                    <td>
                      <a v-if="prospect.email" :href="`mailto:${prospect.email}`" @click.stop>{{ prospect.email }}</a>
                      <span v-else class="muted-value">No email</span>
                    </td>
                    <td>
                      <a v-if="prospect.phone" :href="`tel:${prospect.phone}`" @click.stop>{{ prospect.phone }}</a>
                      <span v-else class="muted-value">No phone</span>
                    </td>
                    <td>
                      <a v-if="getProspectWebsiteValue(prospect)" :href="getProspectWebsiteValue(prospect)" target="_blank" rel="noreferrer" @click.stop>
                        Visit
                      </a>
                      <span v-else class="muted-value">None</span>
                    </td>
                    <td>{{ formatRelativeTime(getLastActivityAt(prospect)) }}</td>
                    <td class="actions-col">
                      <button type="button" class="table-action" @click.stop="selectProspect(prospect)">
                        <span class="detail-action-icon">
                          <component :is="actionIcons.open" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                        </span>
                        Open
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="table-footer">
              <span>{{ currentPageRangeLabel }}</span>
              <div class="pagination">
                <button type="button" class="secondary-action" :disabled="currentPage <= 1" @click="currentPage -= 1">
                  <span class="detail-action-icon">
                    <component :is="actionIcons.chevronLeft" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                  </span>
                  Prev
                </button>
                <span>{{ currentPage }} / {{ pageCount }}</span>
                <button type="button" class="secondary-action" :disabled="currentPage >= pageCount" @click="currentPage += 1">
                  <span class="detail-action-icon">
                    <component :is="actionIcons.chevronRight" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                  </span>
                  Next
                </button>
              </div>
            </div>
          </article>

          <aside class="detail-panel">
            <div class="detail-head">
              <div v-if="selectedProspect">
                <p class="panel-kicker">Research panel</p>
                <h2>{{ selectedProspect.businessName }}</h2>
                <p class="panel-note">
                  {{ selectedProspect.industry }} - {{ selectedProspect.city || "Unknown city" }}{{ selectedProspect.state ? `, ${selectedProspect.state}` : "" }}
                </p>
              </div>
              <div v-if="selectedProspect" class="detail-score">
                <strong>{{ formatScore(selectedProspect.opportunityScore) }}</strong>
                <span class="status-badge" :class="rowStatusToneClass(selectedProspect)">
                  <component
                    :is="resolveProspectStatusIcon(selectedProspect.status)"
                    :size="iconSizes.dense"
                    :stroke-width="iconStrokeWidth"
                  />
                  {{ rowStatusLabel(selectedProspect) }}
                </span>
              </div>
            </div>

            <div class="detail-tabs">
              <button type="button" class="tab-button" :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'">
                Overview
              </button>
              <button type="button" class="tab-button" :class="{ active: activeTab === 'email' }" @click="activeTab = 'email'">
                Email Draft
              </button>
              <button type="button" class="tab-button" :class="{ active: activeTab === 'activity' }" @click="activeTab = 'activity'">
                Activity
              </button>
              <button type="button" class="tab-button" :class="{ active: activeTab === 'notes' }" @click="activeTab = 'notes'">
                Notes
              </button>
            </div>

            <div v-if="!selectedProspect" class="empty-panel">
              Select a row to load the research, email draft, activity timeline, and notes panel.
            </div>

            <div v-else class="detail-content">
              <template v-if="activeTab === 'overview'">
                <section class="section-card">
                  <div class="section-head">
                    <div>
                      <p class="panel-kicker">Overview</p>
                      <h3>Account summary</h3>
                    </div>
                    <div class="detail-actions">
                      <a v-if="selectedWebsite" class="secondary-action link-action" :href="selectedWebsite" target="_blank" rel="noreferrer">
                        <span class="detail-action-icon">
                          <component :is="actionIcons.open" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                        </span>
                        Visit Website
                      </a>
                      <button type="button" class="secondary-action" @click="openAuditPreview">
                        <span class="detail-action-icon">
                          <component :is="actionIcons.eye" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                        </span>
                        View Full Audit
                      </button>
                    </div>
                  </div>

                  <div class="overview-grid">
                    <div class="mini-card">
                      <span>Business</span>
                      <strong>{{ selectedProspect.businessName }}</strong>
                    </div>
                    <div class="mini-card">
                      <span>Opportunity Score</span>
                      <strong>{{ formatScore(selectedProspect.opportunityScore) }}</strong>
                    </div>
                    <div class="mini-card">
                      <span>Contact</span>
                      <strong>{{ selectedProspect.email || selectedProspect.phone || "Not available" }}</strong>
                    </div>
                    <div class="mini-card">
                      <span>Website</span>
                      <strong>{{ selectedWebsite || "Not available" }}</strong>
                    </div>
                  </div>
                </section>

                <section class="section-card">
                  <p class="panel-kicker">Quick stats</p>
                  <div class="quick-grid">
                    <article v-for="stat in selectedQuickStats" :key="stat.label" class="quick-card">
                      <span>{{ stat.label }}</span>
                      <strong>{{ stat.value }}</strong>
                    </article>
                  </div>
                </section>

                <section class="section-card">
                  <p class="panel-kicker">AI summary</p>
                  <p>{{ selectedReport?.businessSummary || selectedProspect.painSummary || "Waiting on research." }}</p>
                </section>

                <section class="section-card">
                  <p class="panel-kicker">Recommended offer</p>
                  <p>{{ selectedReport?.salesStrategy.recommendedOffer || selectedProspect.suggestedOfferAngle || "No offer yet." }}</p>
                </section>

                <section class="section-card">
                  <p class="panel-kicker">Missing features</p>
                  <div class="tag-row">
                    <span v-for="item in selectedMissingFeatures" :key="item" class="tag-pill">{{ item }}</span>
                    <span v-if="selectedMissingFeatures.length === 0" class="tag-pill">No obvious gaps</span>
                  </div>
                </section>

                <section class="section-card">
                  <p class="panel-kicker">Opportunity reasons</p>
                  <ul class="bullet-list">
                    <li v-for="item in selectedOpportunityReasons" :key="item">{{ item }}</li>
                    <li v-if="selectedOpportunityReasons.length === 0">No score reasoning yet.</li>
                  </ul>
                </section>

                <section class="section-card">
                  <p class="panel-kicker">Source coverage</p>
                  <div class="coverage-grid">
                    <div v-for="item in sourceCoverageRows" :key="item.label" class="coverage-card">
                      <strong>{{ item.label }}</strong>
                      <span>{{ formatCoverageStatus(item.coverage?.status || "unknown") }}</span>
                      <small v-if="item.coverage?.note">{{ item.coverage.note }}</small>
                    </div>
                  </div>
                </section>
              </template>

              <template v-else-if="activeTab === 'email'">
                <section class="section-card">
                  <div class="section-head">
                    <div>
                      <p class="panel-kicker">Email draft</p>
                      <h3>Ready to approve or send</h3>
                    </div>
                    <div class="detail-actions">
                      <button
                        type="button"
                        class="secondary-action"
                        :disabled="actionLoadingId === `${selectedProspect.id}:regenerate_research`"
                        @click="regenerateResearch"
                      >
                        <span class="detail-action-icon">
                          <component :is="actionIcons.refresh" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                        </span>
                        {{ actionLoadingId === `${selectedProspect.id}:regenerate_research` ? "Regenerating..." : "Regenerate" }}
                      </button>
                      <button
                        type="button"
                        class="secondary-action"
                        :disabled="actionLoadingId === `${selectedProspect.id}:approve_draft`"
                        @click="performAction('approve_draft')"
                      >
                        <span class="detail-action-icon">
                          <component :is="actionIcons.approve" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                        </span>
                        {{ actionLoadingId === `${selectedProspect.id}:approve_draft` ? "Approving..." : "Approve" }}
                      </button>
                      <button
                        type="button"
                        class="primary-action"
                        :disabled="actionLoadingId === `${selectedProspect.id}:send_email`"
                        @click="performAction('send_email')"
                      >
                        <span class="detail-action-icon">
                          <component :is="actionIcons.send" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                        </span>
                        {{ actionLoadingId === `${selectedProspect.id}:send_email` ? "Sending..." : "Send" }}
                      </button>
                    </div>
                  </div>

                  <div class="mini-stack">
                    <div class="mini-card">
                      <span>Subject</span>
                      <strong>{{ selectedEmailSubject }}</strong>
                    </div>
                    <div class="mini-card">
                      <span>Preview</span>
                      <p class="draft-body">{{ selectedEmailBody }}</p>
                    </div>
                  </div>

                  <div class="action-row">
                    <button type="button" class="secondary-action" @click="copyAuditReport">
                      <span class="detail-action-icon">
                        <component :is="actionIcons.copy" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                      </span>
                      Copy Audit
                    </button>
                    <button type="button" class="secondary-action" @click="downloadAuditReport">
                      <span class="detail-action-icon">
                        <component :is="actionIcons.download" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                      </span>
                      Download Audit
                    </button>
                    <button type="button" class="secondary-action" @click="printAuditReport">
                      <span class="detail-action-icon">
                        <component :is="actionIcons.print" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                      </span>
                      Print / Save PDF
                    </button>
                    <button type="button" class="secondary-action" :disabled="isExportingReport" @click="downloadServerExport">
                      <span class="detail-action-icon">
                        <component :is="actionIcons.open" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                      </span>
                      {{ isExportingReport ? "Exporting..." : "Server Export" }}
                    </button>
                  </div>
                </section>
              </template>

              <template v-else-if="activeTab === 'activity'">
                <section class="section-card">
                  <div class="section-head">
                    <div>
                      <p class="panel-kicker">Activity</p>
                      <h3>Timeline</h3>
                    </div>
                    <label class="inline-field">
                      <span>Filter</span>
                      <select v-model="timelineEventFilter">
                        <option value="all">All events</option>
                        <option value="lead_discovered">Lead discovered</option>
                        <option value="research_generated">Research completed</option>
                        <option value="draft_created">Draft created</option>
                        <option value="draft_approved">Draft approved</option>
                        <option value="sent">Email sent</option>
                        <option value="reply_received">Reply received</option>
                        <option value="reply_analyzed">Reply analyzed</option>
                        <option value="meeting_booked">Meeting booked</option>
                        <option value="follow_up_scheduled">Follow-up scheduled</option>
                        <option value="meeting_prep_created">Meeting prep created</option>
                        <option value="not_interested">Not interested</option>
                      </select>
                    </label>
                  </div>

                  <div class="quick-grid">
                    <article class="quick-card"><span>Total events</span><strong>{{ timelineStats.total }}</strong></article>
                    <article class="quick-card"><span>Replies</span><strong>{{ timelineStats.replies }}</strong></article>
                    <article class="quick-card"><span>Meetings</span><strong>{{ timelineStats.meetings }}</strong></article>
                    <article class="quick-card"><span>Follow-ups</span><strong>{{ timelineStats.followUps }}</strong></article>
                  </div>

                  <p v-if="selectedTimeline.length === 0" class="muted-copy">No timeline yet.</p>
                  <p v-else-if="displayedTimeline.length === 0" class="muted-copy">No events match the current filter.</p>
                  <div v-else class="timeline-list">
                    <article v-for="item in displayedTimeline" :key="item.id" class="timeline-item" :class="item.tone">
                      <div class="timeline-dot"></div>
                      <div class="timeline-copy">
                        <div class="timeline-head">
                          <strong>{{ item.title }}</strong>
                          <span>{{ formatTimelineTimestamp(item.occurredAt) }}</span>
                        </div>
                        <p>{{ item.description }}</p>
                      </div>
                    </article>
                  </div>
                </section>

                <section class="section-card">
                  <div class="section-head">
                    <div>
                      <p class="panel-kicker">Reply intake</p>
                      <h3>Classify inbound replies</h3>
                    </div>
                    <button type="button" class="secondary-action" :disabled="isAnalyzingReply || !replyText.trim()" @click="analyzeReply">
                      <span class="detail-action-icon">
                        <component :is="actionIcons.search" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                      </span>
                      {{ isAnalyzingReply ? "Analyzing..." : "Analyze Reply" }}
                    </button>
                  </div>

                  <label class="field">
                    <span>Inbound reply</span>
                    <textarea
                      v-model="replyText"
                      rows="4"
                      spellcheck="false"
                      placeholder="Thanks for the note. I'm interested, but can we see more details?"
                    ></textarea>
                  </label>

                  <div v-if="replyAnalysis" class="reply-grid">
                    <article class="quick-card"><span>Intent</span><strong>{{ replyAnalysis.intent.replaceAll("_", " ") }}</strong></article>
                    <article class="quick-card"><span>Sentiment</span><strong>{{ replyAnalysis.sentiment }}</strong></article>
                    <article class="quick-card"><span>Confidence</span><strong>{{ Math.round(replyAnalysis.confidence) }}%</strong></article>
                    <article class="quick-card"><span>Next step</span><strong>{{ replyAnalysis.suggestedNextStep.replaceAll("_", " ") }}</strong></article>
                  </div>

                  <div v-if="replyAnalysis" class="section-stack">
                    <p><strong>Summary</strong></p>
                    <p>{{ replyAnalysis.summary }}</p>
                    <p><strong>Suggested response</strong></p>
                    <pre class="draft-body">{{ replyAnalysis.suggestedReply }}</pre>
                  </div>

                  <div class="section-card inner-card">
                    <div class="section-head">
                      <div>
                        <p class="panel-kicker">Meeting handoff</p>
                        <h4>Google Calendar</h4>
                      </div>
                      <div class="detail-actions">
                        <button v-if="!isGoogleCalendarConnected" type="button" class="secondary-action" @click="connectGoogleCalendar">
                          <span class="detail-action-icon">
                            <component :is="actionIcons.add" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                          </span>
                          Connect
                        </button>
                        <button v-else type="button" class="secondary-action" @click="disconnectGoogleCalendar">
                          <span class="detail-action-icon">
                            <component :is="actionIcons.close" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                          </span>
                          Disconnect
                        </button>
                        <button type="button" class="primary-action" :disabled="actionLoadingId === `${selectedProspect.id}:book_meeting`" @click="performAction('book_meeting')">
                          <span class="detail-action-icon">
                            <component :is="actionIcons.send" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                          </span>
                          {{ actionLoadingId === `${selectedProspect.id}:book_meeting` ? "Booking..." : "Book Meeting" }}
                        </button>
                      </div>
                    </div>
                    <p class="muted-copy">
                      {{
                        googleCalendarConnection?.connected
                          ? `Connected as ${googleCalendarConnection.accountEmail || googleCalendarConnection.googleAccountId || "Google account"}`
                          : "Connect Google Calendar to create an event when the meeting is booked."
                      }}
                    </p>
                  </div>
                </section>
              </template>

              <template v-else>
                <section class="section-card">
                  <div class="section-head">
                    <div>
                      <p class="panel-kicker">Notes</p>
                      <h3>Internal notes and tasks</h3>
                    </div>
                    <p class="muted-copy">{{ selectedLastActivity ? `Last activity ${formatRelativeTime(selectedLastActivity)}` : "No activity yet" }}</p>
                  </div>

                  <label class="field">
                    <span>Internal note</span>
                    <textarea v-model="noteDraft" rows="6" spellcheck="false" placeholder="Log context, objections, next steps, or follow-up notes."></textarea>
                  </label>

                  <div class="section-stack">
                    <p class="panel-kicker">Tags</p>
                    <div class="tag-row">
                      <span v-for="tag in selectedProspect.opportunityTags" :key="tag" class="tag-pill">{{ tag }}</span>
                      <span v-if="selectedProspect.opportunityTags.length === 0" class="tag-pill">No tags yet</span>
                    </div>
                  </div>

                  <div class="section-stack">
                    <p class="panel-kicker">Tasks</p>
                    <div v-if="(selectedProspect.tasks?.length ?? 0) === 0" class="muted-copy">No tasks yet.</div>
                    <div v-else class="task-list">
                      <article v-for="task in selectedProspect.tasks || []" :key="task.id" class="task-item">
                        <div>
                          <strong>{{ formatTimelineTaskLabel(task.type) }}</strong>
                          <p>{{ task.status }} - {{ formatTimelineTimestamp(task.dueAt) }}</p>
                        </div>
                        <span class="status-badge" :class="task.status === 'done' ? 'tone-approved' : task.status === 'failed' ? 'tone-lost' : 'tone-follow-up'">
                          {{ task.status }}</span>
                      </article>
                    </div>
                  </div>
                </section>
              </template>
            </div>
          </aside>
        </section>
      </template>
    </template>
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
  background:
    radial-gradient(circle at top left, rgba(217, 110, 63, 0.12), transparent 34%),
    radial-gradient(circle at top right, rgba(37, 99, 235, 0.06), transparent 26%),
    linear-gradient(180deg, #fffaf5 0%, #faf6f0 100%);
  color: #241913;
}

.revenue-shell {
  min-height: 100vh;
  padding: 24px 20px 28px;
}

.revenue-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 14px;
}

.revenue-header-copy {
  display: grid;
  gap: 8px;
  max-width: 760px;
}

.eyebrow,
.panel-kicker {
  margin: 0;
  color: #9a6a4f;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.revenue-header h1 {
  margin: 0;
  font-size: clamp(2rem, 3vw, 3.2rem);
  line-height: 1;
}

.lede,
.panel-note,
.helper-copy,
.muted-copy,
.empty-shell,
.timeline-copy p,
.task-item p,
.coverage-card small,
.draft-body {
  color: #6f5a4e;
}

.lede {
  margin: 0;
  max-width: 68ch;
  line-height: 1.55;
}

.header-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  gap: 10px;
  min-width: 380px;
}

.workspace-pill {
  padding: 14px 16px;
  border: 1px solid rgba(111, 90, 78, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 10px 24px rgba(62, 36, 19, 0.06);
}

.workspace-pill span,
.summary-card span,
.mini-card span,
.quick-card span,
.coverage-card strong,
.table-footer span,
.task-item p,
.field span,
.inline-field span {
  display: block;
  color: #8b6f60;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.workspace-pill strong,
.summary-card strong,
.mini-card strong,
.quick-card strong {
  display: block;
  margin-top: 8px;
  font-size: 1.05rem;
}

.workspace-pill small {
  display: block;
  margin-top: 4px;
  color: #786055;
}

.flash {
  margin: 0 0 14px;
  padding: 12px 14px;
  border: 1px solid rgba(220, 115, 53, 0.18);
  border-radius: 14px;
  background: rgba(220, 115, 53, 0.08);
  color: #9b4c1d;
  font-weight: 700;
}

.flash.error {
  border-color: rgba(176, 57, 57, 0.18);
  background: rgba(176, 57, 57, 0.08);
  color: #8f3030;
}

.empty-shell {
  display: grid;
  place-items: center;
  gap: 10px;
  min-height: 280px;
  padding: 28px;
  border: 1px solid rgba(111, 90, 78, 0.14);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.84);
  text-align: center;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.summary-card,
.toolbar-card,
.table-panel,
.detail-panel,
.section-card,
.mini-card,
.quick-card,
.coverage-card,
.task-item {
  border: 1px solid rgba(111, 90, 78, 0.14);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 14px 28px rgba(58, 34, 18, 0.05);
}

.summary-card {
  padding: 16px;
}

.knowledge-panel {
  display: grid;
  gap: 14px;
  margin-bottom: 14px;
}

.knowledge-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.knowledge-source-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.toolbar-stack {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}

.toolbar-card {
  padding: 14px;
}

.search-toolbar {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.preset-chips {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip-button,
.table-action,
.tab-button,
.more-menu summary {
  border: 1px solid rgba(111, 90, 78, 0.14);
  border-radius: 999px;
  background: #fff;
  color: #4d3a31;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.chip-button {
  padding: 8px 12px;
}

.filter-toolbar {
  display: grid;
  grid-template-columns: repeat(9, minmax(0, 1fr));
  gap: 10px;
}

.feed-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: end;
}

.feed-fields {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.feed-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
  align-items: center;
}

.csv-card {
  padding-top: 6px;
}

.field,
.inline-field {
  display: grid;
  gap: 6px;
}

.field input,
.field select,
.field textarea,
.inline-field select {
  width: 100%;
  border: 1px solid rgba(111, 90, 78, 0.16);
  border-radius: 14px;
  background: #fff;
  color: #241913;
  font: inherit;
  padding: 11px 12px;
  outline: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;
}

.field textarea {
  min-height: 96px;
  resize: vertical;
}

.field input:focus,
.field select:focus,
.field textarea:focus,
.inline-field select:focus {
  border-color: #d86635;
  box-shadow: 0 0 0 4px rgba(216, 102, 53, 0.12);
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 14px;
  padding: 11px 14px;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  transition:
    transform 0.16s ease,
    box-shadow 0.16s ease,
    opacity 0.16s ease,
    background-color 0.16s ease;
}

.primary-action {
  background: linear-gradient(135deg, #ef7a32, #d65e21);
  color: #fff;
  box-shadow: 0 12px 24px rgba(214, 94, 33, 0.22);
}

.secondary-action,
.table-action,
.tab-button,
.chip-button,
.more-menu summary {
  background: #fff;
  color: #4d3a31;
}

.link-action {
  text-decoration: none;
}

.primary-action:hover:not(:disabled),
.secondary-action:hover:not(:disabled),
.table-action:hover,
.chip-button:hover,
.tab-button:hover,
.more-menu summary:hover {
  transform: translateY(-1px);
}

.primary-action:disabled,
.secondary-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.helper-copy {
  margin: 0;
  align-self: center;
  font-size: 0.85rem;
}

.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(360px, 0.95fr);
  gap: 14px;
  align-items: stretch;
  min-height: 0;
}

.table-panel,
.detail-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.panel-head,
.section-head,
.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.panel-head {
  padding: 16px 16px 0;
}

.panel-head-actions {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.page-size-field {
  min-width: 120px;
}

.bulk-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px 16px;
  margin: 14px 16px 0;
  border: 1px solid rgba(216, 102, 53, 0.12);
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(216, 102, 53, 0.08), rgba(216, 102, 53, 0.04));
}

.bulk-summary {
  display: grid;
  gap: 4px;
}

.bulk-summary strong {
  font-size: 1rem;
}

.bulk-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.more-menu {
  position: relative;
}

.more-menu summary {
  list-style: none;
  padding: 11px 14px;
}

.more-menu summary::-webkit-details-marker {
  display: none;
}

.more-menu-panel {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 5;
  display: grid;
  gap: 6px;
  min-width: 180px;
  padding: 8px;
  border: 1px solid rgba(111, 90, 78, 0.14);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 18px 28px rgba(58, 34, 18, 0.12);
}

.more-menu-panel button {
  border: 0;
  border-radius: 12px;
  padding: 10px 12px;
  background: #f8f5f1;
  color: #4d3a31;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.more-menu-panel button:hover {
  background: #f1ebe5;
}

.table-shell {
  min-height: 0;
  overflow: auto;
  margin-top: 12px;
}

.prospect-table {
  width: 100%;
  min-width: 1100px;
  border-collapse: separate;
  border-spacing: 0;
}

.prospect-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 12px 10px;
  background: #fcfaf7;
  border-bottom: 1px solid rgba(111, 90, 78, 0.12);
  color: #6e584c;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: left;
}

.column-sort {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.sort-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.sort-indicator :deep(svg) {
  display: block;
}

.prospect-table td {
  padding: 12px 10px;
  border-bottom: 1px solid rgba(111, 90, 78, 0.1);
  vertical-align: middle;
}

.prospect-table tbody tr {
  cursor: pointer;
  transition:
    background-color 0.16s ease,
    box-shadow 0.16s ease,
    transform 0.16s ease;
}

.prospect-table tbody tr:hover {
  background: rgba(216, 102, 53, 0.04);
}

.prospect-table tbody tr.selected {
  background: rgba(216, 102, 53, 0.08);
  box-shadow: inset 0 0 0 1px rgba(216, 102, 53, 0.16);
}

.checkbox-col {
  width: 42px;
  text-align: center;
}

input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #d86635;
}

.business-cell {
  display: grid;
  gap: 3px;
}

.business-cell span,
.muted-value {
  color: #705b4e;
  font-size: 0.92rem;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.detail-action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.detail-action-icon :deep(svg) {
  display: block;
}

.tone-new {
  background: #f4efe9;
  color: #6d5b50;
}

.tone-researching,
.tone-research-ready {
  background: #e8f2ff;
  color: #20538a;
}

.tone-draft-ready {
  background: #efe6ff;
  color: #6a3ec1;
}

.tone-approved {
  background: #e5f8ec;
  color: #1d7a43;
}

.tone-sent,
.tone-follow-up {
  background: #fff1d9;
  color: #9a651c;
}

.tone-replied {
  background: #e7f7f6;
  color: #14706e;
}

.tone-won {
  background: #e1f8ea;
  color: #1a7a3c;
}

.tone-lost {
  background: #f4e4e4;
  color: #9b3b3b;
}

.actions-col {
  width: 96px;
  text-align: right;
}

.table-action {
  padding: 8px 11px;
}

.table-empty-row td {
  padding: 26px 18px;
  color: #6f5a4e;
  text-align: center;
}

.table-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding: 12px 16px 16px;
  border-top: 1px solid rgba(111, 90, 78, 0.1);
}

.pagination {
  display: flex;
  gap: 8px;
  align-items: center;
}

.detail-panel {
  min-width: 0;
}

.detail-head {
  padding: 16px 16px 0;
}

.detail-score {
  display: grid;
  justify-items: end;
  gap: 8px;
}

.detail-score strong {
  font-size: 1.4rem;
}

.detail-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 16px 0;
  border-bottom: 1px solid rgba(111, 90, 78, 0.1);
}

.tab-button {
  padding: 10px 12px;
}

.tab-button.active {
  background: rgba(216, 102, 53, 0.12);
  color: #b44f21;
  border-color: rgba(216, 102, 53, 0.18);
}

.detail-content {
  display: grid;
  gap: 12px;
  padding: 14px 16px 16px;
  overflow: auto;
  min-height: 0;
}

.section-card {
  padding: 14px;
}

.section-head {
  margin-bottom: 12px;
}

.inner-card {
  padding: 12px;
  background: #fcfaf7;
}

.overview-grid,
.quick-grid,
.reply-grid,
.coverage-grid,
.mini-stack {
  display: grid;
  gap: 10px;
}

.overview-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mini-stack {
  margin-top: 12px;
}

.mini-card {
  padding: 12px;
}

.mini-card p,
.quick-card p {
  margin: 8px 0 0;
  line-height: 1.55;
}

.quick-grid,
.reply-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.quick-card {
  padding: 12px;
}

.tag-row,
.action-row,
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-pill {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(216, 102, 53, 0.1);
  color: #b04f24;
  font-size: 0.8rem;
  font-weight: 800;
}

.bullet-list,
.timeline-list {
  display: grid;
  gap: 10px;
}

.bullet-list {
  margin: 0;
  padding-left: 18px;
  color: #6f5a4e;
}

.coverage-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.coverage-card,
.task-item {
  padding: 12px;
}

.coverage-card {
  display: grid;
  gap: 4px;
}

.timeline-item {
  position: relative;
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr);
  gap: 10px;
  padding: 10px 0;
}

.timeline-dot {
  width: 10px;
  height: 10px;
  margin-top: 4px;
  border-radius: 999px;
  background: #d86635;
  box-shadow: 0 0 0 4px rgba(216, 102, 53, 0.12);
}

.timeline-item.done .timeline-dot {
  background: #1a7a3c;
  box-shadow: 0 0 0 4px rgba(26, 122, 60, 0.12);
}

.timeline-item.pending .timeline-dot {
  background: #a26d1f;
  box-shadow: 0 0 0 4px rgba(162, 109, 31, 0.12);
}

.timeline-copy {
  display: grid;
  gap: 4px;
}

.timeline-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
}

.timeline-head span {
  color: #8b6f60;
  font-size: 0.78rem;
  font-weight: 700;
}

.draft-body {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.55;
}

.task-list {
  display: grid;
  gap: 8px;
}

.task-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.muted-copy {
  margin: 0;
}

.link-action {
  text-decoration: none;
}

.empty-panel {
  padding: 18px 16px 16px;
  color: #705b4e;
}

.field :is(input, select, textarea),
.inline-field select {
  min-width: 0;
}

@media (max-width: 1440px) {
  .summary-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .knowledge-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filter-toolbar {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .feed-fields {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1160px) {
  .revenue-header,
  .workspace-grid,
  .search-toolbar,
  .feed-toolbar {
    grid-template-columns: 1fr;
  }

  .revenue-header {
    display: grid;
  }

  .header-meta {
    min-width: 0;
  }

  .workspace-grid {
    display: grid;
  }

  .summary-grid,
  .filter-toolbar,
  .feed-fields,
  .knowledge-grid,
  .overview-grid,
  .quick-grid,
  .reply-grid,
  .coverage-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 780px) {
  .revenue-shell {
    padding-inline: 14px;
  }

  .header-meta,
  .summary-grid,
  .filter-toolbar,
  .feed-fields,
  .knowledge-grid,
  .overview-grid,
  .quick-grid,
  .reply-grid,
  .coverage-grid {
    grid-template-columns: 1fr;
  }

  .table-panel,
  .detail-panel {
    min-height: auto;
  }

  .prospect-table {
    min-width: 980px;
  }

  .panel-head,
  .detail-head,
  .detail-content {
    padding-inline: 12px;
  }

  .bulk-toolbar {
    margin-inline: 12px;
  }
}
</style>
