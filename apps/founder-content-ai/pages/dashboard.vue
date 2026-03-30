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
import { requestHookGeneration, requestIdeaGeneration } from "../services/generation-service";
import { appRoutes } from "../utils/routes";
import type {
  AISuggestion,
  MissionState,
  PipelineColumnModel,
  PipelineDraftState,
  QuickCreateAction,
} from "../components/dashboard/dashboard-types";

type EditablePipelineStage = ContentPipelineStage;

interface DashboardActionOption {
  id: string;
  label: string;
  description: string;
  previewText: string;
  nextPostText: string;
}

interface DashboardActionPreview {
  kind: "hook" | "cta";
  assetId: string;
  title: string;
  description: string;
  scopeHint: string;
  originalText: string;
  options: DashboardActionOption[];
  selectedOptionId: string;
}

const router = useRouter();
const {
  bootstrap: productAccess,
  activeBusinessId,
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
const actionPreview = ref<DashboardActionPreview | null>(null);
const actionPreviewError = ref("");
const isPreviewingAction = ref(false);
const isApplyingActionPreview = ref(false);
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
    label: column.stage === "review" ? "Ready" : column.label,
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
const selectedActionPreviewOption = computed(() =>
  actionPreview.value?.options.find((option) => option.id === actionPreview.value?.selectedOptionId) ?? null,
);

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

function normalizeParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function getEditableAssetText(asset: ContentAsset): string {
  return getPipelineDraft(asset).textContent.trim() || asset.textContent?.trim() || "";
}

function getOpeningParagraph(text: string): string {
  return normalizeParagraphs(text)[0] ?? "";
}

function getClosingParagraph(text: string): string {
  const paragraphs = normalizeParagraphs(text);
  return paragraphs[paragraphs.length - 1] ?? "";
}

function replaceOpeningParagraph(text: string, nextOpening: string): string {
  const paragraphs = normalizeParagraphs(text);

  if (paragraphs.length === 0) {
    return nextOpening.trim();
  }

  return [nextOpening.trim(), ...paragraphs.slice(1)].join("\n\n");
}

function replaceClosingParagraph(text: string, nextClosing: string): string {
  const paragraphs = normalizeParagraphs(text);

  if (paragraphs.length === 0) {
    return nextClosing.trim();
  }

  if (paragraphs.length === 1) {
    return `${paragraphs[0]}\n\n${nextClosing.trim()}`;
  }

  const lastParagraph = paragraphs[paragraphs.length - 1] ?? "";
  const shouldReplace =
    lastParagraph.length <= 120 ||
    lastParagraph.endsWith("?") ||
    /^curious|^what |^if you|^reply /i.test(lastParagraph);

  if (shouldReplace) {
    return [...paragraphs.slice(0, -1), nextClosing.trim()].join("\n\n");
  }

  return [...paragraphs, nextClosing.trim()].join("\n\n");
}

function buildCtaSuggestions(asset: ContentAsset, baseText: string): DashboardActionOption[] {
  const title = (asset.title ?? "this").trim();
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(" ") || "this";
  const suggestions = [
    {
      id: "cta-question",
      label: "Ask a question",
      description: "Invite replies instead of ending on a generic takeaway.",
      previewText: `Curious — what changed your approach to ${slug}?`,
    },
    {
      id: "cta-experience",
      label: "Invite experience",
      description: "Prompt readers to add what worked for them.",
      previewText: "What would you add to this from your own experience?",
    },
    {
      id: "cta-builders",
      label: "Call in builders",
      description: "Make the ending feel founder-to-founder.",
      previewText: "If you're building through something similar, I'd love to hear what you're seeing.",
    },
  ];

  return suggestions.map((option) => ({
    ...option,
    nextPostText: replaceClosingParagraph(baseText, option.previewText),
  }));
}

function dismissActionPreview(): void {
  actionPreview.value = null;
  actionPreviewError.value = "";
}

async function previewHookFix(asset: ContentAsset): Promise<void> {
  if (!selectedBusinessId.value) {
    return;
  }

  const baseText = getEditableAssetText(asset);
  const originalOpening = getOpeningParagraph(baseText);

  if (!baseText || !originalOpening) {
    ideaFeedback.value = "This draft needs content before the hook can be improved.";
    return;
  }

  isPreviewingAction.value = true;
  actionPreviewError.value = "";

  try {
    const response = await requestHookGeneration({
      businessId: selectedBusinessId.value,
      topic: asset.title?.trim() || originalOpening,
    });
    const options = response.hooks
      .map((hook, index) => hook.trim())
      .filter((hook, index, hooks) => hook !== "" && hook.toLowerCase() !== originalOpening.toLowerCase() && hooks.indexOf(hook) === index)
      .slice(0, 3)
      .map((hook, index) => ({
        id: `hook-${index}`,
        label: `Option ${index + 1}`,
        description: "Only the opening changes. The rest of the post stays intact.",
        previewText: hook,
        nextPostText: replaceOpeningParagraph(baseText, hook),
      }));

    if (options.length === 0) {
      actionPreviewError.value = "No stronger hook suggestion came back for this draft.";
      return;
    }

    actionPreview.value = {
      kind: "hook",
      assetId: asset.id,
      title: "Preview hook improvement",
      description: "Review the opening change before it touches the saved draft.",
      scopeHint: "Only the first paragraph changes. Everything after the hook stays the same.",
      originalText: originalOpening,
      options,
      selectedOptionId: options[0].id,
    };
  } catch (error) {
    actionPreviewError.value =
      error instanceof Error ? error.message : "Unable to preview a hook improvement right now.";
  } finally {
    isPreviewingAction.value = false;
  }
}

function previewCtaAddition(asset: ContentAsset): void {
  const baseText = getEditableAssetText(asset);
  const originalClosing = getClosingParagraph(baseText);

  if (!baseText || !originalClosing) {
    ideaFeedback.value = "This draft needs a body before a CTA can be added.";
    return;
  }

  const options = buildCtaSuggestions(asset, baseText);

  actionPreview.value = {
    kind: "cta",
    assetId: asset.id,
    title: "Preview CTA improvement",
    description: "Choose the ending you want before the saved draft is updated.",
    scopeHint: "Only the closing CTA changes. The rest of the post stays untouched.",
    originalText: originalClosing,
    options,
    selectedOptionId: options[0].id,
  };
  actionPreviewError.value = "";
}

async function applyActionPreview(): Promise<void> {
  if (!selectedBusinessId.value || !actionPreview.value || !selectedActionPreviewOption.value) {
    return;
  }

  const targetAsset = flatPipelineItems.value.find((asset) => asset.id === actionPreview.value?.assetId);

  if (!targetAsset) {
    actionPreviewError.value = "That draft is no longer available on this dashboard.";
    return;
  }

  const draftState = getPipelineDraft(targetAsset);
  isApplyingActionPreview.value = true;
  actionPreviewError.value = "";

  try {
    await requestUpdatePipelineItem({
      businessId: selectedBusinessId.value,
      assetId: targetAsset.id,
      title: draftState.title,
      textContent: selectedActionPreviewOption.value.nextPostText,
      status: draftState.status,
    });
    ideaFeedback.value =
      actionPreview.value.kind === "hook"
        ? "Hook updated. Review the new opening and move it forward when it feels right."
        : "CTA updated. The saved draft now ends with a clearer next step.";
    dismissActionPreview();
    await loadDashboard(selectedBusinessId.value);
    focusAsset(targetAsset.id);
  } catch (error) {
    actionPreviewError.value =
      error instanceof Error ? error.message : "Unable to apply this change right now.";
  } finally {
    isApplyingActionPreview.value = false;
  }
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

    const resolvedBusinessId =
      productAccess.value?.activeBusinessId ||
      activeBusinessId.value ||
      response.businesses[0]?.businessId ||
      "";

    selectedBusinessId.value = resolvedBusinessId;
    let accessState = productAccess.value;

    if (!productAccess.value?.activeBusinessId && selectedBusinessId.value) {
      accessState = await setActiveBusinessId(selectedBusinessId.value);

      if (accessState?.activeBusinessId && accessState.activeBusinessId !== selectedBusinessId.value) {
        selectedBusinessId.value = accessState.activeBusinessId;
      }
    }

    if (selectedBusinessId.value) {
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

function openCreator(target?: ContentAsset | string) {
  dismissActionPreview();
  const hash = typeof target === "string" ? target : undefined;
  const asset = typeof target === "string" ? undefined : target;
  const repurposeMode = hash === "#repurpose-panel";
  void router.push({
    path: appRoutes.appCreate,
    query: {
      ...(repurposeMode ? { mode: "repurpose" } : {}),
      ...(asset ? { postId: asset.id } : {}),
    },
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

  if (action === "daily-idea") {
    void generateDailyIdea();
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
    return "Mark ready";
  }

  if (nextStage === "scheduled") {
    return "Mark scheduled";
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
  const missionAsset = mission.value?.missionAsset;

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
    if (missionAsset) {
      void advancePipelineItem(missionAsset);
    } else {
      openCreator();
    }
    return;
  }

  if (!missionAsset) {
    return;
  }

  if (task.action === "improve_hook") {
    void previewHookFix(missionAsset);
    return;
  }

  if (task.action === "add_cta") {
    previewCtaAddition(missionAsset);
    return;
  }

  if (task.action === "move_to_review") {
    void advancePipelineItem(missionAsset);
    return;
  }

  focusAsset(missionAsset.id);
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

function handleAISuggestionAction(suggestion: AISuggestion) {
  if (suggestion.action === "focus_asset" && suggestion.assetId) {
    const targetAsset = flatPipelineItems.value.find((asset) => asset.id === suggestion.assetId);

    if (targetAsset && suggestion.type === "fix") {
      void previewHookFix(targetAsset);
      return;
    }
  }

  if (suggestion.action === "focus_asset") {
    focusAsset(suggestion.assetId);
    return;
  }

  handleQuickCreateAction(suggestion.action);
}

watch(
  () => productAccess.value?.activeBusinessId || activeBusinessId.value,
  async (businessId, previousBusinessId) => {
    if (!businessId || businessId === previousBusinessId) {
      return;
    }

    selectedBusinessId.value = businessId;
    resetEditingState();
    dismissActionPreview();

    try {
      const response = await requestMyBusinesses();
      memberships.value = response.businesses;
    } catch {
      // Keep dashboard switching responsive even if the workspace list refresh fails.
    }

    if (productAccess.value?.features.control_dashboard === false) {
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
        <div class="workspace-content">
          <header class="dashboard-topbar">
            <QuickCreateBar
              :best-time-label="bestTimeCountdownLabel"
              :inactivity-message="inactivityAlert"
              :inactivity-active="inactivityActive"
              :daily-idea-loading="isGeneratingDailyIdea"
              :write-disabled="!canCreateContent"
              :daily-idea-disabled="!canCreateContent"
              @write="handleQuickCreateAction('write')"
              @daily-idea="handleQuickCreateAction('daily-idea')"
            />

            <div class="topbar-status">
              <div class="topbar-status-card consistency-status">
                <ConsistencyRing
                  :percent="weeklyConsistencyPercent"
                  :streak-days="dashboard.today.streakDays"
                  label="weekly consistency"
                />
              </div>
              <span v-if="productAccess?.access?.readOnly" class="topbar-pill warning">Read-only</span>
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
              <AIRail :suggestions="aiSuggestions" @action="handleAISuggestionAction" />

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
                    <p class="dashboard-card-label">Ready</p>
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

              <section
                v-if="actionPreview || actionPreviewError || isPreviewingAction"
                class="dashboard-panel action-preview-panel"
              >
                <div class="panel-header">
                  <div>
                    <p class="panel-meta">
                      {{
                        actionPreview?.kind === "cta"
                          ? "CTA Preview"
                          : "Hook Preview"
                      }}
                    </p>
                    <h2>
                      {{ actionPreview?.title ?? "Preparing suggestion..." }}
                    </h2>
                    <p class="dashboard-description">
                      {{
                        actionPreview?.description
                          ?? "Generating a scoped suggestion for this saved draft."
                      }}
                    </p>
                  </div>

                  <button
                    v-if="actionPreview || actionPreviewError"
                    type="button"
                    class="dashboard-button secondary small-button"
                    @click="dismissActionPreview"
                  >
                    Keep current draft
                  </button>
                </div>

                <p v-if="isPreviewingAction" class="dashboard-feedback">
                  Generating a scoped improvement preview...
                </p>
                <p v-else-if="actionPreviewError" class="dashboard-feedback error">
                  {{ actionPreviewError }}
                </p>

                <template v-else-if="actionPreview && selectedActionPreviewOption">
                  <div class="action-preview-options">
                    <button
                      v-for="option in actionPreview.options"
                      :key="option.id"
                      type="button"
                      class="action-preview-option"
                      :class="{ active: actionPreview.selectedOptionId === option.id }"
                      @click="actionPreview.selectedOptionId = option.id"
                    >
                      {{ option.label }}
                    </button>
                  </div>

                  <div class="action-preview-diff">
                    <article class="action-preview-card">
                      <p class="panel-meta">Before</p>
                      <strong>{{ actionPreview.kind === "cta" ? "Current ending" : "Current opening" }}</strong>
                      <pre class="action-preview-copy">{{ actionPreview.originalText }}</pre>
                    </article>

                    <article class="action-preview-card updated">
                      <p class="panel-meta">After</p>
                      <strong>{{ selectedActionPreviewOption.label }}</strong>
                      <pre class="action-preview-copy">{{ selectedActionPreviewOption.previewText }}</pre>
                      <p class="action-preview-note">{{ selectedActionPreviewOption.description }}</p>
                    </article>
                  </div>

                  <p class="action-preview-scope">{{ actionPreview.scopeHint }}</p>

                  <div class="action-row">
                    <button
                      type="button"
                      class="dashboard-button"
                      :disabled="isApplyingActionPreview"
                      @click="applyActionPreview"
                    >
                      {{ isApplyingActionPreview ? "Applying..." : "Apply changes" }}
                    </button>
                    <button
                      type="button"
                      class="dashboard-button secondary small-button"
                      @click="dismissActionPreview"
                    >
                      Reject
                    </button>
                  </div>
                </template>
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
  gap: 24px;
  max-width: 1380px;
}

.workspace-frame {
  display: block;
}

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

.workspace-content {
  display: grid;
  gap: 24px;
}

.dashboard-panel,
.dashboard-card,
.dashboard-topbar,
.dashboard-intro,
.refined-today-panel {
  padding: 24px;
}

.dashboard-topbar,
.dashboard-intro,
.refined-today-panel {
  border: 1px solid var(--fc-border);
  border-radius: var(--fc-radius-panel);
  background: var(--fc-panel-bg);
  box-shadow: var(--fc-panel-shadow);
}

.dashboard-topbar {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(260px, 0.95fr);
  grid-template-areas:
    "create status";
  gap: 20px 24px;
  align-items: start;
}

.dashboard-topbar :deep(.quick-create-bar) {
  grid-area: create;
  display: grid;
  gap: 14px;
  align-content: start;
  justify-content: stretch;
}

.dashboard-topbar :deep(.quick-create-actions),
.dashboard-topbar :deep(.quick-create-status) {
  gap: 12px;
}

.dashboard-topbar :deep(.quick-create-status) {
  justify-content: flex-start;
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
  grid-area: status;
  justify-content: flex-start;
  align-content: start;
}

.topbar-status-card {
  display: inline-flex;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: color-mix(in srgb, var(--fc-panel-bg) 82%, var(--fc-surface-muted));
}

.consistency-status :deep(.consistency-ring) {
  grid-template-columns: 62px minmax(0, 1fr);
  justify-items: start;
  align-items: center;
  gap: 12px;
}

.consistency-status :deep(.ring-graphic) {
  width: 62px;
  height: 62px;
}

.consistency-status :deep(.ring-copy) {
  text-align: left;
}

.consistency-status :deep(.ring-copy strong) {
  font-size: 1rem;
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
  align-items: start;
  justify-content: space-between;
  gap: 20px 24px;
}

.dashboard-intro h1 {
  margin: 0;
  font-family: var(--fc-font-family-display);
  font-size: clamp(2rem, 5vw, 3rem);
  line-height: 1.02;
}

.dashboard-main-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 24px;
  align-items: start;
}

.dashboard-primary,
.dashboard-rail {
  display: grid;
  gap: 24px;
}

.dashboard-rail {
  position: sticky;
  top: calc(var(--fc-header-padding-y) + 84px);
  height: fit-content;
}

.today-section {
  display: grid;
  gap: 24px;
}

.dashboard-card-grid {
  gap: 18px;
  margin: 0;
}

.dashboard-card {
  display: grid;
  gap: 8px;
  min-height: 120px;
  align-content: start;
}

.dashboard-card strong {
  font-size: 1.9rem;
}

.dashboard-grid-two {
  gap: 24px;
  margin-bottom: 0;
}

.action-preview-panel {
  display: grid;
  gap: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--fc-accent-soft) 24%, var(--fc-panel-bg)) 0%, var(--fc-panel-bg) 100%);
}

.action-preview-options,
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.action-preview-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-input-bg);
  color: var(--fc-text);
  font-weight: 600;
}

.action-preview-option.active {
  border-color: transparent;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
}

.action-preview-diff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.action-preview-card {
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 88%, white 12%);
}

.action-preview-card.updated {
  border-color: color-mix(in srgb, var(--fc-success-text) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg) 30%, var(--fc-panel-bg));
}

.action-preview-copy {
  margin: 0;
  white-space: pre-wrap;
  font-family: inherit;
  line-height: 1.7;
  color: var(--fc-text);
}

.action-preview-note,
.action-preview-scope {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.panel-header {
  margin-bottom: 18px;
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
  gap: 16px;
}

.rail-list {
  display: grid;
  gap: 14px;
}

.idea-list {
  gap: 14px;
}

.rail-feed-item {
  display: grid;
  gap: 6px;
  padding: 16px 18px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
}
.rail-feed-item {
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.small-button {
  min-height: 38px;
  padding: 0 14px;
}

@media (max-width: 1240px) {
  .dashboard-topbar {
    grid-template-columns: 1fr;
    grid-template-areas:
      "create"
      "status";
  }
}

@media (max-width: 1280px) {
  .today-signal-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 1080px) {
  .dashboard-main-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-rail {
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

  .sidebar-item:hover .sidebar-item-label {
    transform: none;
  }
}

@media (max-width: 760px) {
  .dashboard-topbar {
    grid-template-columns: 1fr;
    grid-template-areas:
      "create"
      "status";
  }

  .topbar-status {
    justify-content: flex-start;
  }

  .pipeline-grid,
  .action-preview-diff,
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
