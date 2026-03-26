<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useProductAccessContext } from "../access/product-access-context";
import AIRail from "../components/dashboard/AIRail.vue";
import ConsistencyRing from "../components/dashboard/ConsistencyRing.vue";
import MissionCard from "../components/dashboard/MissionCard.vue";
import PipelineBoard from "../components/dashboard/PipelineBoard.vue";
import QuickCreateBar from "../components/dashboard/QuickCreateBar.vue";
import VoiceRecorder from "../components/VoiceRecorder.vue";
import { useContentScore } from "../composables/useContentScore";
import { useMission } from "../composables/useMission";
import { useSuggestions } from "../composables/useSuggestions";
import type {
  BusinessMembership,
  ContentAsset,
  ContentPipelineStage,
  ControlDashboardResponse,
  IdeaOption,
  IdeaInboxItem,
} from "../../../packages/shared-types";
import { requestMyBusinesses, trackAnalyticsEvent } from "../services/admin-analytics-service";
import {
  requestControlDashboard,
  requestConvertIdeaToContent,
  requestCreateIdeaInboxItem,
  requestUpdatePipelineItem,
} from "../services/control-dashboard-service";
import { requestIdeaGeneration } from "../services/generation-service";
import { appRoutes } from "../utils/routes";
import type {
  MissionState,
  PipelineColumnModel,
  PipelineDraftState,
  QuickCreateAction,
} from "../components/dashboard/dashboard-types";
import type { GrowthDistributionFormat } from "../utils/repurpose-loop";
import { saveRepurposeSeed } from "../utils/repurpose-loop";

type EditablePipelineStage = ContentPipelineStage;

const router = useRouter();
const {
  bootstrap: productAccess,
  setActiveBusinessId,
  isFeatureEnabled,
} = useProductAccessContext();

const memberships = ref<BusinessMembership[]>([]);
const selectedBusinessId = ref("");
const dashboard = ref<ControlDashboardResponse | null>(null);
const isLoading = ref(true);
const errorMessage = ref("");
const newIdeaText = ref("");
const ideaFeedback = ref("");
const isSavingIdea = ref(false);
const convertingIdeaId = ref("");
const editingAssetId = ref("");
const savingAssetId = ref("");
const assetDrafts = ref<Record<string, PipelineDraftState>>({});
const dailyIdea = ref<IdeaOption | null>(null);
const isGeneratingDailyIdea = ref(false);
const nowMs = ref(Date.now());
let urgencyTimer: number | null = null;
let feedbackTimer: number | null = null;
const { calculateContentScore } = useContentScore();
const { buildMission } = useMission();
const { buildAISuggestions, getContentSuggestions, getNextActionCopy } = useSuggestions();

const currentBusiness = computed(() =>
  memberships.value.find((membership) => membership.businessId === selectedBusinessId.value),
);

const pipelineColumns = computed(() => dashboard.value?.pipeline ?? []);
const bestTimeSlots = computed(() => dashboard.value?.today.bestTimeSlots ?? []);
const isPipelineEmpty = computed(() => pipelineColumns.value.every((column) => column.items.length === 0));
const sidebarItems = [
  { label: "Dashboard", to: appRoutes.dashboard, shortLabel: "D" },
  { label: "Create", to: appRoutes.appGenerate, shortLabel: "C" },
  { label: "Analytics", to: appRoutes.dashboardAnalytics, shortLabel: "A" },
  {
    label: "Repurpose",
    to: `${appRoutes.linkedinPostGenerator}#repurpose-panel`,
    shortLabel: "R",
  },
  { label: "Settings", to: appRoutes.settingsPreferences, shortLabel: "P" },
] as const;

const accessMatchesSelectedBusiness = computed(
  () => productAccess.value?.businessId === selectedBusinessId.value,
);
const dashboardFeatureEnabled = computed(
  () => !accessMatchesSelectedBusiness.value || isFeatureEnabled("control_dashboard"),
);
const contentGenerationEnabled = computed(
  () => !accessMatchesSelectedBusiness.value || isFeatureEnabled("content_generation"),
);
const repurposeEnabled = computed(
  () => !accessMatchesSelectedBusiness.value || isFeatureEnabled("capture_remix"),
);
const accessLimits = computed(() =>
  accessMatchesSelectedBusiness.value ? productAccess.value?.limits : undefined,
);
const postsRemaining = computed(() => accessLimits.value?.postsRemaining ?? null);
const canCreateContent = computed(
  () =>
    contentGenerationEnabled.value &&
    (postsRemaining.value === null || postsRemaining.value > 0),
);
const canUseRepurpose = computed(
  () =>
    repurposeEnabled.value &&
    (postsRemaining.value === null || postsRemaining.value > 0),
);
const topbarLimitPills = computed(() => {
  if (!accessLimits.value) {
    return [];
  }

  return [
    `Posts left ${accessLimits.value.postsRemaining}`,
    `Emails left ${accessLimits.value.emailsRemaining}`,
  ];
});
const workspaceAccessMessage = computed(() => {
  if (!selectedBusinessId.value || !accessMatchesSelectedBusiness.value) {
    return "";
  }

  if (productAccess.value?.access?.readOnly) {
    return "This workspace is temporarily in read-only mode.";
  }

  if (!dashboardFeatureEnabled.value) {
    return "Dashboard access is not enabled for this workspace yet.";
  }

  if (postsRemaining.value === 0) {
    return "You've reached your daily post limit. Upgrade or try tomorrow.";
  }

  return "";
});
const filteredSidebarItems = computed(() =>
  sidebarItems.filter((item) => {
    if (item.to === appRoutes.appGenerate) {
      return contentGenerationEnabled.value || repurposeEnabled.value;
    }

    if (item.to === appRoutes.dashboardAnalytics) {
      return dashboardFeatureEnabled.value;
    }

    if (item.to === `${appRoutes.linkedinPostGenerator}#repurpose-panel`) {
      return canUseRepurpose.value;
    }

    return true;
  }),
);

const profileInitial = computed(
  () => currentBusiness.value?.business.name.trim().charAt(0).toUpperCase() || "F",
);

const bestTimeCountdownLabel = computed(() => {
  const primarySlot = bestTimeSlots.value[0];

  if (!primarySlot) {
    return "No timing signal yet";
  }

  const diffMs = new Date(primarySlot.scheduledAt).getTime() - nowMs.value;

  if (diffMs <= 0) {
    return "Best window is open now";
  }

  const totalMinutes = Math.max(1, Math.round(diffMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `Best window in ${minutes}m`;
  }

  return `Best window in ${hours}h ${minutes}m`;
});

const bestTimeDeltaMinutes = computed(() => {
  const primarySlot = bestTimeSlots.value[0];

  if (!primarySlot) {
    return null;
  }

  return Math.round((new Date(primarySlot.scheduledAt).getTime() - nowMs.value) / 60000);
});

const inactivityAlert = computed(() => {
  const lastActivityAt = dashboard.value?.today.lastActivityAt;

  if (!lastActivityAt) {
    return "Momentum hasn't started yet.";
  }

  const dayDiff = Math.max(
    0,
    Math.floor((nowMs.value - new Date(lastActivityAt).getTime()) / (24 * 60 * 60 * 1000)),
  );

  if (dayDiff === 0) {
    return "Momentum is intact today.";
  }

  return dayDiff === 1
    ? "You're close to losing momentum."
    : `You've been quiet for ${dayDiff} days. Restart momentum today.`;
});
const inactivityActive = computed(() => {
  const lastActivityAt = dashboard.value?.today.lastActivityAt;

  if (!lastActivityAt) {
    return true;
  }

  return nowMs.value - new Date(lastActivityAt).getTime() > 24 * 60 * 60 * 1000;
});

const weeklyConsistencyPercent = computed(() =>
  Math.min(100, Math.round(((dashboard.value?.today.streakDays ?? 0) / 7) * 100)),
);

const flatPipelineItems = computed(() => pipelineColumns.value.flatMap((column) => column.items));

const mission = computed<MissionState | null>(() =>
  buildMission({
    pipelineItems: flatPipelineItems.value,
    bestTimeLabel: bestTimeCountdownLabel.value,
    bestTimeDeltaMinutes: bestTimeDeltaMinutes.value,
    postedToday: (dashboard.value?.today.postedCount ?? 0) > 0,
    streakDays: dashboard.value?.today.streakDays ?? 0,
  }),
);

function buildDraftPreviewAsset(asset: ContentAsset, draft: PipelineDraftState): ContentAsset {
  return {
    ...asset,
    title: draft.title,
    textContent: draft.textContent,
    pipelineStage: draft.status,
  };
}

const pipelineColumnModels = computed<PipelineColumnModel[]>(() =>
  pipelineColumns.value.map((column) => ({
    stage: column.stage,
    label: column.label,
    items: column.items.map((asset) => {
      const draft = getPipelineDraft(asset);
      const previewAsset = buildDraftPreviewAsset(asset, draft);
      const score = calculateContentScore(asset);
      const draftScore = calculateContentScore(previewAsset);
      const suggestions = getContentSuggestions(previewAsset, draftScore);

      return {
        asset,
        score,
        draftScore,
        suggestions,
        primaryVerdict: suggestions[0] ?? null,
        nextActionCopy: getNextActionCopy(previewAsset, draftScore),
        stageActionLabel: getStageActionLabel(asset),
        draft,
        isEditing: editingAssetId.value === asset.id,
        isSaving: savingAssetId.value === asset.id,
      };
    }),
  })),
);

const aiSuggestions = computed(() =>
  buildAISuggestions(
    {
      mission: mission.value,
      pipelineItems: flatPipelineItems.value,
      ideaInbox: dashboard.value?.ideaInbox ?? [],
      postedToday: (dashboard.value?.today.postedCount ?? 0) > 0,
      bestTimeDeltaMinutes: bestTimeDeltaMinutes.value,
    },
    dailyIdea.value ?? undefined,
  ),
);

const totalSuggestionCount = computed(() => aiSuggestions.value.length);
const distributionSourceAsset = computed(
  () => mission.value?.missionAsset ?? flatPipelineItems.value[0] ?? null,
);
const averagePipelineScore = computed(() => {
  if (flatPipelineItems.value.length === 0) {
    return 0;
  }

  const totalScore = flatPipelineItems.value.reduce(
    (sum, asset) => sum + calculateContentScore(asset).score,
    0,
  );

  return Math.round(totalScore / flatPipelineItems.value.length);
});
const strongestPipelineAsset = computed(
  () =>
    [...flatPipelineItems.value].sort(
      (left, right) => calculateContentScore(right).score - calculateContentScore(left).score,
    )[0] ?? null,
);
const liveMomentumFeed = computed(() => {
  const strongestScore = strongestPipelineAsset.value
    ? calculateContentScore(strongestPipelineAsset.value).score
    : 86;
  const baselineScore = Math.max(52, strongestScore - 28);
  const scheduledCount = dashboard.value?.today.scheduledCount ?? 0;

  return [
    `A founder just lifted a post score from ${baselineScore} -> ${strongestScore}.`,
    scheduledCount > 0
      ? "Someone just locked content into the next best posting window."
      : "Someone just turned one idea into three publishable content assets.",
    "A founder just remixed one post into a carousel, a thread, and a follow-up angle.",
  ];
});
const weeklyReportHeading = computed(() =>
  averagePipelineScore.value >= 84
    ? "Your content system is compounding."
    : "Your weekly execution loop is warming up.",
);
const weeklyReportLines = computed(() => {
  const showedUpDays = Math.min(7, dashboard.value?.today.streakDays ?? 0);
  const strongestAsset = strongestPipelineAsset.value;
  const strongestScore = strongestAsset ? calculateContentScore(strongestAsset).score : 0;

  return [
    `You showed up ${showedUpDays} day${showedUpDays === 1 ? "" : "s"} this week.`,
    averagePipelineScore.value > 0
      ? `Average content quality: ${averagePipelineScore.value}/100.`
      : "No quality baseline yet. One published post starts the loop.",
    strongestAsset
      ? `Top draft: ${strongestAsset.title ?? strongestAsset.contentType} at ${strongestScore}/100.`
      : "Capture one more idea to create your first top-performing asset.",
  ];
});
const showReferralPrompt = computed(
  () =>
    (dashboard.value?.today.postedCount ?? 0) > 0
    || (dashboard.value?.today.streakDays ?? 0) >= 2
    || flatPipelineItems.value.length >= 3,
);
const growthDistributionActions = [
  {
    format: "thread" as GrowthDistributionFormat,
    label: "Twitter thread",
    description: "Split one strong post into a serial founder idea.",
  },
  {
    format: "carousel" as GrowthDistributionFormat,
    label: "LinkedIn carousel",
    description: "Turn the current draft into slide-ready content.",
  },
  {
    format: "video" as GrowthDistributionFormat,
    label: "Short video script",
    description: "Pull out a hook, body, and CTA for a quick talking video.",
  },
] as const;

function getPipelineDraft(asset: ContentAsset): PipelineDraftState {
  const existing = assetDrafts.value[asset.id];

  if (existing) {
    return existing;
  }

  return {
    title: asset.title ?? "",
    textContent: asset.textContent ?? "",
    status: (asset.pipelineStage ?? "draft") as EditablePipelineStage,
  };
}

function resetEditingState() {
  editingAssetId.value = "";
  assetDrafts.value = {};
  savingAssetId.value = "";
}

async function loadDashboard(businessId: string) {
  if (!businessId) {
    dashboard.value = null;
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    dashboard.value = await requestControlDashboard(businessId);
  } catch (error) {
    dashboard.value = null;
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load the control dashboard.";
  } finally {
    isLoading.value = false;
  }
}

async function initializeDashboard() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await requestMyBusinesses();
    memberships.value = response.businesses;

    if (!selectedBusinessId.value) {
      selectedBusinessId.value =
        productAccess.value?.activeBusinessId || response.businesses[0]?.businessId || "";
    }

    if (selectedBusinessId.value) {
      const accessState = await setActiveBusinessId(selectedBusinessId.value);

      if (accessState?.activeBusinessId && accessState.activeBusinessId !== selectedBusinessId.value) {
        selectedBusinessId.value = accessState.activeBusinessId;
      }

      if (accessState?.features.control_dashboard === false) {
        dashboard.value = null;
        errorMessage.value = "";
        isLoading.value = false;
        return;
      }

      await loadDashboard(selectedBusinessId.value);
    } else {
      dashboard.value = null;
      isLoading.value = false;
    }
  } catch (error) {
    memberships.value = [];
    dashboard.value = null;
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to initialize the dashboard.";
    isLoading.value = false;
  }
}

async function addIdeaInboxItem() {
  if (!selectedBusinessId.value) {
    ideaFeedback.value = "Create or select a workspace first.";
    return;
  }

  if (!newIdeaText.value.trim()) {
    ideaFeedback.value = "Write one idea before saving it.";
    return;
  }

  isSavingIdea.value = true;
  ideaFeedback.value = "";

  try {
    await requestCreateIdeaInboxItem({
      businessId: selectedBusinessId.value,
      text: newIdeaText.value,
    });
    newIdeaText.value = "";
    ideaFeedback.value = "Idea saved to the inbox.";
    await loadDashboard(selectedBusinessId.value);
  } catch (error) {
    ideaFeedback.value = error instanceof Error ? error.message : "Unable to save the idea.";
  } finally {
    isSavingIdea.value = false;
  }
}

function handleIdeaVoiceTranscript(text: string) {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return;
  }

  newIdeaText.value = newIdeaText.value.trim()
    ? `${newIdeaText.value.trim()}\n\n${normalizedText}`
    : normalizedText;
  ideaFeedback.value = "Voice note transcribed. Edit it or save it to the inbox.";
}

async function convertIdeaToDraft(idea: IdeaInboxItem) {
  if (!selectedBusinessId.value) {
    return;
  }

  if (!canCreateContent.value) {
    ideaFeedback.value =
      postsRemaining.value === 0
        ? "You've reached your daily post limit. Upgrade or try tomorrow."
        : "Content generation is not enabled for this workspace.";
    return;
  }

  convertingIdeaId.value = idea.id;
  ideaFeedback.value = "";

  try {
    await trackAnalyticsEvent({
      eventType: "content_selected",
      businessId: selectedBusinessId.value,
      metadata: {
        entityId: idea.id,
        entityType: "idea",
      },
    });

    const response = await requestConvertIdeaToContent({
      businessId: selectedBusinessId.value,
      ideaId: idea.id,
      tone: "storytelling",
      length: "medium",
    });

    await setActiveBusinessId(selectedBusinessId.value);
    ideaFeedback.value = "Idea converted into a draft.";
    await loadDashboard(selectedBusinessId.value);
    beginEditing(response.asset);
  } catch (error) {
    ideaFeedback.value =
      error instanceof Error ? error.message : "Unable to convert the idea into content.";
  } finally {
    convertingIdeaId.value = "";
  }
}

async function beginEditing(asset: ContentAsset) {
  editingAssetId.value = asset.id;
  assetDrafts.value = {
    ...assetDrafts.value,
    [asset.id]: {
      title: asset.title ?? "",
      textContent: asset.textContent ?? "",
      status: (asset.pipelineStage ?? "draft") as EditablePipelineStage,
    },
  };

  if (selectedBusinessId.value) {
    try {
      await trackAnalyticsEvent({
        eventType: "content_selected",
        businessId: selectedBusinessId.value,
        metadata: {
          entityId: asset.id,
          entityType: "asset",
          stage: asset.pipelineStage ?? "draft",
          contentType: asset.contentType,
        },
      });
    } catch {
      // Selection tracking should not block editing.
    }
  }
}

async function savePipelineItem(asset: ContentAsset) {
  if (!selectedBusinessId.value) {
    return;
  }

  const draft = getPipelineDraft(asset);
  const performancePreviewAsset = {
    ...asset,
    title: draft.title,
    textContent: draft.textContent,
  };
  const beforeScore = calculateContentScore(asset);
  const afterScore = calculateContentScore(performancePreviewAsset);
  const impactDiff = Math.max(0, afterScore.viralScore - beforeScore.viralScore);
  savingAssetId.value = asset.id;

  try {
    await requestUpdatePipelineItem({
      businessId: selectedBusinessId.value,
      assetId: asset.id,
      title: draft.title,
      textContent: draft.textContent,
      status: draft.status,
    });

    ideaFeedback.value =
      impactDiff > 0
        ? `Saved. Your post is now ${impactDiff}% more likely to perform.`
        : "Saved. Keep moving this toward publish.";
    resetEditingState();
    await loadDashboard(selectedBusinessId.value);
  } catch (error) {
    ideaFeedback.value =
      error instanceof Error ? error.message : "Unable to update the pipeline item.";
  } finally {
    savingAssetId.value = "";
  }
}

function scrollToSection(sectionId: string) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function focusAsset(assetId: string | undefined) {
  if (!assetId) {
    return;
  }

  const targetAsset = flatPipelineItems.value.find((asset) => asset.id === assetId);

  if (!targetAsset) {
    return;
  }

  void beginEditing(targetAsset);
  document.getElementById(`asset-${targetAsset.id}`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function openCreator(hash?: string) {
  void router.push({
    path: hash ? appRoutes.linkedinPostGenerator : appRoutes.appGenerate,
    hash,
  });
}

function handleQuickCreateAction(action: QuickCreateAction) {
  if ((action === "write" || action === "daily-idea") && !canCreateContent.value) {
    ideaFeedback.value =
      postsRemaining.value === 0
        ? "You've reached your daily post limit. Upgrade or try tomorrow."
        : "Content generation is not enabled for this workspace.";
    return;
  }

  if (action === "speak") {
    scrollToSection("idea-inbox");
    return;
  }

  if (action === "repurpose") {
    if (!canUseRepurpose.value) {
      ideaFeedback.value =
        postsRemaining.value === 0
          ? "You've reached your daily post limit. Upgrade or try tomorrow."
          : "Repurpose is not enabled for this workspace.";
      return;
    }

    openCreator("#repurpose-panel");
    return;
  }

  if (action === "daily-idea") {
    void generateDailyIdea();
    return;
  }

  openCreator();
}

function resolveNextStage(stage: EditablePipelineStage): EditablePipelineStage | null {
  if (stage === "draft") {
    return "review";
  }

  if (stage === "review") {
    return "scheduled";
  }

  if (stage === "scheduled") {
    return "posted";
  }

  return null;
}

function getStageActionLabel(asset: ContentAsset): string | null {
  const stage = (asset.pipelineStage ?? "draft") as EditablePipelineStage;
  const nextStage = resolveNextStage(stage);

  if (!nextStage) {
    return null;
  }

  if (nextStage === "review") {
    return "Send to review";
  }

  if (nextStage === "scheduled") {
    return "Schedule";
  }

  return "Mark posted";
}

async function advancePipelineItem(asset: ContentAsset) {
  if (!selectedBusinessId.value) {
    return;
  }

  const currentStage = (asset.pipelineStage ?? "draft") as EditablePipelineStage;
  const nextStage = resolveNextStage(currentStage);

  if (!nextStage) {
    return;
  }

  savingAssetId.value = asset.id;
  ideaFeedback.value = "";

  try {
    await requestUpdatePipelineItem({
      businessId: selectedBusinessId.value,
      assetId: asset.id,
      status: nextStage,
    });
    ideaFeedback.value =
      nextStage === "scheduled" ? "Item moved into scheduled." : `Item moved to ${nextStage}.`;
    await loadDashboard(selectedBusinessId.value);
  } catch (error) {
    ideaFeedback.value =
      error instanceof Error ? error.message : "Unable to move this item forward.";
  } finally {
    savingAssetId.value = "";
  }
}

function updateDraftState(assetId: string, draft: PipelineDraftState) {
  assetDrafts.value = {
    ...assetDrafts.value,
    [assetId]: draft,
  };
}

function handleMissionTaskAction(task: MissionState["primaryAction"]) {
  if (!task) {
    return;
  }

  if (task.action === "create") {
    openCreator();
    return;
  }

  if (task.action === "repurpose") {
    openCreator("#repurpose-panel");
    return;
  }

  if (task.action === "schedule") {
    openCreator();
    return;
  }

  if (mission.value?.missionAsset) {
    focusAsset(mission.value.missionAsset.id);
  }
}

async function generateDailyIdea() {
  if (!selectedBusinessId.value) {
    return;
  }

  if (!canCreateContent.value) {
    ideaFeedback.value =
      postsRemaining.value === 0
        ? "You've reached your daily post limit. Upgrade or try tomorrow."
        : "Content generation is not enabled for this workspace.";
    return;
  }

  isGeneratingDailyIdea.value = true;
  ideaFeedback.value = "";

  try {
    const response = await requestIdeaGeneration({
      industry: currentBusiness.value?.business.niche?.trim() || "founder-led business",
      stage: "growth",
      businessId: selectedBusinessId.value,
    });

    dailyIdea.value = response.ideas[0] ?? null;
    ideaFeedback.value = dailyIdea.value
      ? `Daily idea ready: ${dailyIdea.value.title}`
      : "No daily idea returned this time.";

    if (dailyIdea.value) {
      await setActiveBusinessId(selectedBusinessId.value);
      await trackAnalyticsEvent({
        eventType: "idea_generated",
        businessId: selectedBusinessId.value,
        metadata: {
          source: "dashboard_daily_idea",
          title: dailyIdea.value.title,
        },
      });
    }
  } catch (error) {
    ideaFeedback.value =
      error instanceof Error ? error.message : "Unable to generate a daily post idea.";
  } finally {
    isGeneratingDailyIdea.value = false;
  }
}

function handleAISuggestionAction(suggestion: { action: QuickCreateAction | "focus_asset"; assetId?: string }) {
  if (suggestion.action === "focus_asset") {
    focusAsset(suggestion.assetId);
    return;
  }

  handleQuickCreateAction(suggestion.action);
}

async function openDistributionLoop(format: GrowthDistributionFormat) {
  if (!canUseRepurpose.value) {
    ideaFeedback.value =
      postsRemaining.value === 0
        ? "You've reached your daily post limit. Upgrade or try tomorrow."
        : "Repurpose is not enabled for this workspace.";
    return;
  }

  const sourceAsset = distributionSourceAsset.value;

  if (!sourceAsset?.textContent?.trim()) {
    ideaFeedback.value = "Create or select a post before turning it into more formats.";
    return;
  }

  saveRepurposeSeed({
    text: sourceAsset.textContent,
    title: sourceAsset.title,
    format,
    source: "dashboard",
  });

  ideaFeedback.value = `${growthDistributionActions.find((action) => action.format === format)?.label ?? "Distribution"} seed loaded into the repurpose engine.`;

  try {
    await trackAnalyticsEvent({
      eventType: "content_type_selected",
      businessId: selectedBusinessId.value || undefined,
      metadata: {
        source: "dashboard_distribution_loop",
        format,
        assetId: sourceAsset.id,
      },
    });
  } catch {
    // Distribution handoff should remain fast even if analytics tracking fails.
  }

  openCreator("#repurpose-panel");
}

async function copyReferralInvite() {
  try {
    await navigator.clipboard.writeText(
      "I am using FounderContent AI to turn one idea into posts, visuals, and a consistent weekly content loop. Want the link?",
    );
    ideaFeedback.value = "Invite text copied.";
  } catch (error) {
    ideaFeedback.value =
      error instanceof Error ? error.message : "Unable to copy the invite message.";
  }
}

watch(
  selectedBusinessId,
  async (businessId, previousBusinessId) => {
    if (!businessId || businessId === previousBusinessId) {
      return;
    }

    resetEditingState();
    const accessState = await setActiveBusinessId(businessId);

    if (accessState?.activeBusinessId && accessState.activeBusinessId !== businessId) {
      selectedBusinessId.value = accessState.activeBusinessId;
      return;
    }

    if (accessState?.features.control_dashboard === false) {
      dashboard.value = null;
      errorMessage.value = "";
      isLoading.value = false;
      return;
    }

    await loadDashboard(businessId);
  },
);

watch(ideaFeedback, (message) => {
  if (feedbackTimer !== null) {
    window.clearTimeout(feedbackTimer);
    feedbackTimer = null;
  }

  if (!message) {
    return;
  }

  feedbackTimer = window.setTimeout(() => {
    ideaFeedback.value = "";
    feedbackTimer = null;
  }, 4200);
});

onMounted(() => {
  urgencyTimer = window.setInterval(() => {
    nowMs.value = Date.now();
  }, 30000);
  void initializeDashboard();
});

onBeforeUnmount(() => {
  if (urgencyTimer !== null) {
    window.clearInterval(urgencyTimer);
  }

  if (feedbackTimer !== null) {
    window.clearTimeout(feedbackTimer);
  }
});
</script>

<template>
  <main class="dashboard-shell workspace-dashboard">
    <p v-if="isLoading" class="dashboard-feedback">Loading your control dashboard...</p>
    <p v-else-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>

    <template v-else>
      <section v-if="memberships.length === 0" class="dashboard-panel empty-state-panel">
        <h2>No workspace yet</h2>
        <p class="dashboard-description">
          Finish onboarding to create your first workspace before using the content control loop.
        </p>
        <router-link class="dashboard-button" :to="appRoutes.onboarding">Go to onboarding</router-link>
      </section>

      <section
        v-else-if="workspaceAccessMessage && !dashboard"
        class="dashboard-panel empty-state-panel"
      >
        <h2>Workspace access limited</h2>
        <p class="dashboard-description">
          {{ workspaceAccessMessage }}
        </p>
        <router-link class="dashboard-button" :to="appRoutes.appGenerate">
          Go to creator
        </router-link>
      </section>

      <div v-else-if="dashboard" class="workspace-frame">
        <aside class="dashboard-sidebar">
          <div class="sidebar-brand">
            <span class="sidebar-brand-mark">{{ profileInitial }}</span>
          </div>

          <ConsistencyRing
            :percent="weeklyConsistencyPercent"
            :streak-days="dashboard.today.streakDays"
          />

          <nav class="sidebar-nav" aria-label="Workspace navigation">
            <router-link
              v-for="item in filteredSidebarItems"
              :key="item.to"
              :to="item.to"
              class="sidebar-item"
            >
              <span class="sidebar-item-icon">{{ item.shortLabel }}</span>
              <span class="sidebar-item-label">{{ item.label }}</span>
            </router-link>
          </nav>
        </aside>

        <div class="workspace-content">
          <header class="dashboard-topbar">
            <label class="dashboard-field workspace-switcher">
              <span>Workspace</span>
              <select v-model="selectedBusinessId">
                <option
                  v-for="membership in memberships"
                  :key="membership.id"
                  :value="membership.businessId"
                >
                  {{ membership.business.name }}
                </option>
              </select>
            </label>

            <QuickCreateBar
              :best-time-label="bestTimeCountdownLabel"
              :inactivity-message="inactivityAlert"
              :inactivity-active="inactivityActive"
              :daily-idea-loading="isGeneratingDailyIdea"
              :write-disabled="!canCreateContent"
              :repurpose-disabled="!canUseRepurpose"
              :daily-idea-disabled="!canCreateContent"
              @speak="handleQuickCreateAction('speak')"
              @write="handleQuickCreateAction('write')"
              @repurpose="handleQuickCreateAction('repurpose')"
              @daily-idea="handleQuickCreateAction('daily-idea')"
            />

            <div class="topbar-status">
              <span v-for="pill in topbarLimitPills" :key="pill" class="topbar-pill muted">{{ pill }}</span>
              <span v-if="productAccess?.access?.readOnly" class="topbar-pill warning">Read-only</span>
              <span class="topbar-pill">{{ totalSuggestionCount }} strategist moves</span>
              <span class="profile-chip">{{ profileInitial }}</span>
            </div>
          </header>

          <div v-if="ideaFeedback" class="dashboard-feedback-banner">
            <span class="feedback-badge">Success</span>
            <strong>{{ ideaFeedback }}</strong>
          </div>

          <section class="dashboard-intro">
            <div>
              <p class="dashboard-eyebrow">/dashboard</p>
              <h1>{{ currentBusiness?.business.name ?? "Control Dashboard" }}</h1>
              <p class="dashboard-description">
                Stay focused on the next move. Capture, refine, schedule, and post without losing the thread.
              </p>
            </div>

            <div class="intro-stats">
              <span class="topbar-pill">Streak {{ dashboard.today.streakDays }}</span>
              <span class="topbar-pill muted">
                {{
                  dashboard.today.lastActivityAt
                    ? `Last activity ${new Date(dashboard.today.lastActivityAt).toLocaleString()}`
                    : "No recent activity yet"
                }}
              </span>
            </div>
          </section>

          <div class="dashboard-main-grid">
            <div class="dashboard-primary">
              <section id="today" class="today-section">
                <MissionCard
                  :mission="mission"
                  @task-action="handleMissionTaskAction"
                  @primary-action="handleMissionTaskAction"
                />
                <div class="dashboard-card-grid">
                  <article class="dashboard-card">
                    <p class="dashboard-card-label">Drafts</p>
                    <strong>{{ dashboard.today.draftCount }}</strong>
                  </article>
                  <article class="dashboard-card">
                    <p class="dashboard-card-label">Review</p>
                    <strong>{{ dashboard.today.reviewCount }}</strong>
                  </article>
                  <article class="dashboard-card">
                    <p class="dashboard-card-label">Scheduled</p>
                    <strong>{{ dashboard.today.scheduledCount }}</strong>
                  </article>
                  <article class="dashboard-card">
                    <p class="dashboard-card-label">Posted</p>
                    <strong>{{ dashboard.today.postedCount }}</strong>
                  </article>
                  <article class="dashboard-card">
                    <p class="dashboard-card-label">Idea Inbox</p>
                    <strong>{{ dashboard.today.ideaInboxCount }}</strong>
                  </article>
                </div>
              </section>

              <PipelineBoard
                :columns="pipelineColumnModels"
                :empty="isPipelineEmpty"
                @edit="beginEditing"
                @advance="advancePipelineItem"
                @save="savePipelineItem"
                @close="resetEditingState"
                @open-creator="openCreator"
                @speak-now="handleQuickCreateAction('speak')"
                @update-draft="updateDraftState"
              />

              <section id="idea-inbox" class="dashboard-grid-two">
                <article class="dashboard-panel">
                  <p class="panel-meta">Idea Inbox</p>
                  <h2>Capture first. Shape later.</h2>
                  <p class="dashboard-description">
                    Save raw thoughts fast, then convert the best ones into drafts when you are ready.
                  </p>

                  <label class="dashboard-field">
                    <span>Quick idea</span>
                    <textarea
                      v-model="newIdeaText"
                      rows="5"
                      placeholder="A founder lesson, objection, observation, or half-formed thought."
                    />
                  </label>

                  <VoiceRecorder
                    title="Capture an idea by voice"
                    hint="Record a quick thought, then save the transcript into the inbox when it looks right."
                    @transcribed="handleIdeaVoiceTranscript"
                  />

                  <div class="action-row">
                    <button
                      type="button"
                      class="dashboard-button"
                      :disabled="isSavingIdea"
                      @click="addIdeaInboxItem"
                    >
                      {{ isSavingIdea ? "Saving..." : "Save idea" }}
                    </button>
                  </div>

                  <p v-if="ideaFeedback" class="dashboard-feedback">{{ ideaFeedback }}</p>
                </article>

                <article class="dashboard-panel">
                  <p class="panel-meta">Inbox Queue</p>
                  <h2>{{ dashboard.ideaInbox.length }} saved ideas</h2>

                  <div class="idea-list">
                    <article v-for="idea in dashboard.ideaInbox" :key="idea.id" class="idea-item">
                      <div>
                        <strong>{{ idea.text }}</strong>
                        <p class="pipeline-meta">
                          {{ idea.status }} · {{ new Date(idea.updatedAt).toLocaleString() }}
                        </p>
                      </div>

                      <button
                        v-if="idea.status !== 'converted'"
                        type="button"
                        class="dashboard-button secondary small-button"
                        :disabled="convertingIdeaId === idea.id"
                        @click="convertIdeaToDraft(idea)"
                      >
                        {{ convertingIdeaId === idea.id ? "Converting..." : "Convert to draft" }}
                      </button>
                    </article>

                    <div v-if="dashboard.ideaInbox.length === 0" class="pipeline-empty-state">
                      <p class="pipeline-empty">No ideas yet. Start by speaking your first idea.</p>
                      <button type="button" class="dashboard-button secondary small-button" @click="scrollToSection('idea-inbox')">
                        Speak now
                      </button>
                    </div>
                  </div>
                </article>
              </section>
            </div>

            <aside class="dashboard-rail">
              <AIRail :suggestions="aiSuggestions" @action="handleAISuggestionAction" />

              <section class="dashboard-panel rail-panel">
                <div class="panel-header">
                  <div>
                    <p class="panel-meta">Distribution Engine</p>
                    <h2>Turn this into more formats</h2>
                  </div>
                </div>

                <p class="dashboard-description">
                  Use the current best draft as the seed for more reach without starting from zero.
                </p>

                <div class="distribution-stack">
                  <button
                    v-for="action in growthDistributionActions"
                    :key="action.format"
                    type="button"
                    class="distribution-option"
                    @click="openDistributionLoop(action.format)"
                  >
                    <strong>{{ action.label }}</strong>
                    <span>{{ action.description }}</span>
                  </button>
                </div>
              </section>

              <section class="dashboard-panel rail-panel">
                <div class="panel-header">
                  <div>
                    <p class="panel-meta">Live Momentum</p>
                    <h2>Proof the loop is working</h2>
                  </div>
                </div>

                <div class="rail-list">
                  <article
                    v-for="item in liveMomentumFeed"
                    :key="item"
                    class="rail-feed-item"
                  >
                    {{ item }}
                  </article>
                </div>
              </section>

              <section class="dashboard-panel rail-panel">
                <div class="panel-header">
                  <div>
                    <p class="panel-meta">Weekly Report</p>
                    <h2>{{ weeklyReportHeading }}</h2>
                  </div>
                </div>

                <div class="rail-list">
                  <article
                    v-for="line in weeklyReportLines"
                    :key="line"
                    class="rail-feed-item"
                  >
                    {{ line }}
                  </article>
                </div>

                <button
                  type="button"
                  class="dashboard-button secondary small-button"
                  @click="handleQuickCreateAction('daily-idea')"
                >
                  Plan next week
                </button>
              </section>

              <section v-if="showReferralPrompt" class="dashboard-panel rail-panel referral-rail">
                <p class="panel-meta">Referral Loop</p>
                <h2>Let users bring users</h2>
                <p class="dashboard-description">
                  Invite 2 founder friends and unlock deeper scoring, stronger suggestions, and more room to create.
                </p>
                <button
                  type="button"
                  class="dashboard-button secondary small-button"
                  @click="copyReferralInvite"
                >
                  Copy invite text
                </button>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </template>
  </main>
</template>

<style scoped>
.workspace-dashboard {
  display: grid;
  gap: 18px;
}

.workspace-frame {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.dashboard-sidebar {
  position: sticky;
  top: calc(var(--fc-header-padding-y) + 84px);
  display: grid;
  gap: 16px;
  padding: 16px 10px;
  border: 1px solid var(--fc-border);
  border-radius: var(--fc-radius-panel);
  background: var(--fc-panel-bg);
  box-shadow: var(--fc-panel-shadow);
}

.sidebar-brand {
  display: flex;
  justify-content: center;
}

.sidebar-brand-mark,
.profile-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
  font-weight: 800;
}

.sidebar-nav {
  display: grid;
  gap: 10px;
}

.sidebar-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  border-radius: 16px;
  color: var(--fc-text-muted);
  text-decoration: none;
}

.sidebar-item::before {
  content: "";
  position: absolute;
  left: -10px;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 999px;
  background: transparent;
}

.sidebar-item.router-link-active {
  color: var(--fc-text);
  background: color-mix(in srgb, var(--fc-panel-bg) 76%, var(--fc-surface-muted));
}

.sidebar-item.router-link-active::before {
  background: var(--fc-accent);
}

.sidebar-item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: var(--fc-surface-muted);
  font-weight: 700;
}

.sidebar-item-label {
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
  transform: translateY(-50%) translateX(-6px);
  padding: 8px 10px;
  border: 1px solid var(--fc-border);
  border-radius: 12px;
  background: var(--fc-panel-bg);
  box-shadow: var(--fc-panel-shadow);
  color: var(--fc-text);
  font-size: 0.86rem;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 120ms ease,
    transform 120ms ease;
}

.sidebar-item:hover .sidebar-item-label,
.sidebar-item.router-link-active .sidebar-item-label {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}

.workspace-content {
  display: grid;
  gap: 18px;
}

.dashboard-topbar,
.dashboard-intro,
.refined-today-panel {
  padding: 20px;
  border: 1px solid var(--fc-border);
  border-radius: var(--fc-radius-panel);
  background: var(--fc-panel-bg);
  box-shadow: var(--fc-panel-shadow);
}

.dashboard-topbar {
  display: grid;
  grid-template-columns: minmax(0, 280px) auto auto;
  gap: 16px;
  align-items: end;
}

.workspace-switcher select {
  max-width: none;
}

.topbar-actions,
.topbar-status,
.intro-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.topbar-status {
  justify-content: flex-end;
}

.dashboard-feedback-banner {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding: 14px 18px;
  border: 1px solid color-mix(in srgb, var(--fc-success-text) 18%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-success-bg) 72%, var(--fc-panel-bg));
  color: var(--fc-success-text);
}

.feedback-badge {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-success-text) 12%, var(--fc-success-bg));
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.topbar-pill {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-input-bg);
  color: var(--fc-text);
  font-size: 0.92rem;
}

.topbar-pill.muted {
  color: var(--fc-text-muted);
}

.topbar-pill.warning {
  border-color: var(--fc-warning-bg);
  color: var(--fc-warning-text);
  background: var(--fc-warning-bg);
}

.dashboard-intro {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.dashboard-intro h1 {
  margin: 0;
  font-family: var(--fc-font-family-display);
  font-size: clamp(2rem, 5vw, 3rem);
  line-height: 1.02;
}

.dashboard-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.75fr);
  gap: 18px;
  align-items: start;
}

.dashboard-primary,
.dashboard-rail {
  display: grid;
  gap: 18px;
}

.today-panel {
  display: grid;
  gap: 18px;
}

.today-signal-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.today-signal-card {
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--fc-panel-bg) 94%, var(--fc-accent) 6%) 0%, var(--fc-panel-bg) 100%);
}

.today-signal-card strong {
  font-size: 1rem;
}

.today-signal-card[data-tone="warning"] {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--fc-error-bg) 38%, var(--fc-panel-bg)) 0%, var(--fc-panel-bg) 100%);
}

.today-signal-card[data-tone="success"] {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--fc-success-bg) 34%, var(--fc-panel-bg)) 0%, var(--fc-panel-bg) 100%);
}

.today-signal-card p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.pipeline-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.pipeline-column {
  display: grid;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: calc(var(--fc-radius-panel) - 2px);
  background: color-mix(in srgb, var(--fc-panel-bg) 90%, var(--fc-surface-muted));
}

.pipeline-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pipeline-column-header span {
  color: var(--fc-text-muted);
  font-size: 0.92rem;
}

.pipeline-item,
.idea-item,
.suggestion-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
}

.refined-pipeline-item {
  align-content: start;
}

.pipeline-item-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.pipeline-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--fc-surface-muted);
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  text-transform: capitalize;
}

.status-tag.accent {
  background: color-mix(in srgb, var(--fc-accent) 18%, var(--fc-panel-bg));
  color: var(--fc-text);
}

.pipeline-meta {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  font-size: 0.88rem;
  line-height: 1.5;
}

.pipeline-excerpt {
  margin: 0;
  color: var(--fc-text);
  line-height: 1.6;
  white-space: pre-wrap;
}

.pipeline-score-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: center;
}

.score-chip {
  display: grid;
  gap: 2px;
  min-width: 92px;
  padding: 10px 12px;
  border-radius: 16px;
  background: var(--fc-surface-muted);
  color: var(--fc-text);
  text-align: center;
}

.score-chip strong {
  font-size: 1.2rem;
}

.score-chip span {
  color: var(--fc-text-muted);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.score-chip[data-highlight="true"] {
  background: color-mix(in srgb, var(--fc-success-bg) 72%, var(--fc-panel-bg));
}

.score-copy {
  display: grid;
  gap: 4px;
}

.score-copy p,
.next-action-copy {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.micro-reward-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reward-chip {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-success-bg) 62%, var(--fc-panel-bg));
  color: var(--fc-success-text);
  font-size: 0.82rem;
}

.reward-chip[data-highlight="false"] {
  background: var(--fc-surface-muted);
  color: var(--fc-text);
}

.reward-chip.muted {
  background: color-mix(in srgb, var(--fc-info-bg) 60%, var(--fc-panel-bg));
  color: var(--fc-info-text);
}

.pipeline-editor {
  display: grid;
  gap: 12px;
}

.pipeline-actions {
  margin-top: 0;
}

.pipeline-empty,
.dashboard-empty-copy {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.pipeline-empty-state {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px dashed var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
}

.idea-list,
.suggestion-grid {
  display: grid;
  gap: 12px;
}

.suggestion-panel {
  position: sticky;
  top: calc(var(--fc-header-padding-y) + 84px);
}

.suggestion-type {
  color: var(--fc-text-muted);
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.suggestion-card p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.empty-state-panel {
  display: grid;
  gap: 14px;
}

.rail-panel {
  display: grid;
  gap: 14px;
}

.distribution-stack,
.rail-list {
  display: grid;
  gap: 12px;
}

.distribution-option,
.rail-feed-item {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
}

.distribution-option {
  width: 100%;
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.distribution-option strong {
  color: var(--fc-text);
}

.distribution-option span,
.rail-feed-item {
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.referral-rail {
  border-color: color-mix(in srgb, var(--fc-success-text) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg) 26%, var(--fc-panel-bg));
}

.small-button {
  min-height: 38px;
  padding: 0 14px;
}

@media (max-width: 1280px) {
  .today-signal-grid {
    grid-template-columns: 1fr;
  }

  .pipeline-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 1080px) {
  .dashboard-main-grid {
    grid-template-columns: 1fr;
  }

  .suggestion-panel {
    position: static;
  }
}

@media (max-width: 960px) {
  .workspace-frame {
    grid-template-columns: 1fr;
  }

  .dashboard-sidebar {
    order: 2;
    position: sticky;
    top: auto;
    bottom: 14px;
    z-index: 12;
    width: min(100%, 560px);
    margin: 0 auto;
    padding: 10px;
  }

  .sidebar-brand {
    display: none;
  }

  .sidebar-nav {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .sidebar-item {
    min-height: 56px;
    padding: 6px 0;
  }

  .sidebar-item::before {
    left: 12px;
    right: 12px;
    top: auto;
    bottom: -4px;
    width: auto;
    height: 3px;
  }

  .sidebar-item-label {
    position: static;
    transform: none;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    opacity: 1;
    font-size: 0.74rem;
  }

  .sidebar-item:hover .sidebar-item-label,
  .sidebar-item.router-link-active .sidebar-item-label {
    transform: none;
  }
}

@media (max-width: 760px) {
  .dashboard-topbar {
    grid-template-columns: 1fr;
  }

  .topbar-status {
    justify-content: flex-start;
  }

  .pipeline-grid,
  .dashboard-grid-two {
    grid-template-columns: 1fr;
  }

  .pipeline-score-row {
    grid-template-columns: 1fr;
  }

  .pipeline-item-header,
  .panel-header,
  .dashboard-intro {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
