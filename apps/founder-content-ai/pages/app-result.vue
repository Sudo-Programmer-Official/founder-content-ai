<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  BusinessContentOutput,
  BusinessWeeklyPlanGenerationOutput,
  CarouselDraft,
  CarouselDraftSlide,
  ContentNarrative,
  ContentNarrativeSlide,
  ContentAiEditPreview,
  ContentAsset,
  GenerateVisualResponse,
  MediaRecommendationSuggestion,
  PostAsset,
  PublishAttempt,
  PublishAttemptPlatform,
  RecommendedPostTimeSlot,
  RepurposeContentResponse,
  RepurposeStrategy,
  SchedulingSafetyWarning,
  SocialAccount,
  WorkspaceAsset,
} from "../../../packages/shared-types";
import MetaPageSelectionModal from "../components/MetaPageSelectionModal.vue";
import WorkspaceAssetPickerModal from "../components/WorkspaceAssetPickerModal.vue";
import { useAuthContext } from "../auth/auth-context";
import { useProductAccessContext } from "../access/product-access-context";
import { calculateContentScore } from "../composables/useContentScore";
import { ApiRequestError } from "../services/api-client";
import {
  getActivationDraft,
  replaceActivationDraft,
  type ActivationDraftRecord,
} from "../services/activation-flow-service";
import {
  requestCreatePipelineItem,
  requestContentAiEditPreview,
  requestPipelineItem,
  requestUpdatePipelineItem,
} from "../services/control-dashboard-service";
import { requestVisualGeneration } from "../services/generation-service";
import { requestMediaRecommendations } from "../services/media-intelligence-service";
import {
  requestGeneratedHashtags,
  requestCreatePublishAttempt,
  requestLinkedInSocialAuthStart,
  requestMetaSocialAuthStart,
  requestPublishAttempts,
  requestRecommendedPostTimes,
  requestRetryFailedPublishAttempt,
  requestSchedulePost,
  requestSocialAccounts,
} from "../services/publishing-service";
import {
  requestCreatePostAsset,
  requestDeletePostAsset,
  requestMediaUploadUrl,
  requestPostAssets,
} from "../services/post-assets-service";
import { appRoutes } from "../utils/routes";
import {
  convertZonedDateTimeToUtcIso,
  detectUserTimezone,
  formatDateInTimezone,
  formatTimeWithZone,
  toDateKeyInTimezone,
  toTimeValueInTimezone,
} from "../utils/timezone";
import { saveRepurposeSeed } from "../utils/repurpose-loop";
import {
  DEFAULT_REPURPOSE_STRATEGY,
  REPURPOSE_STRATEGY_OPTIONS,
} from "../utils/repurpose-strategies";
import {
  findConnectedFacebookAccount,
  findConnectedInstagramAccount,
  findConnectedLinkedInAccount,
  formatSelectedPlatformsLabel,
  parsePublishableSocialPlatform,
  parsePublishableSocialPlatforms,
  PUBLISHABLE_SOCIAL_PLATFORMS,
  resolveExternalPostLabel,
  resolvePublishingAccountLabel,
  resolvePublishingDescriptor,
  resolveSocialPlatformLabel,
  type PublishableSocialPlatform,
} from "../utils/social-platforms";
import { toFriendlySocialAuthMessage } from "../utils/social-auth-errors";

const route = useRoute();
const router = useRouter();
const auth = useAuthContext();
const { bootstrap, refreshProductAccess, isFeatureEnabled } = useProductAccessContext();
const FOLLOW_UP_STRATEGY_OPTIONS = REPURPOSE_STRATEGY_OPTIONS.filter(
  (option) => option.value !== DEFAULT_REPURPOSE_STRATEGY,
);

interface PlatformPublishAttemptResult {
  attemptId: string;
  platformAttemptId: string;
  platform: PublishableSocialPlatform;
  status: "success" | "failed";
  message: string;
  errorCode?: string;
  externalPostUrl?: string;
}

const draft = ref<ActivationDraftRecord | null>(null);
const feedbackMessage = ref("");
const publishAttemptResults = ref<PlatformPublishAttemptResult[]>([]);
const currentPublishAttemptId = ref("");
const socialAccounts = ref<SocialAccount[]>([]);
const isLoadingChannels = ref(false);
const isConnectingLinkedIn = ref(false);
const isConnectingMeta = ref(false);
const isPublishingToLinkedIn = ref(false);
const initialPublishingPlatforms = parsePublishableSocialPlatforms(route.query.platforms);
const initialPublishingPlatform =
  parsePublishableSocialPlatform(route.query.platform)
  ?? initialPublishingPlatforms[0]
  ?? "linkedin";
const selectedPublishingPlatform = ref<PublishableSocialPlatform>(initialPublishingPlatform);
const selectedPublishingPlatforms = ref<PublishableSocialPlatform[]>(
  initialPublishingPlatforms.length > 0 ? initialPublishingPlatforms : [initialPublishingPlatform],
);
const isMetaSelectionModalOpen = ref(false);
const pendingMetaSession = ref("");
const isLoadingPostAssets = ref(false);
const isUploadingPostAssets = ref(false);
const removingPostAssetId = ref("");
const mediaFeedback = ref("");
const postAssets = ref<PostAsset[]>([]);
const isWorkspaceAssetPickerOpen = ref(false);
const mediaRecommendations = ref<MediaRecommendationSuggestion[]>([]);
const isLoadingMediaRecommendations = ref(false);
const isGeneratingRecommendationId = ref("");
const mediaRecommendationPanelRef = ref<HTMLElement | null>(null);
const aiEditInstruction = ref("");
const aiEditPreview = ref<ContentAiEditPreview | null>(null);
const aiEditFeedback = ref("");
const isPreviewingAiEdit = ref(false);
const isApplyingAiEdit = ref(false);
const growthMechanicsFeedback = ref("");
const hashtagFeedback = ref("");
const isGeneratingHashtags = ref(false);
const generatedHashtags = ref<string[]>([]);
const captionWithHashtags = ref("");
const isSchedulePanelOpen = ref(false);
const isLoadingRecommendedSlots = ref(false);
const isSchedulingDraft = ref(false);
const scheduleFeedback = ref("");
const scheduleDateKey = ref("");
const scheduleTime = ref("09:00");
const audienceTimezone = ref("");
const recommendedTimezone = ref("UTC");
const recommendedSlots = ref<RecommendedPostTimeSlot[]>([]);

const userTimezone = detectUserTimezone();
const COMMON_AUDIENCE_TIMEZONES = [
  "UTC",
  "America/Chicago",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
] as const;

const AI_QUICK_COMMANDS = [
  { label: "Stop the scroll", value: "Rewrite the opening so the first line stops the scroll and creates tension." },
  { label: "Make sharper", value: "Make this sharper and more punchy." },
  { label: "Add specificity", value: "Make this more specific with concrete founder realities and cleaner language. Do not invent facts." },
  { label: "Shorten", value: "Shorten this without changing the core message." },
  { label: "Founder voice", value: "Make this sound like a founder talking to another founder, not a consultant or AI assistant." },
  { label: "Punchier close", value: "Tighten the ending and land on a stronger punchline." },
] as const;

function extractSchedulingWarnings(error: unknown): SchedulingSafetyWarning[] {
  if (!(error instanceof ApiRequestError) || error.code !== "scheduling_safety_warning") {
    return [];
  }

  const warnings = error.details?.warnings;

  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings.flatMap((warning) => {
    if (!warning || typeof warning !== "object") {
      return [];
    }

    const candidate = warning as Record<string, unknown>;

    if (
      typeof candidate.code !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.message !== "string"
    ) {
      return [];
    }

    return [
      {
        code: candidate.code as SchedulingSafetyWarning["code"],
        title: candidate.title,
        message: candidate.message,
      },
    ];
  });
}

function buildSchedulingWarningMessage(warnings: SchedulingSafetyWarning[]): string {
  return warnings.map((warning) => `${warning.title}\n${warning.message}`).join("\n\n");
}

function confirmSchedulingWarnings(warnings: SchedulingSafetyWarning[]): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.confirm(
    `${buildSchedulingWarningMessage(warnings)}\n\nChoose OK to schedule anyway, or Cancel to keep the safer spacing.`,
  );
}

function extractScheduledQueueLimitMessage(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || error.code !== "scheduled_queue_limit_reached") {
    return null;
  }

  return error.message || "Plan your week in advance and stay consistent. Upgrade to unlock scheduling queue.";
}

function splitPostParagraphs(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

function extractPreviewLead(paragraphs: string[]): string[] {
  const firstParagraph = paragraphs[0] ?? "";

  if (!firstParagraph) {
    return [];
  }

  const explicitLines = firstParagraph
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (explicitLines.length >= 2 && explicitLines[0].length <= 72 && explicitLines[1].length <= 72) {
    return explicitLines.slice(0, 2);
  }

  const normalized = firstParagraph.replace(/\s+/g, " ").trim();
  const firstSentenceMatch = normalized.match(/^[^.!?]+[.!?](?=\s|$)/);
  const firstSentence = firstSentenceMatch?.[0]?.trim() ?? normalized;

  if (!firstSentence) {
    return [];
  }

  if (firstSentence.length <= 96) {
    const remaining = normalized.slice(firstSentence.length).trim();
    const secondSentenceMatch = remaining.match(/^[^.!?]+[.!?](?=\s|$)/);
    const secondSentence = secondSentenceMatch?.[0]?.trim() ?? "";

    if (secondSentence && secondSentence.length <= 72) {
      return [firstSentence, secondSentence];
    }
  }

  return [firstSentence.length > 110 ? `${firstSentence.slice(0, 107).trimEnd()}...` : firstSentence];
}

function extractPreviewBody(paragraphs: string[], leadLines: string[]): string[] {
  if (paragraphs.length === 0) {
    return [];
  }

  let firstParagraph = paragraphs[0] ?? "";

  for (const leadLine of leadLines) {
    if (!leadLine) {
      continue;
    }

    if (firstParagraph.startsWith(leadLine)) {
      firstParagraph = firstParagraph.slice(leadLine.length).trimStart();
      continue;
    }

    firstParagraph = firstParagraph.replace(leadLine, "").trim();
  }

  return [firstParagraph, ...paragraphs.slice(1)]
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
}

function normalizeCarouselDraftSlide(value: unknown): CarouselDraftSlide | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const headline = typeof candidate.headline === "string" ? candidate.headline.trim() : "";

  if (!headline) {
    return null;
  }

  const supportingText =
    typeof candidate.supportingText === "string" && candidate.supportingText.trim() !== ""
      ? candidate.supportingText.trim()
      : "";

  return {
    headline,
    supportingText,
    bulletPoints: Array.isArray(candidate.bulletPoints)
      ? candidate.bulletPoints.filter((point): point is string => typeof point === "string" && point.trim() !== "")
      : [],
    highlightText:
      typeof candidate.highlightText === "string" && candidate.highlightText.trim() !== ""
        ? candidate.highlightText.trim()
        : undefined,
    eyebrowText:
      typeof candidate.eyebrowText === "string" && candidate.eyebrowText.trim() !== ""
        ? candidate.eyebrowText.trim()
        : undefined,
    footerText:
      typeof candidate.footerText === "string" && candidate.footerText.trim() !== ""
        ? candidate.footerText.trim()
        : undefined,
    closingText:
      typeof candidate.closingText === "string" && candidate.closingText.trim() !== ""
        ? candidate.closingText.trim()
        : undefined,
    narrativeRole:
      typeof candidate.narrativeRole === "string" && candidate.narrativeRole.trim() !== ""
        ? candidate.narrativeRole.trim()
        : undefined,
  };
}

function normalizeContentNarrativeSlide(value: unknown): ContentNarrativeSlide | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const headline = typeof candidate.headline === "string" ? candidate.headline.trim() : "";

  if (!headline) {
    return null;
  }

  return {
    role:
      typeof candidate.role === "string" && candidate.role.trim() !== ""
        ? candidate.role.trim()
        : "insight",
    headline,
    supportingText:
      typeof candidate.supportingText === "string" && candidate.supportingText.trim() !== ""
        ? candidate.supportingText.trim()
        : undefined,
    bulletPoints: Array.isArray(candidate.bulletPoints)
      ? candidate.bulletPoints.filter((point): point is string => typeof point === "string" && point.trim() !== "")
      : [],
    highlightText:
      typeof candidate.highlightText === "string" && candidate.highlightText.trim() !== ""
        ? candidate.highlightText.trim()
        : undefined,
    eyebrowText:
      typeof candidate.eyebrowText === "string" && candidate.eyebrowText.trim() !== ""
        ? candidate.eyebrowText.trim()
        : undefined,
    footerText:
      typeof candidate.footerText === "string" && candidate.footerText.trim() !== ""
        ? candidate.footerText.trim()
        : undefined,
    closingText:
      typeof candidate.closingText === "string" && candidate.closingText.trim() !== ""
        ? candidate.closingText.trim()
        : undefined,
    assetId:
      typeof candidate.assetId === "string" && candidate.assetId.trim() !== ""
        ? candidate.assetId.trim()
        : undefined,
    imageDataUrl:
      typeof candidate.imageDataUrl === "string" && candidate.imageDataUrl.trim() !== ""
        ? candidate.imageDataUrl.trim()
        : undefined,
    mimeType:
      typeof candidate.mimeType === "string" && candidate.mimeType.trim() !== ""
        ? candidate.mimeType.trim()
        : undefined,
  };
}

function mapCarouselDraftFromNarrative(narrative: ContentNarrative): CarouselDraft {
  return {
    title: narrative.title,
    subtitle: narrative.subtitle,
    narrativeType: narrative.type,
    slides: narrative.slides.map((slide) => ({
      headline: slide.headline,
      supportingText: slide.supportingText || "",
      bulletPoints: slide.bulletPoints ?? [],
      highlightText: slide.highlightText,
      eyebrowText: slide.eyebrowText,
      footerText: slide.footerText,
      closingText: slide.closingText,
      narrativeRole: slide.role,
    })),
  };
}

function normalizeContentNarrative(
  value: unknown,
  fallback: {
    title: string;
    subtitle: string;
  },
): ContentNarrative {
  if (!value || typeof value !== "object") {
    return {
      format: "carousel",
      type: "story",
      title: fallback.title,
      subtitle: fallback.subtitle,
      slides: [],
    };
  }

  const candidate = value as Record<string, unknown>;
  const slides = Array.isArray(candidate.slides)
    ? candidate.slides
      .map((slide) => normalizeContentNarrativeSlide(slide))
      .filter((slide): slide is ContentNarrativeSlide => Boolean(slide))
      .slice(0, 5)
    : [];

  return {
    format: "carousel",
    type:
      candidate.type === "story"
      || candidate.type === "framework"
      || candidate.type === "contrarian"
        ? candidate.type
        : "story",
    title:
      typeof candidate.title === "string" && candidate.title.trim() !== ""
        ? candidate.title.trim()
        : fallback.title,
    subtitle:
      typeof candidate.subtitle === "string" && candidate.subtitle.trim() !== ""
        ? candidate.subtitle.trim()
        : fallback.subtitle,
    sourceText:
      typeof candidate.sourceText === "string" && candidate.sourceText.trim() !== ""
        ? candidate.sourceText.trim()
        : undefined,
    slides,
  };
}

function normalizeCarouselDraft(
  value: unknown,
  fallback: {
    title: string;
    subtitle: string;
  },
): CarouselDraft {
  if (!value || typeof value !== "object") {
    return mapCarouselDraftFromNarrative(normalizeContentNarrative(undefined, fallback));
  }

  const candidate = value as Record<string, unknown>;
  const slides = Array.isArray(candidate.slides)
    ? candidate.slides
      .map((slide) => normalizeCarouselDraftSlide(slide))
      .filter((slide): slide is CarouselDraftSlide => Boolean(slide))
      .slice(0, 5)
    : [];
  const narrativeType =
    candidate.narrativeType === "story"
    || candidate.narrativeType === "framework"
    || candidate.narrativeType === "contrarian"
      ? candidate.narrativeType
      : "story";

  return {
    title:
      typeof candidate.title === "string" && candidate.title.trim() !== ""
        ? candidate.title.trim()
        : fallback.title,
    subtitle:
      typeof candidate.subtitle === "string" && candidate.subtitle.trim() !== ""
        ? candidate.subtitle.trim()
        : fallback.subtitle,
    narrativeType,
    slides,
  };
}

function mapPersistableNarrative(narrative: ContentNarrative): ContentNarrative {
  return {
    format: "carousel",
    type: narrative.type,
    title: narrative.title,
    subtitle: narrative.subtitle,
    sourceText: narrative.sourceText,
    slides: narrative.slides.map((slide) => ({
      role: slide.role,
      headline: slide.headline,
      supportingText: slide.supportingText,
      bulletPoints: slide.bulletPoints ?? [],
      highlightText: slide.highlightText,
      eyebrowText: slide.eyebrowText,
      footerText: slide.footerText,
      closingText: slide.closingText,
      assetId: slide.assetId,
    })),
  };
}

function formatCarouselNarrativeLabel(value: CarouselDraft["narrativeType"] | ContentNarrative["type"] | undefined): string {
  if (value === "framework") {
    return "Framework";
  }

  if (value === "contrarian") {
    return "Contrarian";
  }

  return "Story";
}

function isUploadableGeneratedMimeType(value: string | undefined): boolean {
  return value === "image/png" || value === "image/jpeg" || value === "image/gif";
}

function isBusinessDraft(): boolean {
  return draft.value?.result.workspaceMode === "business";
}

function getMediaSuggestionTitle(suggestion: MediaRecommendationSuggestion): string {
  if (isBusinessDraft() && suggestion.suggestedMediaType === "photo_overlay") {
    return "Generate brand image";
  }

  if (isBusinessDraft() && suggestion.visualTemplateType === "carousel") {
    return "Generate post visual";
  }

  if (suggestion.visualTemplateType === "carousel") {
    return "Generate carousel";
  }

  return suggestion.title;
}

function getMediaSuggestionDescription(suggestion: MediaRecommendationSuggestion): string {
  if (isBusinessDraft() && suggestion.suggestedMediaType === "photo_overlay") {
    return "Create a realistic, brand-led image that matches the campaign hook, CTA, and local audience.";
  }

  if (isBusinessDraft() && suggestion.visualTemplateType === "carousel") {
    return "Create a single promotional visual that matches the generated CTA and platform captions.";
  }

  if (suggestion.visualTemplateType === "carousel") {
    return "Turn this post into a 3-5 slide narrative deck, then render matching slides automatically.";
  }

  return suggestion.description;
}

function getMediaSuggestionReason(suggestion: MediaRecommendationSuggestion): string {
  if (isBusinessDraft() && suggestion.suggestedMediaType === "photo_overlay") {
    return "Business mode works better with trust-building lifestyle creative than founder-style quote cards.";
  }

  if (isBusinessDraft() && suggestion.visualTemplateType === "carousel") {
    return "Business mode stays visual-first and CTA-first, so single-post creative beats slide storytelling.";
  }

  if (suggestion.visualTemplateType === "carousel") {
    return "This keeps the workflow content → narrative → visuals instead of making you manually collect disconnected images.";
  }

  return suggestion.reason;
}

const postScore = computed(() =>
  draft.value
    ? calculateContentScore({
        id: draft.value.id,
        contentType: "post",
        contentBody: draft.value.result.post,
        status: "draft",
        pipelineStage: "review",
        sourceKind: draft.value.mode === "improve" ? "remix" : "capture",
        textContent: draft.value.result.post,
        createdAt: draft.value.createdAt,
      } satisfies ContentAsset).score
    : 0,
);

const quickSignals = computed(() => draft.value?.result.quickSignals);
const isBusinessMode = computed(() => isBusinessDraft());
const generationOutput = computed(() => draft.value?.result.generationOutput);
const businessWeeklyPlan = computed<BusinessWeeklyPlanGenerationOutput | null>(() => {
  if (draft.value?.result.workspaceMode !== "business") {
    return null;
  }

  return generationOutput.value?.kind === "weekly_plan"
    ? generationOutput.value as BusinessWeeklyPlanGenerationOutput
    : null;
});
const businessOutput = computed<BusinessContentOutput | undefined>(() => {
  const currentOutput = generationOutput.value;

  if (currentOutput?.kind === "business_campaign") {
    return currentOutput.content;
  }

  return draft.value?.result.businessOutput;
});
const postContent = computed(() => draft.value?.result.post ?? "");
const postParagraphs = computed(() => splitPostParagraphs(postContent.value));
const previewLeadLines = computed(() => extractPreviewLead(postParagraphs.value));
const previewBodyParagraphs = computed(() =>
  extractPreviewBody(postParagraphs.value, previewLeadLines.value),
);
const visualNarrative = computed(() =>
  draft.value
    ? normalizeContentNarrative(
        draft.value.result.visualNarrative,
        {
          title: draft.value.result.idea.title,
          subtitle: draft.value.result.idea.angle,
        },
      )
    : null,
);
const carouselDraft = computed(() =>
  draft.value && !isBusinessMode.value
    ? mapCarouselDraftFromNarrative(
        visualNarrative.value
          ?? normalizeContentNarrative(undefined, {
            title: draft.value.result.idea.title,
            subtitle: draft.value.result.idea.angle,
          }),
      )
    : null,
);
const carouselNarrativeLabel = computed(() =>
  formatCarouselNarrativeLabel(visualNarrative.value?.type ?? carouselDraft.value?.narrativeType),
);
const hooks = computed(() => draft.value?.result.hooks ?? []);
const povSummary = computed(() => draft.value?.result.pov?.summary ?? "");
const qualitySummary = computed(() => draft.value?.result.quality);
const hasPersistedAsset = computed(() => Boolean(draft.value?.result.asset?.id));
const persistedPostId = computed(() => draft.value?.result.asset?.id ?? "");
const activeBusinessId = computed(() => bootstrap.value?.activeBusinessId ?? "");
const accessLimits = computed(() => bootstrap.value?.limits ?? null);
const canPersistDraft = computed(() => Boolean(activeBusinessId.value && draft.value));
const schedulerEnabled = computed(
  () =>
    Boolean(activeBusinessId.value) &&
    (!bootstrap.value?.activeBusinessId || isFeatureEnabled("scheduler")),
);
const canScheduleDraft = computed(
  () => schedulerEnabled.value && canPersistDraft.value,
);
const scheduledQueueLimit = computed(() => accessLimits.value?.scheduledQueueLimit ?? null);
const scheduledQueueRemaining = computed(() => accessLimits.value?.scheduledQueueRemaining ?? null);
const hasScheduledQueuePreview = computed(() => scheduledQueueLimit.value !== null);
const queueLimitReached = computed(
  () => hasScheduledQueuePreview.value && scheduledQueueRemaining.value === 0,
);
const queuePreviewHeadline = computed(() => {
  if (!hasScheduledQueuePreview.value || scheduledQueueLimit.value === null) {
    return "";
  }

  if (queueLimitReached.value) {
    return `${scheduledQueueLimit.value} of ${scheduledQueueLimit.value} queued`;
  }

  return `${scheduledQueueRemaining.value} of ${scheduledQueueLimit.value} queue slot${scheduledQueueRemaining.value === 1 ? "" : "s"} left`;
});
const queuePreviewCopy = computed(() => {
  if (!hasScheduledQueuePreview.value) {
    return "";
  }

  if (queueLimitReached.value) {
    return "Your free queue is full. Upgrade to plan the rest of your week and stay consistent.";
  }

  return `Queue up to ${scheduledQueueLimit.value} post${scheduledQueueLimit.value === 1 ? "" : "s"} for free, keep the best-time guidance visible, then upgrade when you want a real scheduling cadence.`;
});
const queueLimitPrompt = computed(() =>
  queueLimitReached.value
    ? "Plan your week in advance and stay consistent. Upgrade to unlock scheduling queue."
    : "",
);
const audienceTimezoneOptions = computed(() => {
  const unique = new Set<string>([
    audienceTimezone.value || recommendedTimezone.value || userTimezone,
    userTimezone,
    ...COMMON_AUDIENCE_TIMEZONES,
  ]);

  return [...unique].map((value) => ({
    value,
    label:
      value === userTimezone
        ? `${value} · your time`
        : value === recommendedTimezone.value
          ? `${value} · recommended`
          : value,
  }));
});
const connectedLinkedInAccount = computed(() => findConnectedLinkedInAccount(socialAccounts.value));
const connectedFacebookAccount = computed(() => findConnectedFacebookAccount(socialAccounts.value));
const connectedInstagramAccount = computed(() => findConnectedInstagramAccount(socialAccounts.value));
const selectedPublishingPlatformLabel = computed(() => resolveSocialPlatformLabel(selectedPublishingPlatform.value));
const selectedConnectedAccount = computed(() =>
  selectedPublishingPlatform.value === "instagram"
    ? connectedInstagramAccount.value
    : selectedPublishingPlatform.value === "facebook"
      ? connectedFacebookAccount.value
      : connectedLinkedInAccount.value,
);
const selectedConnectedAccountLabel = computed(() =>
  resolvePublishingAccountLabel(selectedPublishingPlatform.value, selectedConnectedAccount.value),
);
const selectedConnectedAccountDescriptor = computed(() =>
  resolvePublishingDescriptor(selectedPublishingPlatform.value, selectedConnectedAccount.value),
);
const readyImageCount = computed(() =>
  postAssets.value.filter((asset) => asset.type === "image" && asset.status === "ready").length,
);
const readyVideoCount = computed(() =>
  postAssets.value.filter((asset) => asset.type === "video" && asset.status === "ready").length,
);

function resolvePublishingGuardrail(platform: PublishableSocialPlatform): string {
  if (readyImageCount.value > 0 && readyVideoCount.value > 0) {
    return "Mixed image and video drafts are not publishable yet. Use only one media type per post.";
  }

  if (platform === "linkedin" && !connectedLinkedInAccount.value) {
    return "Connect LinkedIn before publishing.";
  }

  if (platform === "linkedin" && readyVideoCount.value > 0) {
    return "Video is publishable on Instagram and Facebook. LinkedIn video support is coming soon.";
  }

  if (platform === "instagram") {
    if (!connectedInstagramAccount.value) {
      return "Connect a Facebook Page with a linked Instagram business account before publishing.";
    }

    if (readyVideoCount.value > 1) {
      return "Instagram video publishing currently supports exactly 1 ready video.";
    }

    if (readyVideoCount.value === 0 && (readyImageCount.value < 1 || readyImageCount.value > 10)) {
      return "Instagram publishing requires either 1 ready video or between 1 and 10 ready images.";
    }
  }

  if (platform === "facebook" && !connectedFacebookAccount.value) {
    return "Connect a Facebook Page before publishing.";
  }

  if (platform === "facebook") {
    if (readyVideoCount.value > 1) {
      return "Facebook video publishing currently supports exactly 1 ready video.";
    }

    if (readyVideoCount.value === 0 && readyImageCount.value > 10) {
      return "Facebook publishing supports up to 10 ready images.";
    }
  }

  return "";
}

const selectedPublishingGuardrail = computed(() => resolvePublishingGuardrail(selectedPublishingPlatform.value));
const selectedPublishingPlatformsLabel = computed(() =>
  formatSelectedPlatformsLabel(selectedPublishingPlatforms.value),
);
const selectedPublishingPlatformCount = computed(() => selectedPublishingPlatforms.value.length);
const selectablePublishingPlatforms = computed(() =>
  PUBLISHABLE_SOCIAL_PLATFORMS.filter((platform) => resolvePublishingGuardrail(platform) === ""),
);
const canPublishSelectedPlatforms = computed(() => selectedPublishingPlatforms.value.length > 0);
const selectedSchedulingCapacityGuardrail = computed(() => {
  if (scheduledQueueRemaining.value === null || selectedPublishingPlatforms.value.length === 0) {
    return "";
  }

  if (scheduledQueueRemaining.value === 0) {
    return queueLimitPrompt.value;
  }

  return "";
});
const selectedPublishingStatus = computed(() => {
  if (!activeBusinessId.value) {
    return "Select a workspace to publish.";
  }

  if (selectedPublishingGuardrail.value) {
    return selectedPublishingGuardrail.value;
  }

  if (selectedConnectedAccount.value) {
    return selectedConnectedAccountLabel.value
      ? `Posting as ${selectedConnectedAccountLabel.value}`
      : `Posting optimized for ${selectedPublishingPlatformLabel.value}`;
  }

  return selectedPublishingPlatform.value === "instagram"
    ? "Connect a Facebook Page with a linked Instagram business account to publish directly."
    : selectedPublishingPlatform.value === "facebook"
      ? "Connect a Facebook Page to publish directly."
      : "Connect LinkedIn to publish directly.";
});
const selectedPublishAttemptResults = computed(() =>
  publishAttemptResults.value.filter((result) => selectedPublishingPlatforms.value.includes(result.platform)),
);
const selectedPublishSuccessResults = computed(() =>
  selectedPublishAttemptResults.value.filter((result) => result.status === "success"),
);
const selectedPublishFailureResults = computed(() =>
  selectedPublishAttemptResults.value.filter((result) => result.status === "failed"),
);
const hasCompleteSelectedPublishAttempt = computed(() =>
  selectedPublishingPlatforms.value.length > 0
  && selectedPublishAttemptResults.value.length === selectedPublishingPlatforms.value.length,
);
const hasPartialSelectedPublishFailure = computed(() =>
  hasCompleteSelectedPublishAttempt.value
  && selectedPublishSuccessResults.value.length > 0
  && selectedPublishFailureResults.value.length > 0,
);
const retryFailedPlatformsLabel = computed(() =>
  formatSelectedPlatformsLabel(selectedPublishFailureResults.value.map((result) => result.platform)),
);
const canRetryFailedPlatforms = computed(() =>
  selectedPublishFailureResults.value.length > 0
  && !isPublishingToLinkedIn.value
  && !isConnectingLinkedIn.value
  && !isConnectingMeta.value
  && !isUploadingPostAssets.value
  && Boolean(activeBusinessId.value),
);
const shouldUseRetryFailedAsPrimaryAction = computed(() =>
  canRetryFailedPlatforms.value && hasCompleteSelectedPublishAttempt.value,
);
const isConnectingSelectedPlatform = computed(() =>
  selectedPublishingPlatform.value === "linkedin" ? isConnectingLinkedIn.value : isConnectingMeta.value,
);
const shouldConnectFocusedPublishingPlatform = computed(() =>
  !canPublishSelectedPlatforms.value
  && !selectedConnectedAccount.value
  && selectedPublishingGuardrail.value.toLowerCase().includes("connect"),
);
const canRunPublishingAction = computed(() =>
  canPublishSelectedPlatforms.value || shouldConnectFocusedPublishingPlatform.value,
);
const primaryPublishActionLabel = computed(() => {
  if (shouldUseRetryFailedAsPrimaryAction.value) {
    return isPublishingToLinkedIn.value
      ? "Retrying failed..."
      : `Retry failed only${selectedPublishFailureResults.value.length > 1 ? ` · ${retryFailedPlatformsLabel.value}` : ""}`;
  }

  if (canPublishSelectedPlatforms.value) {
    return isPublishingToLinkedIn.value
      ? "Publishing..."
      : `Publish to ${selectedPublishingPlatformsLabel.value}`;
  }

  if (shouldConnectFocusedPublishingPlatform.value) {
    return isConnectingSelectedPlatform.value
      ? "Redirecting..."
      : `Connect ${selectedPublishingPlatformLabel.value}`;
  }

  return "Select at least one destination";
});
const primaryScheduleActionLabel = computed(() => {
  if (selectedPublishingPlatformCount.value === 0) {
    return "Select destinations";
  }

  return selectedPublishingPlatformCount.value === 1
    ? `Choose time for ${selectedPublishingPlatformsLabel.value}`
    : `Choose time for ${selectedPublishingPlatformsLabel.value}`;
});

function isPublishingPlatformSelected(platform: PublishableSocialPlatform): boolean {
  return selectedPublishingPlatforms.value.includes(platform);
}

function resolvePublishingPlatformAccount(platform: PublishableSocialPlatform): SocialAccount | null {
  if (platform === "instagram") {
    return connectedInstagramAccount.value;
  }

  if (platform === "facebook") {
    return connectedFacebookAccount.value;
  }

  return connectedLinkedInAccount.value;
}

function resolvePublishingPlatformHint(platform: PublishableSocialPlatform): string {
  const guardrail = resolvePublishingGuardrail(platform);

  if (guardrail) {
    return guardrail;
  }

  const account = resolvePublishingPlatformAccount(platform);

  return account
    ? resolvePublishingDescriptor(platform, account)
    : `Connect ${resolveSocialPlatformLabel(platform)} to enable publishing.`;
}

function togglePublishingPlatform(platform: PublishableSocialPlatform): void {
  selectedPublishingPlatform.value = platform;

  if (resolvePublishingGuardrail(platform) !== "") {
    return;
  }

  if (isPublishingPlatformSelected(platform)) {
    selectedPublishingPlatforms.value = selectedPublishingPlatforms.value.filter(
      (candidate) => candidate !== platform,
    );
    return;
  }

  selectedPublishingPlatforms.value = [
    ...selectedPublishingPlatforms.value,
    platform,
  ];
}

function getPublishFailureMessage(error: unknown, platform: PublishableSocialPlatform): string {
  const platformLabel = resolveSocialPlatformLabel(platform);
  const rawMessage =
    error instanceof Error && error.message.trim() !== ""
      ? error.message.trim()
      : `Unable to publish to ${platformLabel} right now.`;

  if (rawMessage.includes("status 404")) {
    return `Direct ${platformLabel} publishing is not live on the backend yet. Redeploy the API and try again.`;
  }

  return rawMessage;
}

function mapPublishAttemptResult(platform: PublishAttemptPlatform, attemptId: string): PlatformPublishAttemptResult {
  return {
    attemptId,
    platformAttemptId: platform.id,
    platform: platform.platform as PublishableSocialPlatform,
    status: platform.status === "success" ? "success" : "failed",
    message:
      platform.status === "success"
        ? "Posted successfully."
        : platform.errorMessage?.trim() || "Publishing failed. Fix the issue and retry.",
    errorCode: platform.errorCode,
    externalPostUrl: platform.externalPostUrl,
  };
}

function applyPublishAttempt(attempt: PublishAttempt, options: { merge?: boolean } = {}): void {
  currentPublishAttemptId.value = attempt.id;
  const merged = options.merge
    ? new Map(publishAttemptResults.value.map((result) => [result.platform, result] as const))
    : new Map<PublishableSocialPlatform, PlatformPublishAttemptResult>();

  for (const platform of attempt.platforms) {
    merged.set(platform.platform as PublishableSocialPlatform, mapPublishAttemptResult(platform, attempt.id));
  }

  publishAttemptResults.value = PUBLISHABLE_SOCIAL_PLATFORMS
    .map((platform) => merged.get(platform))
    .filter((result): result is PlatformPublishAttemptResult => Boolean(result));
}

async function loadPersistedPublishAttemptResults(): Promise<void> {
  if (!activeBusinessId.value || !persistedPostId.value) {
    currentPublishAttemptId.value = "";
    publishAttemptResults.value = [];
    return;
  }

  try {
    const response = await requestPublishAttempts(activeBusinessId.value);
    const matchingAttempts = response.publishAttempts.filter(
      (attempt) =>
        attempt.assetGroupId === persistedPostId.value
        && attempt.sourceKind !== "scheduled",
    );

    if (matchingAttempts.length === 0) {
      currentPublishAttemptId.value = "";
      publishAttemptResults.value = [];
      return;
    }

    currentPublishAttemptId.value = matchingAttempts[0]?.id ?? "";

    const latestByPlatform = new Map<PublishableSocialPlatform, PlatformPublishAttemptResult>();

    for (const attempt of matchingAttempts) {
      for (const platform of attempt.platforms) {
        if (!latestByPlatform.has(platform.platform as PublishableSocialPlatform)) {
          latestByPlatform.set(
            platform.platform as PublishableSocialPlatform,
            mapPublishAttemptResult(platform, attempt.id),
          );
        }
      }
    }

    publishAttemptResults.value = PUBLISHABLE_SOCIAL_PLATFORMS
      .map((platform) => latestByPlatform.get(platform))
      .filter((result): result is PlatformPublishAttemptResult => Boolean(result));
  } catch {
    currentPublishAttemptId.value = "";
    publishAttemptResults.value = [];
  }
}

const attentionSignal = computed(() => {
  if (postScore.value >= 84) {
    return {
      label: "High",
      copy: "Strong feed readability with a clean publishing structure.",
      tone: "strong",
    } as const;
  }

  if (postScore.value >= 72) {
    return {
      label: "Promising",
      copy: "Good foundation. The main unlock is a sharper opening or tighter close.",
      tone: "steady",
    } as const;
  }

  return {
    label: "Needs punch",
    copy: "The idea is there, but the hook or paragraph rhythm still needs more tension.",
    tone: "warning",
  } as const;
});

const structureSignal = computed(() => {
  if (previewLeadLines.value[0] && previewLeadLines.value[0].length <= 72 && postParagraphs.value.length >= 4) {
    return "Scroll-friendly";
  }

  if (postParagraphs.value.length >= 3) {
    return "Readable";
  }

  return "Dense";
});

const actionPriorityLabel = computed(() => {
  if (shouldUseRetryFailedAsPrimaryAction.value) {
    return "Retry failed only";
  }

  if (selectedPublishingGuardrail.value) {
    return selectedPublishingPlatform.value === "instagram" ? "Fix Instagram setup" : "Fix channel setup";
  }

  return canScheduleDraft.value ? "Schedule next" : selectedConnectedAccount.value ? "Publish now" : "Connect channel";
});
const recommendedContentType = computed(() => (postAssets.value.length > 0 ? "image" : "text"));
const visibleMediaRecommendations = computed(() =>
  mediaRecommendations.value.filter((suggestion) => suggestion.actionType !== "skip"),
);
const eligibleMediaRecommendations = computed(() =>
  visibleMediaRecommendations.value.filter(
    (suggestion) => !(isBusinessMode.value && suggestion.visualTemplateType === "carousel"),
  ),
);
const fallbackMediaRecommendations = computed<MediaRecommendationSuggestion[]>(() => [
  ...(isBusinessMode.value
    ? [
        {
          id: "fallback-brand-image",
          actionType: "generate_visual" as const,
          title: "Generate brand image",
          description: "Create a realistic promotional image that feels local, trustworthy, and campaign-ready.",
          reason: "Business mode benefits from photo-led creative that supports the offer before it asks for the click.",
          suggestedMediaType: "photo_overlay" as const,
          visualTemplateType: "insight" as const,
          recommendedAssetIds: [],
        },
      ]
    : []),
  {
    id: "fallback-carousel",
    actionType: "generate_visual",
    title: isBusinessMode.value ? "Generate post visual" : "Generate carousel",
    description: isBusinessMode.value
      ? "Create a clean promotional visual matched to the campaign headline and CTA."
      : "Turn the post into a 3-5 slide narrative deck with matching visuals.",
    reason: isBusinessMode.value
      ? "Business mode favors single-post creative over slide storytelling."
      : "Best default when the post has enough tension or structure to earn a multi-slide story.",
    suggestedMediaType: "framework_card",
    visualTemplateType: isBusinessMode.value ? "insight" : "carousel",
    recommendedAssetIds: [],
  },
  {
    id: "fallback-quote-card",
    actionType: "generate_visual",
    title: "Generate quote card",
    description: "Turn the strongest line into a clean quote-style visual.",
    reason: "Safe default for text-first founder posts when no stronger match is available yet.",
    suggestedMediaType: "quote_card",
    visualTemplateType: "quote",
    recommendedAssetIds: [],
  },
  {
    id: "fallback-stat-card",
    actionType: "generate_visual",
    title: "Generate stat card",
    description: "Package the main idea into a compact insight or proof-style card.",
    reason: "Useful when the post has a clear takeaway but not enough structure for a carousel.",
    suggestedMediaType: "stat_card",
    visualTemplateType: "insight",
    recommendedAssetIds: [],
  },
]);
const displayedMediaRecommendations = computed(() =>
  (eligibleMediaRecommendations.value.length > 0
    ? eligibleMediaRecommendations.value
    : fallbackMediaRecommendations.value)
    .slice()
    .sort((left, right) => {
      const leftPriority = isBusinessMode.value
        ? left.suggestedMediaType === "photo_overlay"
          ? 0
          : left.visualTemplateType === "quote" ? 2 : 1
        : left.visualTemplateType === "carousel" ? 0 : 1;
      const rightPriority = isBusinessMode.value
        ? right.suggestedMediaType === "photo_overlay"
          ? 0
          : right.visualTemplateType === "quote" ? 2 : 1
        : right.visualTemplateType === "carousel" ? 0 : 1;
      return leftPriority - rightPriority;
    }),
);
const isUsingFallbackMediaRecommendations = computed(
  () => !isLoadingMediaRecommendations.value && eligibleMediaRecommendations.value.length === 0,
);
const selectedAudienceTimeLabel = computed(() => {
  if (!scheduleDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    return "";
  }

  const scheduledAt = convertZonedDateTimeToUtcIso(
    scheduleDateKey.value,
    scheduleTime.value,
    audienceTimezone.value,
  );

  return formatTimeWithZone(scheduledAt, audienceTimezone.value);
});
const selectedAudienceDateLabel = computed(() => {
  if (!scheduleDateKey.value) {
    return "";
  }

  return formatDateInTimezone(`${scheduleDateKey.value}T12:00:00.000Z`, "UTC", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
});
const selectedLocalTimeLabel = computed(() => {
  if (!scheduleDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    return "";
  }

  const scheduledAt = convertZonedDateTimeToUtcIso(
    scheduleDateKey.value,
    scheduleTime.value,
    audienceTimezone.value,
  );

  return formatTimeWithZone(scheduledAt, userTimezone);
});
const bestRecommendedSlot = computed(() => recommendedSlots.value[0] ?? null);
const selectedScheduledAtIso = computed(() => {
  if (!scheduleDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    return "";
  }

  return convertZonedDateTimeToUtcIso(
    scheduleDateKey.value,
    scheduleTime.value,
    audienceTimezone.value,
  );
});
const selectedDispatchWindowLabel = computed(() => {
  if (!selectedScheduledAtIso.value || !audienceTimezone.value) {
    return "";
  }

  const end = new Date(selectedScheduledAtIso.value);
  end.setMinutes(end.getMinutes() + 20);

  const startLabel = formatTimeWithZone(selectedScheduledAtIso.value, audienceTimezone.value);
  const endLabel = formatTimeWithZone(end.toISOString(), audienceTimezone.value);

  return `${startLabel}–${endLabel}`;
});

const signalPills = computed(() => [
  `${attentionSignal.value.label} attention signal`,
  `${structureSignal.value} structure`,
  `${hooks.value.length} alternate hook${hooks.value.length === 1 ? "" : "s"}`,
]);

const growthMechanics = computed(() => [
  {
    id: "pattern-break",
    label: "Pattern-break",
    title: "Sharpen the opening",
    copy: "Push the first lines toward contrast or curiosity so the post feels less familiar in-feed.",
    actionLabel: "Preview sharper hook",
    command:
      "Rewrite the opening into a sharper, pattern-breaking LinkedIn hook. Use short punchy lines and keep the rest of the post grounded.",
  },
  {
    id: "retention",
    label: "Retention",
    title: "Make the middle easier to skim",
    copy: "Break dense paragraphs into smaller beats so readers keep going instead of bouncing.",
    actionLabel: "Preview punchier format",
    command:
      "Reformat this LinkedIn post for retention: shorter paragraphs, punchier line breaks, same message, no emojis.",
  },
  {
    id: "interaction",
    label: "Interaction",
    title: "Land on a stronger comment trigger",
    copy: "Close with one direct question that makes founders want to answer from experience.",
    actionLabel: "Preview better close",
    command:
      "Add a stronger engagement trigger at the end. Finish with one specific question that invites comments from founders.",
  },
] as const);

function buildConversationPrompts(title: string, text: string): string[] {
  const normalized = `${title} ${text}`.toLowerCase();

  if (/(audience|users|user|customer|customers|community|feedback)/.test(normalized)) {
    return [
      "Are you building with users — or assumptions?",
      "What is one thing you only learned after talking to users?",
      "Most underrated founder habit: talk to five users before building one feature. Agree or disagree?",
    ];
  }

  if (/(follower|followers|authentic|authenticity|audience growth|content)/.test(normalized)) {
    return [
      "Are you optimizing for attention — or trust?",
      "What changed more for you: audience size or audience trust?",
      "Most underrated content habit: reply before you broadcast. Agree or disagree?",
    ];
  }

  if (/(startup|founder|saas|product|build|feature|mvp)/.test(normalized)) {
    return [
      "What is one feature you built that nobody actually used?",
      "Are you building the product — or validating the problem?",
      "Most underrated founder move: validate before you build. Agree or disagree?",
    ];
  }

  return [
    "What is one thing you learned the hard way here?",
    "Agree or disagree?",
    "What would you add to this from your own experience?",
  ];
}

const conversationPrompts = computed(() =>
  buildConversationPrompts(draft.value?.result.idea.title ?? "", postContent.value),
);

const suggestedFirstComment = computed(() => {
  const strongestPrompt = conversationPrompts.value[2] ?? conversationPrompts.value[0] ?? "";

  if (!strongestPrompt) {
    return "";
  }

  return `Most underrated founder move:\n\n${strongestPrompt}`;
});

const feedbackTone = computed(() => {
  const message = feedbackMessage.value.trim().toLowerCase();

  if (!message) {
    return "neutral" as const;
  }

  if (
    message.includes("unable") ||
    message.includes("failed") ||
    message.includes("select a workspace") ||
    message.includes("connect linkedin") ||
    message.includes("connect a facebook page") ||
    message.includes("instagram") ||
    message.includes("not live") ||
    message.includes("error")
  ) {
    return "warning" as const;
  }

  return "success" as const;
});

const executionStatus = computed(() => {
  if (isPublishingToLinkedIn.value) {
    return {
      tone: "live",
      label: "Publishing",
      title: `Sending this post to ${selectedPublishingPlatformLabel.value} now`,
      description: selectedPublishingStatus.value,
      detail: `If ${selectedPublishingPlatformLabel.value} rejects the call, the draft stays in the workspace so you can retry cleanly.`,
    } as const;
  }

  if (hasPartialSelectedPublishFailure.value) {
    return {
      tone: "warning",
      label: "Partial publish",
      title: "Some platforms posted, some still need a retry",
      description: `${formatSelectedPlatformsLabel(selectedPublishSuccessResults.value.map((result) => result.platform))} posted successfully. ${retryFailedPlatformsLabel.value} still failed.`,
      detail: "Retry failed only uses the current draft and media, and it skips platforms that already posted successfully.",
    } as const;
  }

  if (
    hasCompleteSelectedPublishAttempt.value
    && selectedPublishFailureResults.value.length === selectedPublishingPlatforms.value.length
  ) {
    return {
      tone: "warning",
      label: "Publish failed",
      title: "No selected platforms published",
      description: "Fix the blocking issue, then retry only the failed platforms.",
      detail: "Successful platforms are preserved when they exist. Failed platforms are safe to retry with the latest media and copy.",
    } as const;
  }

  if (
    hasCompleteSelectedPublishAttempt.value
    && selectedPublishSuccessResults.value.length === selectedPublishingPlatforms.value.length
  ) {
    return {
      tone: "live",
      label: "Published",
      title: "This post is already live",
      description: `The draft has cleared direct publishing on ${selectedPublishingPlatformsLabel.value}.`,
      detail: "Use planner for the next slot, or repurpose this post into email and outreach.",
    } as const;
  }

  if (feedbackMessage.value.startsWith("Queued for dispatch")) {
    return {
      tone: "queued",
      label: "Scheduled",
      title: `${selectedAudienceDateLabel.value} • ${selectedAudienceTimeLabel.value}`,
      description: selectedDispatchWindowLabel.value
        ? `Dispatch window: ${selectedDispatchWindowLabel.value}`
        : "The worker will dispatch this draft inside the selected delivery window.",
      detail: "Queued jobs are picked in ~5 second worker cycles and retried automatically on transient failures.",
    } as const;
  }

  if (canScheduleDraft.value) {
    return {
      tone: "ready",
      label: "Ready to schedule",
      title: bestRecommendedSlot.value
        ? `Best time: ${bestRecommendedSlot.value.localLabel}`
        : "Choose a delivery window",
      description: bestRecommendedSlot.value?.reason
        ?? "Pick a time once and let the queue handle dispatch instead of posting manually.",
      detail: "Scheduling keeps the draft attached to the workspace loop and makes execution visible in planner.",
    } as const;
  }

  if (selectedConnectedAccount.value) {
    return {
      tone: "ready",
      label: "Ready to publish",
      title: "This draft can go live immediately",
      description: selectedPublishingStatus.value,
      detail: "Publish now for instant delivery, or route it through planner when timing matters.",
    } as const;
  }

  return {
    tone: "warning",
    label: "Connection needed",
    title: `Connect ${selectedPublishingPlatformLabel.value} before direct publishing`,
    description: selectedPublishingStatus.value,
    detail: "You can still refine the copy, attach media, and queue the next slot while the channel is being connected.",
  } as const;
});

const executionPanelFacts = computed(() => [
  {
    label: "Status",
    value: executionStatus.value.label,
  },
  {
    label: "Publish as",
    value: selectedConnectedAccountDescriptor.value,
  },
  {
    label: "Best time",
    value: bestRecommendedSlot.value?.localLabel ?? "9:00–11:00 AM",
  },
  {
    label: "Dispatch",
    value:
      feedbackMessage.value.startsWith("Queued for dispatch") && selectedDispatchWindowLabel.value
        ? selectedDispatchWindowLabel.value
        : "~5s worker polling",
  },
  {
    label: "Worker",
    value: feedbackMessage.value.startsWith("Queued for dispatch")
      ? "Active · polls ~5s"
      : "Ready · polls ~5s",
  },
  {
    label: "Attention",
    value: attentionSignal.value.label,
  },
]);

const executionTimeline = computed(() => {
  if (hasPartialSelectedPublishFailure.value) {
    return [
      `${formatSelectedPlatformsLabel(selectedPublishSuccessResults.value.map((result) => result.platform))} already posted successfully.`,
      `${retryFailedPlatformsLabel.value} failed and can be retried without reposting the successful platforms.`,
      "Fix the blocking issue, then use Retry failed only to send just the failed channels again.",
    ];
  }

  if (
    hasCompleteSelectedPublishAttempt.value
    && selectedPublishFailureResults.value.length === selectedPublishingPlatforms.value.length
  ) {
    return [
      "No selected platforms published yet.",
      "The current draft and media are still intact in the workspace.",
      "Fix the failure reason, then retry only the failed platforms.",
    ];
  }

  if (
    hasCompleteSelectedPublishAttempt.value
    && selectedPublishSuccessResults.value.length === selectedPublishingPlatforms.value.length
  ) {
    return [
      `The post is already live on ${selectedPublishingPlatformsLabel.value}.`,
      "History will track the publish result and let you repurpose it later.",
      "Use planner to lock the next execution slot while momentum is fresh.",
    ];
  }

  if (feedbackMessage.value.startsWith("Queued for dispatch")) {
    return [
      "The draft is saved and linked to a real planner slot.",
      selectedDispatchWindowLabel.value
        ? `The worker will dispatch it inside ${selectedDispatchWindowLabel.value}.`
        : "The worker will dispatch it inside the selected window.",
      "If a transient delivery issue happens, the queue retries without losing the draft.",
    ];
  }

  if (selectedConnectedAccount.value) {
    return [
      `Publish now sends the draft to ${selectedPublishingPlatformLabel.value} immediately.`,
      "Choose time hands execution to the scheduler and worker loop.",
      "Open planner if you want the draft inside the weekly queue instead of publishing blind.",
    ];
  }

  return [
    `Connect ${selectedPublishingPlatformLabel.value} once to unlock direct publishing.`,
    "Choose time to route this draft into the safer planner flow.",
    "Keep refining the copy until the timing and hook feel strong enough to push live.",
  ];
});

const aiPreviewActions = computed(() =>
  (aiEditPreview.value?.interpretedActions ?? []).map((action) =>
    action
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  ),
);

function inferBusinessChannelsFromOutput(output: BusinessContentOutput): Array<"instagram" | "facebook" | "email"> {
  return [
    ...(output.captions.instagram ? ["instagram" as const] : []),
    ...(output.captions.facebook ? ["facebook" as const] : []),
    ...(output.email ? ["email" as const] : []),
  ];
}

function buildFallbackGenerationOutput(
  body: Partial<RepurposeContentResponse>,
  post: string,
  visualNarrative: ContentNarrative,
  quickSignals: RepurposeContentResponse["quickSignals"],
): RepurposeContentResponse["generationOutput"] {
  if (body.workspaceMode === "business" && body.businessOutput) {
    return {
      kind: "business_campaign",
      intent:
        body.generationIntent === "get_leads"
        || body.generationIntent === "get_bookings"
        || body.generationIntent === "promote_offer"
          ? body.generationIntent
          : "promote_offer",
      goal:
        body.generationIntent === "get_leads"
          ? "leads"
          : body.generationIntent === "get_bookings"
            ? "bookings"
            : "awareness",
      channels: inferBusinessChannelsFromOutput(body.businessOutput),
      content: body.businessOutput,
    };
  }

  return {
    kind: "creator_post",
    intent:
      body.generationIntent === "grow_audience" || body.generationIntent === "promote_offer"
        ? body.generationIntent
        : "post_idea",
    primaryChannel: "linkedin",
    post,
    hooks: Array.isArray(body.hooks) ? body.hooks.filter((hook): hook is string => typeof hook === "string") : [],
    variations: Array.isArray(body.variations) ? body.variations : [],
    visualNarrative,
    carouselDraft: mapCarouselDraftFromNarrative(visualNarrative),
    quickSignals,
  };
}

function buildDraftFromAsset(asset: ContentAsset): ActivationDraftRecord | null {
  if (!asset.contentBody || typeof asset.contentBody !== "object") {
    return null;
  }

  const body = asset.contentBody as Partial<RepurposeContentResponse> & {
    idea?: { title?: string; angle?: string };
    quickSignals?: RepurposeContentResponse["quickSignals"];
  };
  const post =
    typeof body.post === "string" && body.post.trim() !== ""
      ? body.post.trim()
      : asset.textContent?.trim() || "";

  if (!post) {
    return null;
  }

  const fallbackNarrative = normalizeContentNarrative(body.visualNarrative, {
    title:
      typeof body.idea?.title === "string" && body.idea.title.trim() !== ""
        ? body.idea.title
        : asset.title || "Saved draft",
    subtitle:
      typeof body.idea?.angle === "string" && body.idea.angle.trim() !== ""
        ? body.idea.angle
        : "Refine and publish this workspace draft.",
  });
  const normalizedNarrative =
    body.visualNarrative && typeof body.visualNarrative === "object"
      ? fallbackNarrative
      : normalizeContentNarrative(body.carouselDraft, {
          title:
            typeof body.idea?.title === "string" && body.idea.title.trim() !== ""
              ? body.idea.title
              : asset.title || "Saved draft",
          subtitle:
            typeof body.idea?.angle === "string" && body.idea.angle.trim() !== ""
              ? body.idea.angle
              : "Refine and publish this workspace draft.",
        });
  const quickSignals =
    body.quickSignals && typeof body.quickSignals === "object"
      ? body.quickSignals
      : {
          readyLabel: "Saved as draft",
          formatLabel: "This post is persisted and ready for the next action.",
        };
  const fallbackGenerationOutput = buildFallbackGenerationOutput(
    body,
    post,
    normalizedNarrative,
    quickSignals,
  );
  const normalizedResult: RepurposeContentResponse = {
    inputType: body.inputType ?? "text",
    intent: body.intent ?? (asset.sourceKind === "remix" ? "reference" : "capture"),
    strategy:
      body.strategy === "continue"
      || body.strategy === "deepen"
      || body.strategy === "contrarian"
      || body.strategy === "tactical"
        ? body.strategy
        : "continue",
    generationOutput:
      body.generationOutput && typeof body.generationOutput === "object"
        ? body.generationOutput
        : fallbackGenerationOutput,
    workspaceMode: body.workspaceMode,
    sourceText: typeof body.sourceText === "string" ? body.sourceText : post,
    idea: {
      title:
        typeof body.idea?.title === "string" && body.idea.title.trim() !== ""
          ? body.idea.title
          : asset.title || "Saved draft",
      angle:
        typeof body.idea?.angle === "string" && body.idea.angle.trim() !== ""
          ? body.idea.angle
          : "Refine and publish this workspace draft.",
    },
    hooks: Array.isArray(body.hooks) ? body.hooks.filter((hook): hook is string => typeof hook === "string") : [],
    post,
    visualNarrative: normalizedNarrative,
    variations: Array.isArray(body.variations) ? body.variations : [],
    carouselDraft: mapCarouselDraftFromNarrative(normalizedNarrative),
    quickSignals,
    captionFooterCredit:
      typeof body.captionFooterCredit === "string" ? body.captionFooterCredit : "",
    businessOutput:
      body.businessOutput && typeof body.businessOutput === "object"
        ? body.businessOutput
        : undefined,
    asset,
  };

  return {
    id: asset.id,
    input: post,
    mode: asset.sourceKind === "remix" ? "improve" : "generate",
    createdAt: asset.updatedAt ?? asset.createdAt,
    result: normalizedResult,
  };
}

async function loadDraft(): Promise<void> {
  const draftId = typeof route.query.id === "string" ? route.query.id : "";

  if (!draftId) {
    draft.value = null;
    return;
  }

  const storedDraft = getActivationDraft(draftId);

  if (storedDraft) {
    draft.value = storedDraft;
    return;
  }

  if (!activeBusinessId.value) {
    draft.value = null;
    return;
  }

  try {
    const response = await requestPipelineItem(activeBusinessId.value, draftId);
    draft.value = buildDraftFromAsset(response.asset);
  } catch {
    draft.value = null;
  }
}

async function copyPost(options?: { silent?: boolean }): Promise<boolean> {
  if (!postContent.value.trim() || typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(postContent.value);

    if (!options?.silent) {
      feedbackMessage.value = "Ready to post. Copied to clipboard.";
    }

    return true;
  } catch {
    if (!options?.silent) {
      feedbackMessage.value = "The post is ready. Copy it manually if needed.";
    }

    return false;
  }
}

async function copyCustomText(
  value: string,
  input: {
    successMessage: string;
    failureMessage: string;
    target?: "main" | "growth" | "hashtags";
  },
): Promise<boolean> {
  if (!value.trim() || typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);

    if (input.target === "growth") {
      growthMechanicsFeedback.value = input.successMessage;
    } else if (input.target === "hashtags") {
      hashtagFeedback.value = input.successMessage;
    } else {
      feedbackMessage.value = input.successMessage;
    }

    return true;
  } catch {
    if (input.target === "growth") {
      growthMechanicsFeedback.value = input.failureMessage;
    } else if (input.target === "hashtags") {
      hashtagFeedback.value = input.failureMessage;
    } else {
      feedbackMessage.value = input.failureMessage;
    }

    return false;
  }
}

function clearAiEditPreview(): void {
  aiEditPreview.value = null;
  aiEditFeedback.value = "";
}

function buildDraftContentBody(): Record<string, unknown> {
  if (!draft.value) {
    return { content: postContent.value };
  }

  const { asset: _ignoredAsset, ...resultWithoutAsset } = draft.value.result;
  const nextVisualNarrative = mapPersistableNarrative(
    normalizeContentNarrative(resultWithoutAsset.visualNarrative, {
      title: draft.value.result.idea.title,
      subtitle: draft.value.result.idea.angle,
    }),
  );

  return {
    ...resultWithoutAsset,
    post: postContent.value,
    visualNarrative: nextVisualNarrative,
    carouselDraft: mapCarouselDraftFromNarrative(nextVisualNarrative),
  };
}

function buildDraftContentBodyWithVisualNarrative(nextVisualNarrative: ContentNarrative): Record<string, unknown> {
  if (!draft.value) {
    return {
      content: postContent.value,
      post: postContent.value,
      visualNarrative: mapPersistableNarrative(nextVisualNarrative),
      carouselDraft: mapCarouselDraftFromNarrative(nextVisualNarrative),
    };
  }

  const { asset: _ignoredAsset, ...resultWithoutAsset } = draft.value.result;
  const persistableNarrative = mapPersistableNarrative(nextVisualNarrative);

  return {
    ...resultWithoutAsset,
    post: postContent.value,
    visualNarrative: persistableNarrative,
    carouselDraft: mapCarouselDraftFromNarrative(persistableNarrative),
  };
}

function buildPersistedDraftRecord(nextAsset: ContentAsset): ActivationDraftRecord | null {
  if (!draft.value) {
    return null;
  }

  return {
    ...draft.value,
    id: nextAsset.id,
    result: {
      ...draft.value.result,
      post: postContent.value,
      asset: nextAsset,
    },
  };
}

async function updateDraftPostContent(nextText: string, successMessage: string): Promise<void> {
  if (!draft.value) {
    return;
  }

  const trimmedText = nextText.trim();

  if (!trimmedText) {
    throw new Error("The updated post is empty.");
  }

  let nextAsset = draft.value.result.asset;

  if (activeBusinessId.value && draft.value.result.asset?.id) {
    const response = await requestUpdatePipelineItem({
      businessId: activeBusinessId.value,
      assetId: draft.value.result.asset.id,
      textContent: trimmedText,
    });

    nextAsset = response.asset;
  }

  const nextDraft = replaceActivationDraft({
    ...draft.value,
    result: {
      ...draft.value.result,
      post: trimmedText,
      asset: nextAsset,
    },
  });

  draft.value = nextDraft;
  feedbackMessage.value = successMessage;
}

async function updateDraftVisualNarrative(nextVisualNarrative: ContentNarrative): Promise<void> {
  if (!draft.value) {
    return;
  }

  let nextAsset = draft.value.result.asset;

  if (activeBusinessId.value && draft.value.result.asset?.id) {
    const response = await requestUpdatePipelineItem({
      businessId: activeBusinessId.value,
      assetId: draft.value.result.asset.id,
      textContent: postContent.value,
      contentBody: buildDraftContentBodyWithVisualNarrative(nextVisualNarrative),
    });

    nextAsset = response.asset;
  }

  const persistableNarrative = mapPersistableNarrative(nextVisualNarrative);
  draft.value = replaceActivationDraft({
    ...draft.value,
    result: {
      ...draft.value.result,
      visualNarrative: persistableNarrative,
      carouselDraft: mapCarouselDraftFromNarrative(persistableNarrative),
      asset: nextAsset,
    },
  });
}

async function ensurePersistedDraft(): Promise<string | null> {
  if (!draft.value) {
    feedbackMessage.value = "Generate a post first.";
    return null;
  }

  if (!activeBusinessId.value) {
    feedbackMessage.value = "Select a workspace before saving this draft.";
    return null;
  }

  if (persistedPostId.value) {
    return persistedPostId.value;
  }

  const response = await requestCreatePipelineItem({
    businessId: activeBusinessId.value,
    title: draft.value.result.idea.title,
    textContent: postContent.value,
    contentBody: buildDraftContentBody(),
    sourceKind: draft.value.mode === "improve" ? "remix" : "capture",
  });

  const nextDraft = buildPersistedDraftRecord(response.asset);

  if (!nextDraft) {
    return response.asset.id;
  }

  draft.value = replaceActivationDraft(nextDraft);
  await router.replace({
    path: route.path,
    query: {
      ...route.query,
      id: response.asset.id,
    },
  });

  return response.asset.id;
}

async function previewAiEdit(commandOverride?: string): Promise<void> {
  if (!draft.value) {
    return;
  }

  if (!activeBusinessId.value) {
    aiEditFeedback.value = "Select a workspace before requesting AI edits.";
    return;
  }

  const instruction = (commandOverride ?? aiEditInstruction.value).trim();

  if (!instruction) {
    aiEditFeedback.value = "Describe the change you want first.";
    return;
  }

  aiEditInstruction.value = instruction;
  aiEditFeedback.value = "";
  aiEditPreview.value = null;
  isPreviewingAiEdit.value = true;

  try {
    const response = await requestContentAiEditPreview({
      businessId: activeBusinessId.value,
      assetId: draft.value.result.asset?.id,
      textContent: postContent.value,
      instruction,
    });

    aiEditPreview.value = response.preview;
  } catch (error) {
    aiEditFeedback.value =
      error instanceof Error ? error.message : "Unable to preview AI edits right now.";
  } finally {
    isPreviewingAiEdit.value = false;
  }
}

async function applyAiEditPreview(): Promise<void> {
  if (!draft.value || !aiEditPreview.value) {
    return;
  }

  const suggestedText = aiEditPreview.value.suggestedText.trim();

  if (!suggestedText) {
    aiEditFeedback.value = "The suggested edit did not contain usable content.";
    return;
  }

  isApplyingAiEdit.value = true;
  aiEditFeedback.value = "";

  try {
    await updateDraftPostContent(suggestedText, "Changes applied and saved to this draft.");
    aiEditPreview.value = null;
  } catch (error) {
    aiEditFeedback.value =
      error instanceof Error ? error.message : "Unable to apply AI changes right now.";
  } finally {
    isApplyingAiEdit.value = false;
  }
}

async function loadWorkspaceChannels(): Promise<void> {
  if (!activeBusinessId.value) {
    socialAccounts.value = [];
    return;
  }

  isLoadingChannels.value = true;

  try {
    const response = await requestSocialAccounts(activeBusinessId.value);
    socialAccounts.value = response.accounts;
  } catch {
    socialAccounts.value = [];
  } finally {
    isLoadingChannels.value = false;
  }
}

async function loadPostAssets(): Promise<void> {
  if (!activeBusinessId.value || !persistedPostId.value) {
    postAssets.value = [];
    return;
  }

  isLoadingPostAssets.value = true;

  try {
    const response = await requestPostAssets(activeBusinessId.value, persistedPostId.value);
    postAssets.value = response.assets;
  } catch (error) {
    postAssets.value = [];
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to load attached media.";
  } finally {
    isLoadingPostAssets.value = false;
  }
}

function buildVisualBulletPoints(): string[] {
  return previewBodyParagraphs.value
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0)
    .slice(0, 3)
    .map((paragraph) =>
      paragraph.length > 96 ? `${paragraph.slice(0, 93).trimEnd()}...` : paragraph,
    );
}

function buildGeneratedMediaFileName(
  suggestion: MediaRecommendationSuggestion,
  options?: { slideIndex?: number },
): string {
  const base =
    (draft.value?.result.idea.title || "generated-visual")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "generated-visual";
  const suffix = suggestion.suggestedMediaType || suggestion.visualTemplateType || "visual";
  const slideSuffix =
    typeof options?.slideIndex === "number" ? `-slide-${options.slideIndex + 1}` : "";

  return `${base}-${suffix}${slideSuffix}.png`;
}

function buildVisualAttachmentFeedback(
  successMessage: string,
  generatedVisual: GenerateVisualResponse,
): string {
  return generatedVisual.brandConsistency.tone === "review"
    ? `${successMessage} ${generatedVisual.brandConsistency.summary}`
    : successMessage;
}

async function uploadGeneratedBlobToPost(input: {
  persistedId: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
}): Promise<PostAsset> {
  const uploadTarget = await requestMediaUploadUrl({
    businessId: activeBusinessId.value,
    postId: input.persistedId,
    fileType: input.mimeType,
    fileName: input.fileName,
    sizeBytes: input.blob.size,
  });

  const uploadResponse = await fetch(uploadTarget.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": input.mimeType,
    },
    body: input.blob,
  });

  if (!uploadResponse.ok) {
    throw new Error("Unable to upload the generated visual to storage.");
  }

  const response = await requestCreatePostAsset({
    businessId: activeBusinessId.value,
    postId: input.persistedId,
    storageKey: uploadTarget.storageKey,
    storageUrl: uploadTarget.storageUrl,
    mimeType: input.mimeType,
    sizeBytes: input.blob.size,
    source: "generated",
  });

  return response.asset;
}

async function loadMediaRecommendations(): Promise<void> {
  if (!activeBusinessId.value || !postContent.value.trim()) {
    mediaRecommendations.value = [];
    return;
  }

  isLoadingMediaRecommendations.value = true;

  try {
    const response = await requestMediaRecommendations({
      businessId: activeBusinessId.value,
      contentText: postContent.value,
      contentType: "post",
      goal: isBusinessMode.value ? "conversion" : "authority",
      sourceAssetIds: postAssets.value.map((asset) => asset.id),
    });

    mediaRecommendations.value = response.suggestions;
    if (response.suggestions.filter((suggestion) => suggestion.actionType !== "skip").length === 0) {
      mediaFeedback.value = "No strong visual match yet. You can still generate media manually.";
    }
  } catch (error) {
    mediaRecommendations.value = [];
    mediaFeedback.value =
      error instanceof Error && error.message.trim() !== ""
        ? `${error.message} You can still generate media manually.`
        : "No strong visual match yet. You can still generate media manually.";
  } finally {
    isLoadingMediaRecommendations.value = false;
  }
}

async function openGenerateMediaOptions(): Promise<void> {
  await nextTick();
  mediaRecommendationPanelRef.value?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });

  if (isUsingFallbackMediaRecommendations.value) {
    mediaFeedback.value = "No strong visual match yet. You can still generate media manually.";
  }
}

async function handleMediaSelection(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);

  if (!files.length) {
    return;
  }

  if (!activeBusinessId.value) {
    mediaFeedback.value = "Select a workspace before attaching media.";
    input.value = "";
    return;
  }

  isUploadingPostAssets.value = true;
  mediaFeedback.value = "";

  try {
    const persistedId = await ensurePersistedDraft();

    if (!persistedId) {
      mediaFeedback.value = "Save this draft first, then attach media.";
      return;
    }

    for (const file of files) {
      const uploadTarget = await requestMediaUploadUrl({
        businessId: activeBusinessId.value,
        postId: persistedId,
        fileType: file.type,
        fileName: file.name,
        sizeBytes: file.size,
      });

      const uploadResponse = await fetch(uploadTarget.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Upload to storage failed. Check bucket CORS and try again.");
      }

      await requestCreatePostAsset({
        businessId: activeBusinessId.value,
        postId: persistedId,
        storageKey: uploadTarget.storageKey,
        storageUrl: uploadTarget.storageUrl,
        mimeType: file.type,
        sizeBytes: file.size,
        source: "upload",
      });
    }

    await loadPostAssets();
    mediaFeedback.value = `${files.length} media asset${files.length === 1 ? "" : "s"} attached to this draft.`;
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to attach media right now.";
  } finally {
    isUploadingPostAssets.value = false;
    input.value = "";
  }
}

async function attachWorkspaceAssets(assets: WorkspaceAsset[]): Promise<void> {
  if (!activeBusinessId.value) {
    mediaFeedback.value = "Select a workspace before attaching workspace assets.";
    return;
  }

  isUploadingPostAssets.value = true;
  mediaFeedback.value = "";

  try {
    const persistedId = await ensurePersistedDraft();
    let attachedCount = 0;

    if (!persistedId) {
      mediaFeedback.value = "Save this draft first, then attach workspace assets.";
      return;
    }

    for (const asset of assets) {
      if (!asset.storageKey || (!asset.mimeType.startsWith("image/") && asset.mimeType !== "video/mp4")) {
        continue;
      }

      await requestCreatePostAsset({
        businessId: activeBusinessId.value,
        postId: persistedId,
        storageKey: asset.storageKey,
        storageUrl: asset.storageUrl,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        source: asset.sourceType === "generated" ? "generated" : "upload",
      });
      attachedCount += 1;
    }

    if (attachedCount === 0) {
      mediaFeedback.value = "Only image and MP4 workspace assets can be attached to post drafts right now.";
      return;
    }

    await loadPostAssets();
    mediaFeedback.value = `${attachedCount} workspace asset${attachedCount === 1 ? "" : "s"} attached to this draft.`;
    isWorkspaceAssetPickerOpen.value = false;
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to attach workspace assets right now.";
  } finally {
    isUploadingPostAssets.value = false;
  }
}

async function generateRecommendedMedia(
  suggestion: MediaRecommendationSuggestion,
): Promise<void> {
  if (!activeBusinessId.value || !suggestion.visualTemplateType) {
    return;
  }

  isGeneratingRecommendationId.value = suggestion.id;
  mediaFeedback.value = "";

  try {
    const persistedId = await ensurePersistedDraft();

    if (!persistedId) {
      mediaFeedback.value = "Save this draft first, then generate media.";
      return;
    }

    const currentVisualNarrative = visualNarrative.value
      ?? normalizeContentNarrative(undefined, {
        title: draft.value?.result.idea.title || "Founder insight",
        subtitle: draft.value?.result.idea.angle || "Turn this idea into a stronger narrative.",
      });
    const coverSlide = currentVisualNarrative.slides[0];
    const generatedVisual = await requestVisualGeneration({
      businessId: activeBusinessId.value,
      templateType: suggestion.visualTemplateType,
      content: {
        headline:
          coverSlide?.headline ||
          previewLeadLines.value[0] ||
          draft.value?.result.idea.title ||
          "Founder insight",
        supportingText:
          coverSlide?.supportingText ||
          businessOutput.value?.visual.subheadline ||
          previewLeadLines.value[1] ||
          previewBodyParagraphs.value[0]?.replace(/\s+/g, " ").trim().slice(0, 140) ||
          undefined,
        bulletPoints:
          suggestion.visualTemplateType === "carousel"
            ? coverSlide?.bulletPoints || buildVisualBulletPoints()
            : buildVisualBulletPoints(),
        sceneDescription:
          suggestion.suggestedMediaType === "photo_overlay"
            ? businessOutput.value?.visual.imagePrompt
            : undefined,
        closingText:
          suggestion.suggestedMediaType === "photo_overlay"
            ? businessOutput.value?.cta.label
            : undefined,
      },
      narrative:
        suggestion.visualTemplateType === "carousel"
          ? {
              ...currentVisualNarrative,
              sourceText: postContent.value,
            }
          : undefined,
      mediaPresetId: suggestion.mediaPresetId,
      promptTemplateId: suggestion.promptTemplateId,
      generatedMediaType: suggestion.suggestedMediaType,
      contentAssetId: persistedId,
      sourceAssetIds: suggestion.recommendedAssetIds,
    });

    if (suggestion.visualTemplateType === "carousel") {
      if (!generatedVisual.narrative || generatedVisual.narrative.slides.length === 0) {
        throw new Error("Unable to generate a carousel from this post right now.");
      }

      if (!generatedVisual.narrative.slides.every((slide) => isUploadableGeneratedMimeType(slide.mimeType))) {
        throw new Error("The carousel was generated in preview mode only. Re-run once PNG or JPG generation is available to attach every slide.");
      }

      const uploadedNarrativeSlides: ContentNarrativeSlide[] = [];

      for (const [index, slide] of generatedVisual.narrative.slides.entries()) {
        const imageDataUrl = slide.imageDataUrl;

        if (!imageDataUrl) {
          throw new Error("One of the generated slides did not include a renderable image.");
        }

        const blob = await fetch(imageDataUrl).then(async (response) => {
          if (!response.ok) {
            throw new Error("Unable to convert one of the generated slides into an uploadable file.");
          }

          return response.blob();
        });

        const asset = await uploadGeneratedBlobToPost({
          persistedId,
          fileName: buildGeneratedMediaFileName(suggestion, { slideIndex: index }),
          mimeType: slide.mimeType || generatedVisual.mimeType,
          blob,
        });

        uploadedNarrativeSlides.push({
          ...slide,
          assetId: asset.id,
        });
      }

      const nextVisualNarrative = mapPersistableNarrative({
        format: "carousel",
        type: generatedVisual.narrative.type,
        title: generatedVisual.narrative.title,
        subtitle: generatedVisual.narrative.subtitle,
        slides: uploadedNarrativeSlides,
      });
      await updateDraftVisualNarrative(nextVisualNarrative);
      await loadPostAssets();
      mediaFeedback.value = buildVisualAttachmentFeedback(
        `Generated ${generatedVisual.narrative.slides.length} ${formatCarouselNarrativeLabel(generatedVisual.narrative.type).toLowerCase()} slide${generatedVisual.narrative.slides.length === 1 ? "" : "s"} and attached them to this draft.`,
        generatedVisual,
      );
      return;
    }

    if (!isUploadableGeneratedMimeType(generatedVisual.mimeType)) {
      throw new Error("This visual came back as a preview-only SVG. Re-run once PNG or JPG generation is available to attach it.");
    }

    const blob = await fetch(generatedVisual.imageDataUrl).then(async (response) => {
      if (!response.ok) {
        throw new Error("Unable to convert the generated visual into an uploadable file.");
      }

      return response.blob();
    });

    await uploadGeneratedBlobToPost({
      persistedId,
      fileName: buildGeneratedMediaFileName(suggestion),
      mimeType: generatedVisual.mimeType,
      blob,
    });

    await loadPostAssets();
    mediaFeedback.value = buildVisualAttachmentFeedback(
      `${getMediaSuggestionTitle(suggestion)} attached to this draft.`,
      generatedVisual,
    );
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to generate media right now.";
  } finally {
    isGeneratingRecommendationId.value = "";
  }
}

async function applyMediaRecommendation(
  suggestion: MediaRecommendationSuggestion,
): Promise<void> {
  if (suggestion.actionType === "use_existing_asset") {
    isWorkspaceAssetPickerOpen.value = true;
    mediaFeedback.value = "Pick an existing workspace asset to use for this post.";
    return;
  }

  if (suggestion.actionType === "skip") {
    mediaFeedback.value = "Kept this draft text-first for now.";
    return;
  }

  await generateRecommendedMedia(suggestion);
}

async function removePostAsset(assetId: string): Promise<void> {
  if (!activeBusinessId.value) {
    return;
  }

  removingPostAssetId.value = assetId;
  mediaFeedback.value = "";

  try {
    await requestDeletePostAsset(activeBusinessId.value, assetId);
    postAssets.value = postAssets.value.filter((asset) => asset.id !== assetId);
    mediaFeedback.value = "Media removed from this draft.";
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to remove this asset.";
  } finally {
    removingPostAssetId.value = "";
  }
}

function syncScheduleFormFromSlot(scheduledAt: string, timezone: string): void {
  scheduleDateKey.value = toDateKeyInTimezone(scheduledAt, timezone);
  scheduleTime.value = toTimeValueInTimezone(scheduledAt, timezone);
}

function seedScheduleForm(): void {
  const timezone = audienceTimezone.value || userTimezone;
  const next = new Date();
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  audienceTimezone.value = timezone;
  scheduleDateKey.value = toDateKeyInTimezone(next, timezone);
  scheduleTime.value = toTimeValueInTimezone(next, timezone);
}

async function loadRecommendedScheduleSlots(preferredTimezone?: string): Promise<void> {
  if (!auth.isReady.value || !auth.isAuthenticated.value || !activeBusinessId.value) {
    recommendedSlots.value = [];
    return;
  }

  isLoadingRecommendedSlots.value = true;
  scheduleFeedback.value = "";

  try {
    const response = await requestRecommendedPostTimes(
      activeBusinessId.value,
      recommendedContentType.value,
      preferredTimezone,
    );

    recommendedSlots.value = response.slots;
    recommendedTimezone.value = response.timezone;

    if (!audienceTimezone.value || preferredTimezone) {
      audienceTimezone.value = preferredTimezone || response.timezone;
    }

    if (response.slots[0]) {
      syncScheduleFormFromSlot(response.slots[0].scheduledAt, audienceTimezone.value || response.timezone);
    }
  } catch (error) {
    recommendedSlots.value = [];
    scheduleFeedback.value =
      error instanceof Error ? error.message : "Unable to load the best posting window.";
  } finally {
    isLoadingRecommendedSlots.value = false;
  }
}

async function openSchedulePanel(): Promise<void> {
  if (!schedulerEnabled.value) {
    feedbackMessage.value = "Scheduling is not enabled for this workspace.";
    return;
  }

  if (!canPublishSelectedPlatforms.value) {
    feedbackMessage.value = "Select at least one publishable platform before scheduling.";
    return;
  }

  if (selectedSchedulingCapacityGuardrail.value) {
    feedbackMessage.value = selectedSchedulingCapacityGuardrail.value;
    return;
  }

  try {
    const persistedId = await ensurePersistedDraft();

    if (!persistedId) {
      return;
    }
  } catch (error) {
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to save this draft right now.";
    return;
  }

  isSchedulePanelOpen.value = true;
  scheduleFeedback.value = "";

  if (!scheduleDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    seedScheduleForm();
  }

  await loadRecommendedScheduleSlots(audienceTimezone.value || undefined);
}

function closeSchedulePanel(): void {
  isSchedulePanelOpen.value = false;
  scheduleFeedback.value = "";
}

function applyRecommendedSchedule(): void {
  if (!bestRecommendedSlot.value) {
    return;
  }

  const timezone = audienceTimezone.value || recommendedTimezone.value || userTimezone;
  syncScheduleFormFromSlot(bestRecommendedSlot.value.scheduledAt, timezone);
  scheduleFeedback.value = `Best time applied for ${timezone}.`;
}

async function scheduleDraft(): Promise<void> {
  if (!draft.value) {
    scheduleFeedback.value = "Generate a post first.";
    return;
  }

  if (!activeBusinessId.value) {
    scheduleFeedback.value = "Select a workspace before scheduling.";
    return;
  }

  if (!scheduleDateKey.value || !scheduleTime.value || !audienceTimezone.value) {
    scheduleFeedback.value = "Pick a date, time, and audience timezone first.";
    return;
  }

  if (!canPublishSelectedPlatforms.value) {
    scheduleFeedback.value = "Select at least one publishable platform before scheduling.";
    return;
  }

  if (queueLimitReached.value) {
    scheduleFeedback.value = queueLimitPrompt.value;
    return;
  }

  if (selectedSchedulingCapacityGuardrail.value) {
    scheduleFeedback.value = selectedSchedulingCapacityGuardrail.value;
    return;
  }

  isSchedulingDraft.value = true;
  scheduleFeedback.value = "";
  feedbackMessage.value = "";

  try {
    const ensuredPostId = await ensurePersistedDraft();

    if (!ensuredPostId) {
      scheduleFeedback.value = "Unable to save this draft before scheduling it.";
      return;
    }

    const scheduledAt = convertZonedDateTimeToUtcIso(
      scheduleDateKey.value,
      scheduleTime.value,
      audienceTimezone.value,
    );
    const successes: PublishableSocialPlatform[] = [];
    const failures: string[] = [];

    for (const platform of selectedPublishingPlatforms.value) {
      const scheduleRequest = {
        businessId: activeBusinessId.value,
        platform,
        contentText: postContent.value,
        assetGroupId: ensuredPostId,
        slides: [],
        scheduledAt,
        audienceTimezone: audienceTimezone.value,
      };

      try {
        try {
          await requestSchedulePost(scheduleRequest);
        } catch (error) {
          const warnings = extractSchedulingWarnings(error);

          if (warnings.length === 0 || !confirmSchedulingWarnings(warnings)) {
            throw error;
          }

          await requestSchedulePost({
            ...scheduleRequest,
            ignoreSafetyWarnings: true,
          });
          feedbackMessage.value = selectedDispatchWindowLabel.value
            ? `Queued for dispatch with a manual safety override. Dispatch window: ${selectedDispatchWindowLabel.value}.`
            : "Queued for dispatch with a manual safety override.";
        }

        successes.push(platform);
      } catch (error) {
        failures.push(
          `${resolveSocialPlatformLabel(platform)}: ${error instanceof Error ? error.message : "Unable to schedule."}`,
        );
      }
    }

    if (successes.length === 0) {
      scheduleFeedback.value = failures[0] ?? "Unable to schedule this draft right now.";
      return;
    }

    const refreshedAccess = await refreshProductAccess(activeBusinessId.value);
    const queueFilledByThisSchedule =
      refreshedAccess?.limits?.scheduledQueueLimit !== null
      && refreshedAccess?.limits?.scheduledQueueRemaining === 0;

    isSchedulePanelOpen.value = false;
    if (!feedbackMessage.value) {
      const scheduledPlatformLabel = formatSelectedPlatformsLabel(successes);
      feedbackMessage.value = queueFilledByThisSchedule
        ? `Nice — your post is queued for ${scheduledPlatformLabel} on ${selectedAudienceDateLabel.value} at ${selectedAudienceTimeLabel.value}. Upgrade to plan the rest of your week.`
        : selectedDispatchWindowLabel.value
          ? `Queued for ${scheduledPlatformLabel} on ${selectedAudienceDateLabel.value} at ${selectedAudienceTimeLabel.value}. Dispatch window: ${selectedDispatchWindowLabel.value}.`
          : `Queued for ${scheduledPlatformLabel} on ${selectedAudienceDateLabel.value} at ${selectedAudienceTimeLabel.value}. Open planner to manage it.`;
    }

    if (failures.length > 0) {
      feedbackMessage.value = `${feedbackMessage.value} Failed: ${failures.join(" · ")}`;
    }
  } catch (error) {
    scheduleFeedback.value =
      extractScheduledQueueLimitMessage(error)
      ?? (error instanceof Error ? error.message : "Unable to schedule this draft right now.");
  } finally {
    isSchedulingDraft.value = false;
  }
}

async function goToImprove(): Promise<void> {
  if (!draft.value) {
    return;
  }

  await router.push({
    path: appRoutes.appGenerate,
    query: {
      postId: draft.value.id,
    },
  });
}

async function goToOutreach(): Promise<void> {
  if (!draft.value) {
    return;
  }

  await router.push({
    path: appRoutes.appOutreach,
    query: {
      draftId: draft.value.id,
      prefill: postContent.value,
    },
  });
}

async function goToPlanner(): Promise<void> {
  try {
    const ensuredPostId = await ensurePersistedDraft();

    if (!ensuredPostId) {
      return;
    }

    await router.push({
      path: appRoutes.appPlanner,
      query: {
        draftId: ensuredPostId,
        platform: selectedPublishingPlatform.value,
        platforms: selectedPublishingPlatforms.value.join(","),
      },
    });
  } catch (error) {
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to save this draft right now.";
    return;
  }
}

async function goToEmail(): Promise<void> {
  if (!draft.value) {
    return;
  }

  await router.push({
    path: appRoutes.appEmailNew,
    query: {
      draftId: draft.value.id,
      prefill: postContent.value,
    },
  });
}

async function goToGrowth(): Promise<void> {
  if (!draft.value) {
    return;
  }

  try {
    const ensuredPostId = await ensurePersistedDraft();

    if (!ensuredPostId) {
      return;
    }

    await router.push({
      path: appRoutes.appGrowth,
      query: {
        businessId: activeBusinessId.value,
        sourcePlatform: "linkedin",
        sourceAssetId: ensuredPostId,
        sourceAssetTitle: draft.value.result.idea.title,
        prefillNotes: `Engaged from post: ${draft.value.result.idea.title}`,
      },
    });
  } catch (error) {
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to open lead capture right now.";
  }
}

async function goToContinueWriting(
  strategy: RepurposeStrategy = DEFAULT_REPURPOSE_STRATEGY,
): Promise<void> {
  if (!draft.value) {
    return;
  }

  saveRepurposeSeed({
    text: postContent.value,
    title: draft.value.result.idea.title,
    strategy,
    autoGenerate: true,
    source: "result",
  });

  await router.push({
    path: appRoutes.appCreate,
  });
}

async function generateHashtags(): Promise<void> {
  if (!postContent.value.trim()) {
    hashtagFeedback.value = "Generate a post first.";
    return;
  }

  isGeneratingHashtags.value = true;
  hashtagFeedback.value = "";

  try {
    const response = await requestGeneratedHashtags({
      businessId: activeBusinessId.value || undefined,
      contentText: postContent.value,
      contentType: "text",
      targetCount: 4,
    });

    generatedHashtags.value = response.hashtags;
    captionWithHashtags.value = response.captionWithHashtags;
    hashtagFeedback.value = `Generated ${response.hashtags.length} hashtag${response.hashtags.length === 1 ? "" : "s"} for this post.`;
  } catch (error) {
    hashtagFeedback.value =
      error instanceof Error ? error.message : "Unable to generate hashtags right now.";
  } finally {
    isGeneratingHashtags.value = false;
  }
}

async function applyGeneratedHashtags(): Promise<void> {
  const nextContent =
    captionWithHashtags.value.trim() ||
    `${postContent.value.trim()}\n\n${generatedHashtags.value.join(" ")}`.trim();

  if (!nextContent) {
    hashtagFeedback.value = "Generate hashtags first.";
    return;
  }

  if (postContent.value.trim() === nextContent) {
    hashtagFeedback.value = "These hashtags are already applied to the draft.";
    return;
  }

  try {
    await updateDraftPostContent(nextContent, "Hashtags added to this draft.");
    hashtagFeedback.value = "Hashtags appended to the end of the post.";
  } catch (error) {
    hashtagFeedback.value =
      error instanceof Error ? error.message : "Unable to apply hashtags right now.";
  }
}

async function copyHashtagCaption(): Promise<void> {
  const value =
    captionWithHashtags.value.trim() ||
    `${postContent.value.trim()}\n\n${generatedHashtags.value.join(" ")}`.trim();

  if (!value) {
    hashtagFeedback.value = "Generate hashtags first.";
    return;
  }

  await copyCustomText(value, {
    successMessage: "Copied the caption with hashtags.",
    failureMessage: "Unable to copy the caption with hashtags.",
    target: "hashtags",
  });
}

async function copyConversationPrompt(prompt: string): Promise<void> {
  await copyCustomText(prompt, {
    successMessage: "Copied interaction prompt.",
    failureMessage: "Unable to copy interaction prompt.",
    target: "growth",
  });
}

async function connectLinkedIn(): Promise<void> {
  if (!activeBusinessId.value) {
    feedbackMessage.value = "Select a workspace before connecting LinkedIn.";
    return;
  }

  isConnectingLinkedIn.value = true;
  feedbackMessage.value = "";

  try {
    const response = await requestLinkedInSocialAuthStart({
      businessId: activeBusinessId.value,
      returnPath: route.fullPath,
    });
    window.location.assign(response.authorizationUrl);
  } catch (error) {
    isConnectingLinkedIn.value = false;
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to start LinkedIn connection.";
  }
}

async function connectInstagram(): Promise<void> {
  if (!activeBusinessId.value) {
    feedbackMessage.value = "Select a workspace before connecting Instagram.";
    return;
  }

  isConnectingMeta.value = true;
  feedbackMessage.value = "";

  try {
    const response = await requestMetaSocialAuthStart({
      businessId: activeBusinessId.value,
      platform: "instagram",
      returnPath: route.fullPath,
    });
    window.location.assign(response.authorizationUrl);
  } catch (error) {
    isConnectingMeta.value = false;
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to start Meta connection.";
  }
}

async function connectFacebook(): Promise<void> {
  if (!activeBusinessId.value) {
    feedbackMessage.value = "Select a workspace before connecting Facebook.";
    return;
  }

  isConnectingMeta.value = true;
  feedbackMessage.value = "";

  try {
    const response = await requestMetaSocialAuthStart({
      businessId: activeBusinessId.value,
      platform: "facebook",
      returnPath: route.fullPath,
    });
    window.location.assign(response.authorizationUrl);
  } catch (error) {
    isConnectingMeta.value = false;
    feedbackMessage.value =
      error instanceof Error ? error.message : "Unable to start Meta connection.";
  }
}

async function connectSelectedPlatform(): Promise<void> {
  if (selectedPublishingPlatform.value === "instagram") {
    await connectInstagram();
    return;
  }

  if (selectedPublishingPlatform.value === "facebook") {
    await connectFacebook();
    return;
  }

  await connectLinkedIn();
}

function closeMetaSelectionModal(): void {
  isMetaSelectionModalOpen.value = false;
  pendingMetaSession.value = "";
  isConnectingMeta.value = false;
}

async function handleMetaConnected(): Promise<void> {
  closeMetaSelectionModal();
  feedbackMessage.value =
    selectedPublishingPlatform.value === "facebook"
      ? "Facebook connected. Your post is ready to publish."
      : "Instagram connected. Your post is ready for image publishing.";
  await loadWorkspaceChannels();
}

function handleMetaSelectionError(message: string): void {
  feedbackMessage.value = message;
  isConnectingMeta.value = false;
}

async function publishToSelectedPlatforms(): Promise<void> {
  await publishToPlatforms(selectedPublishingPlatforms.value, { mode: "all" });
}

async function triggerPrimaryPublishAction(): Promise<void> {
  if (!canPublishSelectedPlatforms.value) {
    await connectSelectedPlatform();
    return;
  }

  if (shouldUseRetryFailedAsPrimaryAction.value) {
    await retryFailedPlatforms();
    return;
  }

  await publishToSelectedPlatforms();
}

async function retryFailedPlatforms(): Promise<void> {
  const failedPlatforms = selectedPublishFailureResults.value.map((result) => result.platform);

  if (failedPlatforms.length === 0) {
    return;
  }

  await publishToPlatforms(failedPlatforms, { mode: "retry_failed" });
}

async function publishToPlatforms(
  platforms: PublishableSocialPlatform[],
  options: { mode: "all" | "retry_failed" },
): Promise<void> {
  if (!draft.value) {
    return;
  }

  if (!activeBusinessId.value) {
    feedbackMessage.value = "Select a workspace before publishing.";
    return;
  }

  if (platforms.length === 0) {
    feedbackMessage.value = "Select at least one publishable platform before posting.";
    return;
  }

  isPublishingToLinkedIn.value = true;
  feedbackMessage.value = "";

  try {
    const ensuredPostId = await ensurePersistedDraft();

    if (!ensuredPostId) {
      feedbackMessage.value = "Unable to save this draft before publishing it.";
      return;
    }

    const attempt =
      options.mode === "retry_failed" && currentPublishAttemptId.value
        ? (
          await requestRetryFailedPublishAttempt(currentPublishAttemptId.value, {
            businessId: activeBusinessId.value,
            contentText: postContent.value,
            assetId: ensuredPostId,
            title: draft.value.result.idea.title,
          })
        ).publishAttempt
        : (
          await requestCreatePublishAttempt({
            businessId: activeBusinessId.value,
            platforms,
            contentText: postContent.value,
            assetId: ensuredPostId,
            title: draft.value.result.idea.title,
          })
        ).publishAttempt;

    applyPublishAttempt(attempt, { merge: options.mode === "retry_failed" });

    const relevantResults = attempt.platforms
      .filter((result) => platforms.includes(result.platform as PublishableSocialPlatform))
      .map((result) => mapPublishAttemptResult(result, attempt.id));
    const successes = relevantResults
      .filter((result) => result.status === "success")
      .map((result) => ({
        platform: result.platform,
        url: result.externalPostUrl ?? "",
      }));
    const failures = relevantResults
      .filter((result) => result.status === "failed")
      .map((result) => `${resolveSocialPlatformLabel(result.platform)}: ${result.message}`);

    if (successes.length === 0) {
      const baseMessage = failures[0] ?? "Unable to publish right now.";

      if (options.mode === "retry_failed") {
        feedbackMessage.value = baseMessage;
        return;
      }

      const copied = await copyPost({ silent: true });
      feedbackMessage.value = copied ? `${baseMessage} Optimized caption copied instead.` : baseMessage;
      return;
    }

    const publishedPlatforms = formatSelectedPlatformsLabel(successes.map((success) => success.platform));
    feedbackMessage.value = options.mode === "retry_failed"
      ? failures.length === 0
        ? `Retried successfully on ${publishedPlatforms}.`
        : `Recovered ${publishedPlatforms}.`
      : successes.length === 1
        ? `Posted to ${publishedPlatforms}. ${successes[0].url}`
        : `Posted to ${publishedPlatforms}.`;

    if (failures.length > 0) {
      feedbackMessage.value = `${feedbackMessage.value} Failed: ${failures.join(" · ")}`;
    }
  } catch (error) {
    const copied = await copyPost({ silent: true });
    const baseMessage = getPublishFailureMessage(error, selectedPublishingPlatform.value);

    feedbackMessage.value = copied
      ? `${baseMessage} Optimized caption copied instead.`
      : baseMessage;
  } finally {
    isPublishingToLinkedIn.value = false;
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || !draft.value) {
    return;
  }

  const normalizedKey = event.key.toLowerCase();

  if (normalizedKey === "e") {
    event.preventDefault();
    void goToEmail();
    return;
  }

  if (normalizedKey === "o") {
    event.preventDefault();
    void goToOutreach();
  }
}

watch(
  () => [route.query.id, activeBusinessId.value],
  () => {
    void loadDraft();
  },
  { immediate: true },
);

watch(
  () => activeBusinessId.value,
  () => {
    void loadWorkspaceChannels();
  },
  { immediate: true },
);

watch(
  () => [activeBusinessId.value, persistedPostId.value],
  () => {
    void loadPostAssets();
  },
  { immediate: true },
);

watch(
  () => [activeBusinessId.value, persistedPostId.value],
  () => {
    void loadPersistedPublishAttemptResults();
  },
  { immediate: true },
);

watch(
  () => [activeBusinessId.value, postContent.value, postAssets.value.length],
  () => {
    void loadMediaRecommendations();
  },
  { immediate: true },
);

watch(
  () => audienceTimezone.value,
  (nextTimezone, previousTimezone) => {
    if (!isSchedulePanelOpen.value || !nextTimezone || nextTimezone === previousTimezone) {
      return;
    }

    void loadRecommendedScheduleSlots(nextTimezone);
  },
);

watch(
  selectablePublishingPlatforms,
  (nextSelectable) => {
    const nextSelected = PUBLISHABLE_SOCIAL_PLATFORMS.filter(
      (platform) =>
        nextSelectable.includes(platform) && selectedPublishingPlatforms.value.includes(platform),
    );

    if (
      nextSelected.length !== selectedPublishingPlatforms.value.length
      || nextSelected.some((platform, index) => platform !== selectedPublishingPlatforms.value[index])
    ) {
      selectedPublishingPlatforms.value = nextSelected;
    }

    if (
      selectedPublishingPlatforms.value.length > 0
      && !selectedPublishingPlatforms.value.includes(selectedPublishingPlatform.value)
    ) {
      selectedPublishingPlatform.value = selectedPublishingPlatforms.value[0];
    }
  },
  { immediate: true },
);

watch(
  () => [route.query.linkedin, route.query.meta, route.query.message, route.query.session, route.query.platform, route.query.platforms],
  async ([linkedInStatus, metaStatus, message, session, platform, platforms]) => {
    if (
      typeof linkedInStatus !== "string"
      && typeof metaStatus !== "string"
      && typeof message !== "string"
      && typeof session !== "string"
      && typeof platform !== "string"
      && typeof platforms !== "string"
    ) {
      return;
    }

    const incomingPlatforms = parsePublishableSocialPlatforms(platforms);

    if (incomingPlatforms.length > 0) {
      selectedPublishingPlatforms.value = incomingPlatforms.filter(
        (candidate) => resolvePublishingGuardrail(candidate) === "",
      );
    }

    const incomingPlatform = parsePublishableSocialPlatform(platform);

    if (incomingPlatform) {
      selectedPublishingPlatform.value = incomingPlatform;
      if (
        resolvePublishingGuardrail(incomingPlatform) === ""
        && !selectedPublishingPlatforms.value.includes(incomingPlatform)
      ) {
        selectedPublishingPlatforms.value = [
          ...selectedPublishingPlatforms.value,
          incomingPlatform,
        ];
      }
    }

    if (linkedInStatus === "connected") {
      feedbackMessage.value = "LinkedIn connected. Your post is ready to publish.";
      await loadWorkspaceChannels();
    } else if (linkedInStatus === "error") {
      feedbackMessage.value =
        typeof message === "string" && message.trim() !== ""
          ? toFriendlySocialAuthMessage(message, "linkedin")
          : toFriendlySocialAuthMessage(undefined, "linkedin");
    }

    if (metaStatus === "connected") {
      feedbackMessage.value =
        selectedPublishingPlatform.value === "facebook"
          ? "Facebook connected. Your post is ready to publish."
          : "Instagram connected. Your post is ready for image publishing.";
      await loadWorkspaceChannels();
      isConnectingMeta.value = false;
    } else if (metaStatus === "error") {
      feedbackMessage.value =
        typeof message === "string" && message.trim() !== ""
          ? toFriendlySocialAuthMessage(message, selectedPublishingPlatform.value === "facebook" ? "facebook" : "instagram")
          : toFriendlySocialAuthMessage(undefined, selectedPublishingPlatform.value === "facebook" ? "facebook" : "instagram");
      isConnectingMeta.value = false;
    } else if (metaStatus === "select_page" && typeof session === "string" && session.trim() !== "") {
      pendingMetaSession.value = session.trim();
      isMetaSelectionModalOpen.value = true;
      isConnectingMeta.value = false;
    }

    const nextQuery = { ...route.query };
    delete nextQuery.linkedin;
    delete nextQuery.meta;
    delete nextQuery.message;
    delete nextQuery.session;
    delete nextQuery.platform;
    delete nextQuery.platforms;
    void router.replace({ query: nextQuery });
    isConnectingLinkedIn.value = false;
  },
  { immediate: true },
);

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <main class="result-shell">
    <template v-if="draft">
      <section class="result-hero">
        <p class="result-eyebrow">/app/result</p>
        <h1>
          {{
            businessWeeklyPlan
              ? "Your weekly campaign plan is ready."
              : isBusinessMode
                ? "Your campaign pack is ready."
                : "Your post is ready."
          }}
        </h1>
        <p class="result-description">
          {{
            businessWeeklyPlan
              ? "Review the 7-day plan, tighten the headlines, and turn the best items into channel-ready campaigns."
              : isBusinessMode
              ? "Review the visual direction, platform captions, CTA, and email copy without rebuilding the campaign by hand."
              : "This is the activation moment: improve the draft, send it into outreach, or turn it into an email without rewriting from scratch."
          }}
        </p>
        <p v-if="hasPersistedAsset" class="result-persistence-note">
          Saved as a draft in this workspace. Improve it, send it, or publish it without creating a
          duplicate post.
        </p>
      </section>

      <section class="result-grid">
        <article class="result-post-card">
          <div class="result-card-header">
            <div>
              <p class="panel-meta">
                {{
                  businessWeeklyPlan
                    ? "Generated weekly plan"
                    : isBusinessMode
                      ? "Generated campaign"
                      : "Generated post"
                }}
              </p>
              <h2>{{ businessOutput?.visual.headline || businessWeeklyPlan?.days[0]?.headline || draft.result.idea.title }}</h2>
            </div>
            <div class="score-badge" :data-tone="attentionSignal.tone">
              Attention {{ attentionSignal.label }} · {{ postScore }}/100
            </div>
          </div>

          <p v-if="quickSignals" class="signal-line">
            <span>{{ quickSignals.readyLabel }}</span>
            <span>{{ quickSignals.formatLabel }}</span>
          </p>
          <p v-if="povSummary" class="signal-line">
            <span>{{ povSummary }}</span>
            <span v-if="qualitySummary">POV quality {{ qualitySummary.overall }}/100</span>
          </p>

          <section v-if="businessWeeklyPlan" class="execution-status-grid">
            <article
              v-for="day in businessWeeklyPlan.days"
              :key="`weekly-plan-${day.dayNumber}`"
              class="execution-status-block"
            >
              <p class="panel-meta">Day {{ day.dayNumber }} · {{ day.theme }}</p>
              <strong>{{ day.headline }}</strong>
              <p class="execution-status-description">{{ day.summary }}</p>
              <p v-if="day.cta" class="panel-note">CTA: {{ day.cta }}</p>
            </article>
          </section>

          <section v-if="isBusinessMode && businessOutput" class="result-signal-grid">
            <article class="result-signal-card">
              <p class="panel-meta">Visual brief</p>
              <strong>{{ businessOutput.visual.headline }}</strong>
              <span>{{ businessOutput.visual.visualDirection || businessOutput.visual.subheadline || "Headline-first creative ready for generation." }}</span>
            </article>
            <article class="result-signal-card">
              <p class="panel-meta">CTA</p>
              <strong>{{ businessOutput.cta.label }}</strong>
              <span>{{ businessOutput.cta.url }}</span>
            </article>
            <article class="result-signal-card">
              <p class="panel-meta">Channels</p>
              <strong>
                {{
                  [
                    businessOutput.captions.instagram ? "Instagram" : "",
                    businessOutput.captions.facebook ? "Facebook" : "",
                    businessOutput.email ? "Email" : "",
                  ].filter(Boolean).join(" + ")
                }}
              </strong>
              <span>Campaign copy is already adapted per destination.</span>
            </article>
          </section>

          <section v-if="isBusinessMode && businessOutput" class="execution-status-grid">
            <article v-if="businessOutput.hooks?.length" class="execution-status-block">
              <p class="panel-meta">Hook options</p>
              <ul class="result-bullet-list">
                <li v-for="hook in businessOutput.hooks" :key="hook">{{ hook }}</li>
              </ul>
            </article>

            <article class="execution-status-block">
              <p class="panel-meta">Instagram caption</p>
              <p class="execution-status-description">
                {{ businessOutput.captions.instagram || "Instagram was not selected for this pack." }}
              </p>
            </article>

            <article class="execution-status-block">
              <p class="panel-meta">Facebook caption</p>
              <p class="execution-status-description">
                {{ businessOutput.captions.facebook || "Facebook was not selected for this pack." }}
              </p>
            </article>

            <article v-if="businessOutput.email" class="execution-status-block">
              <p class="panel-meta">Email subject</p>
              <strong>{{ businessOutput.email.subject }}</strong>
              <p class="execution-status-description">{{ businessOutput.email.body }}</p>
            </article>

            <article v-if="businessOutput.cta.alternatives?.length" class="execution-status-block">
              <p class="panel-meta">CTA options</p>
              <ul class="result-bullet-list">
                <li v-for="option in businessOutput.cta.alternatives" :key="option">{{ option }}</li>
              </ul>
            </article>

            <article v-if="businessOutput.hashtags?.length" class="execution-status-block">
              <p class="panel-meta">Hashtags</p>
              <p class="execution-status-description">{{ businessOutput.hashtags.join(" ") }}</p>
            </article>

            <article class="execution-status-block">
              <p class="panel-meta">Image prompt</p>
              <p class="execution-status-description">{{ businessOutput.visual.imagePrompt }}</p>
            </article>
          </section>

          <section class="result-signal-grid">
            <article class="result-signal-card" :data-tone="attentionSignal.tone">
              <p class="panel-meta">Attention signal</p>
              <strong>{{ attentionSignal.label }}</strong>
              <span>{{ attentionSignal.copy }}</span>
            </article>
            <article class="result-signal-card">
              <p class="panel-meta">Structure</p>
              <strong>{{ structureSignal }}</strong>
              <span>{{ postParagraphs.length }} paragraph{{ postParagraphs.length === 1 ? "" : "s" }} ready for feed reading.</span>
            </article>
            <article v-if="qualitySummary" class="result-signal-card">
              <p class="panel-meta">POV profile</p>
              <strong>{{ draft.result.pov?.boldness || "balanced" }}</strong>
              <span>
                Hook {{ qualitySummary.hookStrength }}/100 · Clarity {{ qualitySummary.clarity }}/100 · Alignment {{ qualitySummary.businessAlignment }}/100
              </span>
            </article>
            <article class="result-signal-card">
              <p class="panel-meta">Best next move</p>
              <strong>{{ actionPriorityLabel }}</strong>
              <span>
                {{
                  canScheduleDraft
                    ? "Lock a slot in planner before the draft loses momentum."
                    : selectedConnectedAccount
                      ? `This draft can publish directly to ${selectedPublishingPlatformLabel} from the workspace.`
                      : `Connect ${selectedPublishingPlatformLabel} first, or keep refining before publishing.`
                }}
              </span>
            </article>
          </section>

          <section class="channel-selector-card">
            <div>
              <p class="panel-meta">Destination</p>
              <strong>Select platforms for this post</strong>
              <p class="shortcut-note">
                Pick one, two, or all three. Instagram stays media-first, Facebook stays flexible, and LinkedIn remains text-first.
              </p>
            </div>

            <div class="channel-selector-grid">
              <article
                v-for="platform in PUBLISHABLE_SOCIAL_PLATFORMS"
                :key="platform"
                class="channel-selector-option"
                :data-focused="selectedPublishingPlatform === platform"
                :data-selected="isPublishingPlatformSelected(platform)"
                :data-disabled="Boolean(resolvePublishingGuardrail(platform))"
                @click="selectedPublishingPlatform = platform"
              >
                <div class="channel-selector-option-topline">
                  <label class="channel-selector-checkbox">
                    <input
                      type="checkbox"
                      :checked="isPublishingPlatformSelected(platform)"
                      :disabled="Boolean(resolvePublishingGuardrail(platform))"
                      @click.stop="togglePublishingPlatform(platform)"
                    />
                    <span>{{ resolveSocialPlatformLabel(platform) }}</span>
                  </label>
                  <span class="channel-selector-state">
                    {{
                      isPublishingPlatformSelected(platform)
                        ? "Selected"
                        : resolvePublishingGuardrail(platform)
                          ? "Unavailable"
                          : "Ready"
                    }}
                  </span>
                </div>
                <p>{{ resolvePublishingPlatformHint(platform) }}</p>
              </article>
            </div>

            <p v-if="selectedSchedulingCapacityGuardrail" class="result-feedback subtle">
              {{ selectedSchedulingCapacityGuardrail }}
            </p>
            <p v-else-if="selectedPublishingGuardrail" class="result-feedback subtle">
              {{ selectedPublishingGuardrail }}
            </p>
          </section>

          <section class="linkedin-feed-preview">
            <div class="linkedin-feed-header">
              <div class="linkedin-feed-avatar">{{ (selectedConnectedAccountLabel || selectedPublishingPlatformLabel).charAt(0).toUpperCase() }}</div>
              <div class="linkedin-feed-identity">
                <strong>{{ selectedConnectedAccountLabel || (selectedPublishingPlatform === "instagram" ? "Your Instagram business account" : selectedPublishingPlatform === "facebook" ? "Your Facebook Page" : "Your LinkedIn profile") }}</strong>
                <p>
                  {{
                    selectedConnectedAccount
                      ? `${selectedPublishingPlatformLabel} ${isBusinessMode ? "campaign" : "post"} preview`
                      : "Workspace preview before publishing"
                  }}
                </p>
              </div>
            </div>

            <div class="linkedin-preview-pills">
              <span v-for="pill in signalPills" :key="pill">{{ pill }}</span>
            </div>

            <div class="linkedin-status-card" :data-connected="Boolean(selectedConnectedAccount) && !selectedPublishingGuardrail">
              <div>
                <p class="panel-meta">{{ selectedPublishingPlatformLabel }} publishing</p>
                <strong>
                  {{
                    selectedPublishingGuardrail
                      ? `${selectedPublishingPlatformLabel} setup needs attention`
                      : selectedConnectedAccount
                      ? "Execution channel is ready"
                      : "Direct publishing not connected"
                  }}
                </strong>
                <p class="linkedin-status-copy">
                  {{
                    isLoadingChannels
                      ? "Checking workspace channel..."
                      : selectedConnectedAccount
                        ? selectedConnectedAccountDescriptor
                        : selectedPublishingStatus
                  }}
                </p>
              </div>
            </div>

            <div class="linkedin-feed-body">
              <p
                v-for="(line, index) in previewLeadLines"
                :key="`${line}-${index}`"
                class="linkedin-feed-hook"
                :class="{ companion: index > 0 }"
              >
                {{ line }}
              </p>
              <p v-for="paragraph in previewBodyParagraphs" :key="paragraph" class="linkedin-feed-paragraph">
                {{ paragraph }}
              </p>
            </div>
          </section>

          <section class="execution-status-card" :data-tone="executionStatus.tone">
            <div class="execution-status-header">
              <div>
                <p class="panel-meta">{{ executionStatus.label }}</p>
                <strong>{{ executionStatus.title }}</strong>
                <p class="execution-status-description">{{ executionStatus.description }}</p>
              </div>
              <button
                v-if="canScheduleDraft"
                type="button"
                class="secondary-action execution-status-button"
                :disabled="isUploadingPostAssets"
                @click="goToPlanner"
              >
                View in planner
              </button>
            </div>

            <div class="execution-chip-row">
              <article
                v-for="fact in executionPanelFacts"
                :key="`status-${fact.label}`"
                class="execution-chip"
              >
                <span>{{ fact.label }}</span>
                <strong>{{ fact.value }}</strong>
              </article>
            </div>

            <div class="execution-status-grid">
              <article class="execution-status-block">
                <p class="panel-meta">Preview outcome</p>
                <ul class="execution-timeline-list">
                  <li v-for="step in executionTimeline" :key="step">{{ step }}</li>
                </ul>
              </article>

              <article class="execution-status-block">
                <p class="panel-meta">Delivery confidence</p>
                <strong>{{ actionPriorityLabel }}</strong>
                <p class="execution-status-description">{{ executionStatus.detail }}</p>
              </article>
            </div>

            <p
              v-if="feedbackMessage && feedbackTone === 'success'"
              class="result-feedback execution-feedback"
              data-tone="success"
            >
              {{ feedbackMessage }}
            </p>

            <div v-if="selectedPublishAttemptResults.length > 0" class="publish-attempt-panel">
              <div class="publish-attempt-header">
                <div>
                  <p class="panel-meta">Per-platform status</p>
                  <strong>Successful platforms stay posted. Failed platforms can be retried safely.</strong>
                </div>
                <button
                  v-if="canRetryFailedPlatforms"
                  type="button"
                  class="secondary-action execution-status-button"
                  :disabled="isPublishingToLinkedIn"
                  @click="void retryFailedPlatforms()"
                >
                  {{ isPublishingToLinkedIn ? "Retrying..." : "Retry failed only" }}
                </button>
              </div>

              <article
                v-for="result in selectedPublishAttemptResults"
                :key="`publish-attempt-${result.platform}`"
                class="publish-attempt-row"
                :data-status="result.status"
              >
                <div class="publish-attempt-copy">
                  <strong>{{ resolveSocialPlatformLabel(result.platform) }}</strong>
                  <p>{{ result.message }}</p>
                </div>

                <div class="publish-attempt-actions">
                  <span class="publish-attempt-badge" :data-status="result.status">
                    {{ result.status === "success" ? "Posted" : "Failed" }}
                  </span>
                  <a
                    v-if="result.status === 'success' && result.externalPostUrl"
                    :href="result.externalPostUrl"
                    class="publish-attempt-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {{ resolveExternalPostLabel(result.platform) }}
                  </a>
                </div>
              </article>
            </div>
          </section>

          <div class="result-primary-actions">
            <button
              type="button"
              class="primary-action"
              :disabled="
                isPublishingToLinkedIn ||
                isConnectingLinkedIn ||
                isConnectingMeta ||
                isUploadingPostAssets ||
                !activeBusinessId ||
                !canRunPublishingAction
              "
              @click="void triggerPrimaryPublishAction()"
            >
              {{ primaryPublishActionLabel }}
            </button>

            <button
              v-if="canScheduleDraft"
              type="button"
              class="secondary-action"
              :disabled="
                isSchedulingDraft ||
                isUploadingPostAssets ||
                !canPublishSelectedPlatforms ||
                Boolean(selectedSchedulingCapacityGuardrail)
              "
              @click="void openSchedulePanel()"
            >
              {{ primaryScheduleActionLabel }}
            </button>

            <button
              v-if="canScheduleDraft"
              type="button"
              class="secondary-action"
              :disabled="isUploadingPostAssets"
              @click="goToPlanner"
            >
              Open planner
            </button>

            <button type="button" class="secondary-action" @click="goToImprove">
              Improve
            </button>
            <button type="button" class="secondary-action" @click="void goToContinueWriting()">
              Continue writing
            </button>
            <div class="result-strategy-actions">
              <span class="panel-meta">One-click angles</span>
              <div class="result-strategy-row">
                <button
                  v-for="option in FOLLOW_UP_STRATEGY_OPTIONS"
                  :key="option.value"
                  type="button"
                  class="secondary-action result-strategy-button"
                  @click="void goToContinueWriting(option.value)"
                >
                  {{ option.shortLabel }}
                </button>
              </div>
            </div>

            <button
              v-if="!canScheduleDraft"
              type="button"
              class="secondary-action"
              :disabled="
                isPublishingToLinkedIn ||
                isConnectingLinkedIn ||
                isConnectingMeta ||
                isUploadingPostAssets ||
                !activeBusinessId ||
                !canRunPublishingAction
              "
              @click="void triggerPrimaryPublishAction()"
            >
              {{ primaryPublishActionLabel }}
            </button>
          </div>

          <p
            v-if="feedbackMessage && feedbackTone === 'warning'"
            class="result-feedback"
            data-tone="warning"
          >
            {{ feedbackMessage }}
          </p>

          <section v-if="isSchedulePanelOpen && canScheduleDraft" class="schedule-panel">
            <div class="schedule-panel-header">
              <div>
                <p class="panel-meta">Choose a delivery window</p>
                <strong>Lock the post into a real publishing slot</strong>
                <p class="ai-command-copy">
                  Pick the audience time once, then let planner and the worker handle execution.
                </p>
              </div>
              <button type="button" class="secondary-action schedule-close-button" @click="closeSchedulePanel">
                Close
              </button>
            </div>

            <div v-if="bestRecommendedSlot" class="schedule-best-slot">
              <div>
                <p class="panel-meta">Best time</p>
                <strong>{{ bestRecommendedSlot.localLabel }} in {{ recommendedTimezone }}</strong>
                <p class="ai-command-copy">{{ bestRecommendedSlot.reason }}</p>
              </div>
              <button
                type="button"
                class="secondary-action"
                :disabled="isLoadingRecommendedSlots || isSchedulingDraft"
                @click="applyRecommendedSchedule"
              >
                Use best time
              </button>
            </div>

            <div
              v-if="hasScheduledQueuePreview"
              class="schedule-best-slot"
              :data-tone="queueLimitReached ? 'warning' : 'default'"
            >
              <div>
                <p class="panel-meta">Queue preview</p>
                <strong>{{ queuePreviewHeadline }}</strong>
                <p class="ai-command-copy">{{ queueLimitReached ? queueLimitPrompt : queuePreviewCopy }}</p>
              </div>
            </div>

            <div class="schedule-form-grid">
              <label>
                <span>Date</span>
                <input v-model="scheduleDateKey" type="date" />
              </label>
              <label>
                <span>Time</span>
                <input v-model="scheduleTime" type="time" />
              </label>
              <label>
                <span>Audience timezone</span>
                <select v-model="audienceTimezone">
                  <option
                    v-for="option in audienceTimezoneOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </div>

            <p class="schedule-helper-copy">
              Audience time: {{ selectedAudienceDateLabel }} at {{ selectedAudienceTimeLabel }}
              <span v-if="selectedLocalTimeLabel"> · Your time: {{ selectedLocalTimeLabel }}</span>
            </p>

            <p v-if="selectedPublishingGuardrail" class="result-feedback subtle">
              {{ selectedPublishingGuardrail }}
            </p>

            <p v-if="isLoadingRecommendedSlots" class="result-feedback subtle">
              Loading best posting windows...
            </p>
            <p v-if="scheduleFeedback" class="result-feedback">{{ scheduleFeedback }}</p>

            <div class="schedule-panel-actions">
              <button
                type="button"
                class="primary-action"
                :disabled="isSchedulingDraft || queueLimitReached"
                @click="void scheduleDraft()"
              >
                {{
                  queueLimitReached
                    ? "Queue full"
                    : isSchedulingDraft
                      ? "Adding to queue..."
                      : "Add to queue"
                }}
              </button>
              <button type="button" class="secondary-action" @click="goToPlanner">
                Open planner
              </button>
            </div>
          </section>

          <section v-if="draft" class="media-panel">
            <div class="media-panel-header">
              <div>
                <p class="panel-meta">Media</p>
                <strong>Turn this post into visuals</strong>
                <p class="ai-command-copy">
                  Keep the workflow text-first. When the post earns visuals, generate a narrative deck before you add or upload anything manually.
                </p>
              </div>

              <div class="media-panel-actions">
                <button
                  type="button"
                  class="primary-action media-generate-button"
                  :disabled="isLoadingMediaRecommendations || isUploadingPostAssets"
                  @click="void openGenerateMediaOptions()"
                >
                  {{ isLoadingMediaRecommendations ? "Loading options..." : "Choose visual format" }}
                </button>
                <button
                  type="button"
                  class="secondary-action"
                  @click="isWorkspaceAssetPickerOpen = true"
                >
                  Use existing
                </button>
                <label class="media-upload-button">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,video/mp4"
                    multiple
                    :disabled="isUploadingPostAssets"
                    @change="void handleMediaSelection($event)"
                  />
                  {{ isUploadingPostAssets ? "Uploading..." : "Upload" }}
                </label>
              </div>
            </div>

            <section
              v-if="carouselDraft && carouselDraft.slides.length > 0"
              class="carousel-blueprint-panel"
            >
              <div class="carousel-blueprint-header">
                <div>
                  <p class="panel-meta">Carousel blueprint</p>
                  <strong>{{ carouselNarrativeLabel }} narrative · {{ carouselDraft.slides.length }} slides</strong>
                  <p class="ai-command-copy">
                    This is the story system behind the visual output. Generate carousel to render this narrative into matching slides.
                  </p>
                </div>
                <span class="workspace-chip">Carousel recommended</span>
              </div>

              <div class="carousel-blueprint-grid">
                <article
                  v-for="(slide, index) in carouselDraft.slides"
                  :key="`${carouselDraft.title}-${index}`"
                  class="carousel-blueprint-card"
                >
                  <div class="carousel-blueprint-card-header">
                    <strong>Slide {{ index + 1 }}</strong>
                    <span v-if="slide.narrativeRole">{{ slide.narrativeRole.replace(/_/g, " ") }}</span>
                  </div>
                  <p>{{ slide.headline }}</p>
                  <small v-if="slide.supportingText">{{ slide.supportingText }}</small>
                  <ul v-if="slide.bulletPoints.length > 0" class="carousel-blueprint-points">
                    <li v-for="point in slide.bulletPoints" :key="point">{{ point }}</li>
                  </ul>
                </article>
              </div>
            </section>

            <div
              v-if="displayedMediaRecommendations.length > 0 || isLoadingMediaRecommendations"
              ref="mediaRecommendationPanelRef"
              class="media-recommendation-panel"
            >
              <div class="media-recommendation-header">
                <div>
                  <p class="panel-meta">Recommended next move</p>
                  <strong>
                    {{
                      isBusinessMode
                        ? "Generate the best post visual for this campaign"
                        : isUsingFallbackMediaRecommendations
                          ? "Generate media for this post"
                          : "Choose the safest visual path for this post"
                    }}
                  </strong>
                </div>
                <span class="workspace-chip">
                  {{
                    isBusinessMode
                      ? recommendedContentType === "image" ? "Visual attached" : "Visual-first draft"
                      : isUsingFallbackMediaRecommendations
                        ? "Manual generation"
                        : recommendedContentType === "image" ? "Assets already attached" : "Text-first draft"
                  }}
                </span>
              </div>

              <p v-if="isLoadingMediaRecommendations" class="result-feedback subtle">
                Loading media recommendations...
              </p>
              <p v-else-if="isUsingFallbackMediaRecommendations" class="result-feedback subtle">
                No strong visual match yet. You can still generate media manually.
              </p>

              <div v-else class="media-recommendation-grid">
                <article
                  v-for="suggestion in displayedMediaRecommendations"
                  :key="suggestion.id"
                  class="media-recommendation-card"
                  :data-recommended="suggestion.visualTemplateType === 'carousel'"
                >
                  <div>
                    <p class="panel-meta">{{ suggestion.actionType.replace(/_/g, " ") }}</p>
                    <strong>{{ getMediaSuggestionTitle(suggestion) }}</strong>
                    <p>{{ getMediaSuggestionDescription(suggestion) }}</p>
                    <small>{{ getMediaSuggestionReason(suggestion) }}</small>
                  </div>
                  <button
                    type="button"
                    class="secondary-action"
                    :disabled="isGeneratingRecommendationId === suggestion.id || isUploadingPostAssets"
                    @click="void applyMediaRecommendation(suggestion)"
                  >
                    {{
                      suggestion.actionType === "generate_visual"
                        ? isGeneratingRecommendationId === suggestion.id
                          ? "Generating..."
                          : suggestion.suggestedMediaType === "photo_overlay"
                            ? "Generate image"
                          : suggestion.visualTemplateType === "carousel"
                            ? "Generate carousel"
                            : "Generate visual"
                        : suggestion.actionType === "use_existing_asset"
                          ? "Use existing"
                          : "Skip media"
                    }}
                  </button>
                </article>
              </div>
            </div>

            <p v-if="mediaFeedback" class="result-feedback">{{ mediaFeedback }}</p>
            <p v-else-if="isLoadingPostAssets" class="result-feedback">Loading attached media...</p>

            <div v-if="postAssets.length > 0" class="media-grid">
              <article v-for="asset in postAssets" :key="asset.id" class="media-card">
                <video
                  v-if="asset.previewUrl && asset.mimeType.startsWith('video/')"
                  :src="asset.previewUrl"
                  class="media-preview"
                  controls
                  muted
                  playsinline
                  preload="metadata"
                />
                <img
                  v-else-if="asset.previewUrl"
                  :src="asset.previewUrl"
                  :alt="`Attached media ${asset.orderIndex + 1}`"
                  class="media-preview"
                />
                <div class="media-meta">
                  <span>{{ asset.mimeType }}</span>
                  <strong>{{ Math.max(1, Math.round(asset.sizeBytes / 1024)) }} KB</strong>
                </div>
                <button
                  type="button"
                  class="secondary-action media-remove-button"
                  :disabled="removingPostAssetId === asset.id"
                  @click="void removePostAsset(asset.id)"
                >
                  {{ removingPostAssetId === asset.id ? "Removing..." : "Remove" }}
                </button>
              </article>
            </div>

            <p v-else class="result-feedback subtle">
              {{
                isBusinessMode
                  ? "No visual attached yet. Generate or upload one before publishing to Instagram or Facebook."
                  : "No media attached yet. This post will publish as text until you add supported media."
              }}
            </p>
          </section>

          <WorkspaceAssetPickerModal
            :open="isWorkspaceAssetPickerOpen"
            :business-id="activeBusinessId"
            asset-type="all"
            multiple
            title="Attach existing workspace media"
            @close="isWorkspaceAssetPickerOpen = false"
            @select="void attachWorkspaceAssets($event)"
          />

          <MetaPageSelectionModal
            :open="isMetaSelectionModalOpen"
            :business-id="activeBusinessId"
            :session="pendingMetaSession"
            :platform="selectedPublishingPlatform === 'instagram' ? 'instagram' : 'facebook'"
            @close="closeMetaSelectionModal"
            @connected="void handleMetaConnected()"
            @error="handleMetaSelectionError"
          />

          <section class="ai-command-panel">
            <div class="ai-command-header">
              <div>
                <p class="panel-meta">AI editor</p>
                <strong>Ask AI to improve this draft</strong>
                <p class="ai-command-copy">
                  Preview the change first. Nothing overwrites the post until you apply it.
                </p>
              </div>
            </div>

            <div class="ai-suggestion-callout">
              <p class="panel-meta">Suggested improvements</p>
              <p class="ai-command-copy">
                Start with a stronger hook, a tighter ending, or a more specific founder example.
              </p>
            </div>

            <div class="ai-command-row">
              <input
                v-model="aiEditInstruction"
                type="text"
                class="ai-command-input"
                placeholder="Try: make this sharper, remove emojis, or shorten the ending"
                @keydown.enter.prevent="void previewAiEdit()"
              />
              <button
                type="button"
                class="secondary-action ai-command-submit"
                :disabled="isPreviewingAiEdit || isApplyingAiEdit || !activeBusinessId"
                @click="void previewAiEdit()"
              >
                {{ isPreviewingAiEdit ? "Thinking..." : "Preview change" }}
              </button>
            </div>

            <div class="ai-command-chips">
              <button
                v-for="command in AI_QUICK_COMMANDS"
                :key="command.value"
                type="button"
                class="ai-command-chip"
                :disabled="isPreviewingAiEdit || isApplyingAiEdit || !activeBusinessId"
                @click="void previewAiEdit(command.value)"
              >
                {{ command.label }}
              </button>
            </div>

            <p v-if="aiEditFeedback" class="result-feedback">{{ aiEditFeedback }}</p>

            <div v-if="isPreviewingAiEdit" class="ai-edit-preview-card loading">
              Generating a scoped suggestion...
            </div>

            <div v-else-if="aiEditPreview" class="ai-edit-preview-card">
              <div class="ai-edit-preview-header">
                <div>
                  <p class="panel-meta">Change preview</p>
                  <p class="ai-edit-summary">{{ aiEditPreview.summary }}</p>
                  <p class="ai-edit-scope">{{ aiEditPreview.scopeHint }}</p>
                </div>
                <div v-if="aiPreviewActions.length > 0" class="ai-edit-action-pills">
                  <span v-for="action in aiPreviewActions" :key="action">{{ action }}</span>
                </div>
              </div>

              <div class="ai-edit-diff">
                <article class="ai-edit-diff-card">
                  <p class="panel-meta">Before</p>
                  <pre>{{ aiEditPreview.beforeExcerpt }}</pre>
                </article>
                <article class="ai-edit-diff-card updated">
                  <p class="panel-meta">After</p>
                  <pre>{{ aiEditPreview.afterExcerpt }}</pre>
                </article>
              </div>

              <div class="ai-edit-actions">
                <button
                  type="button"
                  class="primary-action"
                  :disabled="isApplyingAiEdit"
                  @click="void applyAiEditPreview()"
                >
                  {{ isApplyingAiEdit ? "Applying..." : "Apply changes" }}
                </button>
                <button type="button" class="secondary-action" @click="clearAiEditPreview">
                  Keep original
                </button>
              </div>
            </div>
          </section>
        </article>

        <aside class="result-side-rail">
          <article class="side-card">
            <p class="panel-meta">Growth mechanics</p>
            <h3>Make this easier to react to</h3>
            <p class="shortcut-note side-intro-copy">
              Use these moves to sharpen hook tension, improve retention, and create a cleaner reason to comment.
            </p>

            <div class="growth-mechanics-grid">
              <article
                v-for="mechanic in growthMechanics"
                :key="mechanic.id"
                class="growth-mechanic-card"
              >
                <div>
                  <p class="panel-meta">{{ mechanic.label }}</p>
                  <strong>{{ mechanic.title }}</strong>
                  <p>{{ mechanic.copy }}</p>
                </div>
                <button
                  type="button"
                  class="secondary-action side-action-button"
                  :disabled="isPreviewingAiEdit || isApplyingAiEdit || !activeBusinessId"
                  @click="void previewAiEdit(mechanic.command)"
                >
                  {{ mechanic.actionLabel }}
                </button>
              </article>
            </div>

            <div class="growth-callout">
              <p class="panel-meta">Comment prompts</p>
              <strong>Give people a reason to respond</strong>
              <p class="shortcut-note">
                Add one direct question to the post, then use a stronger first comment to boost early conversation.
              </p>
            </div>

            <div class="prompt-stack">
              <article
                v-for="prompt in conversationPrompts"
                :key="prompt"
                class="prompt-card"
              >
                <p>{{ prompt }}</p>
                <button
                  type="button"
                  class="secondary-action side-action-button"
                  @click="void copyConversationPrompt(prompt)"
                >
                  Copy prompt
                </button>
              </article>
            </div>

            <article v-if="suggestedFirstComment" class="first-comment-card">
              <p class="panel-meta">First comment</p>
              <strong>Use this as comment bait</strong>
              <pre>{{ suggestedFirstComment }}</pre>
              <button
                type="button"
                class="secondary-action side-action-button"
                @click="void copyConversationPrompt(suggestedFirstComment)"
              >
                Copy first comment
              </button>
            </article>

            <article class="hashtag-card">
              <div class="hashtag-card-header">
                <div>
                  <p class="panel-meta">Discoverability</p>
                  <strong>Add focused hashtags</strong>
                </div>
                <button
                  type="button"
                  class="secondary-action"
                  :disabled="isGeneratingHashtags"
                  @click="void generateHashtags()"
                >
                  {{ isGeneratingHashtags ? "Generating..." : "Generate hashtags" }}
                </button>
              </div>

              <p class="shortcut-note">
                Keep it tight. Three to five relevant tags is better than a stuffed footer.
              </p>

              <div v-if="generatedHashtags.length > 0" class="hashtag-chip-row">
                <span v-for="tag in generatedHashtags" :key="tag">{{ tag }}</span>
              </div>

              <div v-if="generatedHashtags.length > 0" class="hashtag-actions">
                <button type="button" class="primary-action hashtag-action" @click="void applyGeneratedHashtags()">
                  Apply to post
                </button>
                <button type="button" class="secondary-action hashtag-action" @click="void copyHashtagCaption()">
                  Copy caption
                </button>
              </div>

              <p v-if="hashtagFeedback" class="result-feedback subtle hashtag-feedback">
                {{ hashtagFeedback }}
              </p>
            </article>

            <p v-if="growthMechanicsFeedback" class="result-feedback subtle growth-feedback">
              {{ growthMechanicsFeedback }}
            </p>
          </article>

          <article class="side-card">
            <p class="panel-meta">Hook bank</p>
            <h3>Backup openings</h3>
            <ul class="hook-list">
              <li v-for="hook in hooks" :key="hook">{{ hook }}</li>
            </ul>
          </article>

          <article class="side-card">
            <p class="panel-meta">Execution panel</p>
            <h3>What happens next</h3>
            <div class="execution-fact-grid">
              <article v-for="fact in executionPanelFacts" :key="fact.label" class="execution-fact-card">
                <span>{{ fact.label }}</span>
                <strong>{{ fact.value }}</strong>
              </article>
            </div>
            <div class="execution-delivery-note">
              <p class="panel-meta">Delivery</p>
              <p class="shortcut-note">
                Scheduling hands this draft to the worker loop. Publish now skips the queue and
                goes directly to {{ selectedPublishingPlatformLabel }}.
              </p>
            </div>

            <p class="panel-meta secondary-panel-meta">Use this draft elsewhere</p>
            <div class="side-action-stack">
              <button type="button" class="secondary-action side-action-button" @click="void copyPost()">
                Copy for {{ selectedPublishingPlatformLabel }}
              </button>
              <button type="button" class="secondary-action side-action-button" @click="goToOutreach">
                Send via Outreach
              </button>
              <button type="button" class="secondary-action side-action-button" @click="goToEmail">
                Convert to Email
              </button>
              <button type="button" class="secondary-action side-action-button" @click="goToGrowth">
                Capture engaged lead
              </button>
            </div>
            <p class="shortcut-note">Shortcuts: Cmd/Ctrl + Shift + O for outreach, + E for email.</p>
          </article>
        </aside>
      </section>
    </template>

    <section v-else class="result-empty-card">
      <p class="result-eyebrow">/app/result</p>
      <h1>No generated result found.</h1>
      <p class="result-description">
        Generate a post first, then this screen becomes the handoff into the rest of the product.
      </p>
      <router-link class="primary-action" :to="appRoutes.appGenerate">Generate your first post</router-link>
    </section>
  </main>
</template>

<style scoped>
.result-shell {
  width: min(100%, 1120px);
  margin: 0 auto;
  padding: 48px 20px 80px;
}

.result-hero {
  margin-bottom: 24px;
}

.result-persistence-note {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 0;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-accent-soft) 72%, white 28%);
  color: var(--fc-text-muted);
  font-size: 0.95rem;
}

.result-eyebrow,
.panel-meta {
  margin: 0 0 10px;
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.result-hero h1,
.result-empty-card h1 {
  margin: 0;
  font-size: clamp(2.1rem, 4vw, 3.4rem);
  line-height: 1.02;
}

.result-description {
  max-width: 760px;
  margin: 16px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.7;
}

.result-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
}

.result-post-card,
.side-card,
.result-empty-card {
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: linear-gradient(180deg, var(--fc-surface) 0%, var(--fc-surface-subtle) 100%);
  box-shadow: var(--fc-card-shadow);
}

.result-post-card,
.side-card {
  padding: clamp(22px, 3vw, 32px);
}

.result-empty-card {
  width: min(100%, 760px);
  margin: 0 auto;
  padding: clamp(24px, 4vw, 40px);
}

.result-card-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.result-card-header h2 {
  margin: 0;
  line-height: 1.1;
}

.score-badge {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  border: 1px solid var(--fc-border);
  font-weight: 800;
}

.score-badge[data-tone="strong"] {
  background: color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.12)) 88%, white 12%);
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 18%, var(--fc-border));
  color: var(--fc-success-text, #2c6b35);
}

.score-badge[data-tone="warning"] {
  background: color-mix(in srgb, #f8b84e 16%, white 84%);
  border-color: color-mix(in srgb, #b46a00 20%, var(--fc-border));
  color: #8a5200;
}

.signal-line {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 18px 0 0;
}

.signal-line span {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: var(--fc-success-bg, rgba(56, 142, 60, 0.12));
  color: var(--fc-success-text, #2c6b35);
  font-size: 0.84rem;
  font-weight: 700;
}

.result-signal-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 18px;
}

.result-signal-card {
  display: grid;
  gap: 6px;
  padding: 16px 18px;
  border-radius: 20px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.6);
}

.result-signal-card strong {
  font-size: 1.04rem;
  line-height: 1.2;
}

.result-signal-card span {
  color: var(--fc-text-muted);
  line-height: 1.55;
  font-size: 0.93rem;
}

.result-signal-card[data-tone="strong"] {
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.12)) 80%, white 20%);
}

.result-signal-card[data-tone="warning"] {
  border-color: color-mix(in srgb, #b46a00 22%, var(--fc-border));
  background: color-mix(in srgb, #f8b84e 10%, white 90%);
}

.linkedin-feed-preview {
  display: grid;
  gap: 16px;
  margin-top: 20px;
  padding: clamp(20px, 3vw, 28px);
  border: 1px solid color-mix(in srgb, var(--fc-border) 82%, transparent);
  border-radius: 28px;
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--fc-accent-soft) 38%, transparent) 0%, transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(255, 255, 255, 0.72) 100%);
}

.linkedin-feed-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.linkedin-feed-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--fc-accent-soft) 0%, color-mix(in srgb, var(--fc-accent-soft) 55%, white 45%) 100%);
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  font-weight: 800;
}

.linkedin-feed-identity strong {
  display: block;
  line-height: 1.2;
}

.linkedin-feed-identity p {
  margin: 4px 0 0;
  color: var(--fc-text-muted);
  font-size: 0.93rem;
}

.linkedin-preview-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.linkedin-preview-pills span {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid var(--fc-border);
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.linkedin-status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.55);
}

.linkedin-status-card[data-connected="true"] {
  background: rgba(56, 142, 60, 0.08);
  border-color: rgba(56, 142, 60, 0.18);
}

.linkedin-status-card strong {
  display: block;
  line-height: 1.25;
}

.linkedin-status-copy {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.linkedin-feed-body {
  display: grid;
  gap: 16px;
}

.linkedin-feed-hook,
.linkedin-feed-paragraph {
  margin: 0;
  white-space: pre-wrap;
}

.linkedin-feed-hook {
  max-width: 14ch;
  font-size: clamp(2rem, 5vw, 3.8rem);
  line-height: 0.95;
  letter-spacing: -0.04em;
  font-weight: 800;
  text-wrap: balance;
}

.linkedin-feed-hook.companion {
  color: color-mix(in srgb, var(--fc-text) 78%, var(--fc-accent-dark));
}

.linkedin-feed-paragraph {
  max-width: 62ch;
  color: var(--fc-text);
  font-size: 1.02rem;
  line-height: 1.8;
}

.result-primary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}

.channel-selector-card {
  display: grid;
  gap: 14px;
  margin-top: 18px;
  padding: 18px 20px;
  border-radius: 22px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.72);
}

.channel-selector-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.channel-selector-option {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 82%, white 18%);
  background: color-mix(in srgb, var(--fc-surface) 92%, white 8%);
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.channel-selector-option:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 22px rgba(35, 21, 13, 0.08);
}

.channel-selector-option[data-focused="true"] {
  border-color: color-mix(in srgb, var(--fc-accent) 28%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 34%, white 66%);
}

.channel-selector-option[data-selected="true"] {
  border-color: color-mix(in srgb, var(--fc-success-text) 22%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg) 42%, var(--fc-panel-bg));
}

.channel-selector-option[data-disabled="true"] {
  cursor: default;
  opacity: 0.84;
}

.channel-selector-option-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.channel-selector-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 800;
  cursor: pointer;
}

.channel-selector-checkbox input {
  width: 16px;
  height: 16px;
  accent-color: var(--fc-accent);
}

.channel-selector-state {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.channel-selector-option[data-selected="true"] .channel-selector-state {
  border-color: color-mix(in srgb, var(--fc-success-text) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg) 84%, var(--fc-panel-bg));
  color: var(--fc-success-text);
}

.channel-selector-option p {
  margin: 0;
  color: var(--fc-text-muted);
  font-size: 0.92rem;
  line-height: 1.5;
}

.execution-status-card {
  display: grid;
  gap: 16px;
  margin-top: 18px;
  padding: 20px;
  border-radius: 22px;
  border: 1px solid var(--fc-border);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78) 0%, rgba(255, 255, 255, 0.58) 100%);
  box-shadow: 0 18px 36px rgba(35, 21, 13, 0.08);
}

.execution-status-card[data-tone="queued"] {
  border-color: color-mix(in srgb, var(--fc-accent) 28%, var(--fc-border));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--fc-accent-soft) 44%, white 56%) 0%,
    rgba(255, 255, 255, 0.72) 100%
  );
}

.execution-status-card[data-tone="live"] {
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 22%, var(--fc-border));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.12)) 72%, white 28%) 0%,
    rgba(255, 255, 255, 0.76) 100%
  );
}

.execution-status-card[data-tone="warning"] {
  border-color: color-mix(in srgb, #b46a00 24%, var(--fc-border));
  background: linear-gradient(180deg, color-mix(in srgb, #f8b84e 12%, white 88%) 0%, rgba(255, 255, 255, 0.76) 100%);
}

.execution-status-header {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-start;
  justify-content: space-between;
}

.execution-status-header strong,
.execution-status-block strong {
  display: block;
  font-size: 1.08rem;
  line-height: 1.25;
}

.execution-status-description {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.result-bullet-list {
  display: grid;
  gap: 8px;
  margin: 8px 0 0;
  padding-left: 18px;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.execution-status-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.execution-chip-row {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.execution-chip {
  display: grid;
  gap: 6px;
  padding: 14px 15px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.76);
}

.execution-chip span {
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.execution-chip strong {
  line-height: 1.35;
}

.execution-status-block {
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.72);
}

.execution-timeline-list {
  display: grid;
  gap: 10px;
  padding-left: 18px;
  margin: 10px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.execution-feedback {
  margin-top: 0;
}

.publish-attempt-panel {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.68);
}

.publish-attempt-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.publish-attempt-header strong {
  display: block;
  line-height: 1.3;
}

.publish-attempt-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0;
  border-top: 1px solid color-mix(in srgb, var(--fc-border) 84%, transparent);
}

.publish-attempt-row:first-of-type {
  border-top: none;
  padding-top: 0;
}

.publish-attempt-row:last-of-type {
  padding-bottom: 0;
}

.publish-attempt-copy {
  display: grid;
  gap: 4px;
}

.publish-attempt-copy strong {
  line-height: 1.25;
}

.publish-attempt-copy p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.publish-attempt-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.publish-attempt-badge {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.72);
  font-size: 0.84rem;
  font-weight: 700;
}

.publish-attempt-badge[data-status="success"] {
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.12)) 82%, white 18%);
  color: var(--fc-success-text, #2c6b35);
}

.publish-attempt-badge[data-status="failed"] {
  border-color: color-mix(in srgb, #b14d18 24%, var(--fc-border));
  background: color-mix(in srgb, #ff8a5c 12%, white 88%);
  color: #9a4215;
}

.publish-attempt-link {
  color: var(--fc-accent-dark);
  font-size: 0.92rem;
  font-weight: 700;
  text-decoration: none;
}

.publish-attempt-link:hover,
.publish-attempt-link:focus-visible {
  text-decoration: underline;
}

.schedule-panel {
  display: grid;
  gap: 16px;
  margin-top: 20px;
  padding: 20px;
  border-radius: 22px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.6);
}

.schedule-panel-header,
.schedule-best-slot,
.schedule-panel-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
}

.schedule-close-button {
  min-height: 40px;
}

.schedule-best-slot {
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 28%, white 72%);
}

.schedule-best-slot[data-tone="warning"] {
  border-color: color-mix(in srgb, #b46a00 24%, var(--fc-border));
  background: color-mix(in srgb, #f8b84e 10%, white 90%);
}

.schedule-best-slot strong {
  display: block;
}

.schedule-form-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.schedule-form-grid label {
  display: grid;
  gap: 8px;
  color: var(--fc-text-muted);
  font-size: 0.92rem;
}

.schedule-form-grid input,
.schedule-form-grid select {
  min-height: 48px;
  width: 100%;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.schedule-helper-copy {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.ai-command-panel {
  margin-top: 20px;
  padding: 18px;
  border-radius: 22px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.6);
}

.ai-suggestion-callout {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 22%, white 78%);
}

.ai-command-copy,
.ai-edit-scope {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.ai-command-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  margin-top: 14px;
}

.ai-command-input {
  min-height: 48px;
  width: 100%;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.media-panel {
  display: grid;
  gap: 16px;
  margin-top: 20px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.52);
}

.media-panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 14px;
}

.media-panel-header strong {
  display: block;
}

.media-panel-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.media-generate-button {
  min-width: 170px;
  justify-content: center;
}

.carousel-blueprint-panel {
  display: grid;
  gap: 14px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--fc-accent-soft) 26%, transparent) 0%, transparent 34%),
    rgba(255, 249, 243, 0.94);
}

.carousel-blueprint-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.carousel-blueprint-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.carousel-blueprint-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 90%, transparent);
  background: rgba(255, 255, 255, 0.9);
}

.carousel-blueprint-card p,
.carousel-blueprint-card small {
  margin: 0;
}

.carousel-blueprint-card p {
  font-weight: 700;
  line-height: 1.45;
}

.carousel-blueprint-card small {
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.carousel-blueprint-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.carousel-blueprint-card-header strong {
  font-size: 0.95rem;
}

.carousel-blueprint-card-header span {
  color: var(--fc-text-muted);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.carousel-blueprint-points {
  display: grid;
  gap: 8px;
  padding-left: 18px;
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.45;
}

.workspace-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(245, 232, 219, 0.82);
  color: var(--fc-text);
  font-size: 0.8rem;
  font-weight: 700;
}

.media-recommendation-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 90%, transparent);
  background: rgba(255, 249, 243, 0.94);
}

.media-recommendation-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.media-recommendation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.media-recommendation-card {
  display: grid;
  gap: 12px;
  align-content: space-between;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 90%, transparent);
  background: rgba(255, 255, 255, 0.88);
}

.media-recommendation-card[data-recommended="true"] {
  border-color: color-mix(in srgb, var(--fc-accent) 22%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 20%, white 80%);
}

.media-recommendation-card p,
.media-recommendation-card small {
  display: block;
  margin-top: 6px;
  color: var(--fc-text-muted);
}

.media-upload-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
  font-weight: 700;
  cursor: pointer;
}

.media-upload-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 14px;
}

.media-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
}

.media-preview {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 90%, transparent);
}

.media-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.84rem;
  color: var(--fc-text-muted);
}

.media-remove-button {
  justify-self: start;
}

.ai-command-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}

.ai-command-chip {
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: transparent;
  color: var(--fc-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.ai-command-submit {
  min-width: 160px;
}

.ai-edit-preview-card {
  margin-top: 16px;
  padding: 18px;
  border-radius: 20px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface);
}

.ai-edit-preview-card.loading {
  color: var(--fc-text-muted);
}

.ai-edit-summary {
  margin: 0;
  font-weight: 800;
  line-height: 1.5;
}

.ai-edit-preview-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
}

.ai-edit-action-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ai-edit-action-pills span {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-accent-soft) 38%, white 62%);
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  font-size: 0.8rem;
  font-weight: 700;
}

.ai-edit-diff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 16px;
}

.ai-edit-diff-card {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface-subtle);
}

.ai-edit-diff-card.updated {
  border-color: color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 44%, white 56%);
}

.ai-edit-diff-card pre {
  margin: 0;
  white-space: pre-wrap;
  font: inherit;
  line-height: 1.7;
}

.ai-edit-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}

.result-strategy-actions {
  display: grid;
  gap: 10px;
  min-width: min(100%, 320px);
}

.result-strategy-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.result-strategy-button {
  min-height: 42px;
  padding: 0 14px;
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
}

.primary-action {
  border: none;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
  cursor: pointer;
}

.secondary-action {
  border: 1px solid var(--fc-border);
  background: transparent;
  color: var(--fc-text);
  cursor: pointer;
}

.primary-action:disabled,
.secondary-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.result-feedback,
.shortcut-note {
  margin: 16px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.result-feedback[data-tone="warning"] {
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, #b46a00 22%, var(--fc-border));
  background: color-mix(in srgb, #f8b84e 10%, white 90%);
  color: #8a5200;
}

.result-feedback[data-tone="success"] {
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--fc-success-text, #2c6b35) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.12)) 82%, white 18%);
  color: var(--fc-success-text, #2c6b35);
}

.result-feedback.subtle {
  margin-top: 0;
}

.result-side-rail {
  display: grid;
  gap: 20px;
}

.side-intro-copy {
  margin-top: 12px;
}

.side-card h3 {
  margin: 0;
  font-size: 1.15rem;
  line-height: 1.2;
}

.growth-mechanics-grid,
.prompt-stack {
  display: grid;
  gap: 12px;
  margin-top: 18px;
}

.growth-mechanic-card,
.prompt-card,
.first-comment-card,
.hashtag-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.72);
}

.growth-mechanic-card strong,
.first-comment-card strong,
.hashtag-card strong {
  display: block;
  line-height: 1.25;
}

.growth-mechanic-card p,
.prompt-card p {
  margin: 8px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.growth-callout {
  margin-top: 18px;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 18%, white 82%);
}

.prompt-card p {
  margin: 0;
  color: var(--fc-text);
}

.first-comment-card {
  margin-top: 16px;
}

.first-comment-card pre {
  margin: 0;
  white-space: pre-wrap;
  font: inherit;
  line-height: 1.6;
  color: var(--fc-text);
}

.hashtag-card {
  margin-top: 16px;
}

.hashtag-card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.hashtag-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hashtag-chip-row span {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-accent-soft) 32%, white 68%);
  border: 1px solid color-mix(in srgb, var(--fc-accent) 16%, var(--fc-border));
  font-size: 0.84rem;
  font-weight: 700;
}

.hashtag-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hashtag-action {
  flex: 1 1 160px;
}

.growth-feedback,
.hashtag-feedback {
  margin-top: 14px;
}

.execution-fact-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 18px;
}

.execution-fact-card {
  display: grid;
  gap: 6px;
  padding: 14px 15px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.72);
}

.execution-fact-card span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.execution-fact-card strong {
  line-height: 1.35;
}

.execution-delivery-note {
  margin-top: 18px;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 14%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 16%, white 84%);
}

.secondary-panel-meta {
  margin-top: 20px;
}

.hook-list,
.next-action-list {
  display: grid;
  gap: 12px;
  padding-left: 18px;
  margin: 18px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.side-action-stack {
  display: grid;
  gap: 10px;
  margin-top: 18px;
}

.side-action-button {
  width: 100%;
}

@media (max-width: 900px) {
  .result-grid {
    grid-template-columns: 1fr;
  }

  .result-signal-grid,
  .channel-selector-grid,
  .execution-chip-row,
  .execution-status-grid,
  .execution-fact-grid,
  .schedule-form-grid,
  .ai-command-row,
  .ai-edit-diff {
    grid-template-columns: 1fr;
  }

  .linkedin-feed-hook {
    max-width: none;
  }
}
</style>
