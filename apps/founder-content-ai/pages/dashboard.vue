<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useProductAccessContext } from "../access/product-access-context";
import AIRail from "../components/dashboard/AIRail.vue";
import ConsistencyRing from "../components/dashboard/ConsistencyRing.vue";
import MissionCard from "../components/dashboard/MissionCard.vue";
import PipelineBoard from "../components/dashboard/PipelineBoard.vue";
import QuickCreateBar from "../components/dashboard/QuickCreateBar.vue";
import DashboardSkeleton from "../components/skeletons/DashboardSkeleton.vue";
import VoiceRecorder from "../components/VoiceRecorder.vue";
import { useContentScore } from "../composables/useContentScore";
import { useMission } from "../composables/useMission";
import { useSuggestions } from "../composables/useSuggestions";
import type {
  BusinessMembership,
  ContentAsset,
  ContentPipelineStage,
  ControlDashboardResponse,
  IdeaInboxInputType,
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

const captureModeOptions: Array<{ value: IdeaInboxInputType; label: string; description: string }> = [
  { value: "text", label: "Text", description: "Drop a rough thought, note, or headline." },
  { value: "voice", label: "Voice", description: "Speak one idea and let the transcript land here." },
  { value: "image", label: "Screenshot", description: "Save a screenshot, dashboard proof, or visual cue." },
  { value: "link", label: "Link", description: "Store one public post, article, or page URL." },
];
const MAX_CAPTURE_IMAGE_BYTES = 4 * 1024 * 1024;

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
const ideaCaptureMode = ref<IdeaInboxInputType>("text");
const capturedLinkUrl = ref("");
const uploadedIdeaImageName = ref("");
const uploadedIdeaImageDataUrl = ref("");
const uploadedIdeaImageMimeType = ref("");
const uploadedIdeaImageSizeBytes = ref(0);
const uploadedIdeaImageDimensions = ref<{ width: number; height: number } | null>(null);
const ideaFeedback = ref("");
const isSavingIdea = ref(false);
const isPreparingIdeaImage = ref(false);
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

const flatPipelineItems = computed(() => pipelineColumns.value.flatMap((column) => column.items));
const ideaInboxItems = computed(() => dashboard.value?.ideaInbox ?? []);
const activeCaptureMode = computed(
  () => captureModeOptions.find((option) => option.value === ideaCaptureMode.value) ?? captureModeOptions[0],
);
const captureTextareaLabel = computed(() => {
  if (ideaCaptureMode.value === "link") {
    return "What should we pull from this link?";
  }

  if (ideaCaptureMode.value === "image") {
    return "What matters in this screenshot?";
  }

  if (ideaCaptureMode.value === "voice") {
    return "Voice transcript";
  }

  return "Drop the idea";
});
const captureTextareaPlaceholder = computed(() => {
  if (ideaCaptureMode.value === "link") {
    return "Example: turn this article into a founder post about trust, proof, and what changed my thinking.";
  }

  if (ideaCaptureMode.value === "image") {
    return "Example: Stripe screenshot showing our first meaningful revenue month. Turn it into a proof-driven founder post.";
  }

  if (ideaCaptureMode.value === "voice") {
    return "Your transcript lands here. Tighten it if needed, then save it to the inbox.";
  }

  return "Paste a rough thought, customer note, lesson, or one-line hook...";
});
const captureSaveLabel = computed(() => {
  if (isSavingIdea.value) {
    return "Saving...";
  }

  if (ideaCaptureMode.value === "link") {
    return "Save link to inbox";
  }

  if (ideaCaptureMode.value === "image") {
    return "Save screenshot to inbox";
  }

  if (ideaCaptureMode.value === "voice") {
    return "Save voice note";
  }

  return "Save to inbox";
});
const canSaveIdeaCapture = computed(() => {
  if (!selectedBusinessId.value || isSavingIdea.value || isPreparingIdeaImage.value) {
    return false;
  }

  if (ideaCaptureMode.value === "image") {
    return uploadedIdeaImageDataUrl.value !== "";
  }

  if (ideaCaptureMode.value === "link") {
    return normalizeCapturedLinkUrl(capturedLinkUrl.value) !== "";
  }

  return newIdeaText.value.trim() !== "";
});

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

const intelligenceSummary = computed(() => dashboard.value?.intelligence ?? null);
const retentionSummary = computed(() => dashboard.value?.retention ?? null);
const recentResultsSummary = computed(() => dashboard.value?.recentResults ?? null);
const weeklyConsistencyPercent = computed(
  () =>
    retentionSummary.value?.consistencyScore ??
    Math.min(100, Math.round(((dashboard.value?.today.streakDays ?? 0) / 7) * 100)),
);
const weeklyReportHeading = computed(() => {
  const retention = retentionSummary.value;

  if (!retention) {
    return "Your weekly execution loop is warming up.";
  }

  if (retention.consistencyScore >= 85) {
    return "Your content system is compounding.";
  }

  if (retention.consistencyScore >= 50) {
    return "The rhythm is forming.";
  }

  return "Consistency needs one clear push.";
});
const consistencyDeltaLabel = computed(() => {
  const retention = retentionSummary.value;

  if (!retention || retention.consistencyDelta === 0) {
    return "Flat from last week";
  }

  return retention.consistencyDelta > 0
    ? `Up ${retention.consistencyDelta} pts from last week`
    : `Down ${Math.abs(retention.consistencyDelta)} pts from last week`;
});
const intelligencePatternLabel = computed(() => {
  const summary = intelligenceSummary.value;

  if (!summary?.topFormat || !summary.topHookType || !summary.topLength) {
    return "Content pattern memory will sharpen as you create and publish more posts.";
  }

  return `Recent pattern: ${summary.topFormat} posts with ${summary.topHookType.replace(/_/g, " ")} hooks, mostly ${summary.topLength} length.`;
});
const latestUpdatedAsset = computed(
  () =>
    [...flatPipelineItems.value].sort(
      (left, right) =>
        new Date(right.updatedAt ?? right.createdAt).getTime() -
        new Date(left.updatedAt ?? left.createdAt).getTime(),
    )[0] ?? null,
);
const readyPipelineAsset = computed(
  () => flatPipelineItems.value.find((asset) => asset.pipelineStage === "review") ?? null,
);
const draftPipelineAsset = computed(
  () =>
    flatPipelineItems.value.find(
      (asset) => (asset.pipelineStage ?? "draft") === "draft",
    ) ?? null,
);
const weeklyMissedDays = computed(() =>
  Math.max(0, 7 - (retentionSummary.value?.activeDays7d ?? Math.min(7, dashboard.value?.today.streakDays ?? 0))),
);
const recentResultsLines = computed(() => {
  const results = recentResultsSummary.value;

  const formatTime = (value?: string, fallback = "No signal yet.") => {
    if (!value) {
      return fallback;
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  };

  return [
    results?.lastPublishedPostAt
      ? `Last post published: ${formatTime(results.lastPublishedPostAt)}.`
      : "No published post yet. The first live result will show here.",
    results?.lastCampaignCompletedAt
      ? `Last campaign finished: ${formatTime(results.lastCampaignCompletedAt)}.`
      : "No completed campaign yet. Email outcomes will show up once a send finishes.",
    results?.nextScheduledPostAt
      ? `Next scheduled item: ${formatTime(results.nextScheduledPostAt)}.`
      : "Nothing else is scheduled yet. Queue the next post before the week gets away.",
  ];
});
const pipelineSummaryCards = computed(() => [
  {
    id: "draft",
    label: "Draft",
    count: dashboard.value?.today.draftCount ?? 0,
    copy: "Needs shaping before it can ship.",
  },
  {
    id: "review",
    label: "Ready",
    count: dashboard.value?.today.reviewCount ?? 0,
    copy: "Closest thing to your next post.",
  },
  {
    id: "scheduled",
    label: "Scheduled",
    count: dashboard.value?.today.scheduledCount ?? 0,
    copy: "Already committed to the planner.",
  },
  {
    id: "posted",
    label: "Posted",
    count: dashboard.value?.today.postedCount ?? 0,
    copy: "Use history to verify what shipped.",
  },
]);

function resolveFallbackDashboardRoute(action: string): string {
  switch (action) {
    case "open_planner":
    case "schedule_ready":
      return appRoutes.appPlanner;
    case "open_history":
      return appRoutes.appHistory;
    default:
      return appRoutes.appCreate;
  }
}

const fallbackNextActionState = computed(() => {
  const scheduledCount = dashboard.value?.today.scheduledCount ?? 0;
  const readyAsset = readyPipelineAsset.value;
  const draftAsset = draftPipelineAsset.value;

  if (readyAsset) {
    return {
      heading: "You have one post ready to schedule",
      description: `Move "${readyAsset.title ?? "this post"}" into the planner before ${bestTimeCountdownLabel.value.toLowerCase()}.`,
      primaryLabel: "Schedule now",
      primaryAction: "schedule_ready",
      secondaryLabel: "Improve before posting",
      secondaryAction: "edit_ready",
    } as const;
  }

  if (draftAsset) {
    return {
      heading: "You already have a draft to finish",
      description: `Tighten "${draftAsset.title ?? "this draft"}" and move it toward execution instead of starting another thread.`,
      primaryLabel: "Improve draft",
      primaryAction: "edit_draft",
      secondaryLabel: "Open planner",
      secondaryAction: "open_planner",
    } as const;
  }

  if (scheduledCount > 0) {
    return {
      heading: "Execution is already lined up",
      description: `${scheduledCount} post${scheduledCount === 1 ? "" : "s"} ${scheduledCount === 1 ? "is" : "are"} scheduled. Inspect the planner or verify what already shipped.`,
      primaryLabel: "Open planner",
      primaryAction: "open_planner",
      secondaryLabel: "View history",
      secondaryAction: "open_history",
    } as const;
  }

  return {
    heading: "Today still needs a post",
    description: "Create one clear post and move it into the planner. That is the whole job.",
    primaryLabel: "Create post",
    primaryAction: "create_post",
    secondaryLabel: "Open planner",
    secondaryAction: "open_planner",
  } as const;
});
const dashboardNextAction = computed(() => {
  const nextAction = dashboard.value?.nextAction;

  if (nextAction) {
    return {
      heading: nextAction.title,
      description: nextAction.description,
      primaryLabel: nextAction.cta,
      route: nextAction.route,
    } as const;
  }

  return {
    heading: fallbackNextActionState.value.heading,
    description: fallbackNextActionState.value.description,
    primaryLabel: fallbackNextActionState.value.primaryLabel,
    route: resolveFallbackDashboardRoute(fallbackNextActionState.value.primaryAction),
  } as const;
});
const recentActivityItems = computed(() =>
  [...flatPipelineItems.value]
    .sort(
      (left, right) =>
        new Date(right.updatedAt ?? right.createdAt).getTime() -
        new Date(left.updatedAt ?? left.createdAt).getTime(),
    )
    .slice(0, 5)
    .map((asset) => ({
      asset,
      title: asset.title ?? asset.textContent?.split("\n")[0] ?? "Untitled post",
      description:
        asset.pipelineStage === "posted"
          ? "Marked as posted"
          : asset.pipelineStage === "scheduled"
            ? "Moved into the execution queue"
            : asset.pipelineStage === "review"
              ? "Ready for scheduling"
              : "Still in draft",
      whenLabel: new Date(asset.updatedAt ?? asset.createdAt).toLocaleString(),
    })),
);
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

function normalizeCapturedLinkUrl(value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  try {
    return new URL(trimmedValue).toString();
  } catch {
    try {
      return new URL(`https://${trimmedValue}`).toString();
    } catch {
      return "";
    }
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Unable to read the uploaded file."));
    };

    reader.onerror = () => reject(new Error("Unable to read the uploaded file."));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };

    image.onerror = () => reject(new Error("Unable to inspect the uploaded image."));
    image.src = dataUrl;
  });
}

function resetCaptureComposer(keepMode = false) {
  newIdeaText.value = "";
  capturedLinkUrl.value = "";
  uploadedIdeaImageName.value = "";
  uploadedIdeaImageDataUrl.value = "";
  uploadedIdeaImageMimeType.value = "";
  uploadedIdeaImageSizeBytes.value = 0;
  uploadedIdeaImageDimensions.value = null;

  if (!keepMode) {
    ideaCaptureMode.value = "text";
  }
}

async function persistIdeaCaptureImage(file: File) {
  if (file.size > MAX_CAPTURE_IMAGE_BYTES) {
    throw new Error("Screenshots must be 4 MB or smaller.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Only image uploads are supported for screenshot capture.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  const dimensions = await readImageDimensions(dataUrl);

  uploadedIdeaImageName.value = file.name;
  uploadedIdeaImageDataUrl.value = dataUrl;
  uploadedIdeaImageMimeType.value = file.type;
  uploadedIdeaImageSizeBytes.value = file.size;
  uploadedIdeaImageDimensions.value = dimensions;
  ideaCaptureMode.value = "image";

  if (!newIdeaText.value.trim()) {
    newIdeaText.value = `Screenshot insight from ${file.name.replace(/\.[a-z0-9]+$/i, "")}.`;
  }
}

async function handleIdeaImageUpload(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];

  if (!file) {
    uploadedIdeaImageName.value = "";
    uploadedIdeaImageDataUrl.value = "";
    uploadedIdeaImageMimeType.value = "";
    uploadedIdeaImageSizeBytes.value = 0;
    uploadedIdeaImageDimensions.value = null;
    return;
  }

  isPreparingIdeaImage.value = true;
  ideaFeedback.value = "";

  try {
    await persistIdeaCaptureImage(file);
    ideaFeedback.value = "Screenshot ready. Review the extracted angle, then save it to the inbox.";
  } catch (error) {
    ideaFeedback.value = error instanceof Error ? error.message : "Unable to process the screenshot.";
  } finally {
    isPreparingIdeaImage.value = false;

    if (target) {
      target.value = "";
    }
  }
}

async function handleIdeaImageDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0];

  if (!file) {
    return;
  }

  isPreparingIdeaImage.value = true;
  ideaFeedback.value = "";

  try {
    await persistIdeaCaptureImage(file);
    ideaFeedback.value = "Screenshot ready. Review the extracted angle, then save it to the inbox.";
  } catch (error) {
    ideaFeedback.value = error instanceof Error ? error.message : "Unable to process the screenshot.";
  } finally {
    isPreparingIdeaImage.value = false;
  }
}

async function addIdeaInboxItem() {
  if (!selectedBusinessId.value) {
    ideaFeedback.value = "Create or select a workspace first.";
    return;
  }

  const normalizedLinkUrl = normalizeCapturedLinkUrl(capturedLinkUrl.value);
  const processedText = newIdeaText.value.trim();

  if (ideaCaptureMode.value === "image" && !uploadedIdeaImageDataUrl.value) {
    ideaFeedback.value = "Upload one screenshot before saving it.";
    return;
  }

  if (ideaCaptureMode.value === "link" && !normalizedLinkUrl) {
    ideaFeedback.value = "Paste one valid public link before saving it.";
    return;
  }

  if (
    (ideaCaptureMode.value === "text" || ideaCaptureMode.value === "voice")
    && !processedText
  ) {
    ideaFeedback.value = "Write one idea before saving it.";
    return;
  }

  isSavingIdea.value = true;
  ideaFeedback.value = "";

  try {
    await requestCreateIdeaInboxItem({
      businessId: selectedBusinessId.value,
      inputType: ideaCaptureMode.value,
      processedText:
        processedText
        || (ideaCaptureMode.value === "link" && normalizedLinkUrl
          ? `Link capture from ${new URL(normalizedLinkUrl).hostname.replace(/^www\./i, "")}.`
          : undefined),
      rawInput:
        ideaCaptureMode.value === "image"
          ? uploadedIdeaImageDataUrl.value
          : ideaCaptureMode.value === "link"
            ? normalizedLinkUrl
            : processedText,
      metadata:
        ideaCaptureMode.value === "image"
          ? {
              fileName: uploadedIdeaImageName.value || undefined,
              mimeType: uploadedIdeaImageMimeType.value || undefined,
              sizeBytes: uploadedIdeaImageSizeBytes.value || undefined,
              width: uploadedIdeaImageDimensions.value?.width,
              height: uploadedIdeaImageDimensions.value?.height,
            }
          : ideaCaptureMode.value === "link"
            ? {
                sourceUrl: normalizedLinkUrl,
                hostname: new URL(normalizedLinkUrl).hostname.replace(/^www\./i, ""),
              }
            : undefined,
    });
    resetCaptureComposer();
    ideaFeedback.value = "Capture saved to the inbox.";
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

  ideaCaptureMode.value = "voice";
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

function formatIdeaInputLabel(inputType: IdeaInboxInputType): string {
  switch (inputType) {
    case "voice":
      return "Voice";
    case "image":
      return "Screenshot";
    case "link":
      return "Link";
    default:
      return "Text";
  }
}

function formatIdeaLabel(value: string | undefined): string {
  if (!value) {
    return "";
  }

  return value.replace(/_/g, " ");
}

function formatIdeaUnderstandingStatus(value: IdeaInboxItem["understandingStatus"]): string {
  switch (value) {
    case "processing":
      return "Understanding";
    case "completed":
      return "Ready";
    case "failed":
      return "Needs review";
    default:
      return "Queued";
  }
}

function formatIdeaStrength(value: number | undefined): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  return `${Math.round((value ?? 0) * 100)}% strength`;
}

function formatIdeaTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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

function openPlanner(draftId?: string) {
  void router.push({
    path: appRoutes.appPlanner,
    query: draftId ? { draftId } : undefined,
  });
}

function openHistory(tab?: string) {
  void router.push({
    path: appRoutes.appHistory,
    query: tab ? { tab } : undefined,
  });
}

function handleDashboardAction(action: string) {
  if (action === "schedule_ready") {
    if (readyPipelineAsset.value) {
      openPlanner(readyPipelineAsset.value.id);
      return;
    }

    openPlanner();
    return;
  }

  if (action === "edit_ready") {
    if (readyPipelineAsset.value) {
      openCreator(readyPipelineAsset.value);
      return;
    }

    openCreator();
    return;
  }

  if (action === "edit_draft") {
    if (draftPipelineAsset.value) {
      openCreator(draftPipelineAsset.value);
      return;
    }

    openCreator();
    return;
  }

  if (action === "open_planner") {
    openPlanner();
    return;
  }

  if (action === "open_history") {
    openHistory();
    return;
  }

  openCreator();
}

function openDashboardNextAction(): void {
  void router.push(dashboardNextAction.value.route);
}

function handlePipelineSummaryClick(stage: string) {
  if (stage === "posted") {
    openHistory("published");
    return;
  }

  if (stage === "scheduled") {
    openPlanner();
    return;
  }

  if (stage === "review" && readyPipelineAsset.value) {
    openPlanner(readyPipelineAsset.value.id);
    return;
  }

  if (stage === "draft" && draftPipelineAsset.value) {
    openCreator(draftPipelineAsset.value);
    return;
  }

  openPlanner();
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
    <DashboardSkeleton v-if="isLoading" />
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
              <span class="topbar-pill">Consistency {{ weeklyConsistencyPercent }}%</span>
              <span class="topbar-pill muted">
                {{
                  dashboard.today.lastActivityAt
                    ? `Last activity ${new Date(dashboard.today.lastActivityAt).toLocaleString()}`
                    : "No recent activity yet"
                }}
              </span>
              <span v-if="productAccess?.access?.readOnly" class="topbar-pill warning">Read-only</span>
              <span class="profile-chip">{{ profileInitial }}</span>
            </div>
          </section>

          <section class="dashboard-grid-two dashboard-grid-two--capture">
            <article class="dashboard-panel capture-panel">
              <div class="panel-header">
                <div>
                  <p class="panel-meta">Capture inbox</p>
                  <h2>Drop anything. Shape it later.</h2>
                  <p class="dashboard-description">
                    Voice, text, screenshots, and links all land in one inbox before they become drafts.
                  </p>
                </div>
              </div>

              <div class="capture-mode-row">
                <button
                  v-for="option in captureModeOptions"
                  :key="option.value"
                  type="button"
                  :class="['capture-mode-pill', { active: ideaCaptureMode === option.value }]"
                  @click="ideaCaptureMode = option.value"
                >
                  <strong>{{ option.label }}</strong>
                  <span>{{ option.description }}</span>
                </button>
              </div>

              <div v-if="ideaCaptureMode === 'voice'" class="capture-block">
                <VoiceRecorder
                  title="Capture one thought by voice"
                  hint="Record a quick note. We will transcribe it here so you can save or tighten it."
                  @transcribed="handleIdeaVoiceTranscript"
                />
              </div>

              <div v-else-if="ideaCaptureMode === 'link'" class="capture-block">
                <label class="capture-field">
                  <span>Public link</span>
                  <input
                    v-model="capturedLinkUrl"
                    type="url"
                    placeholder="https://example.com/post-or-article"
                  />
                </label>
              </div>

              <div
                v-else-if="ideaCaptureMode === 'image'"
                class="capture-dropzone"
                @dragover.prevent
                @drop.prevent="handleIdeaImageDrop"
              >
                <div>
                  <strong>{{ isPreparingIdeaImage ? "Processing screenshot..." : "Drop one screenshot here" }}</strong>
                  <p class="dashboard-empty-copy">
                    Or browse from your device. Keep it to proof, tweets, dashboards, or product moments you want to turn into content.
                  </p>
                </div>
                <label class="dashboard-button secondary small-button capture-upload-button">
                  <span>Choose screenshot</span>
                  <input type="file" accept="image/*" @change="handleIdeaImageUpload" />
                </label>
                <div v-if="uploadedIdeaImageDataUrl" class="capture-image-preview">
                  <img :src="uploadedIdeaImageDataUrl" alt="Captured screenshot preview" />
                  <p class="pipeline-meta">
                    {{ uploadedIdeaImageName || "Screenshot ready" }}
                    <span v-if="uploadedIdeaImageDimensions">
                      · {{ uploadedIdeaImageDimensions.width }}×{{ uploadedIdeaImageDimensions.height }}
                    </span>
                  </p>
                </div>
              </div>

              <label class="capture-field">
                <span>{{ captureTextareaLabel }}</span>
                <textarea
                  v-model="newIdeaText"
                  rows="5"
                  :placeholder="captureTextareaPlaceholder"
                ></textarea>
              </label>

              <div class="action-row">
                <button
                  type="button"
                  class="dashboard-button"
                  :disabled="!canSaveIdeaCapture"
                  @click="addIdeaInboxItem"
                >
                  {{ captureSaveLabel }}
                </button>
                <button
                  type="button"
                  class="dashboard-button secondary small-button"
                  @click="resetCaptureComposer()"
                >
                  Clear
                </button>
              </div>

              <p class="dashboard-empty-copy">
                Current mode: {{ activeCaptureMode.label }}. Save first, then generate a draft from the inbox when you are ready.
              </p>
            </article>

            <article class="dashboard-panel capture-panel">
              <div class="panel-header">
                <div>
                  <p class="panel-meta">Inbox queue</p>
                  <h2>{{ ideaInboxItems.length === 0 ? "No saved captures yet" : `${ideaInboxItems.length} saved capture${ideaInboxItems.length === 1 ? "" : "s"}` }}</h2>
                  <p class="dashboard-description">
                    This is the staging lane between raw input and generated drafts.
                  </p>
                </div>
              </div>

              <div v-if="ideaInboxItems.length === 0" class="pipeline-empty-state">
                <p class="pipeline-empty">
                  Save one thought, screenshot, voice note, or link and it will show up here.
                </p>
              </div>

              <div v-else class="idea-inbox-list">
                <article
                  v-for="idea in ideaInboxItems"
                  :key="idea.id"
                  class="idea-item refined-idea-item"
                >
                  <div class="pipeline-item-header">
                    <div class="pipeline-badges">
                      <span class="status-tag accent">{{ formatIdeaInputLabel(idea.inputType) }}</span>
                      <span class="status-tag">{{ idea.status }}</span>
                      <span class="status-tag subtle">{{ formatIdeaUnderstandingStatus(idea.understandingStatus) }}</span>
                      <span
                        v-if="idea.understandingConfidenceScore"
                        class="status-tag subtle"
                      >
                        {{ formatIdeaStrength(idea.understandingConfidenceScore) }}
                      </span>
                    </div>
                    <span class="pipeline-meta">{{ formatIdeaTimestamp(idea.createdAt) }}</span>
                  </div>

                  <div
                    v-if="idea.inputType === 'image' && idea.rawInput?.startsWith('data:image/')"
                    class="idea-image-preview"
                  >
                    <img :src="idea.rawInput" alt="Saved screenshot preview" />
                  </div>

                  <a
                    v-if="idea.inputType === 'link' && (idea.metadata?.sourceUrl || idea.rawInput)"
                    class="capture-source-link"
                    :href="idea.metadata?.sourceUrl || idea.rawInput"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {{ idea.metadata?.hostname || idea.metadata?.sourceUrl || idea.rawInput }}
                  </a>

                  <p class="pipeline-excerpt">{{ idea.text }}</p>

                  <div v-if="idea.understanding || idea.understandingStatus !== 'completed'" class="idea-understanding">
                    <p
                      v-if="idea.understandingStatus === 'processing' || idea.understandingStatus === 'queued'"
                      class="pipeline-meta"
                    >
                      We are shaping this idea into a clearer topic and angle now.
                    </p>
                    <p
                      v-else-if="idea.understandingStatus === 'failed' && idea.understandingError"
                      class="pipeline-meta pipeline-meta-danger"
                    >
                      {{ idea.understandingError }}
                    </p>
                    <div class="pipeline-badges">
                      <span v-if="idea.understanding" class="status-tag">{{ formatIdeaLabel(idea.understanding.intent) }}</span>
                      <span v-if="idea.understanding" class="status-tag">{{ formatIdeaLabel(idea.understanding.contentType) }}</span>
                      <span
                        v-if="idea.understanding?.businessGoal"
                        class="status-tag"
                      >
                        {{ formatIdeaLabel(idea.understanding?.businessGoal) }}
                      </span>
                    </div>
                    <p v-if="idea.understanding" class="pipeline-meta">
                      <strong>Topic:</strong> {{ idea.understanding.topic }}
                    </p>
                    <p v-if="idea.understanding" class="pipeline-meta">
                      <strong>Angle:</strong> {{ idea.understanding.businessAngle }}
                    </p>
                    <p v-if="idea.understanding" class="pipeline-meta">
                      <strong>POV:</strong> {{ idea.understanding.povSummary }}
                    </p>
                  </div>

                  <div class="action-row">
                    <button
                      type="button"
                      class="dashboard-button secondary small-button"
                      :disabled="convertingIdeaId === idea.id || !canCreateContent"
                      @click="convertIdeaToDraft(idea)"
                    >
                      {{ convertingIdeaId === idea.id ? "Generating..." : "Generate draft" }}
                    </button>
                  </div>
                </article>
              </div>
            </article>
          </section>

          <div class="dashboard-main-grid dashboard-main-grid--control">
            <div class="dashboard-primary control-stack">
              <section class="dashboard-panel decision-panel">
                <div class="panel-header">
                  <div>
                    <p class="panel-meta">Next action</p>
                    <h2>{{ dashboardNextAction.heading }}</h2>
                    <p class="dashboard-description">{{ dashboardNextAction.description }}</p>
                  </div>
                </div>

                <div class="action-row">
                  <button
                    type="button"
                    class="dashboard-button"
                    @click="openDashboardNextAction"
                  >
                    {{ dashboardNextAction.primaryLabel }}
                  </button>
                </div>
              </section>

              <section class="dashboard-card-grid pipeline-summary-grid">
                <button
                  v-for="card in pipelineSummaryCards"
                  :key="card.id"
                  type="button"
                  class="dashboard-card summary-card"
                  @click="handlePipelineSummaryClick(card.id)"
                >
                  <p class="dashboard-card-label">{{ card.label }}</p>
                  <strong>{{ card.count }}</strong>
                  <p class="dashboard-empty-copy">{{ card.copy }}</p>
                </button>
              </section>

              <section class="dashboard-grid-two">
                <article class="dashboard-panel">
                  <div class="panel-header">
                    <div>
                      <p class="panel-meta">Weekly signal</p>
                      <h2>{{ weeklyReportHeading }}</h2>
                    </div>
                  </div>

                  <div class="rail-list">
                    <article class="rail-feed-item">
                      {{
                        retentionSummary
                          ? `Consistency score: ${weeklyConsistencyPercent}% across ${retentionSummary.activeDays7d} active day${retentionSummary.activeDays7d === 1 ? "" : "s"} this week.`
                          : `Consistency score: ${weeklyConsistencyPercent}%.`
                      }}
                    </article>
                    <article class="rail-feed-item">
                      {{
                        retentionSummary
                          ? `Created ${retentionSummary.postsCreated7d}, scheduled ${retentionSummary.postsScheduled7d}, published ${retentionSummary.postsPublished7d}, emailed ${retentionSummary.emailsSent7d}.`
                          : weeklyMissedDays === 0
                            ? "You covered every day this week."
                            : `You missed ${weeklyMissedDays} day${weeklyMissedDays === 1 ? "" : "s"} this week.`
                      }}
                    </article>
                    <article class="rail-feed-item">
                      {{
                        retentionSummary?.bestDayLabel
                          ? `Best day this week: ${retentionSummary.bestDayLabel}. ${consistencyDeltaLabel}.`
                          : `${consistencyDeltaLabel}. ${bestTimeSlots[0] ? `Best window: ${bestTimeCountdownLabel}.` : "Best posting window will show up once you build a little more history."}`
                      }}
                    </article>
                    <article class="rail-feed-item">
                      {{ retentionSummary?.nudgeMessage || "The next nudge will appear once the system sees a little more history." }}
                    </article>
                  </div>
                </article>

                <article class="dashboard-panel">
                  <div class="panel-header">
                    <div>
                      <p class="panel-meta">Recent results</p>
                      <h2>What happened last</h2>
                    </div>
                  </div>

                  <div class="rail-list">
                    <article
                      v-for="line in recentResultsLines"
                      :key="line"
                      class="rail-feed-item"
                    >
                      {{ line }}
                    </article>
                    <article class="rail-feed-item">{{ intelligencePatternLabel }}</article>
                  </div>
                </article>
              </section>

              <section class="dashboard-panel">
                <div class="panel-header">
                  <div>
                    <p class="panel-meta">Recent activity</p>
                    <h2>Last 5 content moves</h2>
                    <p class="dashboard-description">
                      Keep this capped. The long archive belongs in History, not on the dashboard.
                    </p>
                  </div>

                  <router-link class="dashboard-button secondary small-button" :to="appRoutes.appHistory">
                    Open history
                  </router-link>
                </div>

                <div v-if="recentActivityItems.length === 0" class="pipeline-empty-state">
                  <p class="pipeline-empty">No recent activity yet. Create one post and the loop starts here.</p>
                </div>

                <div v-else class="recent-activity-list">
                  <button
                    v-for="item in recentActivityItems"
                    :key="item.asset.id"
                    type="button"
                    class="recent-activity-row"
                    @click="openCreator(item.asset)"
                  >
                    <div>
                      <strong>{{ item.title }}</strong>
                      <p class="pipeline-meta">{{ item.description }}</p>
                    </div>
                    <span class="topbar-pill muted">{{ item.whenLabel }}</span>
                  </button>
                </div>
              </section>
            </div>
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

.dashboard-main-grid--control {
  grid-template-columns: 1fr;
}

.dashboard-primary,
.dashboard-rail {
  display: grid;
  gap: 24px;
}

.control-stack {
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

.summary-card {
  width: 100%;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: var(--fc-panel-bg);
  color: var(--fc-text);
  text-align: left;
  cursor: pointer;
}

.summary-card:hover {
  border-color: color-mix(in srgb, var(--fc-accent) 24%, var(--fc-border));
}

.dashboard-card strong {
  font-size: 1.9rem;
}

.dashboard-grid-two {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  margin-bottom: 0;
}

.dashboard-grid-two--capture {
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
}

.capture-panel {
  display: grid;
  gap: 18px;
}

.capture-mode-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.capture-mode-pill {
  display: grid;
  gap: 6px;
  align-content: start;
  min-height: 88px;
  padding: 14px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: var(--fc-input-bg);
  color: var(--fc-text);
  text-align: left;
  cursor: pointer;
}

.capture-mode-pill strong {
  font-size: 0.96rem;
}

.capture-mode-pill span {
  color: var(--fc-text-muted);
  font-size: 0.86rem;
  line-height: 1.45;
}

.capture-mode-pill.active {
  border-color: color-mix(in srgb, var(--fc-accent) 30%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 30%, var(--fc-panel-bg));
}

.capture-block,
.capture-field {
  display: grid;
  gap: 10px;
}

.capture-field span {
  font-weight: 600;
}

.capture-field input,
.capture-field textarea {
  width: 100%;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
  color: var(--fc-text);
}

.capture-field input {
  min-height: 48px;
  padding: 0 16px;
}

.capture-field textarea {
  min-height: 132px;
  padding: 14px 16px;
  resize: vertical;
}

.capture-dropzone {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px dashed color-mix(in srgb, var(--fc-accent) 28%, var(--fc-border));
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-accent-soft) 20%, var(--fc-panel-bg));
}

.capture-upload-button {
  position: relative;
  overflow: hidden;
  width: fit-content;
}

.capture-upload-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.capture-image-preview,
.idea-image-preview {
  display: grid;
  gap: 10px;
}

.capture-image-preview img,
.idea-image-preview img {
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  border-radius: 16px;
  border: 1px solid var(--fc-border);
}

.idea-inbox-list {
  display: grid;
  gap: 12px;
  max-height: 680px;
  overflow: auto;
  padding-right: 4px;
}

.idea-understanding {
  display: grid;
  gap: 8px;
}

.pipeline-meta-danger {
  color: #a64632;
}

.capture-source-link {
  color: var(--fc-accent-dark);
  font-size: 0.9rem;
  text-decoration: none;
  word-break: break-word;
}

.capture-source-link:hover {
  text-decoration: underline;
}

.recent-activity-list {
  display: grid;
  gap: 12px;
}

.recent-activity-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 16px 18px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.recent-activity-row:hover {
  border-color: color-mix(in srgb, var(--fc-accent) 24%, var(--fc-border));
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

.dashboard-button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
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

  .dashboard-grid-two--capture {
    grid-template-columns: 1fr;
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

  .capture-mode-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
