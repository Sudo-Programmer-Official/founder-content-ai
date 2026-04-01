<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  AiAssistLevel,
  BrandCompetitorReference,
  BrandProfile,
  BrandSignalSummary,
  WorkspaceKnowledgeProfile,
  WorkspaceKnowledgeSource,
  WorkspaceKnowledgeSourceType,
  ProductAccessLimits,
  SavedContentSource,
  SocialAccount,
  SocialAccountIdentity,
  UiDensity,
  UiFontSize,
  UiLayoutMode,
  UiTheme,
  UpdateUserPreferencesRequest,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import AiAssistPanel from "../components/AiAssistPanel.vue";
import { useAiAssistSuggestions } from "../composables/use-ai-assist";
import { usePreferenceContext } from "../preferences/preference-context";
import {
  requestCreateWorkspaceKnowledgeSource,
  requestBrandProfile,
  requestRefreshWorkspaceKnowledge,
  requestUpdateBrandProfile,
  requestWorkspaceKnowledge,
} from "../services/brand-profile-service";
import {
  requestContentIngestionPreview,
  requestSavedContentSources,
} from "../services/generation-service";
import {
  requestDisconnectSocialAccount,
  requestLinkedInSocialAuthStart,
  requestSelectSocialAccountIdentity,
  requestSocialAccounts,
} from "../services/publishing-service";
import { appRoutes } from "../utils/routes";

type WorkspaceChannelKey = "linkedin" | "instagram" | "reddit";

interface WorkspaceChannelDefinition {
  key: WorkspaceChannelKey;
  label: string;
  description: string;
  availability: "live" | "coming_soon";
}

const { preferences, isSaving, errorMessage, updatePreferences } = usePreferenceContext();
const { bootstrap } = useProductAccessContext();
const route = useRoute();
const router = useRouter();

const socialAccounts = ref<SocialAccount[]>([]);
const isLoadingChannels = ref(false);
const isStartingChannelConnect = ref<WorkspaceChannelKey | "">("");
const disconnectingAccountId = ref("");
const selectingIdentityAccountId = ref("");
const channelFeedback = ref("");
const channelError = ref("");
const brandProfile = ref<BrandProfile | null>(null);
const brandSignalSummary = ref<BrandSignalSummary | null>(null);
const suggestedCompetitors = ref<BrandCompetitorReference[]>([]);
const selectedCompetitorsInput = ref<BrandCompetitorReference[]>([]);
const toneInput = ref("");
const writingStyleInput = ref("");
const visualStyleInput = ref("");
const topicsInput = ref("");
const patternsInput = ref("");
const customCompetitorLabelInput = ref("");
const customCompetitorUrlInput = ref("");
const isLoadingBrandContext = ref(false);
const isSavingBrandContext = ref(false);
const brandContextFeedback = ref("");
const brandContextError = ref("");
const competitorSelectionFeedback = ref("");
const competitorSelectionError = ref("");
const savedSources = ref<SavedContentSource[]>([]);
const linkedinSourceUrl = ref("");
const instagramSourceUrl = ref("");
const facebookSourceUrl = ref("");
const blogSourceUrl = ref("");
const isLoadingBrandSources = ref(false);
const isSavingBrandSources = ref(false);
const brandSourcesFeedback = ref("");
const brandSourcesError = ref("");
const brandSourceWarnings = ref<string[]>([]);
const workspaceKnowledgeProfile = ref<WorkspaceKnowledgeProfile | null>(null);
const workspaceKnowledgeSources = ref<WorkspaceKnowledgeSource[]>([]);
const knowledgeSourceTypeInput = ref<WorkspaceKnowledgeSourceType>("website");
const knowledgeTitleInput = ref("");
const knowledgeUrlInput = ref("");
const knowledgeNoteInput = ref("");
const isLoadingWorkspaceKnowledge = ref(false);
const isSavingWorkspaceKnowledge = ref(false);
const isRefreshingWorkspaceKnowledge = ref(false);
const workspaceKnowledgeFeedback = ref("");
const workspaceKnowledgeError = ref("");

const workspaceChannelDefinitions: WorkspaceChannelDefinition[] = [
  {
    key: "linkedin",
    label: "LinkedIn",
    description: "Connect the publishing account for this workspace so drafts and scheduled posts stay tied to the right brand.",
    availability: "live",
  },
  {
    key: "instagram",
    label: "Instagram",
    description: "Reserve a slot for the visual publishing workflow. This will land after LinkedIn stabilizes.",
    availability: "coming_soon",
  },
  {
    key: "reddit",
    label: "Reddit",
    description: "Prepare for community-first publishing per workspace without mixing accounts across products.",
    availability: "coming_soon",
  },
];

const themeModel = computed<UiTheme>({
  get: () => preferences.value.theme,
  set: (value) => {
    void updatePreference("theme", value);
  },
});

const fontSizeModel = computed<UiFontSize>({
  get: () => preferences.value.fontSize,
  set: (value) => {
    void updatePreference("fontSize", value);
  },
});

const densityModel = computed<UiDensity>({
  get: () => preferences.value.density,
  set: (value) => {
    void updatePreference("density", value);
  },
});

const layoutModeModel = computed<UiLayoutMode>({
  get: () => preferences.value.layoutMode,
  set: (value) => {
    void updatePreference("layoutMode", value);
  },
});

const aiAssistLevelModel = computed<AiAssistLevel>({
  get: () => preferences.value.aiAssistLevel,
  set: (value) => {
    void updatePreference("aiAssistLevel", value);
  },
});

const notifyPostPublishedModel = computed<boolean>({
  get: () => preferences.value.notifyPostPublished,
  set: (value) => {
    void updatePreference("notifyPostPublished", value);
  },
});

const notifyEmailCampaignUpdatesModel = computed<boolean>({
  get: () => preferences.value.notifyEmailCampaignUpdates,
  set: (value) => {
    void updatePreference("notifyEmailCampaignUpdates", value);
  },
});

async function updatePreference<T extends keyof typeof preferences.value>(
  key: T,
  value: (typeof preferences.value)[T],
) {
  const payload = {
    [key]: value,
  } as UpdateUserPreferencesRequest;
  await updatePreferences(payload);
}

const assistSuggestions = useAiAssistSuggestions([
  {
    id: "creator-mode",
    title: "Use creator layout while drafting",
    description: "Switch to the creator layout when you want a narrower reading width and less dashboard chrome.",
    minimumLevel: "minimal",
  },
  {
    id: "focus-theme",
    title: "Try the focus theme for writing sessions",
    description: "The focus theme reduces visual noise and works well with larger type when you are deep in content work.",
    minimumLevel: "balanced",
  },
  {
    id: "analytics-loop",
    title: "Pair planner layout with analytics review",
    description: "Planner mode gives you more horizontal room for scheduling and performance review workflows.",
    minimumLevel: "proactive",
    ctaLabel: "Open analytics",
    ctaTo: appRoutes.dashboardAnalytics,
  },
]);

const usageLimits = computed<ProductAccessLimits | null>(() => bootstrap.value?.limits ?? null);
const activeBusinessId = computed(() => bootstrap.value?.activeBusinessId ?? null);
const usageCards = computed(() => {
  if (!usageLimits.value) {
    return [];
  }

  return [
    {
      label: "Posts",
      remaining: usageLimits.value.postsRemaining,
      used: usageLimits.value.postsUsed,
      limit: usageLimits.value.postsLimit,
    },
    {
      label: "Emails",
      remaining: usageLimits.value.emailsRemaining,
      used: usageLimits.value.emailsUsed,
      limit: usageLimits.value.emailsLimit,
    },
    {
      label: "Outreach",
      remaining: usageLimits.value.outreachRemaining,
      used: usageLimits.value.outreachUsed,
      limit: usageLimits.value.outreachLimit,
    },
  ];
});
const isReadOnly = computed(() => bootstrap.value?.access?.readOnly ?? false);
const workspaceChannels = computed(() =>
  workspaceChannelDefinitions.map((definition) => {
    const linkedInAccount =
      definition.key === "linkedin"
        ? socialAccounts.value.find((account) => account.platform === "linkedin")
        : undefined;
    const selectedIdentity = linkedInAccount?.selectedIdentity;
    const linkedInName =
      linkedInAccount &&
      typeof linkedInAccount.metadata?.linkedInName === "string" &&
      linkedInAccount.metadata.linkedInName.trim() !== ""
        ? linkedInAccount.metadata.linkedInName.trim()
        : undefined;

    return {
      ...definition,
      account: linkedInAccount,
      selectedIdentity,
      identityOptions: linkedInAccount?.availableIdentities ?? [],
      connectedLabel:
        selectedIdentity?.displayName ||
        linkedInName ||
        linkedInAccount?.accountEmail ||
        linkedInAccount?.platformUserId,
      status:
        definition.availability === "coming_soon"
          ? "coming_soon"
          : linkedInAccount?.status ?? "not_connected",
    };
  }),
);
const hasBrandProfile = computed(() => {
  const profile = brandProfile.value;

  return Boolean(
    profile &&
      (
        profile.tone ||
        profile.writingStyle ||
        profile.visualStyle ||
        profile.topics.length > 0 ||
        profile.patterns.length > 0
      ),
  );
});
const brandContextChips = computed(() =>
  [
    toneInput.value ? `Tone: ${toneInput.value}` : "",
    writingStyleInput.value ? `Style: ${writingStyleInput.value}` : "",
    visualStyleInput.value ? `Visuals: ${visualStyleInput.value}` : "",
  ].filter((value) => value !== ""),
);
const effectiveMarketReferencePreview = computed(() =>
  selectedCompetitorsInput.value.length > 0
    ? selectedCompetitorsInput.value
    : suggestedCompetitors.value.slice(0, 3),
);
const workspaceKnowledgeReadySources = computed(() =>
  workspaceKnowledgeSources.value.filter((source) => source.processingStatus === "completed"),
);
const workspaceKnowledgeStatusLabel = computed(() => {
  const status = workspaceKnowledgeProfile.value?.processingStatus;

  switch (status) {
    case "processing":
      return "Refreshing now";
    case "queued":
      return "Queued for analysis";
    case "failed":
      return "Needs attention";
    case "completed":
      return "Live in prompts";
    default:
      return "No knowledge profile yet";
  }
});
const workspaceKnowledgeInsightChips = computed(() =>
  [
    workspaceKnowledgeProfile.value?.voiceSummary ? "Voice ready" : "",
    workspaceKnowledgeProfile.value?.audienceSummary ? "Audience defined" : "",
    workspaceKnowledgeProfile.value?.positioningSummary ? "Positioning locked" : "",
  ].filter((value) => value !== ""),
);

function joinList(values: string[]): string {
  return values.join(", ");
}

function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function formatKnowledgeSourceType(type: WorkspaceKnowledgeSourceType): string {
  return type === "website" ? "Website" : "Note";
}

function truncateKnowledgePreview(value: string, maxLength = 180): string {
  const normalized = value.trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}…` : normalized;
}

function hydrateBrandContextForm(profile: BrandProfile | null): void {
  toneInput.value = profile?.tone ?? "";
  writingStyleInput.value = profile?.writingStyle ?? "";
  visualStyleInput.value = profile?.visualStyle ?? "";
  topicsInput.value = joinList(profile?.topics ?? []);
  patternsInput.value = joinList(profile?.patterns ?? []);
}

function competitorKey(reference: Pick<BrandCompetitorReference, "id" | "label" | "url">): string {
  return reference.url?.trim().toLowerCase() || reference.id || reference.label.trim().toLowerCase();
}

function normalizeCompetitors(
  values: BrandCompetitorReference[],
): BrandCompetitorReference[] {
  const deduped = new Map<string, BrandCompetitorReference>();

  for (const value of values) {
    const label = value.label.trim();

    if (!label) {
      continue;
    }

    const normalizedUrl = value.url?.trim() || undefined;
    const normalized: BrandCompetitorReference = {
      id: value.id?.trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      label,
      url: normalizedUrl,
      sourceType:
        value.sourceType === "public_url" || value.sourceType === "website_page"
          ? value.sourceType
          : normalizedUrl?.includes("linkedin.com")
            ? "public_url"
            : "website_page",
      rationale: value.rationale?.trim() || undefined,
      origin: value.origin === "suggested" ? "suggested" : "custom",
    };

    deduped.set(competitorKey(normalized), normalized);
  }

  return Array.from(deduped.values()).slice(0, 8);
}

function hydrateCompetitorState(
  profile: BrandProfile | null,
  suggestions: BrandCompetitorReference[],
): void {
  suggestedCompetitors.value = normalizeCompetitors(suggestions);
  selectedCompetitorsInput.value = normalizeCompetitors(profile?.selectedCompetitors ?? []);
  customCompetitorLabelInput.value = "";
  customCompetitorUrlInput.value = "";
  competitorSelectionFeedback.value = "";
  competitorSelectionError.value = "";
}

function isCompetitorSelected(reference: BrandCompetitorReference): boolean {
  const targetKey = competitorKey(reference);
  return selectedCompetitorsInput.value.some((entry) => competitorKey(entry) === targetKey);
}

function addSuggestedCompetitor(reference: BrandCompetitorReference): void {
  competitorSelectionError.value = "";
  competitorSelectionFeedback.value = "";

  if (isCompetitorSelected(reference)) {
    competitorSelectionFeedback.value = "That market reference is already pinned.";
    return;
  }

  selectedCompetitorsInput.value = normalizeCompetitors([
    ...selectedCompetitorsInput.value,
    reference,
  ]);
  competitorSelectionFeedback.value = "Market reference added. Save brand context to keep it.";
}

function removeSelectedCompetitor(reference: BrandCompetitorReference): void {
  const targetKey = competitorKey(reference);
  selectedCompetitorsInput.value = selectedCompetitorsInput.value.filter(
    (entry) => competitorKey(entry) !== targetKey,
  );
  competitorSelectionError.value = "";
  competitorSelectionFeedback.value = "Market reference removed. Save brand context to keep it.";
}

function handleAddCustomCompetitor(): void {
  const label = customCompetitorLabelInput.value.trim();
  const url = customCompetitorUrlInput.value.trim();

  competitorSelectionFeedback.value = "";
  competitorSelectionError.value = "";

  if (!label) {
    competitorSelectionError.value = "Add a creator or company name before saving a custom competitor.";
    return;
  }

  selectedCompetitorsInput.value = normalizeCompetitors([
    ...selectedCompetitorsInput.value,
    {
      id: `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label,
      url: url || undefined,
      sourceType: url.includes("linkedin.com") ? "public_url" : "website_page",
      rationale: "Manually pinned by the workspace owner.",
      origin: "custom",
    },
  ]);
  customCompetitorLabelInput.value = "";
  customCompetitorUrlInput.value = "";
  competitorSelectionFeedback.value = "Custom competitor added. Save brand context to keep it.";
}

function formatIdentityOption(identity: SocialAccountIdentity): string {
  return identity.type === "organization"
    ? `${identity.displayName} · Page`
    : `${identity.displayName} · Personal`;
}

function pickSavedSource(...types: SavedContentSource["sourceType"][]): SavedContentSource | null {
  return savedSources.value.find((source) => types.includes(source.sourceType)) ?? null;
}

function resolveBrandSourceDefaultUrl(kind: "linkedin" | "instagram" | "facebook" | "website"): string {
  switch (kind) {
    case "linkedin":
      return brandProfile.value?.linkedinUrl ?? pickSavedSource("linkedin")?.sourceUrl ?? "";
    case "instagram":
      return brandProfile.value?.instagramUrl ?? pickSavedSource("instagram")?.sourceUrl ?? "";
    case "facebook":
      return brandProfile.value?.facebookUrl ?? pickSavedSource("facebook")?.sourceUrl ?? "";
    case "website":
      return brandProfile.value?.websiteUrl ?? pickSavedSource("blog", "url")?.sourceUrl ?? "";
  }
}

function hydrateBrandSourceForm(): void {
  linkedinSourceUrl.value = resolveBrandSourceDefaultUrl("linkedin");
  instagramSourceUrl.value = resolveBrandSourceDefaultUrl("instagram");
  facebookSourceUrl.value = resolveBrandSourceDefaultUrl("facebook");
  blogSourceUrl.value = resolveBrandSourceDefaultUrl("website");
}

function buildBrandSourceInputs(): Array<{ label: string; url: string }> {
  return [
    { label: "LinkedIn page or post", url: linkedinSourceUrl.value.trim() },
    { label: "Instagram page or post", url: instagramSourceUrl.value.trim() },
    { label: "Facebook page or post", url: facebookSourceUrl.value.trim() },
    { label: "Blog or website", url: blogSourceUrl.value.trim() },
  ].filter((source) => source.url !== "");
}

const brandSourceDefaultPreviewItems = computed(() =>
  [
    { label: "LinkedIn", url: resolveBrandSourceDefaultUrl("linkedin") },
    { label: "Instagram", url: resolveBrandSourceDefaultUrl("instagram") },
    { label: "Facebook", url: resolveBrandSourceDefaultUrl("facebook") },
    { label: "Blog or website", url: resolveBrandSourceDefaultUrl("website") },
  ].filter((item) => item.url !== ""),
);

async function loadBrandSources(): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    savedSources.value = [];
    hydrateBrandSourceForm();
    return;
  }

  isLoadingBrandSources.value = true;
  brandSourcesError.value = "";

  try {
    const response = await requestSavedContentSources(businessId);
    savedSources.value = response.sources;
    hydrateBrandSourceForm();
  } catch (error) {
    savedSources.value = [];
    hydrateBrandSourceForm();
    brandSourcesError.value =
      error instanceof Error ? error.message : "Unable to load workspace brand sources.";
  } finally {
    isLoadingBrandSources.value = false;
  }
}

async function handleBrandSourcesSave(): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    return;
  }

  const sourceUrls = buildBrandSourceInputs();

  isSavingBrandSources.value = true;
  brandSourcesFeedback.value = "";
  brandSourcesError.value = "";
  brandSourceWarnings.value = [];

  try {
    const response = await requestUpdateBrandProfile({
      businessId,
      linkedinUrl: linkedinSourceUrl.value.trim(),
      instagramUrl: instagramSourceUrl.value.trim(),
      facebookUrl: facebookSourceUrl.value.trim(),
      websiteUrl: blogSourceUrl.value.trim(),
      refreshFromSignals: false,
    });
    brandProfile.value = response.brandProfile;
    brandSignalSummary.value = response.signalSummary;
    suggestedCompetitors.value = normalizeCompetitors(response.suggestedCompetitors);
    hydrateBrandSourceForm();

    if (sourceUrls.length > 0) {
      try {
        const previewResponse = await requestContentIngestionPreview({
          businessId,
          sourceUrls,
        });
        brandSourceWarnings.value = previewResponse.errors.map((error) => `${error.label}: ${error.message}`);
      } catch (error) {
        brandSourceWarnings.value = [
          error instanceof Error ? error.message : "Unable to refresh the source preview right now.",
        ];
      }
    }

    await loadBrandSources();
    brandSourcesFeedback.value =
      sourceUrls.length === 0
        ? "Brand source defaults cleared for this workspace."
        : brandSourceWarnings.value.length > 0
          ? "Brand source defaults saved. Some previews were unavailable."
          : "Brand source defaults saved. Repurpose will prefill these automatically.";
  } catch (error) {
    brandSourcesError.value =
      error instanceof Error ? error.message : "Unable to save workspace brand source defaults.";
  } finally {
    isSavingBrandSources.value = false;
  }
}

async function loadBrandContext(refreshFromSignals = false): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    brandProfile.value = null;
    brandSignalSummary.value = null;
    hydrateBrandContextForm(null);
    hydrateCompetitorState(null, []);
    return;
  }

  isLoadingBrandContext.value = true;
  brandContextFeedback.value = "";
  brandContextError.value = "";

  try {
    const response = await requestBrandProfile(businessId, {
      refreshFromSignals,
    });
    brandProfile.value = response.brandProfile;
    brandSignalSummary.value = response.signalSummary;
    hydrateBrandContextForm(response.brandProfile);
    hydrateCompetitorState(response.brandProfile, response.suggestedCompetitors);
    hydrateBrandSourceForm();
  } catch (error) {
    brandProfile.value = null;
    brandSignalSummary.value = null;
    hydrateBrandContextForm(null);
    hydrateCompetitorState(null, []);
    hydrateBrandSourceForm();
    brandContextError.value =
      error instanceof Error ? error.message : "Unable to load brand context.";
  } finally {
    isLoadingBrandContext.value = false;
  }
}

async function handleBrandContextSave(): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    return;
  }

  isSavingBrandContext.value = true;
  brandContextFeedback.value = "";
  brandContextError.value = "";

  try {
    const response = await requestUpdateBrandProfile({
      businessId,
      tone: toneInput.value.trim(),
      writingStyle: writingStyleInput.value.trim(),
      visualStyle: visualStyleInput.value.trim(),
      topics: parseList(topicsInput.value),
      patterns: parseList(patternsInput.value),
      selectedCompetitors: selectedCompetitorsInput.value,
      refreshFromSignals: false,
    });
    brandProfile.value = response.brandProfile;
    brandSignalSummary.value = response.signalSummary;
    hydrateBrandContextForm(response.brandProfile);
    hydrateCompetitorState(response.brandProfile, response.suggestedCompetitors);
    brandContextFeedback.value = "Brand context saved for this workspace.";
  } catch (error) {
    brandContextError.value =
      error instanceof Error ? error.message : "Unable to save brand context.";
  } finally {
    isSavingBrandContext.value = false;
  }
}

async function handleBrandContextRefresh(): Promise<void> {
  brandContextFeedback.value = "";
  await loadBrandContext(true);

  if (!brandContextError.value) {
    brandContextFeedback.value = "Brand context refreshed from workspace signals.";
  }
}

async function loadWorkspaceKnowledge(): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    workspaceKnowledgeProfile.value = null;
    workspaceKnowledgeSources.value = [];
    return;
  }

  isLoadingWorkspaceKnowledge.value = true;
  workspaceKnowledgeError.value = "";

  try {
    const response = await requestWorkspaceKnowledge(businessId);
    workspaceKnowledgeProfile.value = response.profile ?? null;
    workspaceKnowledgeSources.value = response.sources;
  } catch (error) {
    workspaceKnowledgeProfile.value = null;
    workspaceKnowledgeSources.value = [];
    workspaceKnowledgeError.value =
      error instanceof Error ? error.message : "Unable to load workspace knowledge.";
  } finally {
    isLoadingWorkspaceKnowledge.value = false;
  }
}

async function handleWorkspaceKnowledgeSave(): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    return;
  }

  isSavingWorkspaceKnowledge.value = true;
  workspaceKnowledgeFeedback.value = "";
  workspaceKnowledgeError.value = "";

  try {
    const response = await requestCreateWorkspaceKnowledgeSource({
      businessId,
      sourceType: knowledgeSourceTypeInput.value,
      title: knowledgeTitleInput.value.trim(),
      sourceUrl: knowledgeSourceTypeInput.value === "website" ? knowledgeUrlInput.value.trim() : undefined,
      rawText: knowledgeSourceTypeInput.value === "note" ? knowledgeNoteInput.value.trim() : undefined,
    });
    workspaceKnowledgeProfile.value = response.profile ?? null;
    workspaceKnowledgeSources.value = response.sources;
    knowledgeTitleInput.value = "";
    knowledgeUrlInput.value = "";
    knowledgeNoteInput.value = "";
    workspaceKnowledgeFeedback.value =
      knowledgeSourceTypeInput.value === "website"
        ? "Website source saved. The worker is extracting knowledge now."
        : "Workspace note saved. The worker is refreshing the knowledge profile now.";
  } catch (error) {
    workspaceKnowledgeError.value =
      error instanceof Error ? error.message : "Unable to save workspace knowledge.";
  } finally {
    isSavingWorkspaceKnowledge.value = false;
  }
}

async function handleWorkspaceKnowledgeRefresh(): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    return;
  }

  isRefreshingWorkspaceKnowledge.value = true;
  workspaceKnowledgeFeedback.value = "";
  workspaceKnowledgeError.value = "";

  try {
    const response = await requestRefreshWorkspaceKnowledge({
      businessId,
    });
    workspaceKnowledgeProfile.value = response.profile ?? null;
    workspaceKnowledgeSources.value = response.sources;
    workspaceKnowledgeFeedback.value = "Workspace knowledge queued for a fresh rebuild.";
  } catch (error) {
    workspaceKnowledgeError.value =
      error instanceof Error ? error.message : "Unable to refresh workspace knowledge.";
  } finally {
    isRefreshingWorkspaceKnowledge.value = false;
  }
}

async function loadWorkspaceChannels(): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    socialAccounts.value = [];
    return;
  }

  isLoadingChannels.value = true;
  channelError.value = "";

  try {
    const response = await requestSocialAccounts(businessId);
    socialAccounts.value = response.accounts;
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Unable to load workspace channels.";
  } finally {
    isLoadingChannels.value = false;
  }
}

async function handleChannelConnect(platform: WorkspaceChannelKey): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId || platform !== "linkedin") {
    return;
  }

  isStartingChannelConnect.value = platform;
  channelError.value = "";

  try {
    const response = await requestLinkedInSocialAuthStart({
      businessId,
      returnPath: appRoutes.settingsPreferences,
    });
    window.location.href = response.authorizationUrl;
  } catch (error) {
    isStartingChannelConnect.value = "";
    channelError.value = error instanceof Error ? error.message : "Unable to start channel connection.";
  }
}

async function handleChannelDisconnect(accountId: string): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    return;
  }

  disconnectingAccountId.value = accountId;
  channelError.value = "";

  try {
    await requestDisconnectSocialAccount({
      accountId,
      businessId,
    });
    channelFeedback.value = "Channel disconnected from this workspace.";
    await loadWorkspaceChannels();
  } catch (error) {
    channelError.value = error instanceof Error ? error.message : "Unable to disconnect the channel.";
  } finally {
    disconnectingAccountId.value = "";
  }
}

async function handleChannelIdentitySelect(
  accountId: string,
  identityId: string,
): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId || !identityId) {
    return;
  }

  selectingIdentityAccountId.value = accountId;
  channelError.value = "";

  try {
    await requestSelectSocialAccountIdentity({
      accountId,
      businessId,
      identityId,
    });
    channelFeedback.value = "LinkedIn publishing target updated for this workspace.";
    await loadWorkspaceChannels();
  } catch (error) {
    channelError.value =
      error instanceof Error ? error.message : "Unable to update the LinkedIn publishing target.";
  } finally {
    selectingIdentityAccountId.value = "";
  }
}

watch(
  activeBusinessId,
  () => {
    channelFeedback.value = "";
    brandContextFeedback.value = "";
    brandSourcesFeedback.value = "";
    workspaceKnowledgeFeedback.value = "";
    void loadWorkspaceChannels();
    void loadBrandContext();
    void loadBrandSources();
    void loadWorkspaceKnowledge();
  },
  { immediate: true },
);

watch(
  () => [route.query.linkedin, route.query.message],
  async ([status, message]) => {
    if (typeof status !== "string" && typeof message !== "string") {
      return;
    }

    if (status === "connected") {
      channelFeedback.value = "LinkedIn connected for this workspace.";
      channelError.value = "";
      await loadWorkspaceChannels();
    } else if (status === "error") {
      channelError.value = typeof message === "string" && message.trim() !== ""
        ? message
        : "LinkedIn connection failed.";
    }

    const nextQuery = { ...route.query };
    delete nextQuery.linkedin;
    delete nextQuery.message;
    void router.replace({ query: nextQuery });
    isStartingChannelConnect.value = "";
  },
  { immediate: true },
);
</script>

<template>
  <main class="dashboard-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/settings/preferences</p>
      <h1>Interface Preferences</h1>
      <p class="dashboard-description">
        Control theme, density, layout, and how much AI guidance the product surfaces while you work.
      </p>
    </section>

    <p v-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>
    <p v-else-if="isSaving" class="dashboard-feedback">Saving preferences...</p>

    <section class="dashboard-grid-two">
      <article class="dashboard-panel">
        <p class="panel-meta">Appearance</p>
        <div class="settings-grid">
          <label class="dashboard-field">
            <span>Theme</span>
            <select v-model="themeModel">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="focus">Focus</option>
            </select>
          </label>

          <label class="dashboard-field">
            <span>Font Size</span>
            <select v-model="fontSizeModel">
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>

          <label class="dashboard-field">
            <span>Density</span>
            <select v-model="densityModel">
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
          </label>
        </div>
      </article>

      <article class="dashboard-panel">
        <p class="panel-meta">Workspace Mode</p>
        <div class="settings-grid">
          <label class="dashboard-field">
            <span>Layout Mode</span>
            <select v-model="layoutModeModel">
              <option value="dashboard">Dashboard</option>
              <option value="creator">Creator</option>
              <option value="planner">Planner</option>
            </select>
          </label>

          <label class="dashboard-field">
            <span>AI Assist</span>
            <select v-model="aiAssistLevelModel">
              <option value="off">Off</option>
              <option value="minimal">Minimal</option>
              <option value="balanced">Balanced</option>
              <option value="proactive">Proactive</option>
            </select>
          </label>
        </div>
      </article>
    </section>

    <section class="dashboard-panel notification-panel">
      <p class="panel-meta">Notifications</p>
      <div class="notification-preference-stack">
        <div class="notification-preference-row">
          <div>
            <h2>Momentum emails</h2>
            <p class="dashboard-description">
              Get one email when a scheduled LinkedIn post goes live, plus a reminder of the next post already lined up.
            </p>
          </div>

          <label class="notification-toggle">
            <input
              v-model="notifyPostPublishedModel"
              type="checkbox"
              :disabled="isSaving"
            />
            <span>Notify me when posts are published</span>
          </label>
        </div>

        <div class="notification-preference-row">
          <div>
            <h2>Campaign updates</h2>
            <p class="dashboard-description">
              Get one email when a campaign starts, finishes, or needs attention, with real sent, delivered, failed, and pending counts.
            </p>
          </div>

          <label class="notification-toggle">
            <input
              v-model="notifyEmailCampaignUpdatesModel"
              type="checkbox"
              :disabled="isSaving"
            />
            <span>Notify me about email campaign updates</span>
          </label>
        </div>
      </div>
    </section>

    <section class="dashboard-panel channels-panel">
      <div class="channels-panel-header">
        <div>
          <p class="panel-meta">Workspace Channels</p>
          <h2>Connect the right distribution account for each workspace.</h2>
        </div>
        <span class="usage-badge">
          {{ activeBusinessId ? "Workspace scoped" : "Select a workspace first" }}
        </span>
      </div>

      <p class="dashboard-description">
        Every workspace should keep its own publishing channels. Connect LinkedIn now, then layer Instagram and Reddit later without mixing brand accounts across products.
      </p>

      <p v-if="channelFeedback" class="dashboard-feedback">{{ channelFeedback }}</p>
      <p v-if="channelError" class="dashboard-feedback error">{{ channelError }}</p>

      <div class="channel-grid">
        <article
          v-for="channel in workspaceChannels"
          :key="channel.key"
          class="channel-card"
          :data-tone="channel.availability"
        >
          <div class="channel-card-header">
            <div>
              <p class="dashboard-card-label">{{ channel.label }}</p>
              <strong>{{ channel.availability === "live" ? "Workspace connection" : "Coming soon" }}</strong>
            </div>
            <span
              class="channel-status-badge"
              :class="{
                connected: channel.status === 'connected',
                warning: channel.status === 'expired' || channel.status === 'error',
              }"
            >
              {{
                channel.status === "connected"
                  ? "Connected"
                  : channel.status === "expired"
                    ? "Reconnect required"
                    : channel.status === "error"
                      ? "Needs attention"
                      : channel.status === "coming_soon"
                        ? "Soon"
                        : "Not connected"
              }}
            </span>
          </div>

          <p>{{ channel.description }}</p>

          <div v-if="channel.account" class="channel-account-meta">
            <span>{{ channel.connectedLabel }}</span>
            <small>
              {{
                channel.account.accountEmail
                  ? channel.account.accountEmail
                  : `Connected ${new Date(channel.account.updatedAt).toLocaleDateString()}`
              }}
            </small>
          </div>

          <label
            v-if="channel.account && channel.identityOptions.length > 0"
            class="dashboard-field channel-identity-field"
          >
            <span>Publish this workspace as</span>
            <select
              :value="channel.selectedIdentity?.id ?? ''"
              :disabled="selectingIdentityAccountId === channel.account.id"
              @change="
                void handleChannelIdentitySelect(
                  channel.account.id,
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option
                v-for="identity in channel.identityOptions"
                :key="identity.id"
                :value="identity.id"
              >
                {{ formatIdentityOption(identity) }}
              </option>
            </select>
          </label>

          <div class="channel-actions">
            <button
              v-if="channel.availability === 'live'"
              type="button"
              class="dashboard-button"
              :disabled="!activeBusinessId || isStartingChannelConnect === channel.key"
              @click="void handleChannelConnect(channel.key)"
            >
              {{
                channel.status === "connected"
                  ? isStartingChannelConnect === channel.key
                    ? "Refreshing..."
                    : "Reconnect"
                  : isStartingChannelConnect === channel.key
                    ? "Connecting..."
                    : "Connect"
              }}
            </button>

            <button
              v-if="channel.account"
              type="button"
              class="dashboard-button secondary"
              :disabled="
                disconnectingAccountId === channel.account.id ||
                selectingIdentityAccountId === channel.account.id
              "
              @click="void handleChannelDisconnect(channel.account.id)"
            >
              {{ disconnectingAccountId === channel.account.id ? "Disconnecting..." : "Disconnect" }}
            </button>

            <button
              v-if="channel.availability === 'coming_soon'"
              type="button"
              class="dashboard-button secondary"
              disabled
            >
              Planned
            </button>
          </div>
        </article>
      </div>
    </section>

    <section class="dashboard-panel brand-sources-panel">
      <div class="brand-context-panel-header">
        <div>
          <p class="panel-meta">Brand Sources</p>
          <h2>Keep the workspace public listings attached and reusable.</h2>
        </div>
        <span class="usage-badge">
          {{ activeBusinessId ? "Prefills repurpose by default" : "Select a workspace first" }}
        </span>
      </div>

      <p class="dashboard-description">
        Set the public pages that represent this brand. Repurpose will prefill these every time so users are not rebuilding the same source set on each draft.
      </p>

      <p v-if="brandSourcesFeedback" class="dashboard-feedback">{{ brandSourcesFeedback }}</p>
      <p v-if="brandSourcesError" class="dashboard-feedback error">{{ brandSourcesError }}</p>

      <div class="brand-context-layout">
        <div class="brand-context-form">
          <div class="settings-grid brand-context-grid">
            <label class="dashboard-field">
              <span>LinkedIn page or profile</span>
              <input
                v-model="linkedinSourceUrl"
                type="url"
                :disabled="isLoadingBrandSources || isSavingBrandSources || !activeBusinessId"
                placeholder="https://www.linkedin.com/company/your-company/"
              />
            </label>

            <label class="dashboard-field">
              <span>Instagram</span>
              <input
                v-model="instagramSourceUrl"
                type="url"
                :disabled="isLoadingBrandSources || isSavingBrandSources || !activeBusinessId"
                placeholder="https://www.instagram.com/yourbrand/"
              />
            </label>

            <label class="dashboard-field">
              <span>Facebook</span>
              <input
                v-model="facebookSourceUrl"
                type="url"
                :disabled="isLoadingBrandSources || isSavingBrandSources || !activeBusinessId"
                placeholder="https://www.facebook.com/yourbrand/"
              />
            </label>

            <label class="dashboard-field">
              <span>Blog or website</span>
              <input
                v-model="blogSourceUrl"
                type="url"
                :disabled="isLoadingBrandSources || isSavingBrandSources || !activeBusinessId"
                placeholder="https://example.com/blog/or-homepage"
              />
            </label>
          </div>

          <div class="channel-actions">
            <button
              type="button"
              class="dashboard-button"
              :disabled="isSavingBrandSources || isLoadingBrandSources || !activeBusinessId"
              @click="void handleBrandSourcesSave()"
            >
              {{ isSavingBrandSources ? "Saving..." : "Save source defaults" }}
            </button>

            <router-link
              class="dashboard-button secondary link-button"
              :to="{ path: appRoutes.appCreate, query: { mode: 'repurpose' }, hash: '#repurpose-panel' }"
            >
              Open repurpose
            </router-link>
          </div>

          <ul v-if="brandSourceWarnings.length > 0" class="brand-preview-list warning-list">
            <li v-for="warning in brandSourceWarnings" :key="warning">{{ warning }}</li>
          </ul>
        </div>

        <aside class="brand-context-preview">
          <div>
            <p class="panel-meta">Repurpose defaults</p>
            <h3>
              {{
                brandSourceDefaultPreviewItems.length > 0
                  ? "These defaults preload into repurpose"
                  : "No brand sources saved yet"
              }}
            </h3>
            <p class="dashboard-description">
              {{
                brandSourceDefaultPreviewItems.length > 0
                  ? "Users can still add temporary overrides, but the workspace public listings become the default starting point every time."
                  : "Save at least one public URL here so repurpose stops starting from a blank state."
              }}
            </p>
          </div>

          <div v-if="isLoadingBrandSources" class="dashboard-feedback">Loading saved sources...</div>

          <div v-else-if="brandSourceDefaultPreviewItems.length > 0" class="saved-source-list">
            <span
              v-for="source in brandSourceDefaultPreviewItems"
              :key="`${source.label}-${source.url}`"
              class="saved-source-chip"
            >
              {{ source.label }}
            </span>
          </div>

          <div v-if="brandSourceDefaultPreviewItems.length > 0" class="brand-preview-block">
            <p class="panel-meta">Saved default URLs</p>
            <ul class="brand-preview-list">
              <li v-for="source in brandSourceDefaultPreviewItems" :key="`${source.label}-${source.url}`">
                <strong>{{ source.label }}:</strong> {{ source.url }}
              </li>
            </ul>
          </div>

          <div v-if="savedSources.length > 0" class="brand-preview-block">
            <p class="panel-meta">Current source memory</p>
            <ul class="brand-preview-list">
              <li v-for="source in savedSources.slice(0, 4)" :key="source.id">
                {{ source.sourceUrl }}
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </section>

    <section class="dashboard-panel brand-context-panel">
      <div class="brand-context-panel-header">
        <div>
          <p class="panel-meta">Brand Context</p>
          <h2>Shape every draft around the current workspace identity.</h2>
        </div>
        <span class="usage-badge">
          {{ activeBusinessId ? "Applied in create + repurpose" : "Select a workspace first" }}
        </span>
      </div>

      <p class="dashboard-description">
        This is the voice, positioning, and topic memory that generation uses automatically. Repurpose also layers this context on top of any previewed sources so users do not have to restate the brand every time.
      </p>

      <p v-if="brandContextFeedback" class="dashboard-feedback">{{ brandContextFeedback }}</p>
      <p v-if="brandContextError" class="dashboard-feedback error">{{ brandContextError }}</p>

      <div class="brand-context-layout">
        <div class="brand-context-form">
          <div class="settings-grid brand-context-grid">
            <label class="dashboard-field">
              <span>Brand tone</span>
              <input
                v-model="toneInput"
                type="text"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                placeholder="Founder-led, sharp, practical"
              />
            </label>

            <label class="dashboard-field">
              <span>Writing style</span>
              <input
                v-model="writingStyleInput"
                type="text"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                placeholder="Short paragraphs with punchy takeaways"
              />
            </label>

            <label class="dashboard-field">
              <span>Visual style</span>
              <input
                v-model="visualStyleInput"
                type="text"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                placeholder="Editorial minimal with bold contrast"
              />
            </label>

            <label class="dashboard-field brand-context-field-wide">
              <span>Topics</span>
              <textarea
                v-model="topicsInput"
                rows="3"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                placeholder="AI tools, founder workflows, product systems"
              />
            </label>

            <label class="dashboard-field brand-context-field-wide">
              <span>Messaging patterns</span>
              <textarea
                v-model="patternsInput"
                rows="3"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                placeholder="Contrarian hook, practical lesson, direct takeaway"
              />
            </label>
          </div>

          <section class="brand-competitor-section">
            <div>
              <p class="panel-meta">Market references</p>
              <h3>Let the system borrow signal from a few strong voices in your space.</h3>
              <p class="dashboard-description">
                Suggestions are assistive, not prescriptive. They help sharpen hooks and positioning without copying anyone directly.
              </p>
            </div>

            <p v-if="competitorSelectionFeedback" class="dashboard-feedback">{{ competitorSelectionFeedback }}</p>
            <p v-if="competitorSelectionError" class="dashboard-feedback error">{{ competitorSelectionError }}</p>

            <div v-if="suggestedCompetitors.length > 0" class="competitor-suggestion-grid">
              <article
                v-for="competitor in suggestedCompetitors"
                :key="competitor.id"
                class="competitor-card"
                :data-selected="isCompetitorSelected(competitor)"
              >
                <div class="competitor-card-header">
                  <strong>{{ competitor.label }}</strong>
                  <span class="usage-badge">
                    {{ competitor.sourceType === "public_url" ? "public profile" : "website signal" }}
                  </span>
                </div>
                <p>{{ competitor.rationale }}</p>
                <div class="channel-actions">
                  <button
                    type="button"
                    class="dashboard-button secondary"
                    :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId || isCompetitorSelected(competitor)"
                    @click="addSuggestedCompetitor(competitor)"
                  >
                    {{ isCompetitorSelected(competitor) ? "Added" : "Add" }}
                  </button>
                </div>
              </article>
            </div>

            <div v-if="selectedCompetitorsInput.length > 0" class="brand-preview-block">
              <p class="panel-meta">Pinned references</p>
              <div class="selected-competitor-list">
                <span
                  v-for="competitor in selectedCompetitorsInput"
                  :key="competitorKey(competitor)"
                  class="selected-competitor-chip"
                >
                  <span>{{ competitor.label }}</span>
                  <button
                    type="button"
                    class="chip-remove-button"
                    :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                    @click="removeSelectedCompetitor(competitor)"
                  >
                    Remove
                  </button>
                </span>
              </div>
            </div>

            <div class="settings-grid brand-competitor-grid">
              <label class="dashboard-field">
                <span>Add custom competitor</span>
                <input
                  v-model="customCompetitorLabelInput"
                  type="text"
                  :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                  placeholder="Creator or company name"
                />
              </label>

              <label class="dashboard-field">
                <span>Public URL (optional)</span>
                <input
                  v-model="customCompetitorUrlInput"
                  type="url"
                  :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                  placeholder="https://example.com/"
                />
              </label>
            </div>

            <div class="channel-actions">
              <button
                type="button"
                class="dashboard-button secondary"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                @click="handleAddCustomCompetitor()"
              >
                Add custom
              </button>
              <span class="market-reference-note">Pinned references save with brand context.</span>
            </div>
          </section>

          <div class="channel-actions">
            <button
              type="button"
              class="dashboard-button"
              :disabled="isSavingBrandContext || isLoadingBrandContext || !activeBusinessId || isReadOnly"
              @click="void handleBrandContextSave()"
            >
              {{ isSavingBrandContext ? "Saving..." : "Save brand context" }}
            </button>

            <button
              type="button"
              class="dashboard-button secondary"
              :disabled="isSavingBrandContext || isLoadingBrandContext || !activeBusinessId"
              @click="void handleBrandContextRefresh()"
            >
              {{ isLoadingBrandContext ? "Refreshing..." : "Refresh from workspace signals" }}
            </button>
          </div>
        </div>

        <aside class="brand-context-preview">
          <div>
            <p class="panel-meta">Generation preview</p>
            <h3>
              {{
                hasBrandProfile
                  ? "Create and repurpose already use this context"
                  : "Brand context has not been defined yet"
              }}
            </h3>
            <p class="dashboard-description">
              {{
                hasBrandProfile
                  ? "The create flow automatically blends this profile with saved sources and any previewed repurpose inputs."
                  : "Save a tone, style, and a few topics here so the workspace stops feeling blank."
              }}
            </p>
          </div>

          <div v-if="brandContextChips.length > 0" class="saved-source-list">
            <span
              v-for="chip in brandContextChips"
              :key="chip"
              class="saved-source-chip"
            >
              {{ chip }}
            </span>
          </div>

          <div v-if="brandProfile?.topics?.length" class="brand-preview-block">
            <p class="panel-meta">Topics in rotation</p>
            <div class="saved-source-list">
              <span
                v-for="topic in brandProfile.topics"
                :key="topic"
                class="saved-source-chip"
              >
                {{ topic }}
              </span>
            </div>
          </div>

          <div v-if="brandProfile?.patterns?.length" class="brand-preview-block">
            <p class="panel-meta">Messaging cues</p>
            <ul class="brand-preview-list">
              <li v-for="pattern in brandProfile.patterns" :key="pattern">{{ pattern }}</li>
            </ul>
          </div>

          <div v-if="effectiveMarketReferencePreview.length > 0" class="brand-preview-block">
            <p class="panel-meta">Market references in play</p>
            <div class="saved-source-list">
              <span
                v-for="competitor in effectiveMarketReferencePreview"
                :key="competitorKey(competitor)"
                class="saved-source-chip"
              >
                {{ competitor.label }}
              </span>
            </div>
            <p class="dashboard-description">
              {{
                selectedCompetitorsInput.length > 0
                  ? "Pinned references now steer brand-aware generation."
                  : "Generation falls back to the suggested set until you pin your own references."
              }}
            </p>
          </div>

          <div v-if="brandSignalSummary" class="brand-signal-grid">
            <article class="usage-card">
              <p class="dashboard-card-label">Competitor analyses</p>
              <strong>{{ brandSignalSummary.competitorAnalyses }}</strong>
            </article>
            <article class="usage-card">
              <p class="dashboard-card-label">Trend signals</p>
              <strong>{{ brandSignalSummary.trendSignals }}</strong>
            </article>
            <article class="usage-card">
              <p class="dashboard-card-label">Content assets</p>
              <strong>{{ brandSignalSummary.contentAssets }}</strong>
            </article>
          </div>
        </aside>
      </div>
    </section>

    <section class="dashboard-panel workspace-knowledge-panel">
      <div class="brand-context-panel-header">
        <div>
          <p class="panel-meta">Workspace Knowledge</p>
          <h2>Turn website pages and founder notes into reusable memory.</h2>
        </div>
        <span class="usage-badge">
          {{ activeBusinessId ? workspaceKnowledgeStatusLabel : "Select a workspace first" }}
        </span>
      </div>

      <p class="dashboard-description">
        Save the pages, notes, and positioning cues that should compound over time. The worker extracts audience, beliefs, and topic clusters, then generation uses them automatically.
      </p>

      <p v-if="workspaceKnowledgeFeedback" class="dashboard-feedback">{{ workspaceKnowledgeFeedback }}</p>
      <p v-if="workspaceKnowledgeError" class="dashboard-feedback error">{{ workspaceKnowledgeError }}</p>

      <div class="brand-context-layout">
        <div class="brand-context-form">
          <div class="settings-grid brand-context-grid">
            <label class="dashboard-field">
              <span>Source type</span>
              <select
                v-model="knowledgeSourceTypeInput"
                :disabled="isLoadingWorkspaceKnowledge || isSavingWorkspaceKnowledge || !activeBusinessId"
              >
                <option value="website">Website</option>
                <option value="note">Note</option>
              </select>
            </label>

            <label class="dashboard-field">
              <span>Title (optional)</span>
              <input
                v-model="knowledgeTitleInput"
                type="text"
                :disabled="isLoadingWorkspaceKnowledge || isSavingWorkspaceKnowledge || !activeBusinessId"
                placeholder="Homepage, founder note, positioning memo"
              />
            </label>

            <label v-if="knowledgeSourceTypeInput === 'website'" class="dashboard-field brand-context-field-wide">
              <span>Website URL</span>
              <input
                v-model="knowledgeUrlInput"
                type="url"
                :disabled="isLoadingWorkspaceKnowledge || isSavingWorkspaceKnowledge || !activeBusinessId"
                placeholder="https://plancraft.ai"
              />
            </label>

            <label v-else class="dashboard-field brand-context-field-wide">
              <span>Founder note</span>
              <textarea
                v-model="knowledgeNoteInput"
                rows="5"
                :disabled="isLoadingWorkspaceKnowledge || isSavingWorkspaceKnowledge || !activeBusinessId"
                placeholder="What should the system remember about this workspace? Example: We speak directly to founders, avoid fluff, and believe consistency beats hacks."
              />
            </label>
          </div>

          <div class="channel-actions">
            <button
              type="button"
              class="dashboard-button"
              :disabled="isSavingWorkspaceKnowledge || isLoadingWorkspaceKnowledge || !activeBusinessId"
              @click="void handleWorkspaceKnowledgeSave()"
            >
              {{ isSavingWorkspaceKnowledge ? "Saving..." : "Save & process" }}
            </button>

            <button
              type="button"
              class="dashboard-button secondary"
              :disabled="isRefreshingWorkspaceKnowledge || isLoadingWorkspaceKnowledge || !activeBusinessId || workspaceKnowledgeSources.length === 0"
              @click="void handleWorkspaceKnowledgeRefresh()"
            >
              {{ isRefreshingWorkspaceKnowledge ? "Refreshing..." : "Rebuild profile" }}
            </button>
          </div>

          <div v-if="workspaceKnowledgeSources.length > 0" class="knowledge-source-list">
            <article
              v-for="source in workspaceKnowledgeSources"
              :key="source.id"
              class="knowledge-source-card"
              :data-status="source.processingStatus"
            >
              <div class="knowledge-source-card-header">
                <div>
                  <p class="dashboard-card-label">{{ formatKnowledgeSourceType(source.sourceType) }}</p>
                  <strong>{{ source.title || (source.sourceType === "website" ? source.sourceUrl : "Founder note") }}</strong>
                </div>
                <span class="channel-status-badge" :class="{ connected: source.processingStatus === 'completed', warning: source.processingStatus === 'failed' }">
                  {{
                    source.processingStatus === "completed"
                      ? "Ready"
                      : source.processingStatus === "processing"
                        ? "Processing"
                        : source.processingStatus === "failed"
                          ? "Failed"
                          : "Queued"
                  }}
                </span>
              </div>
              <p class="dashboard-description">
                {{
                  truncateKnowledgePreview(
                    source.extractedText || source.rawText || source.sourceUrl || "No extracted text yet.",
                  )
                }}
              </p>
              <p v-if="source.processingError" class="dashboard-feedback error">{{ source.processingError }}</p>
            </article>
          </div>
        </div>

        <aside class="brand-context-preview">
          <div>
            <p class="panel-meta">Derived knowledge profile</p>
            <h3>
              {{
                workspaceKnowledgeProfile
                  ? "Generation now has deeper workspace memory"
                  : "No knowledge profile has been built yet"
              }}
            </h3>
            <p class="dashboard-description">
              {{
                workspaceKnowledgeProfile
                  ? "These summaries feed prompt context behind the scenes so posts, email, and repurpose stay closer to the workspace voice."
                  : "Add a website or founder note here so the system can derive audience, beliefs, and reusable topic clusters."
              }}
            </p>
          </div>

          <div v-if="workspaceKnowledgeInsightChips.length > 0" class="saved-source-list">
            <span
              v-for="chip in workspaceKnowledgeInsightChips"
              :key="chip"
              class="saved-source-chip"
            >
              {{ chip }}
            </span>
          </div>

          <div v-if="workspaceKnowledgeProfile?.voiceSummary" class="brand-preview-block">
            <p class="panel-meta">Voice</p>
            <p class="dashboard-description">{{ workspaceKnowledgeProfile.voiceSummary }}</p>
          </div>

          <div v-if="workspaceKnowledgeProfile?.audienceSummary" class="brand-preview-block">
            <p class="panel-meta">Audience</p>
            <p class="dashboard-description">{{ workspaceKnowledgeProfile.audienceSummary }}</p>
          </div>

          <div v-if="workspaceKnowledgeProfile?.positioningSummary" class="brand-preview-block">
            <p class="panel-meta">Positioning</p>
            <p class="dashboard-description">{{ workspaceKnowledgeProfile.positioningSummary }}</p>
          </div>

          <div v-if="workspaceKnowledgeProfile?.beliefs?.length" class="brand-preview-block">
            <p class="panel-meta">Core beliefs</p>
            <ul class="brand-preview-list">
              <li v-for="belief in workspaceKnowledgeProfile.beliefs" :key="belief">{{ belief }}</li>
            </ul>
          </div>

          <div v-if="workspaceKnowledgeProfile?.topicClusters?.length" class="brand-preview-block">
            <p class="panel-meta">Topic clusters</p>
            <div class="saved-source-list">
              <span
                v-for="topic in workspaceKnowledgeProfile.topicClusters"
                :key="topic"
                class="saved-source-chip"
              >
                {{ topic }}
              </span>
            </div>
          </div>

          <div class="brand-signal-grid">
            <article class="usage-card">
              <p class="dashboard-card-label">Completed sources</p>
              <strong>{{ workspaceKnowledgeReadySources.length }}</strong>
            </article>
            <article class="usage-card">
              <p class="dashboard-card-label">Total sources</p>
              <strong>{{ workspaceKnowledgeSources.length }}</strong>
            </article>
            <article class="usage-card">
              <p class="dashboard-card-label">Profile status</p>
              <strong>{{ workspaceKnowledgeStatusLabel }}</strong>
            </article>
          </div>
        </aside>
      </div>
    </section>

    <section class="dashboard-panel usage-panel">
      <div class="usage-panel-header">
        <div>
          <p class="panel-meta">Usage & Billing</p>
          <h2>Review limits here, then manage billing in the dedicated workspace screen.</h2>
        </div>
        <span v-if="isReadOnly" class="usage-badge warning">Read-only</span>
        <router-link v-else class="usage-badge" :to="appRoutes.appBilling">Open billing</router-link>
      </div>

      <p class="dashboard-description">
        Usage still belongs in workspace settings, but upgrades, subscription management, and Stripe billing now live on the billing page so monetization stays explicit.
      </p>

      <div v-if="usageCards.length > 0" class="usage-grid">
        <article v-for="card in usageCards" :key="card.label" class="usage-card">
          <p class="dashboard-card-label">{{ card.label }}</p>
          <strong>{{ card.remaining }} left</strong>
          <p>{{ card.used }} used of {{ card.limit }} total today</p>
        </article>
      </div>

      <p v-else class="dashboard-feedback">
        Usage appears once you have an active workspace with product access loaded.
      </p>
    </section>

    <section class="dashboard-panel preference-preview-panel">
      <p class="panel-meta">Live Preview</p>
      <div class="dashboard-card-grid">
        <article class="dashboard-card">
          <p class="dashboard-card-label">Theme</p>
          <strong>{{ preferences.theme }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Type Scale</p>
          <strong>{{ preferences.fontSize }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Density</p>
          <strong>{{ preferences.density }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Layout</p>
          <strong>{{ preferences.layoutMode }}</strong>
        </article>
      </div>
    </section>

    <AiAssistPanel title="AI Assist Preview" :suggestions="assistSuggestions" />
  </main>
</template>

<style scoped>
.settings-grid {
  display: grid;
  gap: 16px;
}

.usage-panel {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.channels-panel {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.brand-sources-panel {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.brand-context-panel {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.workspace-knowledge-panel {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.notification-panel {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.notification-preference-stack {
  display: grid;
  gap: 16px;
}

.notification-preference-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.notification-preference-row h2 {
  margin: 0;
}

.notification-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
  color: var(--fc-text);
  font-weight: 600;
}

.notification-toggle input {
  width: 18px;
  height: 18px;
}

.channels-panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.channels-panel-header h2 {
  margin: 0;
}

.channel-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.channel-card {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
}

.channel-card[data-tone="coming_soon"] {
  background: color-mix(in srgb, var(--fc-surface-subtle) 92%, var(--fc-panel-bg));
}

.channel-card-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.channel-card-header strong {
  display: block;
  margin-top: 4px;
  font-size: 1.1rem;
}

.channel-card p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.channel-status-badge {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
}

.channel-status-badge.connected {
  border-color: color-mix(in srgb, var(--fc-success-text) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg) 82%, var(--fc-panel-bg));
  color: var(--fc-success-text);
}

.channel-status-badge.warning {
  border-color: var(--fc-warning-bg);
  background: var(--fc-warning-bg);
  color: var(--fc-warning-text);
}

.channel-account-meta {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-panel-bg) 88%, white 12%);
}

.channel-account-meta span {
  font-weight: 700;
}

.channel-account-meta small {
  color: var(--fc-text-muted);
}

.channel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.channel-actions .dashboard-button,
.channel-actions .link-button {
  width: auto;
  min-height: 44px;
  padding: 0 18px;
  flex: 0 0 auto;
}

.channel-identity-field {
  gap: 8px;
}

.channel-identity-field select {
  width: 100%;
}

.brand-context-panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.brand-context-panel-header h2 {
  margin: 0;
}

.brand-context-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.95fr);
  gap: 18px;
  align-items: start;
}

.brand-context-form,
.brand-context-preview {
  display: grid;
  gap: 16px;
  align-content: start;
}

.brand-context-preview {
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-surface-subtle) 88%, var(--fc-panel-bg));
}

.brand-context-preview h3 {
  margin: 0;
}

.brand-context-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.brand-context-field-wide {
  grid-column: 1 / -1;
}

.brand-competitor-section {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 86%, var(--fc-surface-muted));
}

.brand-competitor-section h3,
.competitor-card p {
  margin: 0;
}

.brand-competitor-grid,
.competitor-suggestion-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.competitor-suggestion-grid {
  display: grid;
  gap: 12px;
}

.competitor-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-panel-bg) 92%, white 8%);
}

.competitor-card[data-selected="true"] {
  border-color: color-mix(in srgb, var(--fc-accent) 28%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft, var(--fc-panel-bg)) 30%, var(--fc-panel-bg));
}

.competitor-card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 10px;
}

.competitor-card p,
.market-reference-note {
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.selected-competitor-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.selected-competitor-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 0 8px 0 12px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font-size: 0.84rem;
  font-weight: 700;
}

.chip-remove-button {
  border: none;
  background: transparent;
  color: var(--fc-text-muted);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.dashboard-field input,
.dashboard-field textarea,
.dashboard-field select {
  width: 100%;
  min-height: 48px;
  padding: 12px 14px;
  border: 1px solid var(--fc-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--fc-surface) 92%, white 8%);
  color: var(--fc-text);
  font: inherit;
}

.dashboard-field textarea {
  min-height: 110px;
  resize: vertical;
}

.saved-source-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.saved-source-chip {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font-size: 0.84rem;
  font-weight: 700;
}

.brand-preview-block {
  display: grid;
  gap: 10px;
}

.knowledge-source-list {
  display: grid;
  gap: 12px;
}

.knowledge-source-card {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 88%, var(--fc-surface-muted));
}

.knowledge-source-card[data-status="completed"] {
  border-color: color-mix(in srgb, var(--fc-success-text) 18%, var(--fc-border));
}

.knowledge-source-card[data-status="failed"] {
  border-color: color-mix(in srgb, var(--fc-danger, #b84b3c) 26%, var(--fc-border));
}

.knowledge-source-card-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.knowledge-source-card-header strong {
  display: block;
  margin-top: 4px;
  line-height: 1.4;
}

.brand-preview-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.warning-list {
  color: var(--fc-danger, #b84b3c);
}

.brand-signal-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.usage-panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.usage-panel-header h2 {
  margin: 0;
}

.usage-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.usage-card {
  display: grid;
  gap: 8px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
}

.usage-card strong {
  font-size: 1.9rem;
}

.usage-card p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.usage-badge {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.usage-badge.warning {
  border-color: var(--fc-warning-bg);
  background: var(--fc-warning-bg);
  color: var(--fc-warning-text);
}

.preference-preview-panel {
  margin-top: 18px;
}

@media (max-width: 920px) {
  .brand-context-layout,
  .channel-grid,
  .usage-grid {
    grid-template-columns: 1fr;
  }

  .brand-context-grid,
  .brand-signal-grid,
  .brand-competitor-grid,
  .competitor-suggestion-grid {
    grid-template-columns: 1fr;
  }
}
</style>
