<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthContext } from "../auth/auth-context";
import { useProductAccessContext } from "../access/product-access-context";
import AiAssistPanel from "../components/AiAssistPanel.vue";
import VoiceRecorder from "../components/VoiceRecorder.vue";
import { useAiAssistSuggestions } from "../composables/use-ai-assist";
import { calculateContentScore } from "../composables/useContentScore";
import { requestMyBusinesses, trackAnalyticsEvent } from "../services/admin-analytics-service";
import { ApiRequestError } from "../services/api-client";
import {
  requestLinkedInPostGeneration,
  requestRepurposeContent,
  requestVisualGeneration,
} from "../services/generation-service";
import {
  requestGeneratedHashtags,
  requestLinkedInSocialAuthStart,
  requestRecommendedPostTimes,
  requestScheduledPosts,
  requestSchedulePost,
  requestSocialAccounts,
} from "../services/publishing-service";
import type {
  BrandKitInput,
  BusinessMembership,
  ContentAsset,
  GenerateVisualResponse,
  GenerateHashtagsResponse,
  LinkedInPostVariation,
  RepurposeContentResponse,
  RepurposeInputType,
  RecommendedPostTimeSlot,
  ScheduledPost,
  SchedulingSafetyWarning,
  SocialAccount,
  VisualTemplateType,
} from "../../../packages/shared-types";
import type { GrowthDistributionFormat } from "../utils/repurpose-loop";
import { appRoutes } from "../utils/routes";
import { consumeRepurposeSeed } from "../utils/repurpose-loop";

const route = useRoute();
const router = useRouter();
const auth = useAuthContext();
const {
  bootstrap: productAccess,
  setActiveBusinessId,
  isReady: isProductAccessReady,
  isFeatureEnabled,
} = useProductAccessContext();

const topic = ref("startup failure lesson");
const tone = ref("storytelling");
const length = ref("medium");
const selectedHook = ref("");
const variations = ref<LinkedInPostVariation[]>([]);
const repurposeInputType = ref<RepurposeInputType>("text");
const repurposeText = ref("");
const repurposeUrl = ref("");
const repurposeVoiceTranscript = ref("");
const repurposeResult = ref<RepurposeContentResponse | null>(null);
const isRepurposing = ref(false);
const repurposeError = ref("");
const repurposeFeedback = ref("");
const isLoading = ref(false);
const errorMessage = ref("");
const copyFeedback = ref("");
const shareLoopCount = ref(0);

const memberships = ref<BusinessMembership[]>([]);
const selectedBusinessId = ref("");
const socialAccounts = ref<SocialAccount[]>([]);
const scheduledPosts = ref<ScheduledPost[]>([]);

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
const scheduleAt = ref(defaultScheduleValue());
const selectedCaptionKey = ref("");
const scheduleFeedback = ref("");
const scheduleError = ref("");
const schedulingContextMessage = ref("");
const recommendedTimezone = ref("UTC");
const recommendedSlots = ref<RecommendedPostTimeSlot[]>([]);
const recommendedSlotsMessage = ref("");
const isLoadingRecommendedSlots = ref(false);
const generatedHashtags = ref<string[]>([]);
const captionWithHashtags = ref("");
const hashtagMessage = ref("");
const isGeneratingHashtags = ref(false);
const isScheduling = ref(false);
const isLoadingPublishingContext = ref(false);
const isConnectingLinkedIn = ref(false);

const visualSelections = ref<Record<string, VisualTemplateType>>({});
const visualStyleSelections = ref<Record<string, VisualStylePreset>>({});
const visualHighlightModes = ref<Record<string, VisualHighlightMode>>({});
const manualVisualHighlights = ref<Record<string, string>>({});
const generatedVisuals = ref<Record<string, GenerateVisualResponse>>({});
const visualLoading = ref<Record<string, boolean>>({});
const visualErrors = ref<Record<string, string>>({});

type VisualStylePreset = "brand-signal" | "editorial-light" | "high-contrast";
type VisualHighlightMode = "auto" | "manual";

interface GeneratedVisualEntry {
  key: string;
  variation: LinkedInPostVariation;
  visual: GenerateVisualResponse;
}

const DEFAULT_CAPTION_FOOTER_CREDIT = "Optimized with FounderContent AI";

let recommendedSlotsRequestId = 0;
let hashtagRequestId = 0;

function defaultScheduleValue(): string {
  const nextMorning = new Date();
  nextMorning.setDate(nextMorning.getDate() + 1);
  nextMorning.setHours(10, 0, 0, 0);
  return toLocalDatetimeValue(nextMorning);
}

function toLocalDatetimeValue(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  const hours = `${value.getHours()}`.padStart(2, "0");
  const minutes = `${value.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseLocalDatetimeValue(value: string): string {
  return new Date(value).toISOString();
}

function getVariationKey(variation: LinkedInPostVariation): string {
  return variation.angle;
}

function isVisualTemplateType(value: string): value is VisualTemplateType {
  return value === "quote" || value === "insight" || value === "contrarian" || value === "carousel";
}

function isVisualStylePreset(value: string): value is VisualStylePreset {
  return value === "brand-signal" || value === "editorial-light" || value === "high-contrast";
}

function isVisualHighlightMode(value: string): value is VisualHighlightMode {
  return value === "auto" || value === "manual";
}

function isPublishableImageMimeType(value: string | undefined): boolean {
  return value === "image/png" || value === "image/jpeg" || value === "image/gif";
}

function resetVisualState() {
  visualSelections.value = {};
  visualStyleSelections.value = {};
  visualHighlightModes.value = {};
  manualVisualHighlights.value = {};
  generatedVisuals.value = {};
  visualLoading.value = {};
  visualErrors.value = {};
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function appendCaptionFooterCredit(baseCaption: string, creditLine: string): string {
  const normalizedCaption = baseCaption.trim();
  const normalizedCredit = creditLine.trim();

  if (!normalizedCredit) {
    return normalizedCaption;
  }

  if (!normalizedCaption) {
    return normalizedCredit;
  }

  if (normalizedCaption.includes(normalizedCredit)) {
    return normalizedCaption;
  }

  return `${normalizedCaption}\n\n${normalizedCredit}`;
}

function truncateLine(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength).trim();
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  return lastSpaceIndex >= 24 ? truncated.slice(0, lastSpaceIndex).trim() : truncated;
}

function extractLines(content: string): string[] {
  return content
    .split("\n")
    .map((line) => normalizeLine(line.replace(/^[-*•]\s*/, "")))
    .filter((line) => line.length > 0);
}

function summarizeSentence(value: string, maxLength: number): string {
  const firstSentence = normalizeLine(value).split(/(?<=[.!?])\s+/)[0] ?? normalizeLine(value);
  return truncateLine(firstSentence, maxLength);
}

function sanitizeVisualPhrase(value: string, maxLength: number): string {
  const normalized = normalizeLine(value)
    .replace(/^[\s"'()[\]]+/, "")
    .replace(/[\s"'()[\].,!?;:]+$/, "")
    .trim();

  if (!normalized) {
    return "";
  }

  return truncateLine(normalized, maxLength);
}

function extractVisualHighlightCandidate(value: string): string {
  const normalized = normalizeLine(value);

  if (!normalized) {
    return "";
  }

  const preferredPatterns = [
    /\babout\s+(.+)$/i,
    /\bwithout\s+(.+)$/i,
    /\binto\s+(.+)$/i,
    /\bthan\s+(.+)$/i,
    /\bisn't\s+(.+)$/i,
    /\bis not\s+(.+)$/i,
    /\bis\s+(.+)$/i,
    /\bwas\s+(.+)$/i,
  ];

  for (const pattern of preferredPatterns) {
    const match = normalized.match(pattern);
    const candidate = sanitizeVisualPhrase(match?.[1] ?? "", 56);

    if (candidate.split(/\s+/).length >= 2) {
      return candidate;
    }
  }

  const words = normalized.split(/\s+/).filter(Boolean);

  if (words.length <= 4) {
    return sanitizeVisualPhrase(normalized, 56);
  }

  return sanitizeVisualPhrase(words.slice(-3).join(" "), 56);
}

function extractVisualFooterLabel(value: string | undefined): string {
  const normalized = normalizeLine(value ?? "");

  if (!normalized) {
    return "";
  }

  try {
    const parsed = /^https?:\/\//i.test(normalized) ? new URL(normalized) : new URL(`https://${normalized}`);
    return parsed.hostname.replace(/^www\./i, "");
  } catch {
    return normalized;
  }
}

function deriveBulletPoints(content: string): string[] {
  const lines = extractLines(content);
  const bulletLikeLines = lines.filter((line) => line.length > 10).slice(1, 4);

  if (bulletLikeLines.length > 0) {
    return bulletLikeLines.map((line) => summarizeSentence(line, 64));
  }

  return content
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeLine(sentence))
    .filter((sentence) => sentence.length > 10)
    .slice(1, 4)
    .map((sentence) => truncateLine(sentence, 64));
}

function resolveBrandTone(value: string): BrandKitInput["tone"] {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("friendly")) {
    return "friendly";
  }

  if (normalized.includes("bold") || normalized.includes("contrarian")) {
    return "bold";
  }

  return "professional";
}

function resolveVisualStyleSelection(key: string): VisualStylePreset {
  return visualStyleSelections.value[key] ?? "brand-signal";
}

function resolveVisualTemplateSelection(key: string): VisualTemplateType {
  return visualSelections.value[key] ?? "quote";
}

function resolveVisualHighlightMode(key: string): VisualHighlightMode {
  return visualHighlightModes.value[key] ?? "auto";
}

function updateVisualTemplateSelection(key: string, value: string) {
  if (!isVisualTemplateType(value)) {
    return;
  }

  visualSelections.value = {
    ...visualSelections.value,
    [key]: value,
  };
}

function updateVisualStylePreset(key: string, value: string) {
  if (!isVisualStylePreset(value)) {
    return;
  }

  visualStyleSelections.value = {
    ...visualStyleSelections.value,
    [key]: value,
  };
}

function updateVisualHighlightMode(key: string, value: string) {
  if (!isVisualHighlightMode(value)) {
    return;
  }

  visualHighlightModes.value = {
    ...visualHighlightModes.value,
    [key]: value,
  };

  if (value === "auto") {
    const nextHighlights = { ...manualVisualHighlights.value };
    delete nextHighlights[key];
    manualVisualHighlights.value = nextHighlights;
  }
}

function updateManualVisualHighlight(key: string, value: string) {
  manualVisualHighlights.value = {
    ...manualVisualHighlights.value,
    [key]: value,
  };
}

function resolveBrandKitPreset(preset: VisualStylePreset): BrandKitInput {
  const baseTone = resolveBrandTone(tone.value);

  if (preset === "editorial-light") {
    return {
      primaryColor: "#F8F2EA",
      secondaryColor: "#1F2937",
      backgroundStyle: "light",
      fontStyle: "modern",
      visualStyle: "minimal",
      tone: baseTone,
    };
  }

  if (preset === "high-contrast") {
    return {
      primaryColor: "#111111",
      secondaryColor: "#FACC15",
      backgroundStyle: "dark",
      fontStyle: "bold",
      visualStyle: "minimal",
      tone: "bold",
    };
  }

  return {
    primaryColor: "#161617",
    secondaryColor: "#F28C28",
    backgroundStyle: "dark",
    fontStyle: "bold",
    visualStyle: "minimal",
    tone: baseTone,
  };
}

const selectedBusiness = computed(
  () => memberships.value.find((membership) => membership.businessId === selectedBusinessId.value) ?? memberships.value[0] ?? null,
);

function resolveVisualEyebrow(variation: LinkedInPostVariation): string | undefined {
  return (
    selectedBusiness.value?.business.brandName ||
    selectedBusiness.value?.business.name ||
    variation.angle
  )?.trim();
}

function resolveVisualFooter(): string | undefined {
  const business = selectedBusiness.value?.business;
  return extractVisualFooterLabel(business?.websiteUrl || business?.brandName || business?.name);
}

function resolveVisualHighlight(
  key: string,
  headline: string,
  supportingText: string,
): string | undefined {
  const mode = resolveVisualHighlightMode(key);

  if (mode === "manual") {
    const manualValue = sanitizeVisualPhrase(manualVisualHighlights.value[key] ?? "", 56);
    return manualValue || undefined;
  }

  return sanitizeVisualPhrase(
    extractVisualHighlightCandidate(headline) || extractVisualHighlightCandidate(supportingText),
    56,
  ) || undefined;
}

function buildVisualRequest(
  variation: LinkedInPostVariation,
  templateType: VisualTemplateType,
  preset: VisualStylePreset,
): Parameters<typeof requestVisualGeneration>[0] {
  const key = getVariationKey(variation);
  const lines = extractLines(variation.content);
  const headline = summarizeSentence(lines[0] ?? topic.value, templateType === "contrarian" ? 88 : templateType === "carousel" ? 82 : 108);
  const supportingText = summarizeSentence(lines[1] ?? `${tone.value} LinkedIn insight`, 88);
  const footerText = resolveVisualFooter();
  const eyebrowText = resolveVisualEyebrow(variation);
  const highlightText = resolveVisualHighlight(key, headline, supportingText);
  const closingText =
    templateType === "quote"
      ? summarizeSentence(lines[1] ?? lines[2] ?? "I was wrong.", 68)
      : undefined;

  return {
    businessId: selectedBusinessId.value || undefined,
    templateType,
    content: {
      headline,
      supportingText:
        templateType === "carousel" || templateType === "contrarian"
          ? supportingText
          : undefined,
      bulletPoints: templateType === "insight" ? deriveBulletPoints(variation.content) : undefined,
      highlightText,
      eyebrowText,
      footerText,
      closingText,
    },
    brandKit: resolveBrandKitPreset(preset),
    watermarkMode: "auto",
    captionFooterCredit: activeCaptionFooterCredit.value,
  };
}

const connectedLinkedInAccount = computed(() =>
  socialAccounts.value.find(
    (account) => account.platform === "linkedin" && account.status === "connected",
  ),
);
const accessMatchesSelectedBusiness = computed(
  () => productAccess.value?.businessId === selectedBusinessId.value,
);
const contentGenerationEnabled = computed(
  () => !accessMatchesSelectedBusiness.value || isFeatureEnabled("content_generation"),
);
const repurposeEnabled = computed(
  () => !accessMatchesSelectedBusiness.value || isFeatureEnabled("capture_remix"),
);
const visualGenerationEnabled = computed(
  () => !accessMatchesSelectedBusiness.value || isFeatureEnabled("visual_generation"),
);
const schedulerEnabled = computed(
  () => !accessMatchesSelectedBusiness.value || isFeatureEnabled("scheduler"),
);
const accessLimits = computed(() =>
  accessMatchesSelectedBusiness.value ? productAccess.value?.limits : undefined,
);
const postsRemaining = computed(() => accessLimits.value?.postsRemaining ?? null);
const scheduledQueueLimit = computed(() => accessLimits.value?.scheduledQueueLimit ?? null);
const scheduledQueueRemaining = computed(() => accessLimits.value?.scheduledQueueRemaining ?? null);
const hasScheduledQueuePreview = computed(() => scheduledQueueLimit.value !== null);
const queueLimitReached = computed(
  () => hasScheduledQueuePreview.value && scheduledQueueRemaining.value === 0,
);
const canGeneratePosts = computed(
  () =>
    contentGenerationEnabled.value &&
    (postsRemaining.value === null || postsRemaining.value > 0),
);
const canRepurposeContent = computed(
  () =>
    repurposeEnabled.value &&
    (postsRemaining.value === null || postsRemaining.value > 0),
);
const canGenerateVisuals = computed(
  () =>
    visualGenerationEnabled.value &&
    (postsRemaining.value === null || postsRemaining.value > 0),
);
const limitPills = computed(() => {
  if (!accessLimits.value) {
    return [];
  }

  return [
    `Posts left ${accessLimits.value.postsRemaining}`,
    `Emails left ${accessLimits.value.emailsRemaining}`,
  ];
});
const schedulerLockedMessage = computed(() => {
  if (!selectedBusinessId.value || !accessMatchesSelectedBusiness.value) {
    return "";
  }

  if (productAccess.value?.access?.readOnly) {
    return "This workspace is temporarily in read-only mode.";
  }

  if (!schedulerEnabled.value) {
    return "Scheduling is not enabled for this workspace yet.";
  }

  if (postsRemaining.value === 0) {
    return "You've reached your daily post limit. Upgrade or try tomorrow.";
  }

  if (queueLimitReached.value) {
    return "Plan your week in advance and stay consistent. Upgrade to unlock scheduling queue.";
  }

  return "";
});
const queuePreviewMessage = computed(() => {
  if (!selectedBusinessId.value || !accessMatchesSelectedBusiness.value || !hasScheduledQueuePreview.value) {
    return "";
  }

  if (queueLimitReached.value) {
    return "";
  }

  return "Queue one post for free so you can feel the timing lift. Upgrade when you want the rest of the week lined up.";
});

const generatedVisualEntries = computed<GeneratedVisualEntry[]>(() =>
  variations.value.flatMap((variation) => {
    const key = getVariationKey(variation);
    const visual = generatedVisuals.value[key];

    if (!visual) {
      return [];
    }

    return [{ key, variation, visual }];
  }),
);

const publishableVisualEntries = computed(() =>
  generatedVisualEntries.value.filter((entry) => isPublishableImageMimeType(entry.visual.mimeType)),
);

const activeCaptionFooterCredit = computed(
  () => {
    const apiCredit = repurposeResult.value?.captionFooterCredit?.trim();

    if (!apiCredit || apiCredit === "Generated with FounderContent AI") {
      return DEFAULT_CAPTION_FOOTER_CREDIT;
    }

    return apiCredit;
  },
);

const showReferralBanner = computed(
  () => shareLoopCount.value > 0 || scheduledPosts.value.length > 0,
);

function createScorePreviewAsset(variation: LinkedInPostVariation): ContentAsset {
  const timestamp = new Date().toISOString();

  return {
    id: `preview-${variation.angle}`,
    businessId: selectedBusinessId.value || undefined,
    contentType: "post",
    contentBody: variation.content,
    status: "review",
    pipelineStage: "review",
    sourceKind: "generated",
    title: variation.angle,
    textContent: variation.content,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function getVariationScoreResult(variation: LinkedInPostVariation) {
  return calculateContentScore(createScorePreviewAsset(variation));
}

function getVariationScoreBadge(variation: LinkedInPostVariation): string {
  if (typeof variation.quality?.overall === "number") {
    return `POV quality ${variation.quality.overall}/100`;
  }

  return `Scored ${getVariationScoreResult(variation).score}/100 on FounderContent AI`;
}

function getVariationReadyLabel(variation: LinkedInPostVariation): string {
  if (typeof variation.quality?.overall === "number") {
    if (variation.quality.overall >= 84) {
      return "Strong founder POV";
    }

    if (variation.quality.overall >= 70) {
      return "Nearly publish-ready";
    }

    return "Needs sharper stance";
  }

  const score = getVariationScoreResult(variation);

  if (score.score >= 84) {
    return "Ready to post";
  }

  if (score.score >= 70) {
    return "One strong edit away";
  }

  return "Fix once before posting";
}

function getVariationImpactHint(variation: LinkedInPostVariation): string {
  if (variation.pov?.summary) {
    return variation.pov.summary;
  }

  const score = getVariationScoreResult(variation);
  return `Expected reach: ${score.expectedReach}. ${score.engagementOutlook}`;
}

const selectedCaptionContent = computed(() => {
  const selectedVariation =
    variations.value.find((variation) => getVariationKey(variation) === selectedCaptionKey.value) ??
    variations.value[0];

  return selectedVariation?.content ?? "";
});

function buildBrandedCaption(baseCaption: string): string {
  const normalizedBaseCaption = baseCaption.trim();
  const normalizedSelectedCaption = selectedCaptionContent.value.trim();
  const normalizedCaptionWithHashtags = captionWithHashtags.value.trim();
  const hashtagsBlock = generatedHashtags.value.join(" ").trim();

  if (
    normalizedCaptionWithHashtags &&
    normalizeLine(normalizedBaseCaption) === normalizeLine(normalizedSelectedCaption)
  ) {
    return appendCaptionFooterCredit(
      normalizedCaptionWithHashtags,
      activeCaptionFooterCredit.value,
    );
  }

  const withHashtags =
    hashtagsBlock && !normalizedBaseCaption.includes(hashtagsBlock)
      ? `${normalizedBaseCaption}\n\n${hashtagsBlock}`
      : normalizedBaseCaption;

  return appendCaptionFooterCredit(withHashtags, activeCaptionFooterCredit.value);
}

const scheduledCaptionPreview = computed(() => buildBrandedCaption(selectedCaptionContent.value));

function distributionFormatLabel(format: GrowthDistributionFormat): string {
  if (format === "thread") {
    return "Twitter thread";
  }

  if (format === "email") {
    return "email draft";
  }

  if (format === "video") {
    return "short video script";
  }

  return "LinkedIn carousel";
}

const canSchedulePost = computed(() => {
  return (
    schedulerEnabled.value &&
    !queueLimitReached.value &&
    Boolean(selectedBusinessId.value) &&
    Boolean(connectedLinkedInAccount.value) &&
    publishableVisualEntries.value.length >= 2 &&
    scheduledCaptionPreview.value.trim() !== ""
  );
});

const assistSuggestions = useAiAssistSuggestions([
  {
    id: "pick-one-angle",
    title: "Commit to one angle before generating visuals",
    description: "Choose the strongest post variation first. Visual generation gets more coherent when the caption source is stable.",
    minimumLevel: "minimal",
  },
  {
    id: "use-best-time",
    title: "Use the recommended posting slots",
    description: "The scheduler blends workspace history and global timing heuristics. Start there before manually choosing a slot.",
    minimumLevel: "balanced",
  },
  {
    id: "tighten-workspace-ui",
    title: "Switch to creator mode for drafting sessions",
    description: "Creator layout keeps the writing flow tighter when you are generating, refining, and scheduling content back to back.",
    minimumLevel: "proactive",
    ctaLabel: "Adjust preferences",
    ctaTo: appRoutes.settingsPreferences,
  },
]);

async function loadPublishingContext(businessId: string) {
  if (!businessId) {
    socialAccounts.value = [];
    scheduledPosts.value = [];
    return;
  }

  if (accessMatchesSelectedBusiness.value && !schedulerEnabled.value) {
    socialAccounts.value = [];
    scheduledPosts.value = [];
    schedulingContextMessage.value = schedulerLockedMessage.value;
    return;
  }

  isLoadingPublishingContext.value = true;

  try {
    const [accountsResponse, scheduledPostsResponse] = await Promise.all([
      requestSocialAccounts(businessId),
      requestScheduledPosts(businessId),
    ]);

    socialAccounts.value = accountsResponse.accounts;
    scheduledPosts.value = scheduledPostsResponse.scheduledPosts;
    schedulingContextMessage.value = "";
  } catch (error) {
    socialAccounts.value = [];
    scheduledPosts.value = [];
    schedulingContextMessage.value =
      error instanceof Error
        ? error.message
        : "Authentication is required to load LinkedIn publishing data.";
  } finally {
    isLoadingPublishingContext.value = false;
  }
}

async function initializePublishingContext() {
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

      await loadPublishingContext(selectedBusinessId.value);
    }
  } catch (error) {
    memberships.value = [];
    schedulingContextMessage.value =
      error instanceof Error
        ? error.message
        : "Authentication is required to use LinkedIn scheduling.";
  }
}

function applyHashtagResponse(response: GenerateHashtagsResponse) {
  generatedHashtags.value = response.hashtags;
  captionWithHashtags.value = response.captionWithHashtags;
  hashtagMessage.value =
    response.hashtags.length > 0
      ? "Hashtags are auto-attached to the scheduling preview."
      : "No hashtags generated yet.";
}

async function loadRecommendedPostTimes(businessId: string) {
  if (!auth.isReady.value || !auth.isAuthenticated.value || !businessId) {
    recommendedSlots.value = [];
    recommendedSlotsMessage.value = "";
    recommendedTimezone.value = "UTC";
    return;
  }

  if (accessMatchesSelectedBusiness.value && !schedulerEnabled.value) {
    recommendedSlots.value = [];
    recommendedSlotsMessage.value = schedulerLockedMessage.value;
    recommendedTimezone.value = "UTC";
    return;
  }

  const requestId = ++recommendedSlotsRequestId;
  isLoadingRecommendedSlots.value = true;

  try {
    const response = await requestRecommendedPostTimes(businessId, "carousel");

    if (requestId !== recommendedSlotsRequestId) {
      return;
    }

    recommendedSlots.value = response.slots;
    recommendedTimezone.value = response.timezone;
    recommendedSlotsMessage.value = response.usedHistory
      ? "Recommendations blend baseline timing heuristics with your recent posting history."
      : "Recommendations use baseline professional-feed timing until more workspace history exists.";
  } catch (error) {
    if (requestId !== recommendedSlotsRequestId) {
      return;
    }

    recommendedSlots.value = [];
    recommendedSlotsMessage.value =
      error instanceof Error ? error.message : "Unable to load best-time suggestions.";
  } finally {
    if (requestId === recommendedSlotsRequestId) {
      isLoadingRecommendedSlots.value = false;
    }
  }
}

async function loadHashtagSuggestions() {
  if (selectedBusinessId.value && accessMatchesSelectedBusiness.value && !contentGenerationEnabled.value) {
    generatedHashtags.value = [];
    captionWithHashtags.value = "";
    hashtagMessage.value = "Content generation is not enabled for this workspace.";
    return;
  }

  const contentText = selectedCaptionContent.value.trim();

  if (!contentText) {
    generatedHashtags.value = [];
    captionWithHashtags.value = "";
    hashtagMessage.value = "";
    return;
  }

  const requestId = ++hashtagRequestId;
  isGeneratingHashtags.value = true;

  try {
    const response = await requestGeneratedHashtags({
      businessId: selectedBusinessId.value || undefined,
      contentText,
      contentType: "carousel",
      targetCount: 10,
    });

    if (requestId !== hashtagRequestId) {
      return;
    }

    applyHashtagResponse(response);
  } catch (error) {
    if (requestId !== hashtagRequestId) {
      return;
    }

    generatedHashtags.value = [];
    captionWithHashtags.value = "";
    hashtagMessage.value =
      error instanceof Error ? error.message : "Unable to generate hashtags right now.";
  } finally {
    if (requestId === hashtagRequestId) {
      isGeneratingHashtags.value = false;
    }
  }
}

function applyRecommendedSlot(slot: RecommendedPostTimeSlot) {
  scheduleAt.value = toLocalDatetimeValue(new Date(slot.scheduledAt));
  scheduleFeedback.value = `Recommended slot applied: ${slot.localLabel}.`;
  scheduleError.value = "";
}

function handleRepurposeVoiceTranscript(text: string) {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return;
  }

  repurposeInputType.value = "voice";
  repurposeVoiceTranscript.value = normalizedText;
  repurposeFeedback.value = "Voice note transcribed. Review it, then repurpose it.";
  repurposeError.value = "";
}

function scrollToRepurposePanel() {
  document.getElementById("repurpose-panel")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function applyRepurposeSeed() {
  const seed = consumeRepurposeSeed();

  if (!seed) {
    return;
  }

  repurposeInputType.value = "text";
  repurposeText.value = seed.text;
  repurposeFeedback.value = seed.format
    ? `Loaded a ${distributionFormatLabel(seed.format)} seed into the repurpose engine.`
    : seed.source === "history"
      ? "Loaded a published post from history into the repurpose engine."
      : seed.source === "result"
        ? "Loaded your saved draft into the repurpose engine."
        : "Loaded a workspace post seed into the repurpose engine.";
  repurposeError.value = "";

  if (seed.title) {
    selectedHook.value = seed.title;
  }
}

async function handleRepurposeSubmit() {
  if (!canRepurposeContent.value) {
    repurposeError.value =
      postsRemaining.value === 0
        ? "You've reached your daily post limit. Upgrade or try tomorrow."
        : "Repurpose is not enabled for this workspace.";
    return;
  }

  isRepurposing.value = true;
  repurposeError.value = "";
  repurposeFeedback.value = "";
  errorMessage.value = "";
  copyFeedback.value = "";

  try {
    const response = await requestRepurposeContent({
      businessId: selectedBusinessId.value || undefined,
      inputType: repurposeInputType.value,
      text: repurposeInputType.value === "text" ? repurposeText.value : undefined,
      url: repurposeInputType.value === "url" ? repurposeUrl.value : undefined,
      voiceTranscript:
        repurposeInputType.value === "voice" ? repurposeVoiceTranscript.value : undefined,
      tone: tone.value,
    });

    repurposeResult.value = response;
    variations.value = response.variations;
    topic.value = response.idea.title;
    selectedHook.value = response.hooks[0] ?? "";
    selectedCaptionKey.value = response.variations[0]?.angle ?? "";
    repurposeFeedback.value = `${response.quickSignals.readyLabel}. ${response.quickSignals.formatLabel}`;
    resetVisualState();
    await setActiveBusinessId(selectedBusinessId.value || null);

    try {
      await trackAnalyticsEvent({
        eventType: "content_type_selected",
        businessId: selectedBusinessId.value || undefined,
        metadata: {
          source: "repurpose-engine",
          contentType: "post",
          tone: tone.value,
          inputType: response.inputType,
        },
      });
    } catch {
      // Repurpose output should remain usable even if analytics tracking fails.
    }
  } catch (error) {
    repurposeError.value =
      error instanceof Error ? error.message : "Unable to repurpose that source right now.";
  } finally {
    isRepurposing.value = false;
  }
}

async function handleSubmit() {
  if (!canGeneratePosts.value) {
    errorMessage.value =
      postsRemaining.value === 0
        ? "You've reached your daily post limit. Upgrade or try tomorrow."
        : "Content generation is not enabled for this workspace.";
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";
  scheduleFeedback.value = "";
  scheduleError.value = "";

  try {
    const response = await requestLinkedInPostGeneration({
      topic: topic.value,
      tone: tone.value,
      length: length.value,
      selectedHook: selectedHook.value || undefined,
      businessId: selectedBusinessId.value || undefined,
    });

    repurposeResult.value = null;
    variations.value = response.variations;
    selectedCaptionKey.value = response.variations[0]?.angle ?? "";
    resetVisualState();
    await setActiveBusinessId(selectedBusinessId.value || null);

    try {
      await trackAnalyticsEvent({
        eventType: "content_type_selected",
        businessId: selectedBusinessId.value || undefined,
        metadata: {
          source: "linkedin-post-generator",
          contentType: "post",
          tone: tone.value,
        },
      });
    } catch {
      // Generation should not fail if analytics tracking is unavailable.
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to generate LinkedIn posts.";
  } finally {
    isLoading.value = false;
  }
}

async function copyVariation(content: string) {
  copyFeedback.value = "";

  try {
    await navigator.clipboard.writeText(content);
    copyFeedback.value = "Post copied.";
  } catch (error) {
    copyFeedback.value = error instanceof Error ? error.message : "Unable to copy post.";
    return;
  }

  try {
    await trackAnalyticsEvent({
      eventType: "output_copied",
      businessId: selectedBusinessId.value || undefined,
      metadata: {
        source: "linkedin-post-generator",
        contentType: "post",
        tone: tone.value,
        preview: content.slice(0, 140),
      },
    });
  } catch {
    // Copy succeeded; analytics failure should not block the UX.
  }
}

function buildThreadDraft(content: string): string {
  const lines = extractLines(content);
  const hook = truncateLine(lines[0] ?? "A founder lesson worth unpacking.", 110);
  const supportingLines = lines.slice(1).filter((line) => line.length > 0);
  const threadSteps =
    supportingLines.length > 0
      ? supportingLines.slice(0, 4)
      : deriveBulletPoints(content);

  const numberedSteps = threadSteps.map((line, index) => `${index + 1}/${threadSteps.length + 1} ${truncateLine(line, 180)}`);

  return [
    `1/${threadSteps.length + 1} ${hook}`,
    ...numberedSteps,
    `${threadSteps.length + 1}/${threadSteps.length + 1} ${truncateLine("If this resonated, reply and I'll break down more founder execution systems.", 180)}`,
  ].join("\n\n");
}

function buildVideoScriptDraft(content: string): string {
  const lines = extractLines(content);
  const hook = truncateLine(lines[0] ?? "Here is the founder lesson nobody tells you.", 100);
  const supportingPoints = deriveBulletPoints(content);

  return [
    `Hook: ${hook}`,
    `Scene 1: ${supportingPoints[0] ?? "Name the real tension or mistake."}`,
    `Scene 2: ${supportingPoints[1] ?? "Explain what changed once the lesson became clear."}`,
    `CTA: ${supportingPoints[2] ?? "Invite the audience to comment or follow for the next breakdown."}`,
  ].join("\n");
}

function buildEmailDraft(content: string): string {
  const lines = extractLines(content);
  const subject = truncateLine(lines[0] ?? "A founder lesson worth sharing", 72);

  return [
    `Subject: ${subject}`,
    "",
    lines.join("\n\n"),
    "",
    "If this resonated, reply and tell me what you're building right now.",
  ].join("\n");
}

async function copyDistributionDraft(
  format: GrowthDistributionFormat,
  variation: LinkedInPostVariation,
) {
  if (format === "carousel") {
    repurposeInputType.value = "text";
    repurposeText.value = variation.content;
    repurposeFeedback.value = "Loaded this post into the carousel remix flow.";
    repurposeError.value = "";
    await nextTick();
    scrollToRepurposePanel();
    return;
  }

  const distributionDraft =
    format === "thread"
      ? buildThreadDraft(variation.content)
      : format === "email"
        ? buildEmailDraft(variation.content)
      : buildVideoScriptDraft(variation.content);

  try {
    await navigator.clipboard.writeText(distributionDraft);
    copyFeedback.value = `${distributionFormatLabel(format)} draft copied.`;
  } catch (error) {
    copyFeedback.value =
      error instanceof Error ? error.message : `Unable to copy the ${distributionFormatLabel(format)} draft.`;
    return;
  }

  try {
    await trackAnalyticsEvent({
      eventType: "output_copied",
      businessId: selectedBusinessId.value || undefined,
      metadata: {
        source: "distribution-loop",
        format,
        contentType: "post",
        preview: distributionDraft.slice(0, 140),
      },
    });
  } catch {
    // Distribution drafts should remain usable even if analytics tracking fails.
  }
}

async function copyAndShareVariation(variation: LinkedInPostVariation) {
  const shareCaption = buildBrandedCaption(variation.content);
  const scoreBadge = getVariationScoreBadge(variation);

  try {
    await navigator.clipboard.writeText(shareCaption);
  } catch (error) {
    copyFeedback.value =
      error instanceof Error ? error.message : "Unable to copy the branded share caption.";
    return;
  }

  let shareMessage = `${scoreBadge}. Caption copied.`;

  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: variation.angle,
        text: shareCaption,
      });
      shareMessage = `${scoreBadge}. Caption copied and share sheet opened.`;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        shareMessage = `${scoreBadge}. Caption copied. Share sheet could not be opened.`;
      }
    }
  } else {
    shareMessage = `${scoreBadge}. Caption copied. Paste it into LinkedIn to share.`;
  }

  copyFeedback.value = shareMessage;
  shareLoopCount.value += 1;

  try {
    await trackAnalyticsEvent({
      eventType: "output_copied",
      businessId: selectedBusinessId.value || undefined,
      metadata: {
        source: "copy-share",
        contentType: "post",
        tone: tone.value,
        branded: true,
        preview: shareCaption.slice(0, 140),
      },
    });
  } catch {
    // Copy and share succeeded; analytics failure should not block the UX.
  }
}

async function postVariationToLinkedIn(variation: LinkedInPostVariation) {
  const shareCaption = buildBrandedCaption(variation.content);
  const scoreBadge = getVariationScoreBadge(variation);

  try {
    await navigator.clipboard.writeText(shareCaption);
  } catch (error) {
    copyFeedback.value =
      error instanceof Error ? error.message : "Unable to copy the LinkedIn caption.";
    return;
  }

  if (typeof window !== "undefined") {
    window.open("https://www.linkedin.com/feed/", "_blank", "noopener,noreferrer");
  }

  shareLoopCount.value += 1;
  copyFeedback.value = `${scoreBadge}. LinkedIn opened in a new tab with the optimized caption copied.`;

  try {
    await trackAnalyticsEvent({
      eventType: "output_copied",
      businessId: selectedBusinessId.value || undefined,
      metadata: {
        source: "post-on-linkedin",
        contentType: "post",
        tone: tone.value,
        branded: true,
        preview: shareCaption.slice(0, 140),
      },
    });
  } catch {
    // Opening LinkedIn should remain fast even if analytics tracking fails.
  }
}

async function remixVariation(variation: LinkedInPostVariation) {
  repurposeInputType.value = "text";
  repurposeText.value = variation.content;
  repurposeError.value = "";
  repurposeFeedback.value = "Remixing this post into fresh angles...";

  await nextTick();
  scrollToRepurposePanel();
  await handleRepurposeSubmit();
}

async function copyInviteText() {
  try {
    await navigator.clipboard.writeText(
      "I am using FounderContent AI to turn one idea into posts, visuals, and a weekly content loop. Want the link?",
    );
    copyFeedback.value = "Invite message copied.";
  } catch (error) {
    copyFeedback.value =
      error instanceof Error ? error.message : "Unable to copy the invite message.";
  }
}

async function generateVisual(variation: LinkedInPostVariation) {
  if (!canGenerateVisuals.value) {
    visualErrors.value = {
      ...visualErrors.value,
      [getVariationKey(variation)]:
        postsRemaining.value === 0
          ? "You've reached your daily post limit. Upgrade or try tomorrow."
          : "Visual generation is not enabled for this workspace.",
    };
    return;
  }

  const key = getVariationKey(variation);
  const templateType = resolveVisualTemplateSelection(key);
  const preset = resolveVisualStyleSelection(key);

  visualLoading.value = {
    ...visualLoading.value,
    [key]: true,
  };
  visualErrors.value = {
    ...visualErrors.value,
    [key]: "",
  };

  try {
    const generatedVisual = await requestVisualGeneration(
      buildVisualRequest(variation, templateType, preset),
    );

    generatedVisuals.value = {
      ...generatedVisuals.value,
      [key]: generatedVisual,
    };
    await setActiveBusinessId(selectedBusinessId.value || null);
  } catch (error) {
    visualErrors.value = {
      ...visualErrors.value,
      [key]:
        error instanceof Error ? error.message : "Unable to generate a visual for this post.",
    };
  } finally {
    visualLoading.value = {
      ...visualLoading.value,
      [key]: false,
    };
  }
}

async function connectLinkedIn() {
  if (!schedulerEnabled.value) {
    scheduleError.value = "Scheduling is not enabled for this workspace yet.";
    return;
  }

  if (!selectedBusinessId.value) {
    scheduleError.value = "Create or select a workspace before connecting LinkedIn.";
    return;
  }

  isConnectingLinkedIn.value = true;
  scheduleError.value = "";

  try {
    const response = await requestLinkedInSocialAuthStart({
      businessId: selectedBusinessId.value,
      returnPath: route.path,
    });

    window.location.assign(response.authorizationUrl);
  } catch (error) {
    scheduleError.value =
      error instanceof Error ? error.message : "Unable to start LinkedIn connection.";
  } finally {
    isConnectingLinkedIn.value = false;
  }
}

async function scheduleCarouselPost() {
  if (!schedulerEnabled.value) {
    scheduleError.value = schedulerLockedMessage.value || "Scheduling is not enabled.";
    return;
  }

  if (queueLimitReached.value) {
    scheduleError.value = schedulerLockedMessage.value || "Plan your week in advance and stay consistent. Upgrade to unlock scheduling queue.";
    return;
  }

  if (!selectedBusinessId.value) {
    scheduleError.value = "Select a workspace before scheduling.";
    return;
  }

  if (!connectedLinkedInAccount.value) {
    scheduleError.value = "Connect a LinkedIn account before scheduling.";
    return;
  }

  if (publishableVisualEntries.value.length < 2) {
    scheduleError.value =
      "Generate at least two PNG or JPG visuals before scheduling a LinkedIn carousel.";
    return;
  }

  isScheduling.value = true;
  scheduleError.value = "";
  scheduleFeedback.value = "";

  const scheduleRequest = {
    businessId: selectedBusinessId.value,
    platform: "linkedin" as const,
    contentText: scheduledCaptionPreview.value,
    assetGroupId: `linkedin-carousel-${Date.now()}`,
    slides: publishableVisualEntries.value.map((entry) => ({
      imageDataUrl: entry.visual.imageDataUrl,
      mimeType: entry.visual.mimeType,
      altText: `${entry.variation.angle} slide`,
    })),
    scheduledAt: parseLocalDatetimeValue(scheduleAt.value),
  };

  try {
    let response;

    try {
      response = await requestSchedulePost(scheduleRequest);
    } catch (error) {
      const warnings = extractSchedulingWarnings(error);

      if (warnings.length === 0 || !confirmSchedulingWarnings(warnings)) {
        throw error;
      }

      response = await requestSchedulePost({
        ...scheduleRequest,
        ignoreSafetyWarnings: true,
      });
      scheduleFeedback.value = "Carousel scheduled with a manual safety override.";
    }

    if (!scheduleFeedback.value) {
      scheduleFeedback.value = `Carousel scheduled for ${new Date(
        response.scheduledPost.scheduledAt,
      ).toLocaleString()}.`;
    }
    scheduledPosts.value = [response.scheduledPost, ...scheduledPosts.value].slice(0, 10);
    scheduleAt.value = toLocalDatetimeValue(new Date(response.scheduledPost.scheduledAt));
    const accessState = await setActiveBusinessId(selectedBusinessId.value);
    const queueFilledByThisSchedule =
      accessState?.limits?.scheduledQueueLimit !== null
      && accessState?.limits?.scheduledQueueRemaining === 0;

    if (queueFilledByThisSchedule) {
      scheduleFeedback.value = "Nice — your post is queued for peak engagement. Upgrade to plan the rest of your week.";
    }
    await loadPublishingContext(selectedBusinessId.value);
  } catch (error) {
    scheduleError.value =
      extractScheduledQueueLimitMessage(error)
      ?? (error instanceof Error ? error.message : "Unable to schedule the carousel post.");
  } finally {
    isScheduling.value = false;
  }
}

watch(
  selectedBusinessId,
  async (businessId, previousBusinessId) => {
    if (!auth.isReady.value || !auth.isAuthenticated.value || !isProductAccessReady.value || !businessId || businessId === previousBusinessId) {
      return;
    }

    const accessState = await setActiveBusinessId(businessId);

    if (accessState?.activeBusinessId && accessState.activeBusinessId !== businessId) {
      selectedBusinessId.value = accessState.activeBusinessId;
      return;
    }

    await Promise.all([loadPublishingContext(businessId), loadRecommendedPostTimes(businessId)]);
    await loadHashtagSuggestions();
  },
);

watch(
  () => [auth.isReady.value, auth.isAuthenticated.value, isProductAccessReady.value] as const,
  async ([authReady, isAuthenticated, accessReady], previousValue) => {
    const [previousAuthReady, previousIsAuthenticated, previousAccessReady] = previousValue ?? [false, false, false];
    if (
      !authReady ||
      !isAuthenticated ||
      !accessReady ||
      (authReady === previousAuthReady && isAuthenticated === previousIsAuthenticated && accessReady === previousAccessReady)
    ) {
      return;
    }

    await initializePublishingContext();

    if (selectedBusinessId.value && schedulerEnabled.value) {
      await loadRecommendedPostTimes(selectedBusinessId.value);
    }

    await loadHashtagSuggestions();
  },
);

watch(
  selectedCaptionContent,
  async (content, previousContent) => {
    if (content === previousContent) {
      return;
    }

    await loadHashtagSuggestions();
  },
);

onMounted(async () => {
  applyRepurposeSeed();

  if (!auth.isReady.value || !auth.isAuthenticated.value || !isProductAccessReady.value) {
    return;
  }

  await initializePublishingContext();

  if (selectedBusinessId.value && schedulerEnabled.value) {
    await loadRecommendedPostTimes(selectedBusinessId.value);
  }

  await loadHashtagSuggestions();

  const linkedinStatus = typeof route.query.linkedin === "string" ? route.query.linkedin : undefined;
  const statusMessage = typeof route.query.message === "string" ? route.query.message : undefined;

  if (linkedinStatus === "connected") {
    scheduleFeedback.value = "LinkedIn account connected.";
    if (selectedBusinessId.value) {
      await loadPublishingContext(selectedBusinessId.value);
    }
  } else if (linkedinStatus === "error") {
    scheduleError.value = statusMessage || "LinkedIn connection failed.";
  }

  if (linkedinStatus || statusMessage) {
    await router.replace({
      path: route.path,
      query: {},
    });
  }
});
</script>

<template>
  <main class="page-shell">
    <section class="hero">
      <p class="eyebrow">/linkedin-post-generator</p>
      <h1>LinkedIn Post Generator</h1>
      <p class="description">
        Turn any source into posts, hooks, visuals, and a LinkedIn-ready growth loop.
      </p>
      <div v-if="limitPills.length > 0" class="hero-limit-row">
        <span v-for="pill in limitPills" :key="pill" class="signal-chip muted">{{ pill }}</span>
        <span v-if="productAccess?.access?.readOnly" class="signal-chip">Read-only mode</span>
      </div>
    </section>

    <section id="repurpose-panel" class="card repurpose-panel">
      <div class="repurpose-header">
        <div>
          <p class="result-label">Repurpose Engine</p>
          <h2>Voice, text, or URL → multiple content outputs</h2>
          <p class="description small">
            Start with a raw input, expand it into hooks, variations, and a carousel draft, then move
            straight into visuals and scheduling.
          </p>
        </div>
      </div>

      <div class="repurpose-type-row">
        <button
          type="button"
          class="secondary-button"
          :data-active="repurposeInputType === 'text'"
          @click="repurposeInputType = 'text'"
        >
          Text
        </button>
        <button
          type="button"
          class="secondary-button"
          :data-active="repurposeInputType === 'voice'"
          @click="repurposeInputType = 'voice'"
        >
          Voice
        </button>
        <button
          type="button"
          class="secondary-button"
          :data-active="repurposeInputType === 'url'"
          @click="repurposeInputType = 'url'"
        >
          URL
        </button>
      </div>

      <div class="form-grid">
        <label v-if="repurposeInputType === 'text'">
          <span>Source Text</span>
          <textarea
            v-model="repurposeText"
            rows="6"
            placeholder="Paste a note, competitor insight, tweet, or rough draft."
          />
        </label>

        <div v-else-if="repurposeInputType === 'voice'" class="voice-block">
          <VoiceRecorder
            title="Capture a post by voice"
            hint="Record one rough thought. It will be transcribed and fed into the repurpose engine."
            @transcribed="handleRepurposeVoiceTranscript"
          />

          <label>
            <span>Transcript</span>
            <textarea
              v-model="repurposeVoiceTranscript"
              rows="6"
              placeholder="Your voice transcript will appear here."
            />
          </label>
        </div>

        <label v-else>
          <span>Public URL</span>
          <input
            v-model="repurposeUrl"
            type="url"
            placeholder="https://example.com/post-or-article"
          />
        </label>

        <div class="action-row">
          <button type="button" :disabled="isRepurposing || !canRepurposeContent" @click="handleRepurposeSubmit">
            {{ isRepurposing ? "Repurposing..." : "Repurpose into content" }}
          </button>
        </div>
      </div>
    </section>

    <form class="card form-grid" @submit.prevent="handleSubmit">
      <label>
        <span>Topic</span>
        <input v-model="topic" type="text" placeholder="startup failure lesson" />
      </label>

      <label>
        <span>Tone</span>
        <input v-model="tone" type="text" placeholder="storytelling" />
      </label>

      <label>
        <span>Length</span>
        <input v-model="length" type="text" placeholder="medium" />
      </label>

      <label>
        <span>Selected Hook (optional)</span>
        <input
          v-model="selectedHook"
          type="text"
          placeholder="The mistake that almost killed my startup"
        />
      </label>

      <button type="submit" :disabled="isLoading || !canGeneratePosts">
        {{ isLoading ? "Generating..." : "Generate posts" }}
      </button>
    </form>

    <p v-if="repurposeError" class="feedback error">{{ repurposeError }}</p>
    <p v-if="repurposeFeedback" class="feedback">{{ repurposeFeedback }}</p>
    <p v-if="errorMessage" class="feedback error">{{ errorMessage }}</p>
    <p v-if="copyFeedback" class="feedback">{{ copyFeedback }}</p>

    <AiAssistPanel title="Writing Assist" :suggestions="assistSuggestions" />

    <section v-if="repurposeResult" class="card repurpose-summary">
      <div class="signal-strip">
        <span class="signal-chip">{{ repurposeResult.quickSignals.readyLabel }}</span>
        <span class="signal-chip muted">{{ repurposeResult.quickSignals.formatLabel }}</span>
      </div>

      <div class="repurpose-summary-grid">
        <article>
          <p class="result-label">Idea</p>
          <h2>{{ repurposeResult.idea.title }}</h2>
          <p class="description small">{{ repurposeResult.idea.angle }}</p>

          <p class="result-label">Hooks</p>
          <ul class="hook-list">
            <li v-for="hook in repurposeResult.hooks" :key="hook">{{ hook }}</li>
          </ul>
        </article>

        <article>
          <p class="result-label">Carousel Draft</p>
          <div class="carousel-draft-grid">
            <article
              v-for="(slide, index) in repurposeResult.carouselDraft.slides"
              :key="`${repurposeResult.carouselDraft.title}-${index}`"
              class="carousel-draft-card"
            >
              <strong>Slide {{ index + 1 }}</strong>
              <p>{{ slide.headline }}</p>
              <small>{{ slide.supportingText }}</small>
            </article>
          </div>
        </article>
      </div>
    </section>

    <section v-if="variations.length > 0" class="results-grid">
      <article v-for="variation in variations" :key="variation.angle" class="card">
        <p class="result-label">{{ variation.angle }}</p>
        <pre>{{ variation.content }}</pre>

        <section class="share-card">
          <div class="signal-strip share-signals">
            <span class="signal-chip">{{ getVariationReadyLabel(variation) }}</span>
            <span class="signal-chip muted">{{ getVariationScoreBadge(variation) }}</span>
          </div>

          <p class="description small">{{ getVariationImpactHint(variation) }}</p>

          <div class="signature-preview">
            —
            <br />
            {{ activeCaptionFooterCredit }}
          </div>

          <div class="action-row">
            <button type="button" class="secondary-button" @click="copyVariation(variation.content)">
              Copy post
            </button>
            <button type="button" @click="copyAndShareVariation(variation)">
              Copy + Share
            </button>
            <button type="button" class="secondary-button" @click="postVariationToLinkedIn(variation)">
              Post on LinkedIn
            </button>
            <button type="button" class="secondary-button" @click="remixVariation(variation)">
              Remix this post
            </button>
          </div>
        </section>

        <section class="distribution-loop">
          <p class="result-label">Turn this into</p>
          <div class="distribution-button-row">
            <button
              type="button"
              class="secondary-button"
              @click="copyDistributionDraft('thread', variation)"
            >
              Twitter thread
            </button>
            <button
              type="button"
              class="secondary-button"
              @click="copyDistributionDraft('email', variation)"
            >
              Email draft
            </button>
            <button
              type="button"
              class="secondary-button"
              @click="copyDistributionDraft('carousel', variation)"
            >
              LinkedIn carousel
            </button>
            <button
              type="button"
              class="secondary-button"
              @click="copyDistributionDraft('video', variation)"
            >
              Short video script
            </button>
          </div>
        </section>

        <div class="visual-controls">
          <label>
            <span>Template</span>
            <select
              :value="resolveVisualTemplateSelection(getVariationKey(variation))"
              @change="
                updateVisualTemplateSelection(
                  getVariationKey(variation),
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="quote">Contrast Quote</option>
              <option value="contrarian">Split Emphasis</option>
              <option value="carousel">Minimal Brand Card</option>
              <option value="insight">Insight Framework</option>
            </select>
          </label>

          <label>
            <span>Look</span>
            <select
              :value="resolveVisualStyleSelection(getVariationKey(variation))"
              @change="
                updateVisualStylePreset(
                  getVariationKey(variation),
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="brand-signal">Brand Signal</option>
              <option value="editorial-light">Editorial Light</option>
              <option value="high-contrast">High Contrast</option>
            </select>
          </label>

          <label>
            <span>Highlight</span>
            <select
              :value="resolveVisualHighlightMode(getVariationKey(variation))"
              @change="
                updateVisualHighlightMode(
                  getVariationKey(variation),
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="auto">Auto</option>
              <option value="manual">Manual</option>
            </select>
          </label>

          <label v-if="resolveVisualHighlightMode(getVariationKey(variation)) === 'manual'">
            <span>Phrase</span>
            <input
              type="text"
              :value="manualVisualHighlights[getVariationKey(variation)] ?? ''"
              maxlength="56"
              placeholder="Pick the phrase that should hit hardest"
              @input="
                updateManualVisualHighlight(
                  getVariationKey(variation),
                  ($event.target as HTMLInputElement).value,
                )
              "
            />
          </label>

          <button
            type="button"
            class="secondary-button"
            :disabled="visualLoading[getVariationKey(variation)] || !canGenerateVisuals"
            @click="generateVisual(variation)"
          >
            {{
              visualLoading[getVariationKey(variation)]
                ? "Generating image..."
                : "Generate image"
            }}
          </button>
        </div>

        <p v-if="visualErrors[getVariationKey(variation)]" class="feedback error">
          {{ visualErrors[getVariationKey(variation)] }}
        </p>

        <section v-if="generatedVisuals[getVariationKey(variation)]" class="visual-preview">
          <img
            :src="generatedVisuals[getVariationKey(variation)].imageDataUrl"
            :alt="`${variation.angle} visual preview`"
          />
          <p class="result-label">
            {{
              generatedVisuals[getVariationKey(variation)].provider === "openai"
                ? "AI image"
                : "Preview image"
            }}
          </p>
          <p
            v-if="generatedVisuals[getVariationKey(variation)].watermarkApplied"
            class="description small"
          >
            Watermark applied: {{ generatedVisuals[getVariationKey(variation)].watermarkText }}
          </p>
        </section>
      </article>
    </section>

    <section v-if="showReferralBanner" class="card referral-banner">
      <div>
        <p class="result-label">Growth Loop</p>
        <h2>Want more reach?</h2>
        <p class="description small">
          Invite 2 founder friends and unlock deeper scoring, stronger suggestions, and more creation room.
        </p>
      </div>
      <div class="action-row">
        <button type="button" class="secondary-button" @click="copyInviteText">
          Copy invite text
        </button>
        <router-link class="secondary-button invite-link" to="/">
          Share the product
        </router-link>
      </div>
    </section>

    <section class="card scheduler-panel">
      <div class="scheduler-header">
        <div>
          <p class="result-label">Schedule Carousel</p>
          <h2>Create → Schedule → Publish</h2>
        </div>
        <button
          type="button"
          class="secondary-button"
          :disabled="isConnectingLinkedIn || !selectedBusinessId || !schedulerEnabled"
          @click="connectLinkedIn"
        >
          {{ isConnectingLinkedIn ? "Redirecting..." : connectedLinkedInAccount ? "Reconnect LinkedIn" : "Connect LinkedIn" }}
        </button>
      </div>

      <p v-if="schedulerLockedMessage" class="feedback">{{ schedulerLockedMessage }}</p>
      <p v-if="queuePreviewMessage" class="feedback">{{ queuePreviewMessage }}</p>
      <p v-if="schedulingContextMessage" class="feedback">{{ schedulingContextMessage }}</p>
      <p v-if="scheduleFeedback" class="feedback">{{ scheduleFeedback }}</p>
      <p v-if="scheduleError" class="feedback error">{{ scheduleError }}</p>

      <div class="scheduler-grid">
        <label>
          <span>Workspace</span>
          <select v-model="selectedBusinessId" :disabled="memberships.length === 0 || isLoadingPublishingContext">
            <option value="" disabled>
              {{ memberships.length === 0 ? "Create a workspace first" : "Select workspace" }}
            </option>
            <option
              v-for="membership in memberships"
              :key="membership.id"
              :value="membership.businessId"
            >
              {{ membership.business.name }}
            </option>
          </select>
        </label>

        <label>
          <span>Caption Source</span>
          <select v-model="selectedCaptionKey" :disabled="variations.length === 0">
            <option value="" disabled>Select caption</option>
            <option v-for="variation in variations" :key="variation.angle" :value="variation.angle">
              {{ variation.angle }}
            </option>
          </select>
        </label>

        <label>
          <span>Schedule Time</span>
          <input v-model="scheduleAt" type="datetime-local" />
        </label>
      </div>

      <section class="intelligence-panel">
        <div>
          <p class="result-label">Best Time to Post</p>
          <p class="description small">
            {{ isLoadingRecommendedSlots ? "Calculating the safest high-signal slots..." : recommendedSlotsMessage || `Recommended in ${recommendedTimezone}.` }}
          </p>
        </div>

        <div v-if="recommendedSlots.length > 0" class="slot-grid">
          <button
            v-for="slot in recommendedSlots"
            :key="slot.scheduledAt"
            type="button"
            class="slot-card"
            @click="applyRecommendedSlot(slot)"
          >
            <strong>{{ slot.localLabel }}</strong>
            <span>{{ slot.source === "hybrid" ? "History + heuristic" : slot.source === "history" ? "Your history" : "Global heuristic" }}</span>
            <small>{{ slot.reason }}</small>
          </button>
        </div>
      </section>

      <div class="status-strip">
        <span>
          LinkedIn:
          {{ connectedLinkedInAccount ? `connected${connectedLinkedInAccount.accountEmail ? ` as ${connectedLinkedInAccount.accountEmail}` : ""}` : "not connected" }}
        </span>
        <span>Publishable slides: {{ publishableVisualEntries.length }}</span>
      </div>

      <p class="description small">
        Generate at least two PNG or JPG visuals to publish a LinkedIn multi-image post. SVG preview
        images from local fallback mode are intentionally excluded from scheduling.
      </p>

      <p class="description small">
        Internal safety rules keep scheduling conservative: limited daily volume, minimum spacing,
        light randomized send times, and capped publish retries.
      </p>

      <section class="intelligence-panel">
        <div>
          <p class="result-label">Auto Hashtags</p>
          <p class="description small">
            {{ isGeneratingHashtags ? "Generating broad, niche, and intent hashtags..." : hashtagMessage || "Hashtags are appended to the final post preview." }}
          </p>
        </div>

        <div v-if="generatedHashtags.length > 0" class="hashtag-row">
          <span v-for="hashtag in generatedHashtags" :key="hashtag" class="hashtag-chip">
            {{ hashtag }}
          </span>
        </div>

        <label>
          <span>Final Post Preview</span>
          <textarea :value="scheduledCaptionPreview" rows="9" readonly />
        </label>

        <p class="description small">
          Free-plan branding stays attached to the shared caption and generated visuals.
        </p>
      </section>

      <div v-if="publishableVisualEntries.length > 0" class="carousel-preview-grid">
        <img
          v-for="entry in publishableVisualEntries"
          :key="entry.key"
          :src="entry.visual.imageDataUrl"
          :alt="`${entry.variation.angle} scheduled slide`"
        />
      </div>

      <div class="action-row">
        <button type="button" :disabled="isScheduling || !canSchedulePost" @click="scheduleCarouselPost">
          {{ isScheduling ? "Scheduling..." : "Schedule Post" }}
        </button>
      </div>
    </section>

    <section class="card scheduled-list">
      <div class="scheduler-header">
        <div>
          <p class="result-label">Queued Posts</p>
          <h2>Latest LinkedIn Queue</h2>
        </div>
      </div>

      <p v-if="scheduledPosts.length === 0" class="description small">
        No queued posts yet.
      </p>

      <article v-for="scheduledPost in scheduledPosts" :key="scheduledPost.id" class="scheduled-post-item">
        <div class="scheduled-post-meta">
          <strong>{{ new Date(scheduledPost.scheduledAt).toLocaleString() }}</strong>
          <span class="status-badge" :data-status="scheduledPost.status">{{ scheduledPost.status }}</span>
        </div>
        <p class="scheduled-post-text">{{ scheduledPost.contentText }}</p>
        <p class="description small">
          Attempts: {{ scheduledPost.retryCount }}<span v-if="scheduledPost.lastAttemptAt">
            · Last attempt {{ new Date(scheduledPost.lastAttemptAt).toLocaleString() }}
          </span>
        </p>
        <div v-if="scheduledPost.slides.length > 0" class="carousel-preview-grid compact">
          <img
            v-for="(slide, index) in scheduledPost.slides"
            :key="`${scheduledPost.id}-${index}`"
            :src="slide.imageDataUrl"
            :alt="`Scheduled slide ${index + 1}`"
          />
        </div>
        <p v-if="scheduledPost.errorMessage" class="feedback error">{{ scheduledPost.errorMessage }}</p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.page-shell {
  max-width: var(--fc-page-max-width);
  color: var(--fc-text);
  font-family: var(--fc-font-family-body);
}

.hero {
  margin-bottom: 24px;
}

.hero-limit-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.eyebrow {
  margin: 0 0 12px;
  color: var(--fc-text-muted);
  font-size: 0.875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.description {
  max-width: 760px;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.description.small {
  max-width: none;
  font-size: 0.95rem;
}

.card {
  padding: 24px;
  border: 1px solid var(--fc-border);
  border-radius: var(--fc-radius-panel);
  background: var(--fc-panel-bg);
  box-shadow: var(--fc-panel-shadow);
}

.repurpose-panel,
.repurpose-summary,
.scheduler-panel,
.scheduled-list {
  margin-top: 24px;
}

.form-grid,
.visual-controls,
.scheduler-grid {
  display: grid;
  gap: 16px;
}

.repurpose-header,
.repurpose-summary-grid {
  display: grid;
  gap: 20px;
}

.repurpose-type-row,
.signal-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}

.secondary-button[data-active="true"] {
  border: 1px solid var(--fc-accent);
  background: color-mix(in srgb, var(--fc-accent) 16%, var(--fc-panel-bg));
}

.voice-block {
  display: grid;
  gap: 16px;
}

.scheduler-grid {
  margin-top: 20px;
}

label {
  display: grid;
  gap: 8px;
}

input,
select,
textarea {
  padding: 12px 14px;
}

textarea {
  resize: vertical;
  line-height: 1.6;
}

button {
  width: fit-content;
  padding: 12px 18px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
  font: inherit;
  cursor: pointer;
}

a.invite-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}

button:disabled {
  opacity: 0.7;
  cursor: progress;
}

.feedback {
  margin-top: 16px;
}

.feedback.error {
  color: var(--fc-error-text);
}

.secondary-button {
  background: var(--fc-surface-muted);
  color: var(--fc-text);
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
}

.results-grid {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}

.share-card,
.distribution-loop,
.referral-banner {
  display: grid;
  gap: 14px;
  margin-top: 18px;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 80%, var(--fc-surface-muted));
}

.share-signals {
  margin-top: 0;
}

.signature-preview {
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--fc-input-bg);
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.distribution-button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.signal-chip {
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--fc-success-bg);
  color: var(--fc-success-text);
  font-size: 0.9rem;
}

.signal-chip.muted {
  background: var(--fc-chip-bg);
  color: var(--fc-text);
}

.hook-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 18px;
  color: var(--fc-text);
  line-height: 1.6;
}

.carousel-draft-grid {
  display: grid;
  gap: 12px;
}

.carousel-draft-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface-muted);
}

.carousel-draft-card p,
.carousel-draft-card small {
  margin: 0;
}

.result-label {
  margin: 0 0 12px;
  color: var(--fc-text-muted);
  font-size: 0.85rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  line-height: 1.7;
}

.visual-preview {
  margin-top: 20px;
}

.visual-preview img,
.carousel-preview-grid img {
  width: 100%;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: var(--fc-input-bg);
}

.intelligence-panel {
  display: grid;
  gap: 14px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--fc-border);
}

.scheduler-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: start;
}

.scheduler-header h2 {
  margin: 0;
}

.status-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 16px;
  color: var(--fc-text-muted);
  font-size: 0.95rem;
}

.carousel-preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.slot-card {
  display: grid;
  gap: 8px;
  width: 100%;
  padding: 16px;
  border: 1px solid var(--fc-input-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
  color: var(--fc-text);
  text-align: left;
}

.slot-card span,
.slot-card small {
  color: var(--fc-text-muted);
}

.hashtag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.hashtag-chip {
  display: inline-flex;
  align-items: center;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--fc-chip-bg);
  color: var(--fc-text);
  font-size: 0.95rem;
}

.carousel-preview-grid.compact {
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
}

.scheduled-post-item + .scheduled-post-item {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--fc-border);
}

.scheduled-post-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.scheduled-post-text {
  margin: 10px 0 0;
  color: var(--fc-text);
  line-height: 1.6;
  white-space: pre-wrap;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--fc-chip-bg);
  color: var(--fc-text);
  font-size: 0.85rem;
  text-transform: capitalize;
}

.status-badge[data-status="published"] {
  background: var(--fc-success-bg);
  color: var(--fc-success-text);
}

.status-badge[data-status="failed"] {
  background: var(--fc-error-bg);
  color: var(--fc-error-text);
}

.status-badge[data-status="processing"] {
  background: var(--fc-info-bg);
  color: var(--fc-info-text);
}

h1 {
  margin: 0;
}

@media (max-width: 720px) {
  .page-shell {
    padding: 32px 16px 56px;
  }

  .scheduler-header {
    flex-direction: column;
  }

  .repurpose-summary-grid {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 900px) {
  .repurpose-summary-grid {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  }
}
</style>
