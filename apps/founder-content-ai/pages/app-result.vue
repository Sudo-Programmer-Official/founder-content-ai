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
  CreatorContentType,
  CreatorPostGenerationOutput,
  CreatorTextVariant,
  CreatorVisualStyle,
  GenerateVisualResponse,
  MediaRecommendationGoal,
  MediaRecommendationSuggestion,
  MotionAudioPreset,
  MotionAudioTrack,
  MotionTemplateId,
  PostAsset,
  PromoVisualLayoutId,
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
  requestCreatePromoVisualPostAsset,
  requestCreatePostAsset,
  requestDeletePostAsset,
  requestGenerateMotionPostAsset,
  requestMediaUploadUrl,
  requestPostAssets,
  requestReorderPostAssets,
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

type PreviewNoticeTone = "default" | "warning";

interface ResultPreviewNotice {
  tone: PreviewNoticeTone;
  label: string;
  detail: string;
}

interface ResultPlatformPreviewCard {
  surface: ResultPreviewSurface;
  label: string;
  accountLabel: string;
  accountDescriptor: string;
  previewText: string;
  previewParagraphs: string[];
  subject: string;
  primaryMetric: string;
  secondaryMetric: string;
  excerpt: string;
  notices: ResultPreviewNotice[];
  mediaSummary: string;
  previewAsset: PostAsset | null;
  isDirty: boolean;
}

interface DraftMediaPreferences {
  primaryAssetId?: string;
  posterAssetId?: string;
  motionTemplateId?: MotionTemplateId;
  motionAudioEnabled?: boolean;
  motionAudioPreset?: MotionAudioPreset;
  motionAudioTrack?: MotionAudioTrack;
  promoVisualLayout?: PromoVisualLayoutId;
}

type ResultPreviewSurface = PublishableSocialPlatform | "email";
type ComposerAutosaveState = "idle" | "queued" | "saving" | "saved" | "error";

const CONTENT_AUTOSAVE_DELAY_MS = 900;
const CTA_AUTOSAVE_DELAY_MS = 700;

const draft = ref<ActivationDraftRecord | null>(null);
const selectedCreatorVariantId = ref("");
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
const selectedResultPreviewSurface = ref<ResultPreviewSurface>(initialPublishingPlatform);
const isMetaSelectionModalOpen = ref(false);
const pendingMetaSession = ref("");
const isLoadingPostAssets = ref(false);
const isUploadingPostAssets = ref(false);
const isGeneratingMotionLite = ref(false);
const isCreatingPromoVisual = ref(false);
const removingPostAssetId = ref("");
const reorderingPostAssetId = ref("");
const mediaFeedback = ref("");
const postAssets = ref<PostAsset[]>([]);
const isWorkspaceAssetPickerOpen = ref(false);
const selectedMotionTemplateId = ref<MotionTemplateId>("subtle_zoom");
const selectedMotionAudioEnabled = ref(true);
const selectedMotionAudioPreset = ref<MotionAudioPreset>("clean_modern");
const selectedPromoVisualLayout = ref<PromoVisualLayoutId>("logo_headline");
const editablePostContent = ref("");
const isSavingManualEdit = ref(false);
const manualEditFeedback = ref("");
const editableInstagramContent = ref("");
const editableFacebookContent = ref("");
const editableEmailSubject = ref("");
const editableEmailBody = ref("");
const editableCtaLabel = ref("");
const editableCtaUrl = ref("");
const publishingSetupFeedback = ref("");
const contentAutosaveState = ref<ComposerAutosaveState>("idle");
const contentAutosaveError = ref("");
const ctaAutosaveState = ref<ComposerAutosaveState>("idle");
const ctaAutosaveError = ref("");
let contentAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
let ctaAutosaveTimer: ReturnType<typeof setTimeout> | null = null;
let activeContentAutosavePromise: Promise<boolean> | null = null;
let activeCtaAutosavePromise: Promise<boolean> | null = null;
const PROMO_VISUAL_LAYOUT_OPTIONS: Array<{ value: PromoVisualLayoutId; label: string; description: string }> = [
  {
    value: "logo_headline",
    label: "Logo + headline",
    description: "Clean branded promo card with your logo or initials, headline, and CTA.",
  },
  {
    value: "screenshot_headline",
    label: "Screenshot + headline",
    description: "Use one uploaded screenshot or product image if it is attached to the draft already.",
  },
  {
    value: "headline_only",
    label: "Headline only",
    description: "Minimal promo visual with centered copy and brand styling only.",
  },
];
const MOTION_TEMPLATE_OPTIONS: Array<{ value: MotionTemplateId; label: string; description: string }> = [
  {
    value: "offer_burst",
    label: "Offer Burst",
    description: "Fast promo pacing with a punchier CTA for launches, offers, and signups.",
  },
  {
    value: "local_awareness",
    label: "Local Awareness",
    description: "Location-led motion for neighborhood campaigns, inquiries, and service discovery.",
  },
  {
    value: "testimonial_highlight",
    label: "Testimonial Highlight",
    description: "Softer trust-building motion for proof, reviews, and credibility moments.",
  },
  {
    value: "story_pan",
    label: "Product Promo",
    description: "Stronger launch pacing with headline, support, and CTA.",
  },
  {
    value: "founder_story",
    label: "Founder Story",
    description: "Slow, intentional motion for story-led founder posts and emotional updates.",
  },
  {
    value: "caption_pulse",
    label: "Problem Hook",
    description: "Sharper hook-first motion for stopping the scroll.",
  },
  {
    value: "subtle_zoom",
    label: "Calm Story",
    description: "Gentle movement for softer brand storytelling.",
  },
];
const MOTION_AUDIO_OPTIONS: Array<{ value: MotionAudioPreset; label: string; description: string }> = [
  {
    value: "clean_modern",
    label: "Modern",
    description: "Clean, polished sound for product updates, founder content, and sharper SaaS motion.",
  },
  {
    value: "high_energy_promo",
    label: "Energetic",
    description: "Punchier sound for launches, promos, and CTA-heavy motion.",
  },
  {
    value: "local_trust",
    label: "Local Trust",
    description: "Warm, trustworthy sound for local awareness, service businesses, and neighborhood reach.",
  },
  {
    value: "luxury_minimal",
    label: "Premium",
    description: "Minimal, softer sound for proof, testimonials, and premium-feeling brand motion.",
  },
  {
    value: "calm_wellness",
    label: "Calm",
    description: "Slow, softer sound for story-led, wellness, and less aggressive brand motion.",
  },
];
const draftMediaPrimaryAssetId = ref("");
const draftMediaPosterAssetId = ref("");
const mediaRecommendations = ref<MediaRecommendationSuggestion[]>([]);
const isLoadingMediaRecommendations = ref(false);
const isGeneratingRecommendationId = ref("");
const mediaRecommendationPanelRef = ref<HTMLElement | null>(null);
type VisualStylePreference = "auto" | "photo_overlay" | "stat_card" | "quote_card" | "framework_card";
const selectedVisualStylePreference = ref<VisualStylePreference>("auto");
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
const isMediaDrawerOpen = ref(false);
const isHashtagDrawerOpen = ref(false);
const isPublishDrawerOpen = ref(false);
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

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "").length;
}

function cloneBusinessOutput(source: BusinessContentOutput): BusinessContentOutput {
  return {
    hooks: [...source.hooks],
    visual: { ...source.visual },
    captions: { ...source.captions },
    cta: {
      ...source.cta,
      alternatives: source.cta.alternatives ? [...source.cta.alternatives] : undefined,
    },
    hashtags: source.hashtags ? [...source.hashtags] : undefined,
    email: source.email ? { ...source.email } : undefined,
  };
}

function formatPostAssetChoiceLabel(asset: PostAsset): string {
  const sourceLabel = asset.source === "generated" ? "Generated" : "Uploaded";
  const typeLabel = asset.type === "video" ? "video" : "image";
  const aspectRatio = asset.metadata.aspectRatio ? ` · ${asset.metadata.aspectRatio}` : "";

  return `${sourceLabel} ${typeLabel} ${asset.orderIndex + 1}${aspectRatio}`;
}

function resolvePublishingContentText(platform: PublishableSocialPlatform): string {
  if (platform === "instagram") {
    return resolveEditableCaptionBaseline("instagram").trim();
  }

  if (platform === "facebook") {
    return resolveEditableCaptionBaseline("facebook").trim();
  }

  return postContent.value;
}

function countHashtags(value: string): number {
  return value.match(/(^|\s)#[^\s#]+/g)?.length ?? 0;
}

function truncatePreviewExcerpt(value: string, limit = 156): string {
  const compact = value.replace(/\s+/g, " ").trim();

  if (compact.length <= limit) {
    return compact;
  }

  return `${compact.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function shortenCaptionParagraphs(
  paragraphs: string[],
  input: { maxChars: number; maxParagraphs: number },
): string {
  const selected: string[] = [];
  let usedChars = 0;

  for (const paragraph of paragraphs) {
    const normalized = paragraph.replace(/\s+/g, " ").trim();

    if (!normalized) {
      continue;
    }

    if (selected.length >= input.maxParagraphs) {
      break;
    }

    const separatorChars = selected.length > 0 ? 2 : 0;
    const remainingChars = input.maxChars - usedChars - separatorChars;

    if (remainingChars <= 0) {
      break;
    }

    const nextParagraph = normalized.length <= remainingChars
      ? normalized
      : `${normalized.slice(0, Math.max(0, remainingChars - 1)).trimEnd()}…`;

    if (!nextParagraph) {
      break;
    }

    selected.push(nextParagraph);
    usedChars += separatorChars + nextParagraph.length;

    if (nextParagraph.endsWith("…")) {
      break;
    }
  }

  return selected.join("\n\n");
}

function buildPlatformCaptionFallback(platform: "instagram" | "facebook"): string {
  const baseText = postContent.value.trim();

  if (!baseText) {
    return "";
  }

  const maxChars = platform === "instagram" ? 520 : 900;
  const maxParagraphs = platform === "instagram" ? 3 : 4;
  const baseParagraphs = splitPostParagraphs(baseText);

  if (baseText.length <= maxChars && baseParagraphs.length <= maxParagraphs) {
    return baseText;
  }

  const leadLines = extractPreviewLead(baseParagraphs);
  const bodyParagraphs = extractPreviewBody(baseParagraphs, leadLines);
  const normalizedLead = leadLines.join("\n").trim();
  const normalizedBody = bodyParagraphs.map((paragraph) => paragraph.replace(/\s+/g, " ").trim()).filter(Boolean);
  const candidateParagraphs = [
    normalizedLead,
    ...normalizedBody,
  ].filter((paragraph) => paragraph !== "");

  const shortened = shortenCaptionParagraphs(candidateParagraphs, { maxChars, maxParagraphs });

  return shortened || truncatePreviewExcerpt(baseText, maxChars);
}

function resolveDraftBusinessOutputSeed(): BusinessContentOutput {
  const trimmedPost = postContent.value.trim();
  const previewLead = splitPostParagraphs(trimmedPost)[0] ?? trimmedPost;
  const ideaTitle = draft.value?.result.idea.title?.trim() || truncatePreviewExcerpt(previewLead, 72).replace(/…$/, "");
  const ideaAngle = draft.value?.result.idea.angle?.trim() || "";
  const imagePrompt = [
    ideaTitle,
    ideaAngle,
    "Create a clean branded social visual that matches this post.",
  ]
    .filter((value) => value && value.trim() !== "")
    .join(" ");

  const seedInstagram = editableInstagramContent.value.trim() || buildPlatformCaptionFallback("instagram");
  const seedFacebook = editableFacebookContent.value.trim() || buildPlatformCaptionFallback("facebook");
  const seedEmailSubject = editableEmailSubject.value.trim();
  const seedEmailBody = editableEmailBody.value.trim();

  return {
    hooks: [...(draft.value?.result.hooks ?? [])],
    visual: {
      headline: ideaTitle || "Saved draft",
      subheadline: ideaAngle || undefined,
      imagePrompt,
      visualDirection: ideaAngle || undefined,
    },
    captions: {
      instagram: seedInstagram,
      facebook: seedFacebook,
    },
    cta: {
      label: editableCtaLabel.value.trim(),
      url: editableCtaUrl.value.trim(),
    },
    ...(seedEmailSubject || seedEmailBody
      ? {
          email: {
            subject: seedEmailSubject,
            body: seedEmailBody,
          },
        }
      : {}),
  };
}

function resolveEditableCaptionBaseline(platform: "instagram" | "facebook"): string {
  const explicitCaption =
    platform === "instagram"
      ? businessOutput.value?.captions.instagram
      : businessOutput.value?.captions.facebook;

  return explicitCaption && explicitCaption.trim() !== ""
    ? explicitCaption
    : buildPlatformCaptionFallback(platform);
}

function resolvePreviewSurfaceText(surface: ResultPreviewSurface): string {
  if (surface === "email") {
    return editableEmailBody.value;
  }

  if (surface === "instagram") {
    return editableInstagramContent.value;
  }

  if (surface === "facebook") {
    return editableFacebookContent.value;
  }

  return editablePostContent.value;
}

function resolvePreviewSurfaceSubject(surface: ResultPreviewSurface): string {
  return surface === "email" ? editableEmailSubject.value : "";
}

function resolvePreviewSurfaceDirty(surface: ResultPreviewSurface): boolean {
  if (surface === "email") {
    return isEmailEditDirty.value;
  }

  if (surface === "instagram") {
    return isInstagramEditDirty.value;
  }

  if (surface === "facebook") {
    return isFacebookEditDirty.value;
  }

  return isManualEditDirty.value;
}

function resolveConnectedAccountForPlatform(platform: PublishableSocialPlatform): SocialAccount | null {
  if (platform === "instagram") {
    return connectedInstagramAccount.value;
  }

  if (platform === "facebook") {
    return connectedFacebookAccount.value;
  }

  return connectedLinkedInAccount.value;
}

function resolvePreviewSurfaceAccountLabel(surface: ResultPreviewSurface): string {
  if (surface === "email") {
    return workspaceBrandLabel.value || "Workspace email";
  }

  return resolvePublishingAccountLabel(surface, resolveConnectedAccountForPlatform(surface));
}

function resolvePreviewSurfaceAccountDescriptor(surface: ResultPreviewSurface): string {
  if (surface === "email") {
    return "Email draft preview";
  }

  return resolvePublishingDescriptor(surface, resolveConnectedAccountForPlatform(surface));
}

function resolvePreviewSurfaceMediaSummary(surface: ResultPreviewSurface): string {
  if (surface === "email") {
    if (readyImageCount.value > 0) {
      return `${readyImageCount.value} image${readyImageCount.value === 1 ? "" : "s"} available for the email header`;
    }

    return "Text-first email preview";
  }

  const counts = summarizeEffectivePostAssetsForPlatform(surface);

  if (counts.videoCount > 0) {
    return `${counts.videoCount} video${counts.videoCount === 1 ? "" : "s"} ready`;
  }

  if (counts.imageCount > 0) {
    return `${counts.imageCount} image${counts.imageCount === 1 ? "" : "s"} ready`;
  }

  return "Text-first preview";
}

function resolvePreviewSurfaceAsset(surface: ResultPreviewSurface): PostAsset | null {
  if (surface === "email") {
    return null;
  }

  return resolveEffectivePostAssetsForPlatform(surface).find((asset) => Boolean(asset.previewUrl)) ?? null;
}

function buildPreviewSurfaceNotices(
  surface: ResultPreviewSurface,
  previewText: string,
  subject: string,
): ResultPreviewNotice[] {
  const text = previewText.trim();
  const normalizedSubject = subject.trim();
  const paragraphs = splitPostParagraphs(previewText);
  const opener = paragraphs[0]?.replace(/\s+/g, " ").trim() ?? "";
  const charCount = text.length;
  const wordCount = countWords(previewText);
  const notices: ResultPreviewNotice[] = [];

  if (surface === "email") {
    if (!normalizedSubject) {
      notices.push({
        tone: "warning",
        label: "Subject still needs a line",
        detail: "Add a subject before routing this into the email flow so the inbox preview is not blank.",
      });
    } else if (normalizedSubject.length > 68) {
      notices.push({
        tone: "warning",
        label: "Subject may truncate",
        detail: "Trim the subject so more of the promise survives the inbox preview.",
      });
    }

    if (!text) {
      notices.push({
        tone: "warning",
        label: "Email body is empty",
        detail: "Add the body copy before converting or sending this version.",
      });
    } else if (wordCount > 260 || paragraphs.length > 7) {
      notices.push({
        tone: "warning",
        label: "Body is getting dense",
        detail: "Cut a section or tighten paragraphs so the main CTA stays visible without too much scrolling.",
      });
    }
  } else {
    if (!text) {
      notices.push({
        tone: "warning",
        label: "No copy yet",
        detail: `Add the ${resolveSocialPlatformLabel(surface)} version before publishing this platform.`,
      });
    }

    if (surface === "linkedin") {
      if (opener.length > 220) {
        notices.push({
          tone: "warning",
          label: "Opening may fold too early",
          detail: "Trim the first beat so the hook lands before LinkedIn hides the rest behind the fold.",
        });
      } else if (charCount > 2400) {
        notices.push({
          tone: "warning",
          label: "Long for a feed read",
          detail: "This is still publishable, but shortening the body will make the CTA easier to reach.",
        });
      }
    } else if (surface === "instagram") {
      if (opener.length > 150) {
        notices.push({
          tone: "warning",
          label: "Caption opener is heavy",
          detail: "Instagram lands better when the first lines carry the promise quickly.",
        });
      }

      if (charCount > 1800) {
        notices.push({
          tone: "warning",
          label: "Caption may feel long",
          detail: "Consider a tighter caption so the visual and CTA do more of the work.",
        });
      }

      if (countHashtags(previewText) > 12) {
        notices.push({
          tone: "warning",
          label: "Hashtag block is noisy",
          detail: "Cut the hashtag stack so the CTA and main message stay more credible.",
        });
      }
    } else if (surface === "facebook") {
      if (opener.length > 240) {
        notices.push({
          tone: "warning",
          label: "First paragraph is heavy",
          detail: "Shorten the opener so the value lands before the copy starts to feel like a wall.",
        });
      } else if (charCount > 1500 || paragraphs.length > 6) {
        notices.push({
          tone: "warning",
          label: "Facebook copy is dense",
          detail: "Break this down or cut a section so the post is easier to skim on mobile.",
        });
      }
    }
  }

  if (notices.length === 0) {
    notices.push({
      tone: "default",
      label: "Preview is in range",
      detail:
        surface === "email"
          ? "Subject and body should preview cleanly before you move into audience and send review."
          : `${resolveSocialPlatformLabel(surface)} copy is sitting in a reasonable range for a fast feed scan.`,
    });
  }

  return notices.slice(0, 2);
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

function resolveDefaultCreatorVisualStyle(contentType: CreatorContentType): CreatorVisualStyle {
  if (contentType === "image_post" || contentType === "promo_post") {
    return "realistic_photo";
  }

  if (contentType === "carousel") {
    return "mixed_carousel";
  }

  if (contentType === "quote_card") {
    return "quote_style";
  }

  return "minimal_text_card";
}

function splitCreatorParagraphs(value: string): string[] {
  return value
    .split(/\n{2,}|\n+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function joinCreatorParagraphs(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");
}

function truncateCreatorParagraph(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3).trimEnd()}...` : value;
}

function resolveLegacyVariationContent(
  variations: RepurposeContentResponse["variations"],
  angle: "story" | "lesson" | "build-in-public",
  fallback: string,
): string {
  const match = variations.find((variation) => variation.angle === angle)?.content?.trim();
  return match || fallback;
}

function buildShortCaptionVariantContent(
  sourceText: string,
  fallbackHook: string,
  contentType: CreatorContentType,
): string {
  const parts = splitCreatorParagraphs(sourceText).slice(0, contentType === "promo_post" ? 2 : 3);
  const normalized = parts.map((part, index) =>
    truncateCreatorParagraph(part.replace(/\s+/g, " ").trim(), index === 0 ? 110 : 140),
  );

  if (normalized.length > 0) {
    return joinCreatorParagraphs(normalized);
  }

  return truncateCreatorParagraph(fallbackHook || sourceText, 160);
}

function buildPromoVariantContent(input: {
  baseText: string;
  ideaTitle: string;
  ideaAngle: string;
  hooks: string[];
  intent?: RepurposeContentResponse["generationIntent"];
  contentType: CreatorContentType;
}): string {
  const parts = splitCreatorParagraphs(input.baseText);
  const opener = truncateCreatorParagraph(
    (input.hooks[0] || parts[0] || input.ideaTitle || "Make the next move obvious.")
      .replace(/\s+/g, " ")
      .trim(),
    110,
  );
  const support = truncateCreatorParagraph(
    (parts[1] || input.ideaAngle || parts[0] || input.ideaTitle).replace(/\s+/g, " ").trim(),
    150,
  );
  const close = truncateCreatorParagraph(
    (
      input.intent === "promote_offer" || input.contentType === "promo_post"
        ? `If this direction matters, make the offer obvious and give people a clear next step toward ${input.ideaTitle || "it"}.`
        : "Use the attention this idea earns to point people toward the next clear action."
    ).replace(/\s+/g, " ").trim(),
    150,
  );

  return joinCreatorParagraphs([opener, support, close]);
}

function orderCreatorVariants(
  variants: CreatorTextVariant[],
  contentType: CreatorContentType,
): CreatorTextVariant[] {
  const priorityByKind: Record<CreatorTextVariant["kind"], number> =
    contentType === "image_post"
      ? {
          short_caption: 0,
          insight_post: 1,
          story_version: 2,
          authority_version: 3,
          promo_copy: 4,
        }
      : contentType === "promo_post"
        ? {
            promo_copy: 0,
            authority_version: 1,
            short_caption: 2,
            insight_post: 3,
            story_version: 4,
          }
        : {
            insight_post: 0,
            story_version: 1,
            authority_version: 2,
            short_caption: 3,
            promo_copy: 4,
          };

  return [...variants].sort((left, right) => priorityByKind[left.kind] - priorityByKind[right.kind]);
}

function buildCreatorVariantsFromLegacy(input: {
  post: string;
  hooks: string[];
  variations: RepurposeContentResponse["variations"];
  intent?: RepurposeContentResponse["generationIntent"];
  contentType: CreatorContentType;
  ideaTitle: string;
  ideaAngle: string;
}): CreatorTextVariant[] {
  const insightPost = resolveLegacyVariationContent(input.variations, "lesson", input.post);
  const storyVersion = resolveLegacyVariationContent(input.variations, "story", input.post);
  const authorityVersion = resolveLegacyVariationContent(input.variations, "build-in-public", input.post);
  const shortCaption = buildShortCaptionVariantContent(
    input.contentType === "image_post" ? storyVersion : insightPost,
    input.hooks[0] || input.ideaTitle,
    input.contentType,
  );
  const promoCopy = buildPromoVariantContent({
    baseText: input.contentType === "promo_post" ? authorityVersion : insightPost,
    ideaTitle: input.ideaTitle,
    ideaAngle: input.ideaAngle,
    hooks: input.hooks,
    intent: input.intent,
    contentType: input.contentType,
  });

  return orderCreatorVariants(
    [
      {
        id: "insight-post",
        kind: "insight_post",
        label: "Insight post",
        description: "Clear authority-building version with one strong lesson and clean pacing.",
        content: insightPost,
        recommendedChannels: ["linkedin", "facebook"],
        length: "medium",
        ctaStyle: "soft",
      },
      {
        id: "story-version",
        kind: "story_version",
        label: "Story version",
        description: "Narrative-led version that feels more personal and trust-building.",
        content: storyVersion,
        recommendedChannels: ["linkedin", "email"],
        length: "medium",
        ctaStyle: "soft",
      },
      {
        id: "authority-version",
        kind: "authority_version",
        label: "Authority version",
        description: "Sharper point-of-view version that sounds more decisive and expert-led.",
        content: authorityVersion,
        recommendedChannels: ["linkedin", "facebook"],
        length: "medium",
        ctaStyle: "soft",
      },
      {
        id: "short-caption",
        kind: "short_caption",
        label: "Short caption",
        description: "Compact version for quicker posting, image-led content, or lighter-distribution days.",
        content: shortCaption,
        recommendedChannels: ["linkedin", "instagram", "facebook"],
        length: "short",
        ctaStyle: "soft",
      },
      {
        id: "promo-copy",
        kind: "promo_copy",
        label: "Promo copy",
        description: "Offer-aware version that moves readers toward the next step without sounding like an ad.",
        content: promoCopy,
        recommendedChannels: ["linkedin", "facebook", "email"],
        length: "short",
        ctaStyle: "direct",
      },
    ],
    input.contentType,
  );
}

function buildCreatorPhotoSuggestion(): MediaRecommendationSuggestion {
  return {
    id: "creator-photo-overlay",
    actionType: "generate_visual",
    title: "Generate image post",
    description: "Create a realistic social image with light overlay copy so this draft can ship as a faster image-led format.",
    reason: "Image-led posts are faster to publish and feel less rigid than forcing every creator draft into a carousel.",
    suggestedMediaType: "photo_overlay",
    visualTemplateType: "insight",
    recommendedAssetIds: [],
  };
}

function getMediaSuggestionTitle(suggestion: MediaRecommendationSuggestion): string {
  if (isBusinessDraft() && suggestion.suggestedMediaType === "photo_overlay") {
    return "Generate brand image";
  }

  if (!isBusinessDraft() && suggestion.suggestedMediaType === "photo_overlay") {
    return creatorContentType.value === "promo_post" ? "Generate promo image" : "Generate image post";
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

  if (!isBusinessDraft() && suggestion.suggestedMediaType === "photo_overlay") {
    return creatorContentType.value === "promo_post"
      ? "Create a realistic promotional image that supports the CTA without turning the post into a text-heavy card."
      : "Create a realistic social image matched to the post angle so you can publish a short image-led update.";
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

  if (!isBusinessDraft() && suggestion.suggestedMediaType === "photo_overlay") {
    return creatorContentType.value === "promo_post"
      ? "Promotion posts usually land better with a human, realistic image than with a generic text card."
      : "This gives creator mode a faster, more natural image path instead of defaulting straight into carousel production.";
  }

  if (suggestion.visualTemplateType === "carousel") {
    return "This keeps the workflow content → narrative → visuals instead of making you manually collect disconnected images.";
  }

  return suggestion.reason;
}

function matchesVisualStylePreference(
  suggestion: MediaRecommendationSuggestion,
  preference: VisualStylePreference,
): boolean {
  return preference !== "auto"
    && suggestion.actionType === "generate_visual"
    && suggestion.suggestedMediaType === preference;
}

function getVisualStyleOptionLabel(preference: Exclude<VisualStylePreference, "auto">): string {
  if (preference === "photo_overlay") {
    return isBusinessMode.value ? "Launch image" : "Realistic image";
  }

  if (preference === "stat_card") {
    return "Stat / proof card";
  }

  if (preference === "quote_card") {
    return "Quote card";
  }

  return isBusinessMode.value ? "Feature visual" : "Carousel";
}

const postScore = computed(() =>
  draft.value
    ? calculateContentScore({
        id: draft.value.id,
        contentType: "post",
        contentBody: postContent.value,
        status: "draft",
        pipelineStage: "review",
        sourceKind: draft.value.mode === "improve" ? "remix" : "capture",
        textContent: postContent.value,
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
const businessSelectedChannels = computed<Array<"instagram" | "facebook" | "email">>(() =>
  businessOutput.value ? inferBusinessChannelsFromOutput(businessOutput.value) : [],
);
const businessChannelSummary = computed(() =>
  businessSelectedChannels.value
    .map((channel) => channel.charAt(0).toUpperCase() + channel.slice(1))
    .join(" + "),
);
const isSingleBusinessPost = computed(
  () =>
    isBusinessMode.value
    && !businessWeeklyPlan.value
    && businessSelectedChannels.value.length === 1,
);
const businessSingleOutputLabel = computed(() =>
  businessSelectedChannels.value[0] === "email" ? "email" : "post",
);
const resultPreviewSurfaceOptions = computed<Array<{
  value: ResultPreviewSurface;
  label: string;
}>>(() => {
  const options: Array<{
    value: ResultPreviewSurface;
    label: string;
  }> = [
    { value: "linkedin", label: "LinkedIn" },
  ];

  if (!isBusinessMode.value || businessOutput.value?.captions.instagram) {
    options.push({ value: "instagram", label: "Instagram" });
  }

  if (!isBusinessMode.value || businessOutput.value?.captions.facebook) {
    options.push({ value: "facebook", label: "Facebook" });
  }

  if (businessOutput.value?.email) {
    options.push({ value: "email", label: "Email" });
  }

  return options;
});
const creatorOutput = computed<CreatorPostGenerationOutput | null>(() =>
  generationOutput.value?.kind === "creator_post" ? generationOutput.value : null,
);
const creatorContentType = computed<CreatorContentType>(() => {
  const value = creatorOutput.value?.contentType;

  return value === "image_post"
    || value === "carousel"
    || value === "quote_card"
    || value === "promo_post"
    || value === "text_post"
    ? value
    : "text_post";
});
const creatorVisualStyle = computed<CreatorVisualStyle>(() => {
  const value = creatorOutput.value?.visualStyle;

  return value === "realistic_photo"
    || value === "mixed_carousel"
    || value === "quote_style"
    || value === "minimal_text_card"
    ? value
    : resolveDefaultCreatorVisualStyle(creatorContentType.value);
});
const creatorVariants = computed<CreatorTextVariant[]>(() => {
  if (isBusinessMode.value || !draft.value) {
    return [];
  }

  const explicitVariants = creatorOutput.value?.variants?.filter(
    (variant): variant is CreatorTextVariant =>
      Boolean(variant && typeof variant === "object" && typeof variant.content === "string" && variant.content.trim() !== ""),
  ) ?? [];

  if (explicitVariants.length > 0) {
    return orderCreatorVariants(explicitVariants, creatorContentType.value);
  }

  return buildCreatorVariantsFromLegacy({
    post: draft.value.result.post,
    hooks: draft.value.result.hooks ?? [],
    variations: draft.value.result.variations ?? [],
    intent: draft.value.result.generationIntent,
    contentType: creatorContentType.value,
    ideaTitle: draft.value.result.idea.title,
    ideaAngle: draft.value.result.idea.angle,
  });
});
const activeCreatorVariant = computed<CreatorTextVariant | null>(() => {
  if (creatorVariants.value.length === 0) {
    return null;
  }

  return creatorVariants.value.find((variant) => variant.id === selectedCreatorVariantId.value)
    ?? creatorVariants.value[0]
    ?? null;
});

function resolvePreferredCreatorVariantId(
  variants: CreatorTextVariant[],
  contentType: CreatorContentType,
  currentPost: string,
): string {
  const matchingVariant = variants.find((variant) => variant.content.trim() === currentPost.trim());

  if (matchingVariant) {
    return matchingVariant.id;
  }

  const preferredKind =
    contentType === "image_post"
      ? "short_caption"
      : contentType === "promo_post"
        ? "promo_copy"
        : "insight_post";

  return variants.find((variant) => variant.kind === preferredKind)?.id ?? variants[0]?.id ?? "";
}

const creatorMediaGoal = computed<MediaRecommendationGoal>(() => {
  if (isBusinessMode.value) {
    return "conversion";
  }

  if (creatorContentType.value === "promo_post") {
    return "conversion";
  }

  if (
    creatorContentType.value === "image_post"
    || creatorVisualStyle.value === "realistic_photo"
    || creatorContentType.value === "quote_card"
  ) {
    return "engagement";
  }

  return "authority";
});
const creatorWantsImageFirst = computed(
  () =>
    !isBusinessMode.value
    && (
      creatorContentType.value === "image_post"
      || creatorContentType.value === "promo_post"
      || creatorVisualStyle.value === "realistic_photo"
    ),
);
const creatorWantsCarouselFirst = computed(
  () =>
    !isBusinessMode.value
    && (
      creatorContentType.value === "carousel"
      || creatorVisualStyle.value === "mixed_carousel"
    ),
);
const creatorWantsQuoteFirst = computed(
  () =>
    !isBusinessMode.value
    && (
      creatorContentType.value === "quote_card"
      || creatorVisualStyle.value === "quote_style"
    ),
);
const postContent = computed(() => {
  if (isBusinessMode.value) {
    return draft.value?.result.post ?? "";
  }

  return activeCreatorVariant.value?.content ?? draft.value?.result.post ?? "";
});
const isManualEditDirty = computed(() =>
  editablePostContent.value.trim() !== postContent.value.trim(),
);
const isInstagramEditDirty = computed(() =>
  editableInstagramContent.value.trim() !== resolveEditableCaptionBaseline("instagram").trim(),
);
const isFacebookEditDirty = computed(() =>
  editableFacebookContent.value.trim() !== resolveEditableCaptionBaseline("facebook").trim(),
);
const isEmailEditDirty = computed(() =>
  editableEmailSubject.value.trim() !== (businessOutput.value?.email?.subject ?? "").trim()
  || editableEmailBody.value.trim() !== (businessOutput.value?.email?.body ?? "").trim(),
);
const isCtaDirty = computed(() =>
  editableCtaLabel.value.trim() !== (businessOutput.value?.cta.label ?? "").trim()
  || editableCtaUrl.value.trim() !== (businessOutput.value?.cta.url ?? "").trim(),
);
const hasPendingContentAutosaveChanges = computed(() =>
  isManualEditDirty.value
  || isInstagramEditDirty.value
  || isFacebookEditDirty.value
  || isEmailEditDirty.value,
);
const isSelectedSurfaceDirty = computed(() => {
  if (selectedResultPreviewSurface.value === "email") {
    return isEmailEditDirty.value;
  }

  if (selectedResultPreviewSurface.value === "instagram") {
    return isInstagramEditDirty.value;
  }

  if (selectedResultPreviewSurface.value === "facebook") {
    return isFacebookEditDirty.value;
  }

  return isManualEditDirty.value;
});
const contentAutosaveLabel = computed(() => {
  if (contentAutosaveState.value === "error") {
    return "Autosave failed";
  }

  if (contentAutosaveState.value === "saving" || contentAutosaveState.value === "queued") {
    return "Saving automatically";
  }

  return "Saved automatically";
});
const ctaAutosaveLabel = computed(() => {
  if (ctaAutosaveState.value === "error") {
    return "Autosave failed";
  }

  if (ctaAutosaveState.value === "saving" || ctaAutosaveState.value === "queued") {
    return "Saving automatically";
  }

  return "Saved automatically";
});
const composerAutosaveSummary = computed(() => {
  if (contentAutosaveState.value === "error") {
    return contentAutosaveError.value || "Autosave failed for the latest draft edits.";
  }

  if (ctaAutosaveState.value === "error") {
    return ctaAutosaveError.value || "Autosave failed for the CTA changes.";
  }

  if (
    contentAutosaveState.value === "saving"
    || contentAutosaveState.value === "queued"
    || ctaAutosaveState.value === "saving"
    || ctaAutosaveState.value === "queued"
  ) {
    return "Saving your latest edits automatically.";
  }

  return "Everything autosaves. Publish and schedule use the latest saved draft.";
});
const selectedSurfaceEditorCopy = computed(() => {
  if (selectedResultPreviewSurface.value === "email") {
    return {
      title: "Edit email variant",
      primary: `Subject ${editableEmailSubject.value.trim().length} chars`,
      secondary: `${countWords(editableEmailBody.value)} words · ${editableEmailBody.value.trim().length} chars`,
      hint: "Keep the subject tight. The body can go longer when it stays broken into scannable sections.",
    };
  }

  const activeText =
    selectedResultPreviewSurface.value === "instagram"
      ? editableInstagramContent.value
      : selectedResultPreviewSurface.value === "facebook"
        ? editableFacebookContent.value
        : editablePostContent.value;
  const charCount = activeText.trim().length;
  const wordCount = countWords(activeText);

  if (selectedResultPreviewSurface.value === "instagram") {
    return {
      title: "Edit Instagram caption",
      primary: `${charCount} chars`,
      secondary: `${wordCount} words`,
      hint: "Instagram lands better when the first lines do the work quickly. Tight is usually easier to scan than long.",
    };
  }

  if (selectedResultPreviewSurface.value === "facebook") {
    return {
      title: "Edit Facebook caption",
      primary: `${charCount} chars`,
      secondary: `${wordCount} words`,
      hint: "Facebook can hold a bit more context, but the opener still needs to make the value obvious fast.",
    };
  }

  return {
    title: "Edit LinkedIn draft",
    primary: `${charCount} chars`,
    secondary: `${wordCount} words`,
    hint: "LinkedIn gives you room for a hook, proof, and CTA, but the opening still has to carry the first swipe.",
  };
});
const selectedResultPreviewText = computed(() => {
  return resolvePreviewSurfaceText(selectedResultPreviewSurface.value);
});
const selectedResultPreviewParagraphs = computed(() =>
  splitPostParagraphs(selectedResultPreviewText.value),
);
const selectedResultPreviewSubject = computed(() =>
  resolvePreviewSurfaceSubject(selectedResultPreviewSurface.value).trim(),
);
const selectedPreviewLengthSummary = computed(() => {
  if (selectedResultPreviewSurface.value === "email") {
    return {
      primary: `Subject ${selectedResultPreviewSubject.value.length} chars`,
      secondary: `${countWords(selectedResultPreviewText.value)} words in body`,
    };
  }

  return {
    primary: `${selectedResultPreviewText.value.trim().length} chars`,
      secondary: `${countWords(selectedResultPreviewText.value)} words`,
  };
});
const platformPreviewCards = computed<ResultPlatformPreviewCard[]>(() =>
  resultPreviewSurfaceOptions.value.map((option) => {
    const previewText = resolvePreviewSurfaceText(option.value);
    const previewParagraphs = splitPostParagraphs(previewText);
    const subject = resolvePreviewSurfaceSubject(option.value).trim();
    const notices = buildPreviewSurfaceNotices(option.value, previewText, subject);
    const excerptSource =
      option.value === "email"
        ? `${subject}${subject && previewText.trim() ? " · " : ""}${previewText}`
        : previewText;

    return {
      surface: option.value,
      label: option.label,
      accountLabel: resolvePreviewSurfaceAccountLabel(option.value),
      accountDescriptor: resolvePreviewSurfaceAccountDescriptor(option.value),
      previewText,
      previewParagraphs,
      subject,
      primaryMetric:
        option.value === "email"
          ? `Subject ${subject.length} chars`
          : `${previewText.trim().length} chars`,
      secondaryMetric:
        option.value === "email"
          ? `${countWords(previewText)} words in body`
          : `${countWords(previewText)} words`,
      excerpt: truncatePreviewExcerpt(excerptSource || "No preview text yet."),
      notices,
      mediaSummary: resolvePreviewSurfaceMediaSummary(option.value),
      previewAsset: resolvePreviewSurfaceAsset(option.value),
      isDirty: resolvePreviewSurfaceDirty(option.value),
    };
  }),
);
const selectedPreviewCard = computed<ResultPlatformPreviewCard | null>(() =>
  platformPreviewCards.value.find((card) => card.surface === selectedResultPreviewSurface.value)
  ?? platformPreviewCards.value[0]
  ?? null,
);
const selectedPreviewWarnings = computed(() => selectedPreviewCard.value?.notices ?? []);
const selectedPublishingOverflowWarnings = computed(() =>
  selectedPublishingPlatforms.value.flatMap((platform) => {
    const previewCard = platformPreviewCards.value.find((card) => card.surface === platform);

    if (!previewCard) {
      return [];
    }

    return previewCard.notices
      .filter((notice) => notice.tone === "warning")
      .slice(0, 2)
      .map((notice) => ({
        platform,
        label: notice.label,
        detail: notice.detail,
      }));
  }),
);
const editorHelperCopy = computed(() => {
  if (selectedResultPreviewSurface.value === "email" && businessOutput.value?.email) {
    return "Edit the email subject and body here, then use Convert to Email for audience, sender, and final send review.";
  }

  if (
    isBusinessMode.value &&
    (selectedResultPreviewSurface.value === "instagram" || selectedResultPreviewSurface.value === "facebook")
  ) {
    return `${resolveSocialPlatformLabel(selectedResultPreviewSurface.value)} can ship a tighter variant than LinkedIn. Changes autosave here so the preview and publish flow stay aligned.`;
  }

  return "Edit the final draft here. Changes autosave, so publish, schedule, and conversion stay in one flow.";
});
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
const shouldShowCarouselBlueprint = computed(
  () =>
    !isBusinessMode.value
    && creatorWantsCarouselFirst.value
    && Boolean(carouselDraft.value && carouselDraft.value.slides.length > 0),
);
function collapseSceneCue(value: string | undefined, maxWords = 6): string {
  const normalized = (value ?? "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  return normalized
    .split(" ")
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

function truncateOverlayLine(value: string | undefined, maxLength = 40): string | undefined {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength).trim();
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  return (lastSpaceIndex >= Math.floor(maxLength * 0.55) ? truncated.slice(0, lastSpaceIndex) : truncated).trim();
}

function extractWorkspaceDomainLabel(value: string | undefined): string | undefined {
  const normalized = (value ?? "").trim();

  if (!normalized) {
    return undefined;
  }

  try {
    const url = /^https?:\/\//i.test(normalized) ? new URL(normalized) : new URL(`https://${normalized}`);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return undefined;
  }
}

const creatorSceneDescription = computed(() => {
  const headlineCue = collapseSceneCue(
    draft.value?.result.idea.title || previewLeadLines.value[0] || "Founder insight",
    5,
  );
  const angleCue = collapseSceneCue(
    draft.value?.result.idea.angle || previewBodyParagraphs.value[0] || "",
    5,
  );
  const sceneBase =
    creatorContentType.value === "promo_post"
      ? "founder brand promo image, professional but human, product-in-context or operator-in-workspace, realistic photography"
      : "founder working scene, realistic lifestyle photography, modern workspace, authentic business atmosphere";
  const styleBase =
    creatorVisualStyle.value === "realistic_photo"
      ? "natural light, documentary feel, generous negative space for headline overlay"
      : creatorVisualStyle.value === "quote_style"
        ? "clean composition with strong focal subject and restrained overlay text area"
        : "balanced composition, mobile-first crop, clear text-safe area";

  return [
    sceneBase,
    styleBase,
    headlineCue ? `subject matter only: ${headlineCue}` : "",
    angleCue ? `mood cue only: ${angleCue}` : "",
    "scene guidance only, never render these cues as on-image text",
  ]
    .filter((value) => value && value.trim() !== "")
    .join(". ");
});
const motionLiteUsesEmbeddedCopy = computed(
  () => motionLiteSourceAsset.value?.source === "generated",
);
const motionLiteOverlay = computed(() => {
  if (motionLiteUsesEmbeddedCopy.value) {
    return {
      headline: undefined,
      subheadline: undefined,
      cta: undefined,
      brandText: undefined,
    };
  }

  const businessHeadline =
    businessOutput.value?.visual.headline
    || draft.value?.result.idea.title
    || previewLeadLines.value[0]
    || "New update";
  const creatorHeadline =
    previewLeadLines.value[0]
    || draft.value?.result.idea.title
    || "Founder insight";
  const headline = truncateOverlayLine(
    isBusinessMode.value ? businessHeadline : creatorHeadline,
    88,
  );
  const businessSubheadline =
    businessOutput.value?.visual.subheadline
    || businessOutput.value?.visual.visualDirection
    || previewBodyParagraphs.value[0]
    || "";
  const creatorSubheadline =
    creatorContentType.value === "promo_post"
      ? draft.value?.result.idea.angle || previewBodyParagraphs.value[0] || ""
      : previewBodyParagraphs.value[0] || draft.value?.result.idea.angle || "";
  const subheadline = truncateOverlayLine(
    isBusinessMode.value ? businessSubheadline : creatorSubheadline,
    120,
  );
  const cta = truncateOverlayLine(
    isBusinessMode.value
      ? businessOutput.value?.cta.label
      : creatorContentType.value === "promo_post"
        ? draft.value?.result.idea.angle || "Learn more"
        : undefined,
    28,
  );
  const brandText = workspaceBrandLabel.value;

  return {
    headline,
    subheadline,
    cta,
    brandText,
  };
});
const motionLiteBehaviorCopy = computed(() =>
  motionLiteUsesEmbeddedCopy.value
    ? "This still already carries the core message, so motion-lite will animate the current design without adding a second text stack."
    : "Turns one attached image into a short reel-style teaser with timed headline, support text, and CTA while keeping the original still image attached as fallback.",
);
const hooks = computed(() => draft.value?.result.hooks ?? []);
const povSummary = computed(() => draft.value?.result.pov?.summary ?? "");
const qualitySummary = computed(() => draft.value?.result.quality);
const hasPersistedAsset = computed(() => Boolean(draft.value?.result.asset?.id));
const persistedPostId = computed(() => draft.value?.result.asset?.id ?? "");
const activeBusinessId = computed(() => bootstrap.value?.activeBusinessId ?? "");
const accessLimits = computed(() => bootstrap.value?.limits ?? null);
const currentWorkspacePlanCode = computed(() => bootstrap.value?.access?.planCode ?? "free");
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
    return currentWorkspacePlanCode.value === "free"
      ? "Your free queue is full. Upgrade to plan the rest of your week and stay consistent."
      : "Your scheduling queue is full right now. Open planner to clear or publish queued work before adding another slot.";
  }

  return `Queue up to ${scheduledQueueLimit.value} post${scheduledQueueLimit.value === 1 ? "" : "s"} for free, keep the best-time guidance visible, then upgrade when you want a real scheduling cadence.`;
});
const queueLimitPrompt = computed(() =>
  queueLimitReached.value
    ? currentWorkspacePlanCode.value === "free"
      ? "Plan your week in advance and stay consistent. Upgrade to unlock scheduling queue."
      : "The current scheduling queue is full. Open planner to remove or publish a queued post, or refresh if this workspace was just upgraded."
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
const currentBusinessMembership = computed(() =>
  auth.appSession.value?.businesses.find((membership) => membership.businessId === activeBusinessId.value) ?? null,
);
const workspaceBrandLabel = computed(() => {
  const business = currentBusinessMembership.value?.business;
  const preferredLabel =
    business?.brandName?.trim()
    || business?.name?.trim()
    || extractWorkspaceDomainLabel(business?.websiteUrl)
    || selectedConnectedAccountLabel.value.trim();

  return truncateOverlayLine(preferredLabel, 30);
});
const readyImageCount = computed(() =>
  postAssets.value.filter((asset) => asset.type === "image" && asset.status === "ready").length,
);
const readyVideoCount = computed(() =>
  postAssets.value.filter((asset) => asset.type === "video" && asset.status === "ready").length,
);
const readyImageAssets = computed(() =>
  postAssets.value.filter((asset) => asset.type === "image" && asset.status === "ready"),
);
const promoVisualSourceAsset = computed(() =>
  readyImageAssets.value.find((asset) => asset.source === "upload" || asset.metadata.source === "upload")
  ?? null,
);
const recommendedPromoVisualLayout = computed<PromoVisualLayoutId>(() => {
  if (promoVisualSourceAsset.value) {
    return "screenshot_headline";
  }

  return isBusinessMode.value ? "logo_headline" : "headline_only";
});
const promoVisualPreviewAsset = computed<PostAsset | null>(() =>
  selectedPromoVisualLayout.value === "screenshot_headline"
    ? promoVisualSourceAsset.value
    : null,
);
const promoVisualHeadline = computed(() =>
  truncateOverlayLine(
    isBusinessMode.value
      ? businessOutput.value?.visual.headline
        || draft.value?.result.idea.title
        || previewLeadLines.value[0]
        || "New update"
      : previewLeadLines.value[0]
        || draft.value?.result.idea.title
        || "Founder update",
    92,
  ) || "New update",
);
const promoVisualSubheadline = computed(() =>
  truncateOverlayLine(
    isBusinessMode.value
      ? businessOutput.value?.visual.subheadline
        || previewBodyParagraphs.value[0]
        || draft.value?.result.idea.angle
      : previewBodyParagraphs.value[0]
        || draft.value?.result.idea.angle
        || activeCreatorVariant.value?.label,
    144,
  ),
);
const promoVisualCta = computed(() =>
  truncateOverlayLine(
    isBusinessMode.value
      ? businessOutput.value?.cta.label
      : creatorContentType.value === "promo_post"
        ? "Learn more"
        : undefined,
    28,
    ),
);
const motionLiteSourceAsset = computed(() =>
  readyImageAssets.value.find((asset) => asset.id === draftMediaPrimaryAssetId.value)
  ?? readyImageAssets.value[0]
  ?? null,
);
const motionLiteDerivedVideoAsset = computed(() => {
  const sourceAssetId = motionLiteSourceAsset.value?.id;

  if (!sourceAssetId) {
    return null;
  }

  return postAssets.value.find((asset) =>
    asset.type === "video"
    && asset.status === "ready"
    && asset.metadata.source === "motion_template"
    && asset.metadata.posterAssetId === sourceAssetId,
  ) ?? null;
});
const motionLiteCurrentTemplateId = computed<MotionTemplateId | null>(() => {
  const asset = motionLiteDerivedVideoAsset.value;

  if (!asset || asset.type !== "video") {
    return null;
  }

  const value = asset.metadata.motionTemplate?.id;

  return value === "subtle_zoom"
    || value === "caption_pulse"
    || value === "story_pan"
    || value === "founder_story"
    || value === "offer_burst"
    || value === "testimonial_highlight"
    || value === "local_awareness"
    ? value
    : null;
});
const motionLitePreviewAsset = computed<PostAsset | null>(() =>
  motionLiteDerivedVideoAsset.value ?? motionLiteSourceAsset.value ?? null,
);
const recommendedMotionTemplateId = computed<MotionTemplateId>(() => {
  const sourceText = [
    postContent.value,
    businessOutput.value?.visual.headline,
    businessOutput.value?.visual.subheadline,
    draft.value?.result.idea.title,
    draft.value?.result.idea.angle,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join(" ")
    .toLowerCase();
  const hasProofLanguage =
    /\b(testimonial|review|trusted|trust|as seen|customer|parents say|proof|results?)\b/.test(sourceText)
    || /\b\d+[%x]?\b/.test(sourceText);

  if (hasProofLanguage) {
    return "testimonial_highlight";
  }

  if (isBusinessMode.value) {
    const currentBusinessOutput = generationOutput.value?.kind === "business_campaign" ? generationOutput.value : null;

    if (currentBusinessOutput?.intent === "promote_offer") {
      return "offer_burst";
    }

    if (currentBusinessOutput?.goal === "leads" || currentBusinessOutput?.goal === "bookings") {
      return "local_awareness";
    }

    return "story_pan";
  }

  if (activeCreatorVariant.value?.kind === "story_version") {
    return "founder_story";
  }

  if (creatorContentType.value === "promo_post") {
    return "offer_burst";
  }

  if (creatorContentType.value === "image_post") {
    return "story_pan";
  }

  return "founder_story";
});
const recommendedMotionTemplateReason = computed(() => {
  if (recommendedMotionTemplateId.value === "offer_burst") {
    return isBusinessMode.value
      ? "Best for launches, promos, and CTA-heavy business posts."
      : "Best for creator promos and announcement-led posts.";
  }

  if (recommendedMotionTemplateId.value === "local_awareness") {
    return "Best for location-led campaigns, inquiries, and nearby discovery.";
  }

  if (recommendedMotionTemplateId.value === "testimonial_highlight") {
    return "Best for proof, trust, and stat-backed messaging.";
  }

  if (recommendedMotionTemplateId.value === "founder_story") {
    return "Best for storytelling, personal updates, and slower founder-led delivery.";
  }

  if (recommendedMotionTemplateId.value === "story_pan") {
    return "Best for product storytelling and image-led updates.";
  }

  if (recommendedMotionTemplateId.value === "caption_pulse") {
    return "Best for sharper problem hooks and stronger first-frame tension.";
  }

  return "Best for softer story-led motion when you want the visual to breathe.";
});
const motionLiteNeedsRefresh = computed(
  () => Boolean(motionLiteDerivedVideoAsset.value && motionLiteCurrentTemplateId.value !== selectedMotionTemplateId.value),
);
const recommendedMotionAudioPreset = computed<MotionAudioPreset>(() =>
  resolveRecommendedMotionAudioPreset(selectedMotionTemplateId.value),
);
const motionLiteAudioDescription = computed(() =>
  MOTION_AUDIO_OPTIONS.find((option) => option.value === selectedMotionAudioPreset.value)?.description
  ?? MOTION_AUDIO_OPTIONS[0]?.description
  ?? "",
);
const motionLiteAspectRatio = computed(() =>
  motionLiteSourceAsset.value?.metadata.aspectRatio === "9:16" ? "portrait" : "square",
);
const motionLiteUnavailableReason = computed(() => {
  if (readyImageCount.value === 0) {
    return "Generate or attach one image first, then animate it into a short promo teaser.";
  }

  const sourceAssetId = motionLiteSourceAsset.value?.id;
  const unrelatedReadyVideos = postAssets.value.filter((asset) =>
    asset.type === "video"
    && asset.status === "ready"
    && (
      asset.metadata.source !== "motion_template"
      || asset.metadata.posterAssetId !== sourceAssetId
    ),
  );

  if (unrelatedReadyVideos.length > 0) {
    return "This draft already has another video attached. Remove it before generating a motion teaser from the current image.";
  }

  return "";
});
const canGenerateMotionLite = computed(() => motionLiteUnavailableReason.value === "");
const shouldShowAdvancedMotionControls = computed(() =>
  readyImageCount.value > 0 || Boolean(motionLiteDerivedVideoAsset.value),
);

function getMotionTemplateLabel(templateId: MotionTemplateId): string {
  switch (templateId) {
    case "offer_burst":
      return "Offer Burst";
    case "local_awareness":
      return "Local Awareness";
    case "testimonial_highlight":
      return "Testimonial Highlight";
    case "story_pan":
      return "Product Promo";
    case "founder_story":
      return "Founder Story";
    case "caption_pulse":
      return "Problem Hook";
    default:
      return "Calm Story";
  }
}

function resolveNextMotionTemplateId(currentTemplateId: MotionTemplateId): MotionTemplateId {
  const optionValues = MOTION_TEMPLATE_OPTIONS.map((option) => option.value);
  const currentIndex = optionValues.indexOf(currentTemplateId);

  if (currentIndex < 0) {
    return recommendedMotionTemplateId.value;
  }

  return optionValues[(currentIndex + 1) % optionValues.length] ?? recommendedMotionTemplateId.value;
}

function resolveRecommendedMotionAudioPreset(templateId: MotionTemplateId): MotionAudioPreset {
  if (templateId === "offer_burst" || templateId === "caption_pulse") {
    return "high_energy_promo";
  }

  if (templateId === "local_awareness") {
    return "local_trust";
  }

  if (templateId === "testimonial_highlight") {
    return "luxury_minimal";
  }

  if (templateId === "story_pan" || templateId === "founder_story") {
    return "clean_modern";
  }

  return "calm_wellness";
}

function isMotionDerivedVideoAsset(asset: PostAsset): asset is Extract<PostAsset, { type: "video" }> {
  return asset.type === "video"
    && asset.metadata.source === "motion_template"
    && typeof asset.metadata.posterAssetId === "string"
    && asset.metadata.posterAssetId.trim() !== "";
}

function resolveEffectivePostAssetsForPlatform(
  platform: PublishableSocialPlatform,
  assets: PostAsset[] = postAssets.value,
): PostAsset[] {
  const readyAssets = assets.filter((asset) => asset.status === "ready");
  const preferredPrimaryAsset =
    draftMediaPrimaryAssetId.value.trim() !== ""
      ? readyAssets.find((asset) => asset.id === draftMediaPrimaryAssetId.value.trim())
      : undefined;
  const preferredPosterAsset =
    draftMediaPosterAssetId.value.trim() !== ""
      ? readyAssets.find((asset) => asset.id === draftMediaPosterAssetId.value.trim())
      : undefined;

  if (platform === "linkedin") {
    if (preferredPosterAsset?.type === "image") {
      return [preferredPosterAsset];
    }

    if (preferredPrimaryAsset?.type === "image") {
      return [preferredPrimaryAsset];
    }
  }

  if ((platform === "instagram" || platform === "facebook") && preferredPrimaryAsset) {
    return [preferredPrimaryAsset];
  }

  const motionVideos = readyAssets.filter((asset) => {
    if (!isMotionDerivedVideoAsset(asset)) {
      return false;
    }

    const posterAssetId = asset.metadata.posterAssetId?.trim();
    return readyAssets.some((candidate) => candidate.type === "image" && candidate.id === posterAssetId);
  });
  const nonMotionVideos = readyAssets.filter((asset) => asset.type === "video" && !isMotionDerivedVideoAsset(asset));

  if (motionVideos.length !== 1 || nonMotionVideos.length > 0) {
    return readyAssets;
  }

  const motionVideo = motionVideos[0];

  if (platform === "linkedin") {
    return readyAssets.filter((asset) => asset.id !== motionVideo.id);
  }

  return [motionVideo];
}

function summarizeEffectivePostAssetsForPlatform(platform: PublishableSocialPlatform): {
  imageCount: number;
  videoCount: number;
} {
  let imageCount = 0;
  let videoCount = 0;

  for (const asset of resolveEffectivePostAssetsForPlatform(platform)) {
    if (asset.type === "image") {
      imageCount += 1;
      continue;
    }

    if (asset.type === "video") {
      videoCount += 1;
    }
  }

  return { imageCount, videoCount };
}

function getMediaAssetRoleLabel(asset: PostAsset): string {
  if (draftMediaPrimaryAssetId.value === asset.id && draftMediaPosterAssetId.value === asset.id) {
    return "Using still image";
  }

  if (draftMediaPrimaryAssetId.value === asset.id) {
    return asset.type === "video" ? "Primary for Instagram/Facebook" : "Primary asset";
  }

  if (draftMediaPosterAssetId.value === asset.id) {
    return "Fallback for LinkedIn";
  }

  if (isMotionDerivedVideoAsset(asset)) {
    return "Primary for Instagram/Facebook";
  }

  const pairedMotionVideo = postAssets.value.find((candidate) =>
    candidate.type === "video"
    && candidate.metadata.source === "motion_template"
    && candidate.metadata.posterAssetId === asset.id,
  );

  return pairedMotionVideo ? "Fallback for LinkedIn" : "";
}

function resolvePublishingGuardrail(platform: PublishableSocialPlatform): string {
  const { imageCount, videoCount } = summarizeEffectivePostAssetsForPlatform(platform);

  if (imageCount > 0 && videoCount > 0) {
    return "Mixed image and video drafts are not publishable yet. Use only one media type per post.";
  }

  if (platform === "linkedin" && !connectedLinkedInAccount.value) {
    return "Connect LinkedIn before publishing.";
  }

  if (platform === "linkedin" && videoCount > 0) {
    return "Video is publishable on Instagram and Facebook. LinkedIn video support is coming soon.";
  }

  if (platform === "instagram") {
    if (!connectedInstagramAccount.value) {
      return "Connect a Facebook Page with a linked Instagram business account before publishing.";
    }

    if (videoCount > 1) {
      return "Instagram video publishing currently supports exactly 1 ready video.";
    }

    if (videoCount === 0 && (imageCount < 1 || imageCount > 10)) {
      return "Instagram publishing requires either 1 ready video or between 1 and 10 ready images.";
    }
  }

  if (platform === "facebook" && !connectedFacebookAccount.value) {
    return "Connect a Facebook Page before publishing.";
  }

  if (platform === "facebook") {
    if (videoCount > 1) {
      return "Facebook video publishing currently supports exactly 1 ready video.";
    }

    if (videoCount === 0 && imageCount > 10) {
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
const recommendedContentType = computed(() => (
  postAssets.value.length > 0 || creatorWantsImageFirst.value ? "image" : "text"
));
const visibleMediaRecommendations = computed(() =>
  mediaRecommendations.value.filter((suggestion) => suggestion.actionType !== "skip"),
);
const augmentedMediaRecommendations = computed(() => {
  const baseSuggestions = visibleMediaRecommendations.value;

  if (
    isBusinessMode.value
    || baseSuggestions.length === 0
    || baseSuggestions.some((suggestion) => suggestion.suggestedMediaType === "photo_overlay")
  ) {
    return baseSuggestions;
  }

  return [buildCreatorPhotoSuggestion(), ...baseSuggestions];
});
const eligibleMediaRecommendations = computed(() =>
  augmentedMediaRecommendations.value.filter(
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
    : [
        buildCreatorPhotoSuggestion(),
      ]),
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
function buildMediaRecommendationMergeKey(suggestion: MediaRecommendationSuggestion): string {
  return [
    suggestion.actionType,
    suggestion.suggestedMediaType ?? "",
    suggestion.visualTemplateType ?? "",
  ].join(":");
}

function mergeUniqueMediaRecommendations(
  primary: MediaRecommendationSuggestion[],
  secondary: MediaRecommendationSuggestion[],
): MediaRecommendationSuggestion[] {
  const merged: MediaRecommendationSuggestion[] = [];
  const seen = new Set<string>();

  for (const suggestion of [...primary, ...secondary]) {
    const key = buildMediaRecommendationMergeKey(suggestion);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(suggestion);
  }

  return merged;
}

const ensuredMediaRecommendations = computed<MediaRecommendationSuggestion[]>(() => {
  const baseSuggestions = eligibleMediaRecommendations.value;
  const hasGenerateVisual = baseSuggestions.some((suggestion) => suggestion.actionType === "generate_visual");

  if (isBusinessMode.value) {
    return mergeUniqueMediaRecommendations(baseSuggestions, fallbackMediaRecommendations.value);
  }

  if (hasGenerateVisual) {
    return baseSuggestions;
  }

  const generateFallbacks = fallbackMediaRecommendations.value.filter(
    (suggestion) => suggestion.actionType === "generate_visual",
  );

  if (generateFallbacks.length === 0) {
    return baseSuggestions;
  }

  const seenIds = new Set(baseSuggestions.map((suggestion) => suggestion.id));

  return [
    ...baseSuggestions,
    ...generateFallbacks.filter((suggestion) => !seenIds.has(suggestion.id)),
  ];
});
const displayedMediaRecommendations = computed(() => {
  const sourceSuggestions =
    eligibleMediaRecommendations.value.length > 0
      ? ensuredMediaRecommendations.value
      : fallbackMediaRecommendations.value;

  return sourceSuggestions
    .slice()
    .sort((left, right) => {
      const leftMatchesPreference = matchesVisualStylePreference(left, selectedVisualStylePreference.value);
      const rightMatchesPreference = matchesVisualStylePreference(right, selectedVisualStylePreference.value);

      if (leftMatchesPreference !== rightMatchesPreference) {
        return leftMatchesPreference ? -1 : 1;
      }

      const resolvePriority = (suggestion: MediaRecommendationSuggestion): number => {
        if (isBusinessMode.value) {
          return suggestion.suggestedMediaType === "photo_overlay"
            ? 0
            : suggestion.visualTemplateType === "quote" ? 2 : 1;
        }

        if (creatorWantsImageFirst.value || creatorContentType.value === "promo_post") {
          return suggestion.suggestedMediaType === "photo_overlay"
            ? 0
            : suggestion.suggestedMediaType === "stat_card"
              ? 1
              : suggestion.visualTemplateType === "quote"
                ? 2
                : suggestion.visualTemplateType === "carousel"
                  ? 3
                  : 2;
        }

        if (creatorWantsCarouselFirst.value) {
          return suggestion.visualTemplateType === "carousel"
            ? 0
            : suggestion.suggestedMediaType === "photo_overlay"
              ? 1
              : suggestion.visualTemplateType === "quote"
                ? 2
                : 3;
        }

        if (creatorWantsQuoteFirst.value) {
          return suggestion.visualTemplateType === "quote"
            ? 0
            : suggestion.suggestedMediaType === "stat_card"
              ? 1
              : suggestion.suggestedMediaType === "photo_overlay"
                ? 2
                : suggestion.visualTemplateType === "carousel"
                  ? 3
                  : 2;
        }

        return suggestion.visualTemplateType === "quote"
          ? 0
          : suggestion.suggestedMediaType === "stat_card"
            ? 1
            : suggestion.suggestedMediaType === "photo_overlay"
              ? 2
              : suggestion.visualTemplateType === "carousel"
                ? 3
                : 2;
      };

      const leftPriority = resolvePriority(left);
      const rightPriority = resolvePriority(right);
      return leftPriority - rightPriority;
    });
});
const selectableVisualStyleOptions = computed(() => [
  {
    value: "auto" as const,
    label: "Auto",
  },
  {
    value: "photo_overlay" as const,
    label: getVisualStyleOptionLabel("photo_overlay"),
  },
  {
    value: "stat_card" as const,
    label: getVisualStyleOptionLabel("stat_card"),
  },
  {
    value: "quote_card" as const,
    label: getVisualStyleOptionLabel("quote_card"),
  },
  {
    value: "framework_card" as const,
    label: getVisualStyleOptionLabel("framework_card"),
  },
]);
const preferredMediaSuggestion = computed<MediaRecommendationSuggestion | null>(() => {
  if (selectedVisualStylePreference.value === "auto") {
    return null;
  }

  return displayedMediaRecommendations.value.find((suggestion) =>
    matchesVisualStylePreference(suggestion, selectedVisualStylePreference.value),
  ) ?? fallbackMediaRecommendations.value.find((suggestion) =>
    matchesVisualStylePreference(suggestion, selectedVisualStylePreference.value),
  ) ?? null;
});
const mediaPrimaryActionLabel = computed(() => {
  if (selectedVisualStylePreference.value === "auto" || !preferredMediaSuggestion.value) {
    return isLoadingMediaRecommendations.value ? "Loading options..." : "Choose visual format";
  }

  if (isGeneratingRecommendationId.value === preferredMediaSuggestion.value.id) {
    return "Generating...";
  }

  return `Generate ${getVisualStyleOptionLabel(selectedVisualStylePreference.value)}`;
});
const isUsingFallbackMediaRecommendations = computed(
  () => !isLoadingMediaRecommendations.value && eligibleMediaRecommendations.value.length === 0,
);
const mediaRecommendationStatusLabel = computed(() => {
  if (isBusinessMode.value) {
    return recommendedContentType.value === "image" ? "Visual attached" : "Visual-first draft";
  }

  if (postAssets.value.length > 0) {
    return "Assets already attached";
  }

  if (creatorWantsImageFirst.value) {
    return "Image-first draft";
  }

  return isUsingFallbackMediaRecommendations.value ? "Manual generation" : "Text-first draft";
});
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
const readyPostAssets = computed(() =>
  postAssets.value.filter((asset) => asset.status === "ready"),
);
const currentPrimaryAssetSelectionId = computed(() =>
  draftMediaPrimaryAssetId.value.trim() || "",
);
const currentPosterAssetSelectionId = computed(() =>
  draftMediaPosterAssetId.value.trim() || "",
);
const selectedPublishingPreviewAsset = computed(() =>
  resolveEffectivePostAssetsForPlatform(selectedPublishingPlatform.value).find((asset) => Boolean(asset.previewUrl)) ?? null,
);
const selectedPublishingMediaSummary = computed(() => {
  const counts = summarizeEffectivePostAssetsForPlatform(selectedPublishingPlatform.value);

  if (counts.videoCount > 0) {
    return `${counts.videoCount} video${counts.videoCount === 1 ? "" : "s"} ready`;
  }

  if (counts.imageCount > 0) {
    return `${counts.imageCount} image${counts.imageCount === 1 ? "" : "s"} ready`;
  }

  return "No media attached yet";
});
const mediaDrawerActionLabel = computed(() => (
  postAssets.value.length > 0 ? "Open media drawer" : "Add media"
));
const composerHashtagSuggestions = computed(() => {
  if (generatedHashtags.value.length > 0) {
    return generatedHashtags.value;
  }

  return businessOutput.value?.hashtags ?? [];
});
const composerHashtagPreview = computed(() =>
  composerHashtagSuggestions.value.slice(0, 5),
);
const hashtagDrawerSummary = computed(() => {
  const count = composerHashtagSuggestions.value.length;

  if (generatedHashtags.value.length > 0) {
    return `${count} generated hashtag${count === 1 ? "" : "s"}`;
  }

  if (count > 0) {
    return `${count} saved hashtag${count === 1 ? "" : "s"}`;
  }

  return "No hashtags prepared yet";
});
const hashtagDrawerActionLabel = computed(() => (
  composerHashtagSuggestions.value.length > 0 ? "Open hashtag drawer" : "Add hashtags"
));
const selectedPublishingCtaLabel = computed(() =>
  businessOutput.value?.cta.label?.trim() || "No CTA attached",
);
const primaryAssetSelectionSummary = computed(() => {
  const selectedAsset = readyPostAssets.value.find((asset) => asset.id === currentPrimaryAssetSelectionId.value);

  if (selectedAsset) {
    return formatPostAssetChoiceLabel(selectedAsset);
  }

  if (selectedPublishingPreviewAsset.value) {
    return `${formatPostAssetChoiceLabel(selectedPublishingPreviewAsset.value)} · currently previewing`;
  }

  return "No explicit primary asset selected";
});
const posterAssetSelectionSummary = computed(() => {
  const selectedAsset = readyImageAssets.value.find((asset) => asset.id === currentPosterAssetSelectionId.value);

  if (selectedAsset) {
    return formatPostAssetChoiceLabel(selectedAsset);
  }

  return "LinkedIn uses the current image preview when a fallback is not pinned yet.";
});

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
const publishLauncherFacts = computed(() => [
  {
    label: "Destinations",
    value: selectedPublishingPlatforms.value.length > 0 ? selectedPublishingPlatformsLabel.value : "Choose destinations",
  },
  {
    label: "Status",
    value: executionStatus.value.label,
  },
  {
    label: "Publish as",
    value: selectedConnectedAccountDescriptor.value,
  },
  {
    label: "Next step",
    value: actionPriorityLabel.value,
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

function resolveMotionAudioPresetFromLegacyTrack(track: MotionAudioTrack): MotionAudioPreset {
  if (track === "upbeat") {
    return "high_energy_promo";
  }

  if (track === "ambient") {
    return "local_trust";
  }

  return "clean_modern";
}

function normalizeDraftMediaPreferences(value: unknown): DraftMediaPreferences | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const mediaPreferences =
    candidate.mediaPreferences && typeof candidate.mediaPreferences === "object" && !Array.isArray(candidate.mediaPreferences)
      ? candidate.mediaPreferences as Record<string, unknown>
      : null;

  if (!mediaPreferences) {
    return undefined;
  }

  const primaryAssetId =
    typeof mediaPreferences.primaryAssetId === "string" && mediaPreferences.primaryAssetId.trim() !== ""
      ? mediaPreferences.primaryAssetId.trim()
      : undefined;
  const posterAssetId =
    typeof mediaPreferences.posterAssetId === "string" && mediaPreferences.posterAssetId.trim() !== ""
      ? mediaPreferences.posterAssetId.trim()
      : undefined;
  const motionTemplateId = mediaPreferences.motionTemplateId;
  const normalizedMotionTemplateId =
    motionTemplateId === "subtle_zoom"
    || motionTemplateId === "caption_pulse"
    || motionTemplateId === "story_pan"
    || motionTemplateId === "founder_story"
    || motionTemplateId === "offer_burst"
    || motionTemplateId === "testimonial_highlight"
    || motionTemplateId === "local_awareness"
      ? motionTemplateId
      : undefined;
  const motionAudioEnabled =
    typeof mediaPreferences.motionAudioEnabled === "boolean"
      ? mediaPreferences.motionAudioEnabled
      : undefined;
  const motionAudioPreset =
    mediaPreferences.motionAudioPreset === "clean_modern"
    || mediaPreferences.motionAudioPreset === "high_energy_promo"
    || mediaPreferences.motionAudioPreset === "local_trust"
    || mediaPreferences.motionAudioPreset === "luxury_minimal"
    || mediaPreferences.motionAudioPreset === "calm_wellness"
      ? mediaPreferences.motionAudioPreset
      : undefined;
  const motionAudioTrack =
    mediaPreferences.motionAudioTrack === "calm"
    || mediaPreferences.motionAudioTrack === "upbeat"
    || mediaPreferences.motionAudioTrack === "ambient"
      ? mediaPreferences.motionAudioTrack
      : undefined;
  const promoVisualLayout =
    mediaPreferences.promoVisualLayout === "logo_headline"
    || mediaPreferences.promoVisualLayout === "screenshot_headline"
    || mediaPreferences.promoVisualLayout === "headline_only"
      ? mediaPreferences.promoVisualLayout
      : undefined;

  return primaryAssetId
    || posterAssetId
    || normalizedMotionTemplateId
    || motionAudioEnabled !== undefined
    || motionAudioPreset
    || motionAudioTrack
    || promoVisualLayout
    ? {
        primaryAssetId,
        posterAssetId,
        motionTemplateId: normalizedMotionTemplateId,
        motionAudioEnabled,
        motionAudioPreset: motionAudioPreset ?? (motionAudioTrack ? resolveMotionAudioPresetFromLegacyTrack(motionAudioTrack) : undefined),
        motionAudioTrack,
        promoVisualLayout,
      }
    : undefined;
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
    contentType: "text_post",
    visualStyle: "minimal_text_card",
    post,
    hooks: Array.isArray(body.hooks) ? body.hooks.filter((hook): hook is string => typeof hook === "string") : [],
    variants: buildCreatorVariantsFromLegacy({
      post,
      hooks: Array.isArray(body.hooks) ? body.hooks.filter((hook): hook is string => typeof hook === "string") : [],
      variations: Array.isArray(body.variations) ? body.variations : [],
      intent: body.generationIntent,
      contentType: "text_post",
      ideaTitle:
        typeof body.idea?.title === "string" && body.idea.title.trim() !== ""
          ? body.idea.title
          : "Saved draft",
      ideaAngle:
        typeof body.idea?.angle === "string" && body.idea.angle.trim() !== ""
          ? body.idea.angle
          : "Refine and publish this workspace draft.",
    }),
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
  const normalizedGenerationOutput =
    body.generationOutput && typeof body.generationOutput === "object"
      ? body.generationOutput.kind === "creator_post"
        ? {
            ...body.generationOutput,
            variants:
              Array.isArray(body.generationOutput.variants) && body.generationOutput.variants.length > 0
                ? body.generationOutput.variants
                : buildCreatorVariantsFromLegacy({
                    post,
                    hooks: Array.isArray(body.hooks) ? body.hooks.filter((hook): hook is string => typeof hook === "string") : [],
                    variations: Array.isArray(body.variations) ? body.variations : [],
                    intent: body.generationIntent,
                    contentType:
                      body.generationOutput.contentType === "image_post"
                      || body.generationOutput.contentType === "carousel"
                      || body.generationOutput.contentType === "quote_card"
                      || body.generationOutput.contentType === "promo_post"
                      || body.generationOutput.contentType === "text_post"
                        ? body.generationOutput.contentType
                        : "text_post",
                    ideaTitle:
                      typeof body.idea?.title === "string" && body.idea.title.trim() !== ""
                        ? body.idea.title
                        : asset.title || "Saved draft",
                    ideaAngle:
                      typeof body.idea?.angle === "string" && body.idea.angle.trim() !== ""
                        ? body.idea.angle
                        : "Refine and publish this workspace draft.",
                  }),
          }
        : body.generationOutput
      : fallbackGenerationOutput;
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
    generationOutput: normalizedGenerationOutput,
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
  const valueToCopy = resolvePreviewSurfaceText(selectedPublishingPlatform.value).trim();

  if (!valueToCopy || typeof navigator === "undefined" || !navigator.clipboard) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(valueToCopy);

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

function setResultPreviewSurface(surface: ResultPreviewSurface): void {
  selectedResultPreviewSurface.value = surface;

  if (surface !== "email") {
    selectedPublishingPlatform.value = surface;
  }
}

function resetManualPostEdit(): void {
  editablePostContent.value = postContent.value;
  manualEditFeedback.value = "";
}

function resetSelectedSurfaceEdit(): void {
  manualEditFeedback.value = "";

  if (selectedResultPreviewSurface.value === "instagram") {
    editableInstagramContent.value = resolveEditableCaptionBaseline("instagram");
    return;
  }

  if (selectedResultPreviewSurface.value === "facebook") {
    editableFacebookContent.value = resolveEditableCaptionBaseline("facebook");
    return;
  }

  if (selectedResultPreviewSurface.value === "email") {
    editableEmailSubject.value = businessOutput.value?.email?.subject ?? "";
    editableEmailBody.value = businessOutput.value?.email?.body ?? "";
    return;
  }

  resetManualPostEdit();
}

async function persistBusinessOutputChanges(
  nextBusinessOutput: BusinessContentOutput,
  successMessage: string,
): Promise<void> {
  if (!draft.value) {
    return;
  }

  let nextAsset = draft.value.result.asset;

  if (activeBusinessId.value && draft.value.result.asset?.id) {
    const response = await requestUpdatePipelineItem({
      businessId: activeBusinessId.value,
      assetId: draft.value.result.asset.id,
      textContent: postContent.value,
      contentBody: buildDraftContentBodyWithBusinessOutput(nextBusinessOutput),
    });

    nextAsset = response.asset;
  }

  draft.value = replaceActivationDraft({
    ...draft.value,
    result: {
      ...draft.value.result,
      businessOutput: nextBusinessOutput,
      generationOutput: buildSyncedGenerationOutput(nextBusinessOutput) ?? draft.value.result.generationOutput,
      asset: nextAsset,
    },
  });
  feedbackMessage.value = successMessage;
}
function resetPublishingSetup(): void {
  editableCtaLabel.value = businessOutput.value?.cta.label ?? "";
  editableCtaUrl.value = businessOutput.value?.cta.url ?? "";
  publishingSetupFeedback.value = "";
}

function clearContentAutosaveTimer(): void {
  if (!contentAutosaveTimer) {
    return;
  }

  clearTimeout(contentAutosaveTimer);
  contentAutosaveTimer = null;
}

function clearCtaAutosaveTimer(): void {
  if (!ctaAutosaveTimer) {
    return;
  }

  clearTimeout(ctaAutosaveTimer);
  ctaAutosaveTimer = null;
}

function markContentAutosaveSettled(): void {
  contentAutosaveError.value = "";
  contentAutosaveState.value = draft.value ? "saved" : "idle";
}

function markCtaAutosaveSettled(): void {
  ctaAutosaveError.value = "";
  ctaAutosaveState.value = businessOutput.value ? "saved" : "idle";
}

function buildPendingVariantBusinessOutput(): BusinessContentOutput | null {
  if (!isInstagramEditDirty.value && !isFacebookEditDirty.value && !isEmailEditDirty.value) {
    return null;
  }

  const nextBusinessOutput = businessOutput.value
    ? cloneBusinessOutput(businessOutput.value)
    : resolveDraftBusinessOutputSeed();

  if (isInstagramEditDirty.value) {
    nextBusinessOutput.captions.instagram = editableInstagramContent.value.trim();
  }

  if (isFacebookEditDirty.value) {
    nextBusinessOutput.captions.facebook = editableFacebookContent.value.trim();
  }

  if (isEmailEditDirty.value) {
    if (!nextBusinessOutput.email) {
      nextBusinessOutput.email = {
        subject: "",
        body: "",
      };
    }

    nextBusinessOutput.email.subject = editableEmailSubject.value.trim();
    nextBusinessOutput.email.body = editableEmailBody.value.trim();
  }

  return nextBusinessOutput;
}

function buildPendingCtaBusinessOutput(): BusinessContentOutput | null {
  if (!businessOutput.value || !isCtaDirty.value) {
    return null;
  }

  const nextBusinessOutput = cloneBusinessOutput(businessOutput.value);
  nextBusinessOutput.cta.label = editableCtaLabel.value.trim();
  nextBusinessOutput.cta.url = editableCtaUrl.value.trim();
  return nextBusinessOutput;
}

function scheduleContentAutosave(): void {
  clearContentAutosaveTimer();

  if (!draft.value) {
    contentAutosaveState.value = "idle";
    return;
  }

  if (!hasPendingContentAutosaveChanges.value) {
    markContentAutosaveSettled();
    return;
  }

  contentAutosaveError.value = "";
  manualEditFeedback.value = "";
  contentAutosaveState.value = "queued";
  contentAutosaveTimer = setTimeout(() => {
    contentAutosaveTimer = null;
    void runContentAutosave();
  }, CONTENT_AUTOSAVE_DELAY_MS);
}

function scheduleCtaAutosave(): void {
  clearCtaAutosaveTimer();

  if (!businessOutput.value) {
    ctaAutosaveState.value = "idle";
    return;
  }

  if (!isCtaDirty.value) {
    markCtaAutosaveSettled();
    return;
  }

  ctaAutosaveError.value = "";
  publishingSetupFeedback.value = "";
  ctaAutosaveState.value = "queued";
  ctaAutosaveTimer = setTimeout(() => {
    ctaAutosaveTimer = null;
    void runCtaAutosave();
  }, CTA_AUTOSAVE_DELAY_MS);
}

async function runContentAutosave(): Promise<boolean> {
  if (activeContentAutosavePromise) {
    return activeContentAutosavePromise;
  }

  activeContentAutosavePromise = (async () => {
  clearContentAutosaveTimer();

  if (!hasPendingContentAutosaveChanges.value) {
    markContentAutosaveSettled();
    return true;
  }

  contentAutosaveState.value = "saving";
  contentAutosaveError.value = "";
  manualEditFeedback.value = "";
  isSavingManualEdit.value = true;

  try {
    if (isManualEditDirty.value) {
      await updateDraftPostContent(editablePostContent.value, "");
    }

    const nextBusinessOutput = buildPendingVariantBusinessOutput();

    if (nextBusinessOutput) {
      await persistBusinessOutputChanges(nextBusinessOutput, "");
    }

    contentAutosaveState.value = "saved";

    if (hasPendingContentAutosaveChanges.value) {
      scheduleContentAutosave();
    }

    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save your latest draft changes.";
    contentAutosaveState.value = "error";
    contentAutosaveError.value = message;
    manualEditFeedback.value = message;
    return false;
  } finally {
    isSavingManualEdit.value = false;
  }
  })();

  try {
    return await activeContentAutosavePromise;
  } finally {
    activeContentAutosavePromise = null;
  }
}

async function runCtaAutosave(): Promise<boolean> {
  if (activeCtaAutosavePromise) {
    return activeCtaAutosavePromise;
  }

  activeCtaAutosavePromise = (async () => {
  clearCtaAutosaveTimer();

  if (!isCtaDirty.value) {
    markCtaAutosaveSettled();
    return true;
  }

  const nextBusinessOutput = buildPendingCtaBusinessOutput();

  if (!nextBusinessOutput) {
    markCtaAutosaveSettled();
    return true;
  }

  ctaAutosaveState.value = "saving";
  ctaAutosaveError.value = "";
  publishingSetupFeedback.value = "";

  try {
    await persistBusinessOutputChanges(nextBusinessOutput, "");
    ctaAutosaveState.value = "saved";

    if (isCtaDirty.value) {
      scheduleCtaAutosave();
    }

    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save the CTA changes right now.";
    ctaAutosaveState.value = "error";
    ctaAutosaveError.value = message;
    publishingSetupFeedback.value = message;
    return false;
  }
  })();

  try {
    return await activeCtaAutosavePromise;
  } finally {
    activeCtaAutosavePromise = null;
  }
}

async function flushComposerAutosaves(): Promise<boolean> {
  clearContentAutosaveTimer();
  clearCtaAutosaveTimer();

  const contentSaved = await runContentAutosave();
  const ctaSaved = await runCtaAutosave();
  return contentSaved && ctaSaved;
}

async function setPrimaryAssetPreference(assetId: string): Promise<void> {
  const asset = readyPostAssets.value.find((candidate) => candidate.id === assetId);

  if (!asset) {
    return;
  }

  try {
    await persistDraftMediaPreferences(
      {
        primaryAssetId: asset.id,
        posterAssetId:
          asset.type === "image"
            ? asset.id
            : draftMediaPosterAssetId.value || readyImageAssets.value[0]?.id,
        motionTemplateId: selectedMotionTemplateId.value,
        motionAudioEnabled: selectedMotionAudioEnabled.value,
        motionAudioPreset: selectedMotionAudioPreset.value,
        promoVisualLayout: selectedPromoVisualLayout.value,
      },
      {
        successMessage:
          asset.type === "video"
            ? "Instagram and Facebook will prefer this video. LinkedIn keeps the selected image fallback."
            : "This image is now the primary media across the draft.",
      },
    );
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to update the primary media right now.";
  }
}

async function setPosterAssetPreference(assetId: string): Promise<void> {
  const asset = readyImageAssets.value.find((candidate) => candidate.id === assetId);

  if (!asset) {
    return;
  }

  try {
    await persistDraftMediaPreferences(
      {
        primaryAssetId: draftMediaPrimaryAssetId.value || undefined,
        posterAssetId: asset.id,
        motionTemplateId: selectedMotionTemplateId.value,
        motionAudioEnabled: selectedMotionAudioEnabled.value,
        motionAudioPreset: selectedMotionAudioPreset.value,
        promoVisualLayout: selectedPromoVisualLayout.value,
      },
      {
        successMessage: "LinkedIn fallback image updated for this draft.",
      },
    );
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to update the LinkedIn fallback image right now.";
  }
}

function clearAiEditPreview(): void {
  aiEditPreview.value = null;
  aiEditFeedback.value = "";
}

function buildSyncedGenerationOutput(
  nextBusinessOutput: BusinessContentOutput | undefined = draft.value?.result.businessOutput,
): RepurposeContentResponse["generationOutput"] | undefined {
  if (!draft.value?.result.generationOutput) {
    return undefined;
  }

  if (draft.value.result.generationOutput.kind === "business_campaign") {
    return {
      ...draft.value.result.generationOutput,
      content: nextBusinessOutput ?? draft.value.result.generationOutput.content,
    };
  }

  if (draft.value.result.generationOutput.kind === "creator_post") {
    return {
      ...draft.value.result.generationOutput,
      post: postContent.value,
      variants: (
        Array.isArray(draft.value.result.generationOutput.variants)
          ? draft.value.result.generationOutput.variants
          : creatorVariants.value
      ).map((variant) =>
        variant.id === selectedCreatorVariantId.value
          ? {
              ...variant,
              content: postContent.value,
            }
          : variant,
      ),
    };
  }

  return draft.value.result.generationOutput;
}

function buildDraftMediaPreferences(): DraftMediaPreferences | undefined {
  const primaryAssetId = draftMediaPrimaryAssetId.value.trim() || undefined;
  const posterAssetId = draftMediaPosterAssetId.value.trim() || undefined;
  const motionTemplateId = selectedMotionTemplateId.value;
  const motionAudioEnabled = selectedMotionAudioEnabled.value;
  const motionAudioPreset = selectedMotionAudioPreset.value;
  const promoVisualLayout = selectedPromoVisualLayout.value;

  return primaryAssetId || posterAssetId || motionTemplateId || motionAudioEnabled !== undefined || motionAudioPreset || promoVisualLayout
    ? {
        primaryAssetId,
        posterAssetId,
        motionTemplateId,
        motionAudioEnabled,
        motionAudioPreset,
        promoVisualLayout,
      }
    : undefined;
}

function syncDraftMediaPreferencesFromDraft(): void {
  const preferences = normalizeDraftMediaPreferences(draft.value?.result.asset?.contentBody);
  draftMediaPrimaryAssetId.value = preferences?.primaryAssetId ?? "";
  draftMediaPosterAssetId.value = preferences?.posterAssetId ?? "";
  selectedMotionTemplateId.value = preferences?.motionTemplateId ?? recommendedMotionTemplateId.value;
  selectedMotionAudioEnabled.value = preferences?.motionAudioEnabled ?? true;
  selectedMotionAudioPreset.value = preferences?.motionAudioPreset ?? resolveRecommendedMotionAudioPreset(selectedMotionTemplateId.value);
  selectedPromoVisualLayout.value = preferences?.promoVisualLayout ?? recommendedPromoVisualLayout.value;
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
    generationOutput: buildSyncedGenerationOutput(),
    visualNarrative: nextVisualNarrative,
    carouselDraft: mapCarouselDraftFromNarrative(nextVisualNarrative),
    ...(buildDraftMediaPreferences() ? { mediaPreferences: buildDraftMediaPreferences() } : {}),
  };
}

function buildDraftContentBodyWithBusinessOutput(nextBusinessOutput: BusinessContentOutput): Record<string, unknown> {
  if (!draft.value) {
    return {
      content: postContent.value,
      post: postContent.value,
      businessOutput: nextBusinessOutput,
    };
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
    businessOutput: nextBusinessOutput,
    generationOutput: buildSyncedGenerationOutput(nextBusinessOutput),
    visualNarrative: nextVisualNarrative,
    carouselDraft: mapCarouselDraftFromNarrative(nextVisualNarrative),
    ...(buildDraftMediaPreferences() ? { mediaPreferences: buildDraftMediaPreferences() } : {}),
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
    generationOutput: buildSyncedGenerationOutput(),
    visualNarrative: persistableNarrative,
    carouselDraft: mapCarouselDraftFromNarrative(persistableNarrative),
    ...(buildDraftMediaPreferences() ? { mediaPreferences: buildDraftMediaPreferences() } : {}),
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
      generationOutput: buildSyncedGenerationOutput() ?? draft.value.result.generationOutput,
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

  const nextGenerationOutput =
    draft.value.result.generationOutput?.kind === "creator_post"
      ? {
          ...draft.value.result.generationOutput,
          post: trimmedText,
          variants: (
            Array.isArray(draft.value.result.generationOutput.variants)
              ? draft.value.result.generationOutput.variants
              : creatorVariants.value
          ).map((variant) =>
            variant.id === selectedCreatorVariantId.value
              ? {
                  ...variant,
                  content: trimmedText,
                }
              : variant,
          ),
        }
      : draft.value.result.generationOutput;

  const nextDraft = replaceActivationDraft({
    ...draft.value,
    result: {
      ...draft.value.result,
      post: trimmedText,
      generationOutput: nextGenerationOutput,
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

async function persistDraftMediaPreferences(
  input: DraftMediaPreferences,
  options?: { successMessage?: string; silent?: boolean },
): Promise<void> {
  draftMediaPrimaryAssetId.value = input.primaryAssetId ?? "";
  draftMediaPosterAssetId.value = input.posterAssetId ?? "";

  if (!draft.value || !activeBusinessId.value || !draft.value.result.asset?.id) {
    return;
  }

  const response = await requestUpdatePipelineItem({
    businessId: activeBusinessId.value,
    assetId: draft.value.result.asset.id,
    textContent: postContent.value,
    contentBody: buildDraftContentBody(),
  });

  const nextDraft = buildPersistedDraftRecord(response.asset);

  if (nextDraft) {
    draft.value = nextDraft;
  }

  if (!options?.silent && options?.successMessage) {
    feedbackMessage.value = options.successMessage;
  }
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
  const businessId = activeBusinessId.value;
  socialAccounts.value = [];

  if (!businessId) {
    return;
  }

  isLoadingChannels.value = true;

  try {
    const response = await requestSocialAccounts(businessId);
    if (activeBusinessId.value !== businessId) {
      return;
    }

    socialAccounts.value = response.accounts;
  } catch {
    if (activeBusinessId.value !== businessId) {
      return;
    }

    socialAccounts.value = [];
  } finally {
    if (activeBusinessId.value === businessId) {
      isLoadingChannels.value = false;
    }
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
      goal: creatorMediaGoal.value,
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
  openMediaDrawer();
  await nextTick();
  mediaRecommendationPanelRef.value?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });

  if (isUsingFallbackMediaRecommendations.value) {
    mediaFeedback.value = "No strong visual match yet. You can still generate media manually.";
  }
}

async function triggerPreferredMediaGeneration(): Promise<void> {
  if (selectedVisualStylePreference.value === "auto" || !preferredMediaSuggestion.value) {
    await openGenerateMediaOptions();
    return;
  }

  await applyMediaRecommendation(preferredMediaSuggestion.value);
}

async function createPromoVisualFromBrand(): Promise<void> {
  if (!activeBusinessId.value) {
    mediaFeedback.value = "Select a workspace before creating a promo visual.";
    return;
  }

  if (!draft.value) {
    mediaFeedback.value = "Generate a post first, then create a promo visual.";
    return;
  }

  isCreatingPromoVisual.value = true;
  mediaFeedback.value = "";

  try {
    const persistedId = await ensurePersistedDraft();

    if (!persistedId) {
      mediaFeedback.value = "Save this draft first, then create a promo visual.";
      return;
    }

    const response = await requestCreatePromoVisualPostAsset({
      businessId: activeBusinessId.value,
      postId: persistedId,
      layout: selectedPromoVisualLayout.value,
      headline: promoVisualHeadline.value,
      subheadline: promoVisualSubheadline.value,
      cta: promoVisualCta.value,
      sourceAssetId:
        selectedPromoVisualLayout.value === "screenshot_headline"
          ? promoVisualSourceAsset.value?.id
          : undefined,
      aspectRatio: "1:1",
    });

    await loadPostAssets();
    await persistDraftMediaPreferences(
      {
        primaryAssetId: response.asset.id,
        posterAssetId: response.asset.id,
        promoVisualLayout: selectedPromoVisualLayout.value,
      },
      {
        silent: true,
      },
    );

    const brandMessage = response.usedLogo
      ? "Used the saved brand logo."
      : "No saved logo found, so initials were used instead.";
    const layoutMessage =
      response.resolvedLayout !== selectedPromoVisualLayout.value
        ? "Screenshot layout was requested, but no ready uploaded image was attached, so it fell back to Logo + headline."
        : response.usedSourceAssetId
          ? "Used the attached screenshot as the hero visual."
          : "Built a clean branded still from your headline, CTA, and brand styling.";
    mediaFeedback.value = `Promo visual created and attached to this draft. ${layoutMessage} ${brandMessage}`;
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to create a promo visual right now.";
  } finally {
    isCreatingPromoVisual.value = false;
  }
}

async function generateMotionLiteFromCurrentVisual(): Promise<void> {
  if (!activeBusinessId.value) {
    mediaFeedback.value = "Select a workspace before generating motion.";
    return;
  }

  if (!canGenerateMotionLite.value || !motionLiteSourceAsset.value) {
    mediaFeedback.value = motionLiteUnavailableReason.value || "Attach one image first, then animate it.";
    return;
  }

  isGeneratingMotionLite.value = true;
  mediaFeedback.value = "";

  try {
    const persistedId = await ensurePersistedDraft();

    if (!persistedId) {
      mediaFeedback.value = "Save this draft first, then generate motion.";
      return;
    }

    const response = await requestGenerateMotionPostAsset({
      businessId: activeBusinessId.value,
      postId: persistedId,
      sourceAssetId: motionLiteSourceAsset.value.id,
      motionTemplate: {
        id: selectedMotionTemplateId.value,
        aspectRatio: motionLiteAspectRatio.value,
        durationMs: 5000,
        loop: false,
        overlay: {
          headline: motionLiteOverlay.value.headline,
          subheadline: motionLiteOverlay.value.subheadline,
          cta: motionLiteOverlay.value.cta,
          brandText: motionLiteOverlay.value.brandText,
        },
        audio: {
          enabled: selectedMotionAudioEnabled.value,
          music: {
            preset: selectedMotionAudioPreset.value,
          },
          voice: {
            enabled: false,
            script: null,
            provider: "elevenlabs",
            voiceId: null,
          },
        },
      },
    });

    await loadPostAssets();
    await persistDraftMediaPreferences(
      {
        primaryAssetId: response.asset.id,
        posterAssetId: motionLiteSourceAsset.value.id,
      },
      {
        silent: true,
      },
    );
    mediaFeedback.value =
      `Created a short ${getMotionTemplateLabel(selectedMotionTemplateId.value).toLowerCase()} teaser and kept the original image attached as a fallback.`;

    if (response.removedAssetIds.length > 0) {
      mediaFeedback.value =
        `Re-generated the ${getMotionTemplateLabel(selectedMotionTemplateId.value).toLowerCase()} teaser. Instagram and Facebook will use the refreshed video, while LinkedIn keeps the poster image.`;
    } else {
      mediaFeedback.value =
        `Created a short ${getMotionTemplateLabel(selectedMotionTemplateId.value).toLowerCase()} teaser. Instagram and Facebook will prefer the video, while LinkedIn keeps the poster image.`;
    }
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to generate a motion teaser right now.";
  } finally {
    isGeneratingMotionLite.value = false;
  }
}

async function tryAnotherMotionStyle(): Promise<void> {
  if (isGeneratingMotionLite.value || isUploadingPostAssets.value) {
    return;
  }

  const nextTemplateId = resolveNextMotionTemplateId(selectedMotionTemplateId.value);
  selectedMotionTemplateId.value = nextTemplateId;
  await nextTick();
  await generateMotionLiteFromCurrentVisual();
}

async function preferStillImageForDraft(): Promise<void> {
  if (!motionLiteSourceAsset.value) {
    mediaFeedback.value = "Attach one image before switching this draft back to still-image mode.";
    return;
  }

  try {
    await persistDraftMediaPreferences(
      {
        primaryAssetId: motionLiteSourceAsset.value.id,
        posterAssetId: motionLiteSourceAsset.value.id,
      },
      {
        successMessage: "This draft will use the still image across platforms.",
      },
    );
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to switch this draft back to the still image.";
  }
}

async function preferMotionVideoForDraft(): Promise<void> {
  if (!motionLiteDerivedVideoAsset.value || !motionLiteSourceAsset.value) {
    mediaFeedback.value = "Generate a motion teaser first, then make it primary.";
    return;
  }

  try {
    await persistDraftMediaPreferences(
      {
        primaryAssetId: motionLiteDerivedVideoAsset.value.id,
        posterAssetId: motionLiteSourceAsset.value.id,
      },
      {
        successMessage: "This draft will use the motion teaser for Instagram and Facebook, with the image kept for LinkedIn.",
      },
    );
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to switch this draft back to the motion teaser.";
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
    const isPhotoOverlay = suggestion.suggestedMediaType === "photo_overlay";
    const creatorOverlayFooterText =
      !isBusinessMode.value && workspaceBrandLabel.value
        ? workspaceBrandLabel.value
        : undefined;
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
          isPhotoOverlay
            ? (
                isBusinessMode.value
                  ? truncateOverlayLine(businessOutput.value?.visual.subheadline, 52)
                  : undefined
              )
            : (
                coverSlide?.supportingText ||
                businessOutput.value?.visual.subheadline ||
                previewLeadLines.value[1] ||
                previewBodyParagraphs.value[0]?.replace(/\s+/g, " ").trim().slice(0, 140) ||
                undefined
              ),
        bulletPoints:
          suggestion.visualTemplateType === "carousel"
            ? coverSlide?.bulletPoints || buildVisualBulletPoints()
            : buildVisualBulletPoints(),
        sceneDescription:
          isPhotoOverlay
            ? (isBusinessMode.value ? businessOutput.value?.visual.imagePrompt : creatorSceneDescription.value)
            : undefined,
        closingText:
          isPhotoOverlay
            ? (
                isBusinessMode.value
                  ? truncateOverlayLine(businessOutput.value?.cta.label, 28)
                  : creatorContentType.value === "promo_post"
                    ? truncateOverlayLine(draft.value?.result.idea.angle || previewBodyParagraphs.value[0], 30)
                    : undefined
              )
            : undefined,
        footerText: isPhotoOverlay ? creatorOverlayFooterText : undefined,
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

async function persistPostAssetOrder(
  nextAssetIds: string[],
  activeAssetId: string,
  successMessage: string,
): Promise<void> {
  if (!activeBusinessId.value || !persistedPostId.value || nextAssetIds.length === 0) {
    return;
  }

  reorderingPostAssetId.value = activeAssetId;
  mediaFeedback.value = "";

  try {
    const response = await requestReorderPostAssets({
      businessId: activeBusinessId.value,
      postId: persistedPostId.value,
      assetIds: nextAssetIds,
    });
    postAssets.value = response.assets;
    mediaFeedback.value = successMessage;
  } catch (error) {
    mediaFeedback.value =
      error instanceof Error ? error.message : "Unable to update media order.";
  } finally {
    reorderingPostAssetId.value = "";
  }
}

function canMovePostAsset(assetId: string, direction: -1 | 1): boolean {
  if (reorderingPostAssetId.value !== "" || removingPostAssetId.value !== "") {
    return false;
  }

  const currentIndex = postAssets.value.findIndex((asset) => asset.id === assetId);
  const nextIndex = currentIndex + direction;

  return currentIndex >= 0 && nextIndex >= 0 && nextIndex < postAssets.value.length;
}

async function movePostAsset(assetId: string, direction: -1 | 1): Promise<void> {
  const currentIndex = postAssets.value.findIndex((asset) => asset.id === assetId);
  const nextIndex = currentIndex + direction;

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= postAssets.value.length) {
    return;
  }

  const nextAssetIds = postAssets.value.map((asset) => asset.id);
  const [movedAssetId] = nextAssetIds.splice(currentIndex, 1);

  if (!movedAssetId) {
    return;
  }

  nextAssetIds.splice(nextIndex, 0, movedAssetId);

  await persistPostAssetOrder(nextAssetIds, assetId, "Media order updated for this draft.");
}

async function movePostAssetToFront(assetId: string): Promise<void> {
  const currentIndex = postAssets.value.findIndex((asset) => asset.id === assetId);

  if (currentIndex <= 0) {
    return;
  }

  const nextAssetIds = postAssets.value.map((asset) => asset.id);
  const [movedAssetId] = nextAssetIds.splice(currentIndex, 1);

  if (!movedAssetId) {
    return;
  }

  nextAssetIds.unshift(movedAssetId);

  await persistPostAssetOrder(
    nextAssetIds,
    assetId,
    "Media order updated. The selected image now leads the draft.",
  );
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

  if (!(await flushComposerAutosaves())) {
    feedbackMessage.value = "We could not save the latest edits. Fix the autosave error first.";
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

  isPublishDrawerOpen.value = true;
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

function openPublishDrawer(): void {
  isMediaDrawerOpen.value = false;
  isHashtagDrawerOpen.value = false;
  isPublishDrawerOpen.value = true;
}

function closePublishDrawer(): void {
  isPublishDrawerOpen.value = false;
  closeSchedulePanel();
}

function openMediaDrawer(): void {
  isPublishDrawerOpen.value = false;
  isHashtagDrawerOpen.value = false;
  isMediaDrawerOpen.value = true;
}

function closeMediaDrawer(): void {
  isMediaDrawerOpen.value = false;
}

function openHashtagDrawer(): void {
  isPublishDrawerOpen.value = false;
  isMediaDrawerOpen.value = false;
  isHashtagDrawerOpen.value = true;
}

function closeHashtagDrawer(): void {
  isHashtagDrawerOpen.value = false;
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

  if (!(await flushComposerAutosaves())) {
    scheduleFeedback.value = "We could not save the latest edits. Fix the autosave error first.";
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
      const platformContentText = resolvePublishingContentText(platform);
      const scheduleRequest = {
        businessId: activeBusinessId.value,
        platform,
        contentText: platformContentText,
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

  if (!(await flushComposerAutosaves())) {
    feedbackMessage.value = "We could not save the latest edits before opening improve mode.";
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

  if (!(await flushComposerAutosaves())) {
    feedbackMessage.value = "We could not save the latest edits before opening outreach.";
    return;
  }

  await router.push({
    path: appRoutes.appOutreach,
    query: {
      draftId: draft.value.id,
      prefill: editablePostContent.value.trim() || postContent.value,
    },
  });
}

async function goToPlanner(): Promise<void> {
  if (!(await flushComposerAutosaves())) {
    feedbackMessage.value = "We could not save the latest edits before opening planner.";
    return;
  }

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

  if (!(await flushComposerAutosaves())) {
    feedbackMessage.value = "We could not save the latest edits before opening email.";
    return;
  }

  const socialDraft = editablePostContent.value.trim() || postContent.value.trim();
  const emailSubject = editableEmailSubject.value.trim() || businessOutput.value?.email?.subject?.trim() || "";
  const emailBody = editableEmailBody.value.trim() || businessOutput.value?.email?.body?.trim() || "";
  const emailCtaLabel = editableCtaLabel.value.trim() || businessOutput.value?.cta.label?.trim() || "";
  const emailCtaUrl = editableCtaUrl.value.trim() || businessOutput.value?.cta.url?.trim() || "";
  const emailHeaderImageUrl =
    selectedPublishingPreviewAsset.value?.type !== "video"
      ? selectedPublishingPreviewAsset.value?.previewUrl?.trim() || ""
      : "";
  const nextQuery: Record<string, string> = {
    draftId: draft.value.id,
    prefill: socialDraft,
  };

  if (draft.value.result.idea.title.trim()) {
    nextQuery.emailTitle = draft.value.result.idea.title.trim();
  }

  if (emailSubject) {
    nextQuery.emailSubject = emailSubject;
  }

  if (emailBody) {
    nextQuery.emailBody = emailBody;
  }

  if (emailCtaLabel) {
    nextQuery.emailCtaLabel = emailCtaLabel;
  }

  if (emailCtaUrl) {
    nextQuery.emailCtaUrl = emailCtaUrl;
  }

  if (emailHeaderImageUrl) {
    nextQuery.emailHeaderImageUrl = emailHeaderImageUrl;
  }

  await router.push({
    path: appRoutes.appEmailNew,
    query: nextQuery,
  });
}

async function goToGrowth(): Promise<void> {
  if (!draft.value) {
    return;
  }

  if (!(await flushComposerAutosaves())) {
    feedbackMessage.value = "We could not save the latest edits before opening growth.";
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
  if (!(await flushComposerAutosaves())) {
    feedbackMessage.value = "We could not save the latest edits. Fix the autosave error first.";
    return;
  }

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

  if (!(await flushComposerAutosaves())) {
    feedbackMessage.value = "We could not save the latest edits. Fix the autosave error first.";
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
            assetId: ensuredPostId,
            title: draft.value.result.idea.title,
          })
        ).publishAttempt
        : (
          await requestCreatePublishAttempt({
            businessId: activeBusinessId.value,
            platforms,
            contentText: postContent.value,
            platformInputs: platforms.map((platform) => ({
              platform,
              contentText: resolvePublishingContentText(platform),
            })),
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
  if (isMetaSelectionModalOpen.value || isWorkspaceAssetPickerOpen.value) {
    return;
  }

  if (event.key === "Escape" && isMediaDrawerOpen.value) {
    closeMediaDrawer();
    return;
  }

  if (event.key === "Escape" && isHashtagDrawerOpen.value) {
    closeHashtagDrawer();
    return;
  }

  if (
    event.key === "Escape"
    && isPublishDrawerOpen.value
  ) {
    closePublishDrawer();
    return;
  }

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

async function syncWorkspaceAccessState(): Promise<void> {
  if (!auth.isReady.value || !auth.isAuthenticated.value) {
    return;
  }

  await refreshProductAccess(activeBusinessId.value || null);
}

function handleWindowFocus(): void {
  void syncWorkspaceAccessState();
}

function handleVisibilityChange(): void {
  if (typeof document === "undefined" || document.visibilityState !== "visible") {
    return;
  }

  void syncWorkspaceAccessState();
}

watch(
  () => [route.query.id, activeBusinessId.value],
  () => {
    void loadDraft();
  },
  { immediate: true },
);

watch(
  () => draft.value?.result.asset?.contentBody,
  () => {
    syncDraftMediaPreferencesFromDraft();
  },
  { immediate: true },
);

watch(
  () => [selectedMotionTemplateId.value, selectedMotionAudioEnabled.value, selectedMotionAudioPreset.value, selectedPromoVisualLayout.value] as const,
  ([nextTemplateId, nextAudioEnabled, nextAudioPreset, nextPromoLayout], [previousTemplateId, previousAudioEnabled, previousAudioPreset, previousPromoLayout]) => {
    if (
      !draft.value
      || !activeBusinessId.value
      || !draft.value.result.asset?.id
      || (
        nextTemplateId === previousTemplateId
        && nextAudioEnabled === previousAudioEnabled
        && nextAudioPreset === previousAudioPreset
        && nextPromoLayout === previousPromoLayout
      )
    ) {
      return;
    }

    const persistedPreferences = normalizeDraftMediaPreferences(draft.value.result.asset.contentBody);
    const previousRecommendedPreset = resolveRecommendedMotionAudioPreset(previousTemplateId);

    if (
      previousTemplateId !== nextTemplateId
      && selectedMotionAudioPreset.value === previousRecommendedPreset
    ) {
      selectedMotionAudioPreset.value = resolveRecommendedMotionAudioPreset(nextTemplateId);
      return;
    }

    if (
      persistedPreferences?.motionTemplateId === nextTemplateId
      && persistedPreferences?.motionAudioEnabled === nextAudioEnabled
      && persistedPreferences?.motionAudioPreset === nextAudioPreset
      && persistedPreferences?.promoVisualLayout === nextPromoLayout
    ) {
      return;
    }

    void persistDraftMediaPreferences(
      {
        primaryAssetId: draftMediaPrimaryAssetId.value || undefined,
        posterAssetId: draftMediaPosterAssetId.value || undefined,
        motionTemplateId: nextTemplateId,
        motionAudioEnabled: nextAudioEnabled,
        motionAudioPreset: nextAudioPreset,
        promoVisualLayout: nextPromoLayout,
      },
      { silent: true },
    );
  },
);

watch(
  () => [draft.value?.id, draft.value?.result.post, creatorContentType.value, creatorVariants.value.map((variant) => variant.id).join("|")],
  () => {
    if (isBusinessMode.value || creatorVariants.value.length === 0) {
      selectedCreatorVariantId.value = "";
      return;
    }

    if (selectedCreatorVariantId.value && creatorVariants.value.some((variant) => variant.id === selectedCreatorVariantId.value)) {
      return;
    }

    selectedCreatorVariantId.value = resolvePreferredCreatorVariantId(
      creatorVariants.value,
      creatorContentType.value,
      draft.value?.result.post ?? "",
    );
  },
  { immediate: true },
);

watch(
  () => postContent.value,
  (nextValue, previousValue = "") => {
    if (
      editablePostContent.value.trim() === ""
      || editablePostContent.value === previousValue
    ) {
      editablePostContent.value = nextValue;
    }

    manualEditFeedback.value = "";
  },
  { immediate: true },
);

watch(
  () => [
    postContent.value,
    businessOutput.value?.captions.instagram ?? "",
    businessOutput.value?.captions.facebook ?? "",
    businessOutput.value?.email?.subject ?? "",
    businessOutput.value?.email?.body ?? "",
    businessOutput.value?.cta.label ?? "",
    businessOutput.value?.cta.url ?? "",
  ] as const,
  ([nextPost, nextInstagram, nextFacebook, nextEmailSubject, nextEmailBody, nextCtaLabel, nextCtaUrl], previousValues) => {
    const [
      previousPost = "",
      previousInstagram = "",
      previousFacebook = "",
      previousEmailSubject = "",
      previousEmailBody = "",
      previousCtaLabel = "",
      previousCtaUrl = "",
    ] = previousValues ?? [];

    const previousInstagramBaseline = previousInstagram.trim() !== "" ? previousInstagram : previousPost;
    const previousFacebookBaseline = previousFacebook.trim() !== "" ? previousFacebook : previousPost;
    const nextInstagramBaseline = nextInstagram.trim() !== "" ? nextInstagram : nextPost;
    const nextFacebookBaseline = nextFacebook.trim() !== "" ? nextFacebook : nextPost;

    if (
      editableInstagramContent.value.trim() === ""
      || editableInstagramContent.value === previousInstagramBaseline
    ) {
      editableInstagramContent.value = nextInstagramBaseline;
    }

    if (
      editableFacebookContent.value.trim() === ""
      || editableFacebookContent.value === previousFacebookBaseline
    ) {
      editableFacebookContent.value = nextFacebookBaseline;
    }

    if (
      editableEmailSubject.value.trim() === ""
      || editableEmailSubject.value === previousEmailSubject
    ) {
      editableEmailSubject.value = nextEmailSubject;
    }

    if (
      editableEmailBody.value.trim() === ""
      || editableEmailBody.value === previousEmailBody
    ) {
      editableEmailBody.value = nextEmailBody;
    }

    if (
      editableCtaLabel.value.trim() === ""
      || editableCtaLabel.value === previousCtaLabel
    ) {
      editableCtaLabel.value = nextCtaLabel;
    }

    if (
      editableCtaUrl.value.trim() === ""
      || editableCtaUrl.value === previousCtaUrl
    ) {
      editableCtaUrl.value = nextCtaUrl;
    }

    manualEditFeedback.value = "";
    publishingSetupFeedback.value = "";
  },
  { immediate: true },
);

watch(
  () => [
    editablePostContent.value,
    editableInstagramContent.value,
    editableFacebookContent.value,
    editableEmailSubject.value,
    editableEmailBody.value,
    draft.value?.id ?? "",
  ] as const,
  () => {
    scheduleContentAutosave();
  },
);

watch(
  () => [editableCtaLabel.value, editableCtaUrl.value, draft.value?.id ?? ""] as const,
  () => {
    scheduleCtaAutosave();
  },
);

watch(
  () => selectedPublishingPlatform.value,
  (nextPlatform) => {
    if (selectedResultPreviewSurface.value !== "email") {
      selectedResultPreviewSurface.value = nextPlatform;
    }
  },
  { immediate: true },
);

watch(
  resultPreviewSurfaceOptions,
  (nextOptions) => {
    if (!nextOptions.some((option) => option.value === selectedResultPreviewSurface.value)) {
      selectedResultPreviewSurface.value = nextOptions[0]?.value ?? "linkedin";
    }
  },
  { immediate: true },
);

watch(
  () => activeBusinessId.value,
  () => {
    void syncWorkspaceAccessState();
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
  window.addEventListener("focus", handleWindowFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("focus", handleWindowFocus);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  clearContentAutosaveTimer();
  clearCtaAutosaveTimer();
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
              : isSingleBusinessPost
                ? `Your ${businessSingleOutputLabel} is ready.`
                : isBusinessMode
                ? "Your campaign pack is ready."
                : "Your post is ready."
          }}
        </h1>
        <p class="result-description">
          {{
            businessWeeklyPlan
              ? "Review the 7-day plan, tighten the headlines, and turn the best items into channel-ready campaigns."
              : isSingleBusinessPost
              ? businessSingleOutputLabel === "email"
                ? "Review the email copy and CTA, then send it without turning it into a bigger campaign."
                : "Review the post, CTA, and visual direction, then publish it without turning it into a bigger campaign."
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

      <section class="result-operator-panel">
        <div class="result-operator-header">
          <div>
            <p class="panel-meta">Final asset</p>
            <h2>This is the version the team should react to first.</h2>
            <p class="shortcut-note">
              Keep the editable draft, destination choice, attached media, and publish actions in one place.
            </p>
          </div>
          <div class="score-badge" :data-tone="attentionSignal.tone">
            Attention {{ attentionSignal.label }} · {{ postScore }}/100
          </div>
        </div>

        <div class="result-operator-grid">
          <article class="result-post-card result-primary-surface">
            <div class="result-card-header">
              <div>
                <p class="panel-meta">Editable final draft</p>
                <h2>{{ selectedSurfaceEditorCopy.title }}</h2>
              </div>
              <span class="workspace-chip" :data-tone="contentAutosaveState === 'error' ? 'warning' : 'default'">
                {{ contentAutosaveLabel }}
              </span>
            </div>

            <div class="result-editor-stat-row">
              <span class="workspace-chip">{{ selectedSurfaceEditorCopy.primary }}</span>
              <span class="workspace-chip">{{ selectedSurfaceEditorCopy.secondary }}</span>
            </div>

            <p class="shortcut-note">
              {{ editorHelperCopy }}
            </p>

            <template v-if="selectedResultPreviewSurface === 'email'">
              <label class="result-inline-field">
                <span class="panel-meta">Email subject</span>
                <input
                  v-model="editableEmailSubject"
                  type="text"
                  class="result-inline-input"
                  placeholder="Subject line for the email version"
                />
              </label>

              <label class="result-inline-field">
                <span class="panel-meta">Email body</span>
                <textarea
                  v-model="editableEmailBody"
                  class="result-draft-textarea"
                  placeholder="Refine the email body here before converting or sending."
                />
              </label>
            </template>

            <template v-else-if="selectedResultPreviewSurface === 'instagram'">
              <label class="result-inline-field">
                <span class="panel-meta">Instagram caption</span>
                <textarea
                  v-model="editableInstagramContent"
                  class="result-draft-textarea"
                  placeholder="Tighten the Instagram caption here before publishing."
                />
              </label>
            </template>

            <template v-else-if="selectedResultPreviewSurface === 'facebook'">
              <label class="result-inline-field">
                <span class="panel-meta">Facebook caption</span>
                <textarea
                  v-model="editableFacebookContent"
                  class="result-draft-textarea"
                  placeholder="Refine the Facebook version here before publishing."
                />
              </label>
            </template>

            <template v-else>
              <textarea
                v-model="editablePostContent"
                class="result-draft-textarea"
                placeholder="Refine the LinkedIn draft here before publishing."
              />
            </template>

            <p class="shortcut-note result-editor-guidance">
              {{ selectedSurfaceEditorCopy.hint }}
            </p>

            <div class="result-editor-actions">
              <span class="workspace-chip" :data-tone="contentAutosaveState === 'error' ? 'warning' : 'default'">
                {{ contentAutosaveLabel }}
              </span>
              <button
                v-if="contentAutosaveState === 'error'"
                type="button"
                class="secondary-action"
                :disabled="isSavingManualEdit"
                @click="void flushComposerAutosaves()"
              >
                Retry save
              </button>
              <button
                type="button"
                class="secondary-action"
                :disabled="isSavingManualEdit || !isSelectedSurfaceDirty"
                @click="resetSelectedSurfaceEdit"
              >
                Reset
              </button>
            </div>

            <p v-if="manualEditFeedback" class="result-feedback subtle">
              {{ manualEditFeedback }}
            </p>
          </article>

          <article class="result-post-card result-preview-surface">
            <div class="result-card-header">
              <div>
                <p class="panel-meta">What will publish</p>
                <h2>{{ selectedPreviewCard?.label || "Preview" }}</h2>
              </div>
              <span class="workspace-chip" :data-tone="selectedPreviewCard?.isDirty ? 'warning' : 'default'">
                {{ selectedPreviewCard?.isDirty ? "Syncing preview" : "Preview synced" }}
              </span>
            </div>

            <div class="result-platform-card-grid">
              <article
                v-for="card in platformPreviewCards"
                :key="card.surface"
                class="result-platform-card"
                :data-active="selectedResultPreviewSurface === card.surface"
                :data-platform="card.surface"
                @click="setResultPreviewSurface(card.surface)"
              >
                <div class="result-platform-card-topline">
                  <span class="workspace-chip">{{ card.label }}</span>
                  <span v-if="card.isDirty" class="workspace-chip" data-tone="warning">Syncing</span>
                </div>

                <div class="result-platform-card-header">
                  <div class="result-platform-card-avatar">
                    {{ card.accountLabel.charAt(0).toUpperCase() }}
                  </div>
                  <div>
                    <strong>{{ card.accountLabel }}</strong>
                    <p>{{ card.accountDescriptor }}</p>
                  </div>
                </div>

                <div
                  v-if="card.previewAsset?.previewUrl && card.surface !== 'email'"
                  class="result-platform-card-media"
                  :data-platform="card.surface"
                >
                  <video
                    v-if="card.previewAsset.type === 'video'"
                    :src="card.previewAsset.previewUrl"
                    class="result-platform-card-media-inner"
                    muted
                    playsinline
                    preload="metadata"
                  />
                  <img
                    v-else
                    :src="card.previewAsset.previewUrl"
                    alt="Platform preview media"
                    class="result-platform-card-media-inner"
                  />
                </div>

                <p v-if="card.subject" class="result-platform-card-subject">
                  {{ card.subject }}
                </p>
                <p class="result-platform-card-excerpt">
                  {{ card.excerpt }}
                </p>

                <div class="result-platform-card-metrics">
                  <span class="workspace-chip">{{ card.primaryMetric }}</span>
                  <span class="workspace-chip">{{ card.secondaryMetric }}</span>
                  <span
                    v-if="card.notices[0]"
                    class="workspace-chip"
                    :data-tone="card.notices[0].tone === 'warning' ? 'warning' : 'default'"
                  >
                    {{ card.notices[0].label }}
                  </span>
                </div>

                <div class="result-platform-card-actions">
                  <button
                    type="button"
                    class="secondary-action result-platform-card-button"
                    @click.stop="setResultPreviewSurface(card.surface)"
                  >
                    {{ selectedResultPreviewSurface === card.surface ? "Editing" : "Edit" }}
                  </button>
                  <button
                    v-if="card.surface === 'email'"
                    type="button"
                    class="secondary-action result-platform-card-button"
                    @click.stop="goToEmail"
                  >
                    Open Email
                  </button>
                </div>
              </article>
            </div>

            <div class="result-preview-metrics">
              <span class="workspace-chip">{{ selectedPreviewLengthSummary.primary }}</span>
              <span class="workspace-chip">{{ selectedPreviewLengthSummary.secondary }}</span>
            </div>

            <div class="result-preview-notice-row">
              <span
                v-for="notice in selectedPreviewWarnings"
                :key="`${selectedResultPreviewSurface}-${notice.label}`"
                class="workspace-chip"
                :data-tone="notice.tone === 'warning' ? 'warning' : 'default'"
              >
                {{ notice.label }}
              </span>
            </div>

            <div v-if="selectedPreviewCard?.surface === 'email'" class="result-email-preview-card">
              <div class="result-email-preview-head">
                <div>
                  <p class="panel-meta">Subject</p>
                  <strong>{{ selectedPreviewCard.subject || "Add a subject to preview the inbox line." }}</strong>
                </div>
                <button type="button" class="secondary-action compact-action" @click="goToEmail">
                  Edit in Email
                </button>
              </div>
              <div class="result-preview-body">
                <p
                  v-for="paragraph in selectedPreviewCard.previewParagraphs"
                  :key="`email-preview-${paragraph}`"
                  class="linkedin-feed-paragraph"
                >
                  {{ paragraph }}
                </p>
              </div>
            </div>

            <template v-else-if="selectedPreviewCard?.surface === 'instagram'">
              <div class="result-social-platform-preview result-inline-preview" data-platform="instagram">
                <div class="result-social-preview-header" data-platform="instagram">
                  <div class="result-social-preview-identity">
                    <div class="result-social-preview-avatar" data-platform="instagram">
                      {{ selectedPreviewCard.accountLabel.charAt(0).toUpperCase() }}
                    </div>
                    <div>
                      <strong>{{ selectedPreviewCard.accountLabel }}</strong>
                      <p>{{ selectedPreviewCard.accountDescriptor }}</p>
                    </div>
                  </div>
                  <span class="workspace-chip">Instagram feed</span>
                </div>

                <div
                  v-if="selectedPreviewCard.previewAsset?.previewUrl"
                  class="result-social-preview-media"
                  data-platform="instagram"
                >
                  <video
                    v-if="selectedPreviewCard.previewAsset.type === 'video'"
                    :src="selectedPreviewCard.previewAsset.previewUrl"
                    class="result-social-preview-media-inner"
                    controls
                    muted
                    playsinline
                    preload="metadata"
                  />
                  <img
                    v-else
                    :src="selectedPreviewCard.previewAsset.previewUrl"
                    alt="Instagram preview media"
                    class="result-social-preview-media-inner"
                  />
                </div>

                <div class="result-social-preview-actions-row" data-platform="instagram">
                  <span>Like</span>
                  <span>Comment</span>
                  <span>Send</span>
                  <span>Save</span>
                </div>

                <div class="result-instagram-caption-stack">
                  <p class="result-instagram-caption-line">
                    <strong>{{ workspaceBrandLabel }}</strong>
                    <span>{{ selectedPreviewCard.previewParagraphs[0] || "Your caption will preview here." }}</span>
                  </p>
                  <p
                    v-for="(paragraph, index) in selectedPreviewCard.previewParagraphs.slice(1)"
                    :key="`instagram-preview-${index}-${paragraph}`"
                    class="linkedin-feed-paragraph"
                  >
                    {{ paragraph }}
                  </p>
                </div>
              </div>
            </template>

            <template v-else-if="selectedPreviewCard?.surface === 'facebook'">
              <div class="result-social-platform-preview result-inline-preview" data-platform="facebook">
                <div class="result-social-preview-header" data-platform="facebook">
                  <div class="result-social-preview-identity">
                    <div class="result-social-preview-avatar" data-platform="facebook">
                      {{ selectedPreviewCard.accountLabel.charAt(0).toUpperCase() }}
                    </div>
                    <div>
                      <strong>{{ selectedPreviewCard.accountLabel }}</strong>
                      <p>{{ selectedPreviewCard.accountDescriptor }}</p>
                    </div>
                  </div>
                  <span class="workspace-chip">Facebook post</span>
                </div>

                <div class="result-preview-body">
                  <p
                    v-for="(paragraph, index) in selectedPreviewCard.previewParagraphs"
                    :key="`facebook-preview-${index}-${paragraph}`"
                    class="linkedin-feed-paragraph"
                    :class="{ 'result-facebook-lead': index === 0 }"
                  >
                    {{ paragraph }}
                  </p>
                </div>

                <div
                  v-if="selectedPreviewCard.previewAsset?.previewUrl"
                  class="result-social-preview-media"
                  data-platform="facebook"
                >
                  <video
                    v-if="selectedPreviewCard.previewAsset.type === 'video'"
                    :src="selectedPreviewCard.previewAsset.previewUrl"
                    class="result-social-preview-media-inner"
                    controls
                    muted
                    playsinline
                    preload="metadata"
                  />
                  <img
                    v-else
                    :src="selectedPreviewCard.previewAsset.previewUrl"
                    alt="Facebook preview media"
                    class="result-social-preview-media-inner"
                  />
                </div>

                <div class="result-social-preview-actions-row" data-platform="facebook">
                  <span>Like</span>
                  <span>Comment</span>
                  <span>Share</span>
                </div>
              </div>
            </template>

            <template v-else-if="selectedPreviewCard">
              <div class="linkedin-feed-preview result-inline-preview">
                <div class="linkedin-feed-header">
                  <div class="linkedin-feed-avatar">{{ selectedPreviewCard.accountLabel.charAt(0).toUpperCase() }}</div>
                  <div class="linkedin-feed-identity">
                    <strong>{{ selectedPreviewCard.accountLabel }}</strong>
                    <p>{{ selectedPreviewCard.accountDescriptor }}</p>
                  </div>
                </div>

                <div class="linkedin-preview-pills">
                  <span v-for="pill in signalPills" :key="pill">{{ pill }}</span>
                </div>

                <div class="result-preview-body">
                  <p
                    v-for="(paragraph, index) in selectedPreviewCard.previewParagraphs"
                    :key="`${selectedPreviewCard.surface}-${index}-${paragraph}`"
                    class="linkedin-feed-paragraph"
                    :class="{ 'linkedin-feed-hook': index === 0 }"
                  >
                    {{ paragraph }}
                  </p>
                </div>

                <div
                  v-if="selectedPreviewCard.previewAsset?.previewUrl"
                  class="result-social-preview-media"
                  data-platform="linkedin"
                >
                  <video
                    v-if="selectedPreviewCard.previewAsset.type === 'video'"
                    :src="selectedPreviewCard.previewAsset.previewUrl"
                    class="result-social-preview-media-inner"
                    controls
                    muted
                    playsinline
                    preload="metadata"
                  />
                  <img
                    v-else
                    :src="selectedPreviewCard.previewAsset.previewUrl"
                    alt="LinkedIn preview media"
                    class="result-social-preview-media-inner"
                  />
                </div>
              </div>
            </template>

            <div class="result-preview-summary-grid">
              <article class="result-signal-card">
                <p class="panel-meta">Destination</p>
                <strong>{{ selectedPreviewCard?.accountLabel || selectedPublishingPlatformLabel }}</strong>
                <span>
                  {{
                    selectedPreviewCard?.surface === "email"
                      ? "Route this into the email composer when the preview is ready."
                      : isLoadingChannels
                        ? "Checking workspace channel..."
                        : selectedPublishingStatus
                  }}
                </span>
              </article>
              <article class="result-signal-card">
                <p class="panel-meta">CTA</p>
                <strong>{{ selectedPublishingCtaLabel }}</strong>
                <span>{{ businessOutput?.cta.url || "Use the main draft CTA or add one in email." }}</span>
              </article>
              <article class="result-signal-card">
                <p class="panel-meta">Media</p>
                <strong>{{ selectedPreviewCard?.mediaSummary || selectedPublishingMediaSummary }}</strong>
                <span>
                  {{
                    selectedPreviewCard?.previewAsset?.previewUrl
                      ? "Attached media is already part of this preview."
                      : "Generate or upload media if this version should ship with a visual."
                  }}
                </span>
              </article>
            </div>

            <div class="result-inline-setup-grid">
              <article class="result-inline-setup-card">
                <p class="panel-meta">CTA</p>
                <template v-if="businessOutput">
                  <div class="result-inline-field-grid">
                    <label class="result-inline-field">
                      <span class="panel-meta">Label</span>
                      <input
                        v-model="editableCtaLabel"
                        type="text"
                        class="result-inline-input"
                        placeholder="Book your demo"
                      />
                    </label>
                    <label class="result-inline-field">
                      <span class="panel-meta">URL</span>
                      <input
                        v-model="editableCtaUrl"
                        type="url"
                        class="result-inline-input"
                        placeholder="https://your-link.com"
                      />
                    </label>
                  </div>

                  <div class="result-inline-card-actions">
                    <span class="workspace-chip" :data-tone="ctaAutosaveState === 'error' ? 'warning' : 'default'">
                      {{ ctaAutosaveLabel }}
                    </span>
                    <button
                      v-if="ctaAutosaveState === 'error'"
                      type="button"
                      class="secondary-action"
                      @click="void flushComposerAutosaves()"
                    >
                      Retry save
                    </button>
                    <button
                      type="button"
                      class="secondary-action"
                      :disabled="ctaAutosaveState === 'saving' || !isCtaDirty"
                      @click="resetPublishingSetup"
                    >
                      Reset
                    </button>
                  </div>

                  <p v-if="publishingSetupFeedback" class="result-feedback subtle">
                    {{ publishingSetupFeedback }}
                  </p>
                </template>
                <p v-else class="shortcut-note">
                  Structured CTA editing is available on business campaign drafts. For founder posts, keep the CTA inside the main draft copy.
                </p>
              </article>

              <article class="result-inline-setup-card">
                <div class="result-inline-card-header">
                  <div>
                    <p class="panel-meta">Media</p>
                    <strong>{{ selectedPublishingMediaSummary }}</strong>
                  </div>
                  <span class="workspace-chip">{{ postAssets.length }} attached</span>
                </div>

                <p class="shortcut-note result-inline-launcher-copy">
                  Generation, motion-lite, upload, and asset order now live in one focused drawer instead of stretching the editor.
                </p>

                <div class="result-inline-card-actions">
                  <button
                    type="button"
                    class="secondary-action"
                    @click="openMediaDrawer"
                  >
                    {{ mediaDrawerActionLabel }}
                  </button>
                </div>

                <p class="result-feedback subtle">
                  {{
                    mediaFeedback
                      || (postAssets.length > 0
                        ? `${primaryAssetSelectionSummary} · ${posterAssetSelectionSummary}`
                        : "No ready media yet. Open the drawer to generate, upload, or reuse an asset.")
                  }}
                </p>
              </article>

              <article class="result-inline-setup-card result-inline-launcher-card">
                <div class="result-inline-card-header">
                  <div>
                    <p class="panel-meta">Hashtags</p>
                    <strong>{{ hashtagDrawerSummary }}</strong>
                  </div>
                  <span class="workspace-chip">
                    {{ composerHashtagPreview.length > 0 ? `${composerHashtagPreview.length} ready` : "Optional" }}
                  </span>
                </div>

                <p class="shortcut-note result-inline-launcher-copy">
                  Keep discoverability focused. Generate three to five tags without bloating the main editor or helper rail.
                </p>

                <div v-if="composerHashtagPreview.length > 0" class="hashtag-chip-row result-inline-launcher-chip-row">
                  <span v-for="tag in composerHashtagPreview" :key="tag">{{ tag }}</span>
                </div>

                <div class="result-inline-card-actions">
                  <button
                    type="button"
                    class="secondary-action"
                    @click="openHashtagDrawer"
                  >
                    {{ hashtagDrawerActionLabel }}
                  </button>
                </div>

                <p v-if="hashtagFeedback" class="result-feedback subtle">
                  {{ hashtagFeedback }}
                </p>
              </article>
            </div>
          </article>
        </div>

        <section class="result-post-card publish-launch-card">
          <div class="result-card-header">
            <div>
              <p class="panel-meta">Publish flow</p>
              <h2>Publish, schedule, or route when you’re ready.</h2>
              <p class="shortcut-note publish-launch-copy">
                Keep editing on the main canvas. Destinations, scheduling, and dispatch live in one focused drawer.
              </p>
            </div>
            <span class="workspace-chip">{{ actionPriorityLabel }}</span>
          </div>

          <div class="publish-launch-grid">
            <article v-for="fact in publishLauncherFacts" :key="fact.label" class="execution-fact-card">
              <span>{{ fact.label }}</span>
              <strong>{{ fact.value }}</strong>
            </article>
          </div>

          <div v-if="selectedPublishingOverflowWarnings.length > 0" class="result-publish-warning-stack">
            <article
              v-for="warning in selectedPublishingOverflowWarnings"
              :key="`${warning.platform}-${warning.label}`"
              class="result-signal-card"
              data-tone="warning"
            >
              <p class="panel-meta">{{ resolveSocialPlatformLabel(warning.platform) }}</p>
              <strong>{{ warning.label }}</strong>
              <span>{{ warning.detail }}</span>
            </article>
          </div>

          <div class="result-primary-actions publish-launch-actions">
            <button type="button" class="primary-action" @click="openPublishDrawer">
              Open publish drawer
            </button>
          </div>

          <p
            v-if="feedbackMessage && feedbackTone === 'warning'"
            class="result-feedback"
            data-tone="warning"
          >
            {{ feedbackMessage }}
          </p>
          <p
            v-else-if="feedbackMessage && feedbackTone === 'success'"
            class="result-feedback"
            data-tone="success"
          >
            {{ feedbackMessage }}
          </p>
          <p v-else class="result-feedback subtle">
            {{ composerAutosaveSummary }}
          </p>
        </section>
      </section>

      <section class="result-helper-stack">
        <details class="result-helper-section" open>
          <summary>
            <span>Campaign pack and diagnostics</span>
            <span>Core source material</span>
          </summary>

          <div class="result-helper-content">
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
                <strong>{{ businessChannelSummary || "Business" }}</strong>
                <span>
                  {{
                    isSingleBusinessPost
                      ? "This output is focused on one destination."
                      : "Campaign copy is already adapted per destination."
                  }}
                </span>
              </article>
            </section>

            <section v-if="isBusinessMode && businessOutput" class="execution-status-grid">
              <article v-if="businessOutput.hooks?.length" class="execution-status-block">
                <p class="panel-meta">Hook options</p>
                <ul class="result-bullet-list">
                  <li v-for="hook in businessOutput.hooks" :key="hook">{{ hook }}</li>
                </ul>
              </article>

              <article v-if="businessOutput.captions.instagram" class="execution-status-block">
                <p class="panel-meta">{{ isSingleBusinessPost ? "Instagram post" : "Instagram caption" }}</p>
                <p class="execution-status-description">
                  {{ businessOutput.captions.instagram }}
                </p>
              </article>

              <article v-if="businessOutput.captions.facebook" class="execution-status-block">
                <p class="panel-meta">{{ isSingleBusinessPost ? "Facebook post" : "Facebook caption" }}</p>
                <p class="execution-status-description">
                  {{ businessOutput.captions.facebook }}
                </p>
              </article>

              <article v-if="businessOutput.email" class="execution-status-block">
                <p class="panel-meta">{{ isSingleBusinessPost ? "Email draft" : "Email subject" }}</p>
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

            <section v-if="!isBusinessMode && creatorVariants.length > 0" class="variant-switcher-panel">
              <div class="variant-switcher-header">
                <div>
                  <p class="panel-meta">Text variants</p>
                  <strong>Switch the output before you publish</strong>
                  <p class="execution-status-description">
                    The same idea is now packaged as multiple usable formats instead of one fixed LinkedIn post.
                  </p>
                </div>
                <span v-if="activeCreatorVariant" class="workspace-chip">
                  {{ activeCreatorVariant.length === "short" ? "Short form" : "Full post" }}
                </span>
              </div>

              <div class="variant-switcher-row">
                <button
                  v-for="variant in creatorVariants"
                  :key="variant.id"
                  type="button"
                  class="variant-switcher-chip"
                  :class="{ active: activeCreatorVariant?.id === variant.id }"
                  @click="selectedCreatorVariantId = variant.id"
                >
                  {{ variant.label }}
                </button>
              </div>

              <article v-if="activeCreatorVariant" class="variant-detail-card">
                <div class="variant-detail-topline">
                  <strong>{{ activeCreatorVariant.label }}</strong>
                  <span>{{ activeCreatorVariant.ctaStyle === "direct" ? "Direct CTA" : "Soft CTA" }}</span>
                </div>
                <p class="execution-status-description">{{ activeCreatorVariant.description }}</p>
                <div class="variant-channel-row">
                  <span
                    v-for="channel in activeCreatorVariant.recommendedChannels"
                    :key="`${activeCreatorVariant.id}-${channel}`"
                    class="saved-source-chip"
                  >
                    {{ channel }}
                  </span>
                </div>
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
          </div>
        </details>

        <details class="result-helper-section" :open="feedbackMessage !== '' || selectedPublishAttemptResults.length > 0">
          <summary>
            <span>Delivery status</span>
            <span>Execution, retries, and planner handoff</span>
          </summary>

          <div class="result-helper-content">
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
          </div>
        </details>

        <details class="result-helper-section">
          <summary>
            <span>Media and visuals</span>
            <span>Generate, upload, and attach assets intentionally</span>
          </summary>

          <div class="result-helper-content">
            <article class="side-card drawer-callout-card">
              <div class="result-inline-card-header">
                <div>
                  <p class="panel-meta">Media drawer</p>
                  <strong>Open one focused space for visuals, uploads, motion, and ordering.</strong>
                  <p class="shortcut-note drawer-callout-copy">
                    The editor stays text-first. Media generation, carousel blueprints, motion-lite, and asset management now live off-canvas.
                  </p>
                </div>
                <span class="workspace-chip">{{ selectedPublishingMediaSummary }}</span>
              </div>

              <div class="execution-fact-grid drawer-callout-grid">
                <article class="execution-fact-card">
                  <span>Attached</span>
                  <strong>{{ postAssets.length === 0 ? "None yet" : `${postAssets.length} attached` }}</strong>
                </article>
                <article class="execution-fact-card">
                  <span>Lead asset</span>
                  <strong>{{ primaryAssetSelectionSummary }}</strong>
                </article>
                <article class="execution-fact-card">
                  <span>Motion</span>
                  <strong>{{ motionLiteDerivedVideoAsset ? "Video ready" : shouldShowAdvancedMotionControls ? "Image-first" : "Not active" }}</strong>
                </article>
                <article class="execution-fact-card">
                  <span>Recommendations</span>
                  <strong>{{ isLoadingMediaRecommendations ? "Loading..." : mediaRecommendationStatusLabel }}</strong>
                </article>
              </div>

              <div class="result-primary-actions">
                <button type="button" class="primary-action" @click="openMediaDrawer">
                  {{ mediaDrawerActionLabel }}
                </button>
              </div>

              <p v-if="mediaFeedback" class="result-feedback subtle">
                {{ mediaFeedback }}
              </p>
            </article>
          </div>
        </details>

        <details class="result-helper-section">
          <summary>
            <span>AI helpers</span>
            <span>Improvement prompts, hooks, comments, and hashtags</span>
          </summary>

          <div class="result-helper-content helper-two-column">
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

              <div class="result-secondary-actions">
                <button type="button" class="secondary-action" @click="goToImprove">
                  Improve
                </button>
                <button type="button" class="secondary-action" @click="void goToContinueWriting()">
                  Continue writing
                </button>
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

            <div class="result-helper-rail">
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

                <article class="drawer-callout-card drawer-callout-inline">
                  <div class="hashtag-card-header">
                    <div>
                      <p class="panel-meta">Discoverability</p>
                      <strong>Hashtags now live in a focused drawer</strong>
                    </div>
                    <button
                      type="button"
                      class="secondary-action"
                      @click="openHashtagDrawer"
                    >
                      {{ hashtagDrawerActionLabel }}
                    </button>
                  </div>

                  <p class="shortcut-note">
                    Generate, review, and apply 3-5 tags without stretching this helper rail.
                  </p>

                  <div v-if="composerHashtagPreview.length > 0" class="hashtag-chip-row">
                    <span v-for="tag in composerHashtagPreview" :key="tag">{{ tag }}</span>
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
                <p class="panel-meta">Use this draft elsewhere</p>
                <h3>Route the same work into the rest of the product.</h3>
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
            </div>
          </div>
        </details>
      </section>

      <div v-if="isMediaDrawerOpen" class="publish-drawer-overlay utility-drawer-overlay" @click.self="closeMediaDrawer">
        <article class="publish-drawer utility-drawer" role="dialog" aria-modal="true" aria-label="Media and visuals">
          <div class="publish-drawer-header utility-drawer-header">
            <div>
              <p class="panel-meta">Media drawer</p>
              <h2>Generate, attach, and order visuals without leaving the composer.</h2>
              <p class="shortcut-note publish-drawer-copy">
                Keep the draft text-first on the canvas. Use this drawer when the post is ready for visuals or motion.
              </p>
            </div>
            <button type="button" class="secondary-action publish-drawer-close" @click="closeMediaDrawer">
              Close
            </button>
          </div>

          <div class="publish-drawer-content utility-drawer-content">
            <section class="media-panel utility-drawer-panel">
              <div class="media-panel-header">
                <div>
                  <p class="panel-meta">Media</p>
                  <strong>Turn this post into visuals</strong>
                  <p class="ai-command-copy">
                    {{
                      isBusinessMode
                        ? "Generate a launch image here, or upload a short MP4 promo if you already have motion ready."
                        : "Keep the workflow text-first. When the post earns visuals, generate a narrative deck before you add or upload anything manually."
                    }}
                  </p>
                </div>

                <div class="media-panel-actions">
                  <label class="media-style-select-wrap">
                    <span class="panel-meta media-style-select-label">Visual style</span>
                    <select v-model="selectedVisualStylePreference" class="media-style-select">
                      <option
                        v-for="option in selectableVisualStyleOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </label>
                  <button
                    type="button"
                    class="primary-action media-generate-button"
                    :disabled="isLoadingMediaRecommendations || isUploadingPostAssets"
                    @click="void triggerPreferredMediaGeneration()"
                  >
                    {{ mediaPrimaryActionLabel }}
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

              <div class="promo-visual-panel">
                <div>
                  <p class="panel-meta">Promo visual</p>
                  <strong>Create a clean branded visual from your known brand elements</strong>
                  <p class="ai-command-copy">
                    Pulls the saved logo from settings when available, falls back to initials when it is missing, and uses the current headline, support text, CTA, and brand colors automatically.
                  </p>
                  <p class="motion-lite-status">
                    {{
                      selectedPromoVisualLayout === "screenshot_headline"
                        ? promoVisualSourceAsset
                          ? "Screenshot + headline will frame the uploaded image already attached to this draft."
                          : "Screenshot + headline needs one ready uploaded image. If none is attached, it falls back to Logo + headline."
                        : "Best when you want a fresh, polished promo still before you animate anything."
                    }}
                  </p>
                </div>
                <div class="motion-lite-actions">
                  <label class="media-style-select-wrap">
                    <span class="panel-meta media-style-select-label">Layout</span>
                    <select v-model="selectedPromoVisualLayout" class="media-style-select">
                      <option
                        v-for="option in PROMO_VISUAL_LAYOUT_OPTIONS"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                    <small class="ai-command-copy media-style-select-help">
                      {{ PROMO_VISUAL_LAYOUT_OPTIONS.find((option) => option.value === selectedPromoVisualLayout)?.description }}
                    </small>
                  </label>
                  <div v-if="promoVisualPreviewAsset?.previewUrl" class="motion-lite-preview-card">
                    <p class="panel-meta">Source preview</p>
                    <img
                      :src="promoVisualPreviewAsset.previewUrl"
                      alt="Promo visual source preview"
                      class="motion-lite-preview"
                    />
                    <small class="ai-command-copy media-style-select-help">
                      Uploaded image that will be framed inside the promo visual.
                    </small>
                  </div>
                  <button
                    type="button"
                    class="secondary-action media-generate-button"
                    :disabled="isCreatingPromoVisual || isUploadingPostAssets"
                    @click="void createPromoVisualFromBrand()"
                  >
                    {{ isCreatingPromoVisual ? "Creating..." : "Create promo visual" }}
                  </button>
                </div>
              </div>

              <div v-if="shouldShowAdvancedMotionControls" class="motion-lite-panel">
                <div>
                  <p class="panel-meta">Motion-lite</p>
                  <strong>Animate the current visual into a short promo teaser</strong>
                  <p class="ai-command-copy">
                    {{ motionLiteBehaviorCopy }}
                  </p>
                  <p v-if="motionLiteDerivedVideoAsset" class="motion-lite-status">
                    Animated version created. Instagram and Facebook use the video, and LinkedIn keeps the original image.
                  </p>
                  <p class="motion-lite-status">
                    Recommended: {{ getMotionTemplateLabel(recommendedMotionTemplateId) }}. {{ recommendedMotionTemplateReason }}
                  </p>
                  <p v-if="motionLiteNeedsRefresh" class="motion-lite-status motion-lite-status-warning">
                    Current teaser uses {{ getMotionTemplateLabel(motionLiteCurrentTemplateId || "subtle_zoom") }}. Re-generate to switch this draft to {{ getMotionTemplateLabel(selectedMotionTemplateId) }}.
                  </p>
                </div>
                <div class="motion-lite-actions">
                  <label class="media-style-select-wrap">
                    <span class="panel-meta media-style-select-label">Motion style</span>
                    <select v-model="selectedMotionTemplateId" class="media-style-select">
                      <option
                        v-for="option in MOTION_TEMPLATE_OPTIONS"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                    <small class="ai-command-copy media-style-select-help">
                      {{ MOTION_TEMPLATE_OPTIONS.find((option) => option.value === selectedMotionTemplateId)?.description }}
                    </small>
                  </label>
                  <div class="motion-audio-controls">
                    <label class="motion-audio-toggle">
                      <input v-model="selectedMotionAudioEnabled" type="checkbox" />
                      <span>Audio on</span>
                    </label>
                    <label class="media-style-select-wrap" :class="{ muted: !selectedMotionAudioEnabled }">
                      <span class="panel-meta media-style-select-label">Choose a vibe</span>
                      <select
                        v-model="selectedMotionAudioPreset"
                        class="media-style-select"
                        :disabled="!selectedMotionAudioEnabled"
                      >
                        <option
                          v-for="option in MOTION_AUDIO_OPTIONS"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </select>
                      <small class="ai-command-copy media-style-select-help">
                        {{
                          selectedMotionAudioEnabled
                            ? `${motionLiteAudioDescription} Recommended: ${MOTION_AUDIO_OPTIONS.find((option) => option.value === recommendedMotionAudioPreset)?.label}.`
                            : "Render a silent teaser. Re-generate later if you want sound back."
                        }}
                      </small>
                    </label>
                  </div>
                  <div v-if="motionLitePreviewAsset?.previewUrl" class="motion-lite-preview-card">
                    <p class="panel-meta">Current preview</p>
                    <video
                      v-if="motionLitePreviewAsset.type === 'video'"
                      :src="motionLitePreviewAsset.previewUrl"
                      class="motion-lite-preview"
                      controls
                      muted
                      playsinline
                      preload="metadata"
                    />
                    <img
                      v-else
                      :src="motionLitePreviewAsset.previewUrl"
                      alt="Motion-lite preview"
                      class="motion-lite-preview"
                    />
                    <small class="ai-command-copy media-style-select-help">
                      {{
                        motionLitePreviewAsset.type === "video"
                          ? "Current Meta-ready teaser preview."
                          : "Current still image that motion-lite will animate."
                      }}
                    </small>
                  </div>
                  <button
                    type="button"
                    class="secondary-action media-generate-button"
                    :disabled="!canGenerateMotionLite || isGeneratingMotionLite || isUploadingPostAssets"
                    @click="void generateMotionLiteFromCurrentVisual()"
                  >
                    {{ isGeneratingMotionLite ? "Animating..." : motionLiteDerivedVideoAsset ? "Re-generate" : "Animate this visual" }}
                  </button>
                  <button
                    v-if="motionLiteDerivedVideoAsset"
                    type="button"
                    class="secondary-action"
                    :disabled="!canGenerateMotionLite || isGeneratingMotionLite || isUploadingPostAssets"
                    @click="void tryAnotherMotionStyle()"
                  >
                    Try another style
                  </button>
                  <button
                    v-if="motionLiteDerivedVideoAsset"
                    type="button"
                    class="secondary-action"
                    :disabled="isGeneratingMotionLite || isUploadingPostAssets"
                    @click="void preferStillImageForDraft()"
                  >
                    Use image instead
                  </button>
                  <button
                    v-if="motionLiteDerivedVideoAsset"
                    type="button"
                    class="secondary-action"
                    :disabled="isGeneratingMotionLite || isUploadingPostAssets"
                    @click="void preferMotionVideoForDraft()"
                  >
                    Use video instead
                  </button>
                </div>
              </div>

              <p v-if="motionLiteUnavailableReason && shouldShowAdvancedMotionControls" class="result-feedback subtle">
                {{ motionLiteUnavailableReason }}
              </p>

              <section
                v-if="shouldShowCarouselBlueprint && carouselDraft && carouselDraft.slides.length > 0"
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
                    {{ mediaRecommendationStatusLabel }}
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
              <p v-else-if="postAssets.length > 1" class="result-feedback subtle">
                The first image becomes the lead frame. Use the controls below to move a visual to the front.
              </p>

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
                  <div class="media-order-row">
                    <span class="media-order-chip">
                      {{ asset.orderIndex === 0 ? "First in post" : `Position ${asset.orderIndex + 1}` }}
                    </span>
                  </div>
                  <div class="media-meta">
                    <span>{{ asset.mimeType }}</span>
                    <strong>{{ Math.max(1, Math.round(asset.sizeBytes / 1024)) }} KB</strong>
                  </div>
                  <span v-if="getMediaAssetRoleLabel(asset)" class="media-role-chip">
                    {{ getMediaAssetRoleLabel(asset) }}
                  </span>
                  <div v-if="postAssets.length > 1" class="media-order-actions">
                    <button
                      v-if="asset.orderIndex > 0"
                      type="button"
                      class="secondary-action media-order-button"
                      :disabled="reorderingPostAssetId === asset.id || removingPostAssetId === asset.id"
                      @click="void movePostAssetToFront(asset.id)"
                    >
                      {{ reorderingPostAssetId === asset.id ? "Saving..." : "Make first" }}
                    </button>
                    <button
                      type="button"
                      class="secondary-action media-order-button"
                      :disabled="!canMovePostAsset(asset.id, -1)"
                      @click="void movePostAsset(asset.id, -1)"
                    >
                      Move left
                    </button>
                    <button
                      type="button"
                      class="secondary-action media-order-button"
                      :disabled="!canMovePostAsset(asset.id, 1)"
                      @click="void movePostAsset(asset.id, 1)"
                    >
                      Move right
                    </button>
                  </div>
                  <button
                    type="button"
                    class="secondary-action media-remove-button"
                    :disabled="removingPostAssetId === asset.id || reorderingPostAssetId === asset.id"
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
          </div>
        </article>
      </div>

      <div v-if="isHashtagDrawerOpen" class="publish-drawer-overlay utility-drawer-overlay" @click.self="closeHashtagDrawer">
        <article class="publish-drawer utility-drawer utility-drawer-narrow" role="dialog" aria-modal="true" aria-label="Hashtag tools">
          <div class="publish-drawer-header utility-drawer-header">
            <div>
              <p class="panel-meta">Hashtag drawer</p>
              <h2>Keep discoverability tight and intentional.</h2>
              <p class="shortcut-note publish-drawer-copy">
                Generate a small tag set, review it, and apply it without stretching the helper rail.
              </p>
            </div>
            <button type="button" class="secondary-action publish-drawer-close" @click="closeHashtagDrawer">
              Close
            </button>
          </div>

          <div class="publish-drawer-content utility-drawer-content">
            <article class="hashtag-card utility-drawer-panel">
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

              <div v-if="businessOutput?.hashtags?.length" class="drawer-callout-card drawer-callout-inline">
                <p class="panel-meta">Saved with this draft</p>
                <strong>{{ businessOutput.hashtags.length }} brand-aligned hashtags available</strong>
                <div class="hashtag-chip-row result-inline-launcher-chip-row">
                  <span v-for="tag in businessOutput.hashtags.slice(0, 5)" :key="`saved-${tag}`">{{ tag }}</span>
                </div>
              </div>

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
          </div>
        </article>
      </div>

      <WorkspaceAssetPickerModal
        :open="isWorkspaceAssetPickerOpen"
        :business-id="activeBusinessId"
        asset-type="all"
        multiple
        title="Attach existing workspace media"
        @close="isWorkspaceAssetPickerOpen = false"
        @select="void attachWorkspaceAssets($event)"
      />

      <div v-if="isPublishDrawerOpen" class="publish-drawer-overlay" @click.self="closePublishDrawer">
        <article class="publish-drawer" role="dialog" aria-modal="true" aria-label="Publish and schedule this draft">
          <div class="publish-drawer-header">
            <div>
              <p class="panel-meta">Publish flow</p>
              <h2>Choose destinations, then publish or schedule.</h2>
              <p class="shortcut-note publish-drawer-copy">
                Editing stays on the main canvas. This drawer handles channels, timing, and dispatch.
              </p>
            </div>
            <button type="button" class="secondary-action publish-drawer-close" @click="closePublishDrawer">
              Close
            </button>
          </div>

          <div class="publish-drawer-content">
            <section class="channel-selector-card result-compact-card">
              <div>
                <p class="panel-meta">Destination</p>
                <strong>Select platforms for this post</strong>
                <p class="shortcut-note">
                  Pick the platforms that should receive this draft. The focused one drives the preview and publish status.
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

            <section class="result-post-card result-action-card">
              <div class="result-card-header">
                <div>
                  <p class="panel-meta">Actions</p>
                  <h2>Publish, schedule, or route this draft.</h2>
                </div>
                <span class="workspace-chip">{{ actionPriorityLabel }}</span>
              </div>

              <div class="execution-fact-grid result-action-facts">
                <article v-for="fact in executionPanelFacts.slice(0, 4)" :key="fact.label" class="execution-fact-card">
                  <span>{{ fact.label }}</span>
                  <strong>{{ fact.value }}</strong>
                </article>
              </div>

              <div v-if="selectedPublishingOverflowWarnings.length > 0" class="result-publish-warning-stack">
                <article
                  v-for="warning in selectedPublishingOverflowWarnings"
                  :key="`${warning.platform}-${warning.label}`"
                  class="result-signal-card"
                  data-tone="warning"
                >
                  <p class="panel-meta">{{ resolveSocialPlatformLabel(warning.platform) }}</p>
                  <strong>{{ warning.label }}</strong>
                  <span>{{ warning.detail }}</span>
                </article>
              </div>

              <div class="result-primary-actions result-primary-actions-compact">
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

                <button type="button" class="secondary-action" @click="goToEmail">
                  Convert to Email
                </button>
                <button type="button" class="secondary-action" @click="goToOutreach">
                  Send via Outreach
                </button>
              </div>

              <p
                v-if="feedbackMessage && feedbackTone === 'warning'"
                class="result-feedback"
                data-tone="warning"
              >
                {{ feedbackMessage }}
              </p>
              <p
                v-else-if="feedbackMessage && feedbackTone === 'success'"
                class="result-feedback"
                data-tone="success"
              >
                {{ feedbackMessage }}
              </p>
              <p v-else class="result-feedback subtle">
                {{ composerAutosaveSummary }}
              </p>
            </section>

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
          </div>
        </article>
      </div>

      <MetaPageSelectionModal
        :open="isMetaSelectionModalOpen"
        :business-id="activeBusinessId"
        :session="pendingMetaSession"
        :platform="selectedPublishingPlatform === 'instagram' ? 'instagram' : 'facebook'"
        @close="closeMetaSelectionModal"
        @connected="void handleMetaConnected()"
        @error="handleMetaSelectionError"
      />
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

.result-operator-panel,
.result-helper-section {
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: linear-gradient(180deg, var(--fc-surface) 0%, var(--fc-surface-subtle) 100%);
  box-shadow: var(--fc-card-shadow);
}

.result-operator-panel {
  display: grid;
  gap: 22px;
  padding: clamp(22px, 3vw, 32px);
}

.result-operator-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.result-operator-header h2 {
  margin: 0;
  line-height: 1.1;
}

.result-operator-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
}

.result-preview-surface,
.result-action-card,
.result-compact-card {
  height: 100%;
}

.result-primary-surface {
  height: auto;
  align-self: start;
}

.result-preview-surface {
  align-self: start;
}

.result-draft-textarea {
  width: 100%;
  min-height: 260px;
  max-height: 340px;
  margin-top: 18px;
  padding: 18px 20px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 14%, var(--fc-border));
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.86);
  color: var(--fc-text);
  font: inherit;
  line-height: 1.75;
  resize: vertical;
}

.result-draft-textarea:focus,
.result-inline-input:focus,
.result-preview-tab:focus-visible,
.result-helper-section summary:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--fc-accent) 70%, transparent);
  outline-offset: 2px;
}

.result-editor-actions,
.result-preview-tabs,
.result-secondary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.result-editor-actions {
  margin-top: 16px;
}

.result-preview-tabs {
  margin-top: 18px;
}

.result-preview-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: transparent;
  color: var(--fc-text-muted);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.result-preview-tab:hover {
  transform: translateY(-1px);
}

.result-preview-tab.active {
  border-color: transparent;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  color: var(--fc-accent-contrast);
  box-shadow: var(--fc-accent-shadow);
}

.result-email-preview-card {
  display: grid;
  gap: 14px;
  margin-top: 18px;
  padding: 18px 20px;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 84%, transparent);
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--fc-accent-soft) 22%, transparent) 0%, transparent 38%),
    rgba(255, 255, 255, 0.82);
}

.result-email-preview-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.result-inline-preview {
  margin-top: 18px;
}

.result-preview-body {
  display: grid;
  gap: 14px;
}

.result-preview-summary-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 18px;
}

.result-preview-asset {
  margin-top: 18px;
}

.result-preview-asset-media {
  width: 100%;
  max-height: 360px;
  object-fit: cover;
  border-radius: 22px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: color-mix(in srgb, var(--fc-accent-soft) 16%, white 84%);
}

.publish-launch-card {
  margin-top: 20px;
}

.publish-launch-copy,
.publish-drawer-copy {
  max-width: 56ch;
}

.publish-launch-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 18px;
}

.publish-launch-actions {
  margin-top: 20px;
}

.publish-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  justify-content: flex-end;
  padding: 24px;
  background: rgba(25, 14, 9, 0.2);
  backdrop-filter: blur(10px);
}

.publish-drawer {
  width: min(100%, 700px);
  max-height: calc(100vh - 48px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-radius: 30px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 90%, transparent);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--fc-accent-soft) 28%, transparent) 0%, transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 250, 246, 0.94) 100%);
  box-shadow: 0 34px 64px rgba(35, 21, 13, 0.18);
  overflow: hidden;
}

.utility-drawer {
  width: min(100%, 860px);
}

.utility-drawer.utility-drawer-narrow {
  width: min(100%, 560px);
}

.publish-drawer-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 24px 24px 20px;
  border-bottom: 1px solid color-mix(in srgb, var(--fc-border) 84%, transparent);
}

.publish-drawer-header h2 {
  margin: 0;
  line-height: 1.12;
}

.publish-drawer-close {
  min-width: 96px;
}

.publish-drawer-content {
  display: grid;
  gap: 18px;
  padding: 24px;
  overflow: auto;
}

.publish-drawer-content .schedule-panel,
.publish-drawer-content .channel-selector-card {
  margin-top: 0;
}

.utility-drawer-content .media-panel,
.utility-drawer-content .hashtag-card {
  margin-top: 0;
}

.utility-drawer-panel {
  background: rgba(255, 255, 255, 0.72);
}

.drawer-callout-card {
  display: grid;
  gap: 14px;
}

.drawer-callout-inline {
  padding: 16px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.72);
}

.drawer-callout-copy {
  max-width: 58ch;
}

.drawer-callout-grid .execution-fact-card strong {
  font-size: 0.98rem;
}

.result-compact-card.channel-selector-card {
  margin-top: 0;
}

.result-action-facts {
  margin-top: 0;
}

.result-primary-actions-compact {
  margin-top: 18px;
}

.result-editor-stat-row,
.result-preview-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}

.result-preview-metrics {
  margin-top: 14px;
}

.result-platform-card-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 232px));
  justify-content: start;
  margin-top: 18px;
}

.result-platform-card {
  display: grid;
  align-content: start;
  gap: 9px;
  padding: 11px;
  border-radius: 20px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition:
    transform 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    background 160ms ease;
}

.result-platform-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 22px rgba(35, 21, 13, 0.08);
}

.result-platform-card[data-active="true"] {
  border-color: color-mix(in srgb, var(--fc-accent) 28%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 28%, white 72%);
  box-shadow: 0 14px 28px rgba(35, 21, 13, 0.1);
}

.result-platform-card[data-platform="instagram"] {
  background:
    radial-gradient(circle at top right, color-mix(in srgb, #ff9f8e 22%, transparent) 0%, transparent 34%),
    rgba(255, 255, 255, 0.82);
}

.result-platform-card[data-platform="facebook"] {
  background:
    radial-gradient(circle at top left, color-mix(in srgb, #dce8ff 44%, transparent) 0%, transparent 38%),
    rgba(255, 255, 255, 0.82);
}

.result-platform-card[data-platform="linkedin"] {
  background:
    radial-gradient(circle at top left, color-mix(in srgb, #d8efff 42%, transparent) 0%, transparent 36%),
    rgba(255, 255, 255, 0.82);
}

.result-platform-card[data-platform="email"] {
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--fc-accent-soft) 30%, transparent) 0%, transparent 32%),
    rgba(255, 255, 255, 0.84);
}

.result-platform-card-topline,
.result-platform-card-actions,
.result-platform-card-metrics,
.result-preview-notice-row,
.result-social-preview-actions-row,
.result-publish-warning-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.result-platform-card-header,
.result-social-preview-header,
.result-social-preview-identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.result-platform-card-header strong,
.result-social-preview-identity strong {
  display: block;
  line-height: 1.2;
}

.result-platform-card-header p,
.result-social-preview-identity p {
  margin: 4px 0 0;
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  line-height: 1.4;
}

.result-platform-card-avatar,
.result-social-preview-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  background: linear-gradient(135deg, var(--fc-accent-soft) 0%, color-mix(in srgb, var(--fc-accent-soft) 55%, white 45%) 100%);
  font-weight: 800;
}

.result-social-preview-avatar[data-platform="instagram"] {
  background: linear-gradient(135deg, #ffd8b8 0%, #ffb7d5 52%, #d5c7ff 100%);
}

.result-social-preview-avatar[data-platform="facebook"] {
  background: linear-gradient(135deg, #dbe8ff 0%, #bdd4ff 100%);
}

.result-platform-card-media {
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: color-mix(in srgb, var(--fc-accent-soft) 14%, white 86%);
}

.result-platform-card-media[data-platform="instagram"] {
  aspect-ratio: 1 / 1;
}

.result-platform-card-media[data-platform="facebook"],
.result-platform-card-media[data-platform="linkedin"] {
  aspect-ratio: 16 / 10;
}

.result-platform-card-media-inner,
.result-social-preview-media-inner {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.result-platform-card-subject {
  margin: 0;
  font-weight: 700;
  line-height: 1.4;
  font-size: 0.9rem;
}

.result-platform-card-excerpt {
  margin: 0;
  color: var(--fc-text);
  line-height: 1.55;
  font-size: 0.88rem;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.result-platform-card-button,
.compact-action {
  min-height: 36px;
  padding: 0 12px;
  font-size: 0.84rem;
  font-weight: 700;
}

.result-platform-card-actions {
  margin-top: auto;
  align-items: center;
}

.result-platform-card-topline .workspace-chip,
.result-platform-card-metrics .workspace-chip {
  padding: 5px 9px;
  font-size: 0.72rem;
}

.result-preview-notice-row {
  margin-top: 14px;
}

.result-social-platform-preview {
  display: grid;
  gap: 16px;
  margin-top: 18px;
  padding: clamp(18px, 3vw, 24px);
  border-radius: 28px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 84%, transparent);
  background: rgba(255, 255, 255, 0.84);
}

.result-social-platform-preview[data-platform="instagram"] {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(255, 248, 250, 0.94) 100%);
}

.result-social-platform-preview[data-platform="facebook"] {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 251, 255, 0.94) 100%);
}

.result-social-preview-header {
  justify-content: space-between;
  align-items: flex-start;
}

.result-social-preview-media {
  overflow: hidden;
  border-radius: 24px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: color-mix(in srgb, var(--fc-accent-soft) 16%, white 84%);
}

.result-social-preview-media[data-platform="instagram"] {
  aspect-ratio: 4 / 5;
}

.result-social-preview-media[data-platform="facebook"],
.result-social-preview-media[data-platform="linkedin"] {
  aspect-ratio: 16 / 9;
}

.result-social-preview-actions-row {
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--fc-border) 84%, transparent);
  color: var(--fc-text-muted);
  font-size: 0.88rem;
  font-weight: 700;
}

.result-instagram-caption-stack {
  display: grid;
  gap: 12px;
}

.result-instagram-caption-line {
  margin: 0;
  color: var(--fc-text);
  line-height: 1.7;
}

.result-instagram-caption-line strong {
  margin-right: 8px;
}

.result-facebook-lead {
  font-weight: 700;
}

.result-publish-warning-stack {
  margin-top: 18px;
}

.result-publish-warning-stack .result-signal-card {
  flex: 1 1 220px;
}

.result-inline-field {
  display: grid;
  gap: 8px;
  margin-top: 18px;
}

.result-inline-input {
  min-height: 48px;
  width: 100%;
  padding: 0 16px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 14%, var(--fc-border));
  background: rgba(255, 255, 255, 0.86);
  color: var(--fc-text);
  font: inherit;
}

.result-editor-guidance {
  margin-top: 12px;
}

.result-inline-setup-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  align-items: start;
  margin-top: 18px;
}

.result-inline-setup-card {
  display: grid;
  gap: 12px;
  align-content: start;
  padding: 16px 18px;
  border-radius: 22px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: rgba(255, 255, 255, 0.72);
}

.result-inline-card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.result-inline-card-header strong {
  display: block;
  line-height: 1.25;
}

.result-inline-field-grid {
  display: grid;
  gap: 12px;
}

.result-inline-card-actions,
.result-inline-media-actions {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 10px;
}

.result-inline-launcher-copy {
  margin-top: 0;
}

.result-inline-launcher-chip-row {
  margin-top: 2px;
}

.result-inline-upload {
  min-height: 48px;
}

.result-asset-choice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 12px;
}

.result-asset-choice-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.88);
  color: var(--fc-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.result-asset-choice-card[data-active="true"] {
  border-color: color-mix(in srgb, var(--fc-accent) 30%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 24%, white 76%);
  box-shadow: 0 12px 24px rgba(35, 21, 13, 0.08);
}

.result-asset-choice-card span {
  font-size: 0.88rem;
  line-height: 1.4;
  font-weight: 700;
}

.result-asset-choice-card small {
  color: var(--fc-text-muted);
  line-height: 1.4;
}

.result-asset-choice-preview {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, transparent);
  background: color-mix(in srgb, var(--fc-accent-soft) 16%, white 84%);
}

.result-inline-submeta {
  margin-top: 4px;
}

.result-inline-poster-copy {
  margin-top: 0;
}

.result-poster-choice-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.result-poster-choice {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  min-height: 42px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.82);
  color: var(--fc-text);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.result-poster-choice[data-active="true"] {
  border-color: color-mix(in srgb, var(--fc-accent) 30%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 24%, white 76%);
}

.result-helper-stack {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.result-helper-section {
  overflow: hidden;
}

.result-helper-section summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  list-style: none;
  cursor: pointer;
  font-weight: 700;
}

.result-helper-section summary::-webkit-details-marker {
  display: none;
}

.result-helper-section summary span:last-child {
  color: var(--fc-text-muted);
  font-size: 0.92rem;
  font-weight: 600;
}

.result-helper-section[open] summary {
  border-bottom: 1px solid color-mix(in srgb, var(--fc-border) 86%, transparent);
  background: color-mix(in srgb, var(--fc-accent-soft) 8%, transparent);
}

.result-helper-content {
  display: grid;
  gap: 18px;
  padding: 22px 24px 24px;
}

.helper-two-column {
  grid-template-columns: minmax(0, 1.08fr) minmax(300px, 0.92fr);
  align-items: start;
}

.result-helper-rail {
  display: grid;
  gap: 18px;
}

.workspace-chip[data-tone="warning"] {
  background: color-mix(in srgb, #f8b84e 18%, white 82%);
  color: #8a5200;
}

.workspace-chip[data-tone="default"] {
  background: rgba(245, 232, 219, 0.82);
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

.variant-switcher-panel {
  display: grid;
  gap: 14px;
  margin-top: 18px;
  padding: 18px 20px;
  border-radius: 22px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 12%, white 88%);
}

.variant-switcher-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.variant-switcher-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.variant-switcher-chip {
  display: inline-flex;
  align-items: center;
  min-height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.72);
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
  cursor: pointer;
}

.variant-switcher-chip.active {
  border-color: transparent;
  background: var(--fc-accent);
  color: var(--fc-accent-contrast);
}

.variant-detail-card {
  display: grid;
  gap: 10px;
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.76);
}

.variant-detail-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.variant-detail-topline span {
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.variant-channel-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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

.media-style-select-wrap {
  display: grid;
  gap: 6px;
}

.media-style-select-label {
  margin: 0;
}

.media-style-select-help {
  max-width: 240px;
}

.media-style-select {
  min-width: 200px;
  min-height: 46px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid var(--fc-border);
  background: rgba(255, 255, 255, 0.82);
  color: var(--fc-text);
  font: inherit;
}

.media-generate-button {
  min-width: 170px;
  justify-content: center;
}

.media-role-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  max-width: 100%;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 24%, white 76%);
  color: var(--fc-text);
  font-size: 0.82rem;
  font-weight: 600;
}

.motion-lite-panel {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 14px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 14%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 16%, white 84%);
}

.promo-visual-panel {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 14px;
  padding: 16px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 12%, var(--fc-border));
  background: rgba(255, 255, 255, 0.86);
  margin-bottom: 14px;
}

.promo-visual-panel strong {
  display: block;
}

.motion-lite-panel strong {
  display: block;
}

.motion-lite-status {
  margin: 10px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.motion-lite-status-warning {
  color: var(--fc-accent-dark);
}

.motion-lite-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
}

.motion-audio-controls {
  display: grid;
  gap: 8px;
  min-width: 220px;
}

.motion-audio-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--fc-text);
}

.motion-audio-toggle input {
  accent-color: var(--fc-accent);
}

.media-style-select-wrap.muted {
  opacity: 0.68;
}

.motion-lite-preview-card {
  display: grid;
  gap: 8px;
  width: min(210px, 100%);
}

.motion-lite-preview {
  width: 100%;
  aspect-ratio: 9 / 16;
  object-fit: cover;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 14%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 12%, white 88%);
  box-shadow: 0 16px 32px rgba(15, 23, 42, 0.12);
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
  grid-auto-flow: column;
  grid-auto-columns: minmax(240px, 280px);
  gap: 12px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  padding-bottom: 8px;
  scroll-snap-type: x proximity;
  scrollbar-width: thin;
}

.media-recommendation-card {
  display: grid;
  gap: 12px;
  align-content: space-between;
  min-height: 100%;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 90%, transparent);
  background: rgba(255, 255, 255, 0.88);
  scroll-snap-align: start;
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

.media-order-row {
  display: flex;
  justify-content: flex-start;
}

.media-order-chip {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft) 18%, white 82%);
  color: var(--fc-text);
  font-size: 0.78rem;
  font-weight: 700;
}

.media-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.84rem;
  color: var(--fc-text-muted);
}

.media-order-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.media-order-button {
  min-height: 36px;
  padding-inline: 12px;
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
  .result-operator-grid,
  .result-grid {
    grid-template-columns: 1fr;
  }

  .helper-two-column,
  .publish-launch-grid,
  .result-signal-grid,
  .result-preview-summary-grid,
  .result-inline-setup-grid,
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

  .result-helper-section summary {
    flex-direction: column;
    align-items: flex-start;
  }

  .publish-drawer-overlay {
    padding: 16px;
  }

  .publish-drawer {
    width: 100%;
    max-height: calc(100vh - 32px);
  }
}

@media (max-width: 640px) {
  .result-shell {
    padding-inline: 16px;
  }

  .result-operator-panel,
  .result-post-card,
  .side-card,
  .result-helper-content,
  .result-helper-section summary {
    padding-inline: 18px;
  }

  .result-draft-textarea {
    min-height: 220px;
    max-height: 300px;
    padding: 16px;
  }

  .result-preview-asset-media,
  .motion-lite-preview {
    border-radius: 18px;
  }

  .publish-drawer-overlay {
    padding: 0;
  }

  .publish-drawer {
    max-height: 100vh;
    border-radius: 0;
  }

  .publish-drawer-header,
  .publish-drawer-content {
    padding-inline: 18px;
  }
}
</style>
