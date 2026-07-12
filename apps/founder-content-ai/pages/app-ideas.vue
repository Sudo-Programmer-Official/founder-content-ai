<script setup lang="ts">
import type {
  ContentAsset,
  ControlDashboardResponse,
  IdeaInboxItem,
  RepurposeStrategy,
  WorkspaceInsightAngleType,
  WorkspaceInsightSuggestion,
  WorkspaceInsightsResponse,
  WorkspaceTopicInsight,
} from "../../../packages/shared-types";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useProductAccessContext } from "../access/product-access-context";
import { actionIcons, aiFeatureIcons, iconSizes, iconStrokeWidth } from "../src/icons";
import {
  requestControlDashboard,
  requestConvertIdeaToContent,
  requestCreateIdeaInboxItem,
  requestUpdatePipelineItem,
} from "../services/control-dashboard-service";
import { requestWorkspaceInsights } from "../services/workspace-insights-service";
import { appRoutes } from "../utils/routes";
import { saveRepurposeSeed } from "../utils/repurpose-loop";
import {
  DEFAULT_REPURPOSE_STRATEGY,
  REPURPOSE_STRATEGY_OPTIONS,
} from "../utils/repurpose-strategies";

type IdeaStatusFilter = "all" | "fresh" | "explored" | "posted";
type AngleTypeFilter = "all" | "contrarian" | "story" | "tactical";
type IdeaAngleType = Exclude<AngleTypeFilter, "all">;
const FOLLOW_UP_STRATEGY_OPTIONS = REPURPOSE_STRATEGY_OPTIONS.filter(
  (option) => option.value !== DEFAULT_REPURPOSE_STRATEGY,
);

interface IdeaAngleModel {
  key: string;
  type: IdeaAngleType;
  title: string;
  support: string;
  tone: string;
}

interface IdeaCardModel {
  idea: IdeaInboxItem;
  title: string;
  preview: string;
  statusLabel: "Fresh" | "Explored" | "Posted";
  statusTone: "fresh" | "explored" | "posted";
  angles: IdeaAngleModel[];
  posts: ContentAsset[];
  tags: string[];
}

const router = useRouter();
const { bootstrap, isFeatureEnabled } = useProductAccessContext();

const isLoading = ref(false);
const isSavingIdea = ref(false);
const activeGenerateKey = ref("");
const isSavingDrawer = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");
const drawerFeedbackMessage = ref("");

const dashboard = ref<ControlDashboardResponse | null>(null);
const workspaceInsights = ref<WorkspaceInsightsResponse | null>(null);
const composerText = ref("");
const expandedIdeaIds = ref<string[]>([]);
const searchQuery = ref("");
const ideaStatusFilter = ref<IdeaStatusFilter>("all");
const angleFilter = ref<AngleTypeFilter>("all");
const selectedDrawerAssetId = ref("");
const drawerDraftTitle = ref("");
const drawerDraftText = ref("");
const angleRefreshSeedByIdea = ref<Record<string, number>>({});
const allowDuplicateComposerIdea = ref(false);
const composerTextarea = ref<HTMLTextAreaElement | null>(null);

const activeBusinessId = computed(() => bootstrap.value?.activeBusinessId ?? "");
const canUseIdeas = computed(
  () => Boolean(activeBusinessId.value) && isFeatureEnabled("control_dashboard"),
);

const flatPipelineAssets = computed(() =>
  (dashboard.value?.pipeline ?? []).flatMap((column) => column.items),
);

const assetsByIdeaId = computed(() => {
  const map = new Map<string, ContentAsset[]>();

  for (const asset of flatPipelineAssets.value) {
    const sourceIdeaId = asset.sourceIdeaId;

    if (!sourceIdeaId) {
      continue;
    }

    const bucket = map.get(sourceIdeaId) ?? [];
    bucket.push(asset);
    map.set(sourceIdeaId, bucket);
  }

  for (const [ideaId, assets] of map.entries()) {
    map.set(
      ideaId,
      [...assets].sort(
        (left, right) =>
          new Date(right.updatedAt ?? right.createdAt).getTime()
          - new Date(left.updatedAt ?? left.createdAt).getTime(),
      ),
    );
  }

  return map;
});

const angleFilterOptions: Array<{ value: AngleTypeFilter; label: string }> = [
  { value: "all", label: "All angles" },
  { value: "contrarian", label: "Contrarian" },
  { value: "story", label: "Story" },
  { value: "tactical", label: "Tactical" },
];

const statusFilterOptions: Array<{ value: IdeaStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "fresh", label: "Fresh" },
  { value: "explored", label: "Explored" },
  { value: "posted", label: "Posted" },
];

const suggestedIdeas = computed(() =>
  ideaCards.value
    .sort((left, right) => {
      const leftScore =
        (left.statusTone === "posted" ? 0 : left.posts.length === 0 ? 1 : 2)
        + (left.statusTone === "fresh" ? 0 : 10);
      const rightScore =
        (right.statusTone === "posted" ? 0 : right.posts.length === 0 ? 1 : 2)
        + (right.statusTone === "fresh" ? 0 : 10);
      return leftScore - rightScore;
    })
    .slice(0, 3),
);

const topicInsightsByKey = computed(() => {
  const map = new Map<string, WorkspaceTopicInsight>();

  for (const topic of workspaceInsights.value?.topics ?? []) {
    map.set(topic.topicKey, topic);
  }

  return map;
});

const topTopicKeys = computed(
  () =>
    new Set(
      (workspaceInsights.value?.topics ?? [])
        .slice(0, 3)
        .map((topic) => topic.topicKey),
    ),
);

const ideaInsightSuggestions = computed(() => workspaceInsights.value?.suggestions ?? []);

const summaryInsightCards = computed(() => {
  const summary = workspaceInsights.value?.summary;

  if (!summary) {
    return [];
  }

  return [
    { label: "Top topic", value: summary.topTopicLabel || "Still learning" },
    { label: "Best angle", value: summary.bestAngleLabel || "Still learning" },
    { label: "Best format", value: summary.bestFormatLabel || "Still learning" },
    { label: "Best time", value: summary.bestSendWindowLabel || "Still learning" },
  ];
});

const ideaCards = computed<IdeaCardModel[]>(() =>
  (dashboard.value?.ideaInbox ?? [])
    .map((idea) => {
      const posts = assetsByIdeaId.value.get(idea.id) ?? [];
      return {
        idea,
        title: buildIdeaTitle(idea),
        preview: buildIdeaPreview(idea),
        ...resolveIdeaStatus(posts),
        angles: buildIdeaAngles(idea, angleRefreshSeedByIdea.value[idea.id] ?? 0),
        posts,
        tags: buildIdeaTags(idea),
      };
    })
    .sort(
      (left, right) =>
        new Date(right.idea.updatedAt).getTime() - new Date(left.idea.updatedAt).getTime(),
    ),
);

const filteredIdeaCards = computed(() => {
  const normalizedSearch = searchQuery.value.trim().toLowerCase();

  return ideaCards.value.filter((card) => {
    if (
      ideaStatusFilter.value !== "all"
      && card.statusTone !== ideaStatusFilter.value
    ) {
      return false;
    }

    if (
      angleFilter.value !== "all"
      && !card.angles.some((angle) => angle.type === angleFilter.value)
    ) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    const haystack = [
      card.title,
      card.preview,
      card.idea.text,
      ...card.tags,
      ...card.angles.map((angle) => angle.title),
      ...card.posts.map((post) => post.title ?? post.textContent ?? ""),
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedSearch);
  });
});

const selectedDrawerAsset = computed(() =>
  flatPipelineAssets.value.find((asset) => asset.id === selectedDrawerAssetId.value) ?? null,
);

const selectedDrawerIdea = computed(() => {
  const sourceIdeaId = selectedDrawerAsset.value?.sourceIdeaId;

  if (!sourceIdeaId) {
    return null;
  }

  return ideaCards.value.find((card) => card.idea.id === sourceIdeaId) ?? null;
});

const selectedDrawerStatusLabel = computed(() =>
  selectedDrawerAsset.value ? humanizeAssetStatus(selectedDrawerAsset.value) : "",
);

const selectedDrawerStatusTone = computed(() => {
  const asset = selectedDrawerAsset.value;

  if (!asset) {
    return "draft";
  }

  const stage = asset.pipelineStage ?? "draft";
  return stage === "posted" ? "posted" : stage === "scheduled" ? "queued" : "draft";
});

const shouldShowDeduplicationPrompt = computed(() =>
  Boolean(similarIdeaCandidate.value && composerText.value.trim() && !allowDuplicateComposerIdea.value),
);

const similarIdeaCandidate = computed(() => {
  const input = normalizeIdeaText(composerText.value);

  if (input.length < 18) {
    return null;
  }

  let bestMatch: { card: IdeaCardModel; score: number } | null = null;

  for (const card of ideaCards.value) {
    const score = computeIdeaSimilarity(input, normalizeIdeaText(card.idea.text));

    if (score >= 0.38 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { card, score };
    }
  }

  return bestMatch;
});

watch(composerText, () => {
  allowDuplicateComposerIdea.value = false;
});

watch(selectedDrawerAsset, (asset) => {
  drawerFeedbackMessage.value = "";

  if (!asset) {
    drawerDraftTitle.value = "";
    drawerDraftText.value = "";
    return;
  }

  drawerDraftTitle.value = asset.title ?? buildAssetTitle(asset);
  drawerDraftText.value = asset.textContent ?? "";
});

watch([activeBusinessId, canUseIdeas], () => {
  void loadIdeaInbox();
});

function normalizeIdeaText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeTopicKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function tokenize(value: string): string[] {
  return normalizeIdeaText(value)
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 2);
}

function computeIdeaSimilarity(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }

  if (left.includes(right) || right.includes(left)) {
    return 1;
  }

  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  return union === 0 ? 0 : intersection / union;
}

function buildIdeaTitle(idea: IdeaInboxItem): string {
  if (idea.understanding?.topic?.trim()) {
    return idea.understanding.topic.trim();
  }

  const firstLine = idea.text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");

  return firstLine?.slice(0, 76) || "Untitled idea";
}

function getTopicInsightForCard(card: IdeaCardModel): WorkspaceTopicInsight | undefined {
  return topicInsightsByKey.value.get(normalizeTopicKey(card.title));
}

function isWorkingIdea(card: IdeaCardModel): boolean {
  return topTopicKeys.value.has(normalizeTopicKey(card.title)) && card.posts.length > 0;
}

function buildTopicInsightLine(card: IdeaCardModel): string | null {
  const topicInsight = getTopicInsightForCard(card);

  if (!topicInsight || topicInsight.postCount === 0) {
    return null;
  }

  if (topicInsight.emailSupportScore > 0.15) {
    return `Cross-channel: this topic is landing in email too, so it is a strong reuse candidate for another post or campaign.`;
  }

  if (topicInsight.highSignalCount > topicInsight.lowSignalCount && topicInsight.highSignalCount > 0) {
    return `Working now: ${topicInsight.highSignalCount} strong signal${topicInsight.highSignalCount === 1 ? "" : "s"} across ${topicInsight.postCount} post${topicInsight.postCount === 1 ? "" : "s"}.`;
  }

  if (topicInsight.lowSignalCount > topicInsight.highSignalCount && topicInsight.lowSignalCount > 0) {
    return `Mixed so far: ${topicInsight.lowSignalCount} weak signal${topicInsight.lowSignalCount === 1 ? "" : "s"} suggest the framing still needs work.`;
  }

  return `Untested loop: ${topicInsight.postCount} post${topicInsight.postCount === 1 ? "" : "s"} exist, but this theme still needs more feedback.`;
}

function buildIdeaPreview(idea: IdeaInboxItem): string {
  if (idea.understanding?.businessAngle) {
    return idea.understanding.businessAngle;
  }

  return idea.text.replace(/\s+/g, " ").trim().slice(0, 200);
}

function buildIdeaTags(idea: IdeaInboxItem): string[] {
  const tags = [
    humanizeIdeaInputType(idea.inputType),
    idea.understanding?.intent ? humanizeLabel(idea.understanding.intent) : "",
    idea.understanding?.contentType ? humanizeLabel(idea.understanding.contentType) : "",
  ].filter((value) => value !== "");

  return [...new Set(tags)];
}

function resolveIdeaStatus(posts: ContentAsset[]): {
  statusLabel: IdeaCardModel["statusLabel"];
  statusTone: IdeaCardModel["statusTone"];
} {
  const hasPosted = posts.some((post) => {
    const stage = post.pipelineStage ?? "draft";
    return stage === "posted" || post.status === "published";
  });

  if (hasPosted) {
    return { statusLabel: "Posted", statusTone: "posted" };
  }

  if (posts.length > 0) {
    return { statusLabel: "Explored", statusTone: "explored" };
  }

  return { statusLabel: "Fresh", statusTone: "fresh" };
}

function buildIdeaAngles(idea: IdeaInboxItem, refreshSeed: number): IdeaAngleModel[] {
  const topic = buildIdeaTitle(idea);
  const angle = idea.understanding?.businessAngle || `Use ${topic.toLowerCase()} as the hook.`;
  const pov = idea.understanding?.povSummary || `Sharpen ${topic.toLowerCase()} into a founder opinion.`;
  const cleanTopic = topic.replace(/[.?!]+$/, "").trim();
  const variantIndex = refreshSeed % 3;

  const contrarianTitles = [
    `Most founders overcook ${cleanTopic.toLowerCase()}.`,
    `${cleanTopic} is not the real problem.`,
    `What looks smart about ${cleanTopic.toLowerCase()} usually slows growth.`,
  ];
  const storyTitles = [
    `The moment ${cleanTopic.toLowerCase()} stopped being theoretical for me.`,
    `What ${cleanTopic.toLowerCase()} taught me the hard way.`,
    `I only understood ${cleanTopic.toLowerCase()} after shipping the wrong version.`,
  ];
  const tacticalTitles = [
    `3 rules for keeping ${cleanTopic.toLowerCase()} simple.`,
    `A tighter operating system for ${cleanTopic.toLowerCase()}.`,
    `How to make ${cleanTopic.toLowerCase()} usable this week.`,
  ];

  return [
    {
      key: `${idea.id}-contrarian`,
      type: "contrarian",
      title: contrarianTitles[variantIndex],
      support: pov,
      tone: "bold",
    },
    {
      key: `${idea.id}-story`,
      type: "story",
      title: storyTitles[(variantIndex + 1) % storyTitles.length],
      support: angle,
      tone: "storytelling",
    },
    {
      key: `${idea.id}-tactical`,
      type: "tactical",
      title: tacticalTitles[(variantIndex + 2) % tacticalTitles.length],
      support: `Turn ${cleanTopic.toLowerCase()} into a practical post people can reuse.`,
      tone: "direct",
    },
  ];
}

function buildAssetTitle(asset: ContentAsset): string {
  return asset.title || asset.textContent?.split("\n")[0]?.slice(0, 80) || "Untitled post";
}

function buildExcerpt(value: string | undefined, length = 140): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";

  if (!normalized) {
    return "No content yet.";
  }

  return normalized.length <= length ? normalized : `${normalized.slice(0, length - 3).trimEnd()}...`;
}

function humanizeLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}

function humanizeIdeaInputType(value: IdeaInboxItem["inputType"]): string {
  switch (value) {
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

function humanizeAssetStatus(asset: ContentAsset): string {
  const stage = asset.pipelineStage ?? "draft";

  if (stage === "posted" || asset.status === "published") {
    return "Published";
  }

  if (stage === "scheduled") {
    return "Queued";
  }

  if (stage === "review") {
    return "Ready";
  }

  return "Draft";
}

function formatIdeaTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

async function loadIdeaInbox(): Promise<void> {
  if (!activeBusinessId.value || !canUseIdeas.value) {
    dashboard.value = null;
    workspaceInsights.value = null;
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const [dashboardResponse, insightsResponse] = await Promise.all([
      requestControlDashboard(activeBusinessId.value),
      requestWorkspaceInsights(activeBusinessId.value).catch(() => null),
    ]);

    dashboard.value = dashboardResponse;
    workspaceInsights.value = insightsResponse;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load the idea inbox right now.";
  } finally {
    isLoading.value = false;
  }
}

function focusComposer(): void {
  composerTextarea.value?.focus();
}

function toggleIdeaExpansion(ideaId: string): void {
  if (expandedIdeaIds.value.includes(ideaId)) {
    expandedIdeaIds.value = expandedIdeaIds.value.filter((id) => id !== ideaId);
    return;
  }

  expandedIdeaIds.value = [...expandedIdeaIds.value, ideaId];
}

function ensureIdeaExpanded(ideaId: string): void {
  if (!expandedIdeaIds.value.includes(ideaId)) {
    expandedIdeaIds.value = [...expandedIdeaIds.value, ideaId];
  }
}

function getIdeaCardById(ideaId: string): IdeaCardModel | undefined {
  return ideaCards.value.find((card) => card.idea.id === ideaId);
}

function refreshAngles(ideaId: string): void {
  angleRefreshSeedByIdea.value = {
    ...angleRefreshSeedByIdea.value,
    [ideaId]: (angleRefreshSeedByIdea.value[ideaId] ?? 0) + 1,
  };
}

async function handleSaveIdea(saveAndExpand: boolean): Promise<void> {
  if (!activeBusinessId.value || !composerText.value.trim()) {
    return;
  }

  if (shouldShowDeduplicationPrompt.value) {
    return;
  }

  isSavingIdea.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    const response = await requestCreateIdeaInboxItem({
      businessId: activeBusinessId.value,
      text: composerText.value.trim(),
      inputType: "text",
    });

    composerText.value = "";
    allowDuplicateComposerIdea.value = false;
    feedbackMessage.value = saveAndExpand
      ? "Idea saved. Angles are ready to explore."
      : "Idea saved to the inbox.";

    await loadIdeaInbox();

    if (saveAndExpand) {
      ensureIdeaExpanded(response.idea.id);
      await nextTick();
      document.getElementById(`idea-card-${response.idea.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to save this idea yet.";
  } finally {
    isSavingIdea.value = false;
  }
}

function mergeWithSimilarIdea(): void {
  const candidate = similarIdeaCandidate.value?.card;

  if (!candidate) {
    return;
  }

  ensureIdeaExpanded(candidate.idea.id);
  composerText.value = "";
  feedbackMessage.value = `Merged into "${candidate.title}" by reopening the existing idea instead of creating a duplicate.`;
  void nextTick(() => {
    document.getElementById(`idea-card-${candidate.idea.id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}

function keepComposerIdeaSeparate(): void {
  allowDuplicateComposerIdea.value = true;
  void handleSaveIdea(true);
}

async function generatePostFromAngle(idea: IdeaInboxItem, angle: IdeaAngleModel): Promise<void> {
  if (!activeBusinessId.value) {
    return;
  }

  const generateKey = `${idea.id}:${angle.type}`;
  activeGenerateKey.value = generateKey;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    const response = await requestConvertIdeaToContent({
      businessId: activeBusinessId.value,
      ideaId: idea.id,
      tone: angle.tone,
      length: "medium",
    });

    feedbackMessage.value = `${humanizeLabel(angle.type)} angle converted into a draft.`;
    ensureIdeaExpanded(idea.id);
    await loadIdeaInbox();
    selectedDrawerAssetId.value = response.asset.id;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to generate a post from this angle.";
  } finally {
    activeGenerateKey.value = "";
  }
}

function humanizeSuggestionKind(kind: WorkspaceInsightSuggestion["kind"]): string {
  switch (kind) {
    case "double_down":
      return "Working now";
    case "missing_angle":
      return "Missing angle";
    case "reuse":
      return "Reuse";
    case "timing":
      return "Timing edge";
    case "watchout":
      return "Watchout";
    default:
      return "Suggestion";
  }
}

function resolveSuggestedAngle(
  card: IdeaCardModel | undefined,
  angleType: WorkspaceInsightAngleType | undefined,
): IdeaAngleModel | undefined {
  if (!card || !angleType) {
    return undefined;
  }

  return card.angles.find((angle) => angle.type === angleType);
}

function openSuggestionIdea(suggestion: WorkspaceInsightSuggestion): void {
  if (!suggestion.ideaId) {
    return;
  }

  ensureIdeaExpanded(suggestion.ideaId);
  void nextTick(() => {
    document.getElementById(`idea-card-${suggestion.ideaId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}

async function actOnSuggestion(suggestion: WorkspaceInsightSuggestion): Promise<void> {
  if (suggestion.kind === "timing") {
    await router.push(appRoutes.appPlanner);
    return;
  }

  const card = suggestion.ideaId ? getIdeaCardById(suggestion.ideaId) : undefined;
  const angle = resolveSuggestedAngle(card, suggestion.angleType);

  if (card && angle) {
    await generatePostFromAngle(card.idea, angle);
    return;
  }

  if (suggestion.ideaId) {
    openSuggestionIdea(suggestion);
  }
}

function openAssetDrawer(assetId: string): void {
  selectedDrawerAssetId.value = assetId;
}

function closeAssetDrawer(): void {
  selectedDrawerAssetId.value = "";
}

async function saveDrawerDraft(): Promise<void> {
  if (!activeBusinessId.value || !selectedDrawerAsset.value) {
    return;
  }

  isSavingDrawer.value = true;
  drawerFeedbackMessage.value = "";

  try {
    await requestUpdatePipelineItem({
      businessId: activeBusinessId.value,
      assetId: selectedDrawerAsset.value.id,
      title: drawerDraftTitle.value.trim() || selectedDrawerAsset.value.title,
      textContent: drawerDraftText.value,
      status: "draft",
    });

    drawerFeedbackMessage.value = "Draft saved.";
    await loadIdeaInbox();
  } catch (error) {
    drawerFeedbackMessage.value =
      error instanceof Error ? error.message : "Unable to save this draft right now.";
  } finally {
    isSavingDrawer.value = false;
  }
}

function openPublishFlow(assetId: string): void {
  void router.push({
    path: appRoutes.appResult,
    query: { id: assetId },
  });
}

function openPlannerForAsset(assetId: string): void {
  void router.push({
    path: appRoutes.appPlanner,
    query: { draftId: assetId },
  });
}

function openEmailForAsset(assetId: string): void {
  const asset = flatPipelineAssets.value.find((entry) => entry.id === assetId);

  void router.push({
    path: appRoutes.appEmailNew,
    query: {
      draftId: assetId,
      prefill: asset?.textContent ?? "",
    },
  });
}

function openGrowthForAsset(assetId: string): void {
  const asset = flatPipelineAssets.value.find((entry) => entry.id === assetId);

  void router.push({
    path: appRoutes.appGrowth,
    query: {
      businessId: activeBusinessId.value,
      sourcePlatform: "linkedin",
      sourceAssetId: assetId,
      sourceAssetTitle: asset ? buildAssetTitle(asset) : "LinkedIn post",
      prefillNotes: asset ? `Engaged from post: ${buildAssetTitle(asset)}` : "Engaged from LinkedIn post",
    },
  });
}

function continueWritingFromAsset(
  assetId: string,
  strategy: RepurposeStrategy = DEFAULT_REPURPOSE_STRATEGY,
): void {
  const asset = flatPipelineAssets.value.find((entry) => entry.id === assetId);

  if (!asset?.textContent?.trim()) {
    return;
  }

  saveRepurposeSeed({
    text: asset.textContent,
    title: buildAssetTitle(asset),
    strategy,
    autoGenerate: true,
    source: "dashboard",
  });

  void router.push({
    path: appRoutes.appCreate,
  });
}

onMounted(() => {
  void loadIdeaInbox();
});
</script>

<template>
  <main class="workspace-shell ideas-shell">
    <section class="workspace-card ideas-header-card">
      <div>
        <p class="workspace-eyebrow">Idea inbox</p>
        <h1>Idea to angle to post to publish</h1>
        <p class="workspace-description">
          Capture raw thoughts, shape them into reusable angles, and move the best ones into real drafts without leaving the workspace.
        </p>
      </div>

      <button type="button" class="workspace-primary-button" @click="focusComposer">
        <span class="workspace-button-icon">
          <component :is="actionIcons.add" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
        </span>
        New idea
      </button>
    </section>

    <section v-if="errorMessage" class="workspace-card empty-state">
      <h2>Idea inbox unavailable</h2>
      <p>{{ errorMessage }}</p>
    </section>

    <section v-else-if="!activeBusinessId" class="workspace-card empty-state">
      <h2>No workspace selected</h2>
      <p>Switch to a workspace first, then use the idea inbox to build the next content lane.</p>
    </section>

    <section v-else-if="!canUseIdeas" class="workspace-card empty-state">
      <h2>Idea inbox is not enabled here</h2>
      <p>Turn on the control dashboard feature for this workspace to manage ideas, angles, and post drafts.</p>
    </section>

    <template v-else>
      <section class="workspace-card idea-composer-card">
        <div class="idea-composer-copy">
          <p class="workspace-eyebrow">What’s on your mind?</p>
          <h2>Capture once. Reuse often.</h2>
          <p class="workspace-description compact">
            Save the raw idea first. Expand it into angles only after it deserves space in the system.
          </p>
        </div>

        <textarea
          ref="composerTextarea"
          v-model="composerText"
          class="workspace-textarea idea-composer-textarea"
          rows="4"
          placeholder="Most founders overcomplicate MVPs..."
        />

        <div v-if="shouldShowDeduplicationPrompt && similarIdeaCandidate" class="dedupe-banner">
          <div>
            <p class="workspace-eyebrow">Similar idea found</p>
            <strong>{{ similarIdeaCandidate.card.title }}</strong>
            <p class="workspace-description compact">
              This looks close enough to reuse instead of creating another fragmented thread.
            </p>
          </div>

          <div class="dedupe-actions">
            <button type="button" class="workspace-secondary-button compact" @click="mergeWithSimilarIdea">
              Merge with existing
            </button>
            <button type="button" class="workspace-primary-button compact" @click="keepComposerIdeaSeparate">
              Keep separate
            </button>
          </div>
        </div>

        <div class="idea-composer-actions">
          <button
            type="button"
            class="workspace-secondary-button"
            :disabled="isSavingIdea || !composerText.trim()"
            @click="handleSaveIdea(false)"
          >
            {{ isSavingIdea ? "Saving..." : "Save idea" }}
          </button>
          <button
            type="button"
            class="workspace-primary-button"
            :disabled="isSavingIdea || !composerText.trim()"
            @click="handleSaveIdea(true)"
          >
            {{ isSavingIdea ? "Saving..." : "Save & generate angles" }}
          </button>
        </div>

        <p v-if="feedbackMessage" class="ideas-feedback success">{{ feedbackMessage }}</p>
      </section>

      <section v-if="summaryInsightCards.length > 0" class="workspace-card insight-summary-card">
        <div class="panel-header">
          <div>
            <p class="panel-meta">What is working</p>
            <h2>Use live signals to decide what to post next</h2>
          </div>
        </div>

        <div class="insight-summary-grid">
          <article
            v-for="item in summaryInsightCards"
            :key="item.label"
            class="insight-summary-tile"
          >
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </article>
        </div>
      </section>

      <section v-if="ideaInsightSuggestions.length > 0" class="workspace-card suggestions-card">
        <div class="panel-header">
          <div>
            <p class="panel-meta">Suggested today</p>
            <h2>Use the feedback loop instead of guessing</h2>
          </div>
        </div>

        <div class="suggestions-grid">
          <article
            v-for="suggestion in ideaInsightSuggestions"
            :key="suggestion.id"
            class="suggestion-card"
            :data-tone="suggestion.kind"
          >
            <div class="suggestion-card-copy">
              <span class="workspace-chip">{{ humanizeSuggestionKind(suggestion.kind) }}</span>
              <strong>{{ suggestion.title }}</strong>
              <p>{{ suggestion.description }}</p>
              <small class="suggestion-reason">{{ suggestion.reason }}</small>
            </div>

            <div class="suggestion-card-actions">
              <button
                v-if="suggestion.ideaId"
                type="button"
                class="workspace-secondary-button compact"
                @click="openSuggestionIdea(suggestion)"
              >
                Open idea
              </button>
              <button
                type="button"
                class="workspace-primary-button compact"
                @click="actOnSuggestion(suggestion)"
              >
                {{ suggestion.cta }}
              </button>
            </div>
          </article>
        </div>
      </section>

      <section
        v-else-if="suggestedIdeas.length > 0"
        class="workspace-card suggestions-card"
      >
        <div class="panel-header">
          <div>
            <p class="panel-meta">Suggested today</p>
            <h2>Pick the next idea without overthinking it</h2>
          </div>
        </div>

        <div class="suggestions-grid">
          <article
            v-for="card in suggestedIdeas"
            :key="card.idea.id"
            class="suggestion-card"
            :data-tone="card.statusTone"
          >
            <div class="suggestion-card-copy">
              <span class="workspace-chip">{{ card.statusLabel }}</span>
              <strong>{{ card.title }}</strong>
              <p>{{ card.angles[0]?.title || card.preview }}</p>
            </div>

            <div class="suggestion-card-actions">
              <button type="button" class="workspace-secondary-button compact" @click="ensureIdeaExpanded(card.idea.id)">
                Open idea
              </button>
              <button
                type="button"
                class="workspace-primary-button compact"
                :disabled="activeGenerateKey === `${card.idea.id}:${card.angles[0]?.type}`"
                @click="card.angles[0] && generatePostFromAngle(card.idea, card.angles[0])"
              >
                {{ activeGenerateKey === `${card.idea.id}:${card.angles[0]?.type}` ? "Generating..." : "Generate post" }}
              </button>
            </div>
          </article>
        </div>
      </section>

      <section class="workspace-card filters-card">
        <div class="filters-grid">
          <label class="filter-search">
            <span>Search ideas</span>
            <input
              v-model="searchQuery"
              class="workspace-input"
              type="search"
              placeholder="Search ideas, angles, or drafts..."
            />
          </label>

          <div class="filter-group">
            <span>Status</span>
            <div class="filter-chip-row">
              <button
                v-for="option in statusFilterOptions"
                :key="option.value"
                type="button"
                class="workspace-secondary-button compact"
                :data-active="ideaStatusFilter === option.value"
                @click="ideaStatusFilter = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="filter-group">
            <span>Angle</span>
            <div class="filter-chip-row">
              <button
                v-for="option in angleFilterOptions"
                :key="option.value"
                type="button"
                class="workspace-secondary-button compact"
                :data-active="angleFilter === option.value"
                @click="angleFilter = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="idea-list">
        <article
          v-for="card in filteredIdeaCards"
          :id="`idea-card-${card.idea.id}`"
          :key="card.idea.id"
          class="workspace-card idea-card"
          :class="{ expanded: expandedIdeaIds.includes(card.idea.id) }"
        >
          <button type="button" class="idea-card-summary" @click="toggleIdeaExpansion(card.idea.id)">
            <div class="idea-card-heading">
              <div class="idea-card-copy">
                <div class="idea-card-title-row">
                  <span class="idea-brain">🧠</span>
                  <strong>{{ card.title }}</strong>
                </div>
                <p>{{ card.preview }}</p>
              </div>

              <div class="idea-card-meta">
                <span class="workspace-chip">{{ card.angles.length }} angles</span>
                <span class="workspace-chip">{{ card.posts.length }} posts</span>
                <span v-if="isWorkingIdea(card)" class="workspace-chip" data-tone="working">Working now</span>
                <span class="workspace-chip" :data-tone="card.statusTone">{{ card.statusLabel }}</span>
              </div>
            </div>
          </button>

          <div v-if="expandedIdeaIds.includes(card.idea.id)" class="idea-card-body">
            <div class="idea-card-detail-row">
              <div class="idea-tag-row">
                <span v-for="tag in card.tags" :key="tag" class="workspace-chip subtle">{{ tag }}</span>
                <span class="workspace-chip subtle">{{ formatIdeaTimestamp(card.idea.createdAt) }}</span>
              </div>
            </div>

            <div v-if="buildTopicInsightLine(card)" class="idea-insight-callout">
              {{ buildTopicInsightLine(card) }}
            </div>

            <section class="idea-section">
              <div class="idea-section-header">
                <div>
                  <p class="panel-meta">Angles</p>
                  <h3>Multiple ways to use the same thought</h3>
                </div>
                <button type="button" class="workspace-secondary-button compact" @click="refreshAngles(card.idea.id)">
                  <span class="workspace-button-icon">
                    <component :is="aiFeatureIcons.generate" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                  </span>
                  Generate more angles
                </button>
              </div>

              <div class="angle-list">
                <article
                  v-for="angle in card.angles"
                  :key="angle.key"
                  class="angle-row"
                >
                  <div class="angle-copy">
                    <span class="angle-type">{{ humanizeLabel(angle.type) }}</span>
                    <strong>{{ angle.title }}</strong>
                    <p>{{ angle.support }}</p>
                  </div>

                  <div class="angle-actions">
                    <button
                      type="button"
                      class="workspace-primary-button compact"
                      :disabled="activeGenerateKey === `${card.idea.id}:${angle.type}`"
                      @click="generatePostFromAngle(card.idea, angle)"
                    >
                      {{
                        activeGenerateKey === `${card.idea.id}:${angle.type}`
                          ? "Generating..."
                          : "Generate post"
                      }}
                    </button>
                    <button
                      v-if="card.posts[0]"
                      type="button"
                      class="workspace-secondary-button compact"
                      @click="openAssetDrawer(card.posts[0].id)"
                    >
                      View posts
                    </button>
                  </div>
                </article>
              </div>
            </section>

            <section class="idea-section">
              <div class="idea-section-header">
                <div>
                  <p class="panel-meta">Posts</p>
                  <h3>{{ card.posts.length === 0 ? "No posts yet" : `${card.posts.length} linked post${card.posts.length === 1 ? "" : "s"}` }}</h3>
                </div>
              </div>

              <div v-if="card.posts.length === 0" class="idea-empty-posts">
                Generate one post from an angle above. It will land here as a reusable draft.
              </div>

              <div v-else class="idea-post-list">
                <button
                  v-for="post in card.posts"
                  :key="post.id"
                  type="button"
                  class="idea-post-row"
                  @click="openAssetDrawer(post.id)"
                >
                  <div class="idea-post-row-copy">
                    <strong>{{ buildAssetTitle(post) }}</strong>
                    <p>{{ buildExcerpt(post.textContent, 180) }}</p>
                  </div>
                  <div class="idea-post-row-meta">
                    <span class="workspace-chip">{{ humanizeAssetStatus(post) }}</span>
                    <span class="workspace-chip subtle">{{ formatIdeaTimestamp(post.updatedAt ?? post.createdAt) }}</span>
                  </div>
                </button>
              </div>
            </section>
          </div>
        </article>

        <section v-if="!isLoading && filteredIdeaCards.length === 0" class="workspace-card empty-state">
          <h2>No ideas match this view</h2>
          <p>Try clearing the search or filters, or capture a new idea to start the loop.</p>
        </section>
      </section>
    </template>

    <section
      v-if="selectedDrawerAsset"
      class="idea-drawer-overlay"
      @click.self="closeAssetDrawer"
    >
      <article class="workspace-card idea-drawer">
        <div class="idea-drawer-header">
          <div>
            <p class="workspace-eyebrow">Generated post</p>
            <h2>{{ drawerDraftTitle || "Untitled post" }}</h2>
            <p class="workspace-description compact">
              {{ selectedDrawerIdea?.title || "Draft details" }} · {{ selectedDrawerStatusLabel }}
            </p>
          </div>

          <button type="button" class="workspace-secondary-button compact" @click="closeAssetDrawer">
            Close
          </button>
        </div>

        <div class="idea-drawer-meta-grid">
          <article class="idea-drawer-meta-card">
            <span>Status</span>
            <strong :data-tone="selectedDrawerStatusTone">{{ selectedDrawerStatusLabel }}</strong>
          </article>
          <article class="idea-drawer-meta-card">
            <span>Source idea</span>
            <strong>{{ selectedDrawerIdea?.title || "Workspace draft" }}</strong>
          </article>
          <article class="idea-drawer-meta-card">
            <span>Last updated</span>
            <strong>{{ formatIdeaTimestamp(selectedDrawerAsset.updatedAt ?? selectedDrawerAsset.createdAt) }}</strong>
          </article>
        </div>

        <label class="drawer-field">
          <span>Title</span>
          <input v-model="drawerDraftTitle" class="workspace-input" type="text" placeholder="Draft title" />
        </label>

        <label class="drawer-field">
          <span>Post</span>
          <textarea
            v-model="drawerDraftText"
            class="workspace-textarea"
            rows="16"
            placeholder="Generated post will appear here."
          />
        </label>

        <p v-if="drawerFeedbackMessage" class="ideas-feedback success">{{ drawerFeedbackMessage }}</p>

        <div class="idea-drawer-actions">
          <button
            type="button"
            class="workspace-secondary-button"
            :disabled="isSavingDrawer"
            @click="saveDrawerDraft"
          >
            {{ isSavingDrawer ? "Saving..." : "Save draft" }}
          </button>
          <button
            type="button"
            class="workspace-secondary-button"
            @click="openPlannerForAsset(selectedDrawerAsset.id)"
          >
            Queue in planner
          </button>
          <button
            type="button"
            class="workspace-secondary-button"
            @click="openEmailForAsset(selectedDrawerAsset.id)"
          >
            Convert to email
          </button>
          <button
            type="button"
            class="workspace-secondary-button"
            @click="openGrowthForAsset(selectedDrawerAsset.id)"
          >
            Capture lead
          </button>
          <button
            type="button"
            class="workspace-secondary-button"
            :disabled="!selectedDrawerAsset.textContent?.trim()"
            @click="continueWritingFromAsset(selectedDrawerAsset.id)"
          >
            Continue writing
          </button>
          <div class="idea-drawer-strategy-actions">
            <span class="panel-meta">One-click angles</span>
            <div class="idea-drawer-strategy-row">
              <button
                v-for="option in FOLLOW_UP_STRATEGY_OPTIONS"
                :key="option.value"
                type="button"
                class="workspace-secondary-button compact"
                :disabled="!selectedDrawerAsset.textContent?.trim()"
                @click="continueWritingFromAsset(selectedDrawerAsset.id, option.value)"
              >
                {{ option.shortLabel }}
              </button>
            </div>
          </div>
          <button
            type="button"
            class="workspace-primary-button"
            @click="openPublishFlow(selectedDrawerAsset.id)"
          >
            Publish
          </button>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
.ideas-shell {
  display: grid;
  gap: 20px;
  max-width: 1480px;
  margin: 0 auto;
  padding: 48px 24px 96px;
}

.workspace-card {
  padding: clamp(22px, 3vw, 30px);
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  border-radius: 30px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 249, 242, 0.88)),
    var(--fc-surface);
  box-shadow: 0 26px 58px rgba(70, 42, 24, 0.08);
}

.workspace-eyebrow,
.panel-meta {
  margin: 0;
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.workspace-description {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.workspace-description.compact {
  max-width: 72ch;
}

.workspace-primary-button,
.workspace-secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid transparent;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease;
}

.workspace-primary-button {
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
  box-shadow: 0 20px 36px rgba(221, 128, 56, 0.25);
}

.workspace-primary-button:hover,
.workspace-secondary-button:hover {
  transform: translateY(-1px);
}

.workspace-primary-button:disabled,
.workspace-secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.68;
  transform: none;
  box-shadow: none;
}

.workspace-secondary-button {
  background: rgba(255, 255, 255, 0.82);
  color: var(--fc-text);
  border-color: color-mix(in srgb, var(--fc-border) 85%, rgba(221, 128, 56, 0.18));
  box-shadow: 0 12px 24px rgba(70, 42, 24, 0.05);
}

.workspace-secondary-button.compact,
.workspace-primary-button.compact {
  min-height: 38px;
  padding: 0 14px;
  font-size: 0.9rem;
}

.workspace-secondary-button[data-active="true"] {
  background: color-mix(in srgb, var(--fc-accent) 12%, white 88%);
  border-color: color-mix(in srgb, var(--fc-accent) 30%, var(--fc-border));
  color: var(--fc-accent-dark);
}

.workspace-button-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
}

.workspace-button-icon :deep(svg) {
  display: block;
}

.workspace-input,
.workspace-textarea {
  width: 100%;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.84);
  color: var(--fc-text);
  font: inherit;
  padding: 16px 18px;
  box-sizing: border-box;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
}

.workspace-textarea {
  resize: vertical;
  line-height: 1.7;
}

.workspace-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.8);
  color: var(--fc-text);
  font-size: 0.85rem;
  font-weight: 600;
}

.workspace-chip.subtle {
  color: var(--fc-text-muted);
}

.workspace-chip[data-tone="fresh"] {
  background: color-mix(in srgb, #f6efe7 82%, white 18%);
}

.workspace-chip[data-tone="explored"] {
  background: color-mix(in srgb, #fef1df 80%, white 20%);
  color: #8a5400;
}

.workspace-chip[data-tone="posted"] {
  background: color-mix(in srgb, #e8f5ef 78%, white 22%);
  color: #1d7a4b;
}

.workspace-chip[data-tone="working"] {
  background: color-mix(in srgb, #eef6e9 80%, white 20%);
  color: #2c6e3f;
}

.ideas-header-card {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
}

.ideas-header-card h1 {
  margin: 4px 0 10px;
  font-size: clamp(2rem, 4vw, 3.4rem);
  line-height: 0.96;
}

.idea-composer-card {
  display: grid;
  gap: 16px;
}

.idea-composer-copy {
  display: grid;
  gap: 8px;
}

.idea-composer-copy h2 {
  margin: 0;
  font-size: 1.6rem;
}

.idea-composer-textarea {
  min-height: 124px;
}

.idea-composer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.dedupe-banner {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-radius: 22px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 28%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent) 10%, white 90%);
}

.dedupe-banner strong {
  display: block;
  margin-top: 4px;
}

.dedupe-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.insight-summary-card,
.suggestions-card,
.filters-card {
  display: grid;
  gap: 18px;
}

.insight-summary-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.insight-summary-tile {
  display: grid;
  gap: 8px;
  padding: 18px;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 84%, transparent);
  background: rgba(255, 255, 255, 0.76);
  box-shadow: 0 14px 28px rgba(70, 42, 24, 0.05);
}

.insight-summary-tile span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.insight-summary-tile strong {
  font-size: 1.05rem;
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.panel-header h2,
.idea-section-header h3 {
  margin: 4px 0 0;
}

.suggestions-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.suggestion-card {
  display: grid;
  gap: 16px;
  padding: 18px;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 84%, transparent);
  background: rgba(255, 255, 255, 0.74);
  box-shadow: 0 16px 30px rgba(70, 42, 24, 0.06);
}

.suggestion-card[data-tone="fresh"] {
  background: linear-gradient(180deg, rgba(255, 249, 243, 0.94), rgba(255, 244, 236, 0.9));
}

.suggestion-card[data-tone="double_down"] {
  background: linear-gradient(180deg, rgba(237, 246, 233, 0.96), rgba(245, 251, 241, 0.92));
}

.suggestion-card[data-tone="missing_angle"] {
  background: linear-gradient(180deg, rgba(255, 244, 232, 0.96), rgba(255, 250, 244, 0.92));
}

.suggestion-card[data-tone="timing"] {
  background: linear-gradient(180deg, rgba(238, 244, 253, 0.96), rgba(247, 250, 255, 0.92));
}

.suggestion-card[data-tone="watchout"] {
  background: linear-gradient(180deg, rgba(255, 240, 236, 0.96), rgba(255, 248, 246, 0.92));
}

.suggestion-card-copy {
  display: grid;
  gap: 10px;
}

.suggestion-card-copy strong {
  font-size: 1.06rem;
}

.suggestion-card-copy p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.suggestion-reason {
  color: var(--fc-text);
  font-size: 0.88rem;
  line-height: 1.55;
}

.suggestion-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.filters-grid {
  display: grid;
  gap: 16px;
}

.filter-search,
.filter-group {
  display: grid;
  gap: 10px;
}

.filter-search span,
.filter-group span,
.drawer-field span,
.idea-drawer-meta-card span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.filter-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.idea-list {
  display: grid;
  gap: 16px;
}

.idea-card {
  display: grid;
  gap: 0;
  padding: 0;
  overflow: hidden;
}

.idea-card.expanded {
  box-shadow: 0 28px 60px rgba(70, 42, 24, 0.1);
}

.idea-card-summary {
  display: block;
  width: 100%;
  padding: 24px 26px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.idea-card-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.idea-card-copy {
  display: grid;
  gap: 10px;
}

.idea-card-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.idea-card-title-row strong {
  font-size: 1.28rem;
  line-height: 1.15;
}

.idea-card-copy p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.idea-card-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.idea-card-body {
  display: grid;
  gap: 24px;
  padding: 0 26px 26px;
}

.idea-card-detail-row,
.idea-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.idea-insight-callout {
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, #d6eadb 72%, var(--fc-border));
  background: linear-gradient(180deg, rgba(241, 248, 239, 0.9), rgba(248, 251, 246, 0.92));
  color: #35583d;
  font-weight: 600;
  line-height: 1.55;
}

.idea-section {
  display: grid;
  gap: 14px;
  padding-top: 18px;
  border-top: 1px solid color-mix(in srgb, var(--fc-border) 86%, transparent);
}

.idea-section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.angle-list,
.idea-post-list {
  display: grid;
  gap: 12px;
}

.angle-row,
.idea-post-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-radius: 22px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.78);
}

.idea-post-row {
  width: 100%;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.angle-copy,
.idea-post-row-copy {
  display: grid;
  gap: 8px;
}

.angle-type {
  color: var(--fc-accent-dark);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.angle-copy p,
.idea-post-row-copy p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.65;
}

.angle-actions,
.idea-post-row-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.idea-empty-posts {
  padding: 18px;
  border-radius: 22px;
  border: 1px dashed color-mix(in srgb, var(--fc-accent) 22%, var(--fc-border));
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.empty-state {
  display: grid;
  gap: 10px;
}

.empty-state h2 {
  margin: 0;
}

.ideas-feedback {
  margin: 0;
  font-weight: 600;
}

.ideas-feedback.success {
  color: #1e7b4c;
}

.idea-drawer-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  justify-content: flex-end;
  padding: 24px;
  background: rgba(27, 18, 13, 0.28);
  backdrop-filter: blur(8px);
  z-index: 90;
}

.idea-drawer {
  display: grid;
  gap: 18px;
  width: min(100%, 520px);
  height: calc(100vh - 48px);
  overflow: auto;
}

.idea-drawer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.idea-drawer-header h2 {
  margin: 4px 0 8px;
}

.idea-drawer-meta-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.idea-drawer-meta-card {
  display: grid;
  gap: 6px;
  padding: 16px;
  border-radius: 20px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.72);
}

.idea-drawer-meta-card strong[data-tone="queued"] {
  color: #8a5400;
}

.idea-drawer-meta-card strong[data-tone="posted"] {
  color: #1e7b4c;
}

.drawer-field {
  display: grid;
  gap: 10px;
}

.idea-drawer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.idea-drawer-strategy-actions {
  display: grid;
  gap: 10px;
  min-width: min(100%, 320px);
}

.idea-drawer-strategy-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 1120px) {
  .ideas-shell {
    padding-inline: 18px;
  }

  .idea-card-heading,
  .angle-row,
  .idea-post-row,
  .ideas-header-card,
  .dedupe-banner,
  .idea-section-header,
  .idea-drawer-header {
    grid-template-columns: 1fr;
    display: grid;
  }

  .idea-card-meta,
  .angle-actions,
  .idea-post-row-meta {
    justify-content: flex-start;
  }

  .idea-drawer-meta-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .ideas-shell {
    padding: 28px 14px 84px;
  }

  .workspace-card {
    border-radius: 24px;
    padding: 20px;
  }

  .idea-card-summary,
  .idea-card-body {
    padding-inline: 20px;
  }

  .idea-drawer-overlay {
    padding: 12px;
  }

  .idea-drawer {
    width: 100%;
    height: calc(100vh - 24px);
  }
}
</style>
