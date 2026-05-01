<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  BusinessGenerationChannel,
  BusinessGenerationIntent,
  BusinessContentOutput,
  BusinessGenerationResponse,
  BusinessGenerationTone,
  BrandProfile,
  ContentAiEditPreview,
  ContentGenerationSuggestion,
  ContentIngestionItem,
  CreatorContentType,
  CreatorGenerationIntent,
  CreatorTextVariant,
  CreatorVisualStyle,
  GenerationToneMode,
  GenerationIntent,
  RepurposeContentResponse,
  RepurposeSuggestionSelection,
  RepurposeStrategy,
  RepurposeSourceUrlInput,
  SavedContentSource,
  SocialAccount,
} from "../../../packages/shared-types";
import {
  DEFAULT_REPURPOSE_STRATEGY,
  DEFAULT_GENERATION_TONE,
  resolveGenerationToneMode,
  resolveBusinessGenerationGoal,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import VoiceRecorder from "../components/VoiceRecorder.vue";
import {
  requestContentIngestionPreview,
  requestBusinessGeneration,
  requestRepurposeContent,
  requestSavedContentSources,
} from "../services/generation-service";
import {
  requestBrandProfile,
  requestUpdateBrandProfile,
} from "../services/brand-profile-service";
import {
  getActivationDraft,
  replaceActivationDraft,
  saveActivationDraft,
  type ActivationDraftRecord,
} from "../services/activation-flow-service";
import {
  requestCreatePipelineItem,
  requestContentAiEditPreview,
  requestContentGenerationSuggestions,
  requestPipelineItem,
  requestUpdatePipelineItem,
} from "../services/control-dashboard-service";
import { requestSocialAccounts } from "../services/publishing-service";
import { consumeRepurposeSeed, type RepurposeSeedPayload } from "../utils/repurpose-loop";
import {
  REPURPOSE_STRATEGY_OPTIONS,
  getRepurposeStrategyOption,
  resolveRepurposeStrategySubmitLabel,
} from "../utils/repurpose-strategies";
import { appRoutes } from "../utils/routes";
import {
  findConnectedFacebookAccount,
  findConnectedInstagramAccount,
  findConnectedLinkedInAccount,
} from "../utils/social-platforms";

const exampleIdeas = [
  "Building in public is messy, but it makes trust compound faster.",
  "Most founders do not need more ideas. They need a system to ship content consistently.",
  "The loneliest part of building a startup is acting confident while everything feels uncertain.",
];

const toneOptions = [
  { label: "Creator", value: "storytelling" },
  { label: "Direct", value: "direct" },
  { label: "Structured", value: "professional" },
] as const;

const businessToneOptions = [
  { label: "Friendly", value: "friendly" },
  { label: "Premium", value: "premium" },
  { label: "Urgent", value: "urgent" },
  { label: "Direct", value: "direct" },
] as const;

const businessChannelOptions = [
  { label: "Instagram", value: "instagram" },
  { label: "Facebook", value: "facebook" },
  { label: "Email", value: "email" },
] as const;

const DEFAULT_BUSINESS_GENERATION_INTENT: BusinessGenerationIntent = "get_leads";
const DEFAULT_BUSINESS_TONE: BusinessGenerationTone = "friendly";
const DEFAULT_BUSINESS_CHANNELS: BusinessGenerationChannel[] = ["instagram", "facebook", "email"];
const BUSINESS_CAMPAIGN_SETUP_STORAGE_PREFIX = "founder-content-business-campaign-setup";
const BUSINESS_GENERATION_INTENT_VALUES: readonly BusinessGenerationIntent[] = [
  "get_leads",
  "get_bookings",
  "weekly_plan",
  "promote_offer",
];
const BUSINESS_TONE_VALUES: readonly BusinessGenerationTone[] = [
  "friendly",
  "premium",
  "urgent",
  "direct",
];
const BUSINESS_CHANNEL_VALUES: readonly BusinessGenerationChannel[] = [
  "instagram",
  "facebook",
  "email",
];

type StoredBusinessCampaignSetup = {
  intent?: BusinessGenerationIntent;
  tone?: BusinessGenerationTone;
  location?: string;
  offer?: string;
  channels?: BusinessGenerationChannel[];
};

type GenerationStatusStep = {
  id: string;
  label: string;
  detail: string;
};

const GENERATION_STATUS_ROTATE_MS = 1400;

const creatorContentTypeOptions: Array<{
  value: CreatorContentType;
  label: string;
  description: string;
}> = [
  {
    value: "text_post",
    label: "Insight post",
    description: "Classic LinkedIn text post with stronger structure and a clear point of view.",
  },
  {
    value: "image_post",
    label: "Quick image post",
    description: "Short caption plus realistic image for a faster, higher-engagement post.",
  },
  {
    value: "carousel",
    label: "Carousel",
    description: "Narrative-first post built to break cleanly into multiple slides.",
  },
  {
    value: "quote_card",
    label: "Quote card",
    description: "One sharp idea with short supporting copy and a branded visual path.",
  },
  {
    value: "promo_post",
    label: "Promotion",
    description: "Trust-led post that moves toward a product, service, or CTA.",
  },
];

const creatorVisualStyleOptions: Array<{
  value: CreatorVisualStyle;
  label: string;
  description: string;
}> = [
  {
    value: "realistic_photo",
    label: "Realistic photo",
    description: "Scene-led image treatment with lighter overlay copy.",
  },
  {
    value: "minimal_text_card",
    label: "Minimal card",
    description: "Clean text-forward visual with restrained design treatment.",
  },
  {
    value: "mixed_carousel",
    label: "Mixed carousel",
    description: "Blend text-led slides with more visual breathing room.",
  },
  {
    value: "quote_style",
    label: "Quote style",
    description: "Oversized key line with compact support and brand framing.",
  },
];

const route = useRoute();
const router = useRouter();
const { bootstrap, isReady: isProductAccessReady } = useProductAccessContext();

type GenerationSourceMode = "fresh" | "feed";
type WorkspaceBusinessType = "daycare" | "salon" | "fitness" | "general";
type IntentOption<TIntent extends string> = {
  value: TIntent;
  label: string;
  description: string;
  inputLabel: string;
  freshPlaceholder: string;
  feedPlaceholder?: string;
  disabled?: boolean;
};

const creatorIntentOptions: IntentOption<CreatorGenerationIntent>[] = [
  {
    value: "post_idea",
    label: "Post an idea",
    description: "Start from one idea, insight, or rough note and turn it into a strong post.",
    inputLabel: "What idea do you want to turn into a post?",
    freshPlaceholder: "Share the idea, lesson, or point you want to publish.",
    feedPlaceholder:
      "Example: turn these sources into a sharp post around one clear insight, lesson, or observation.",
  },
  {
    value: "grow_audience",
    label: "Grow audience",
    description: "Create a post that sharpens what you want to be known for and compounds authority.",
    inputLabel: "What do you want to become known for?",
    freshPlaceholder: "Describe the perspective, belief, or lesson you want your audience to remember.",
    feedPlaceholder:
      "Example: turn these sources into a positioning post that sharpens your expertise and earns trust.",
  },
  {
    value: "promote_offer",
    label: "Promote offer",
    description: "Write a post that builds trust and moves readers toward a product, service, or CTA.",
    inputLabel: "What offer should this post move people toward?",
    freshPlaceholder: "Describe the offer, outcome, and why someone should care right now.",
    feedPlaceholder:
      "Example: turn these sources into a post that builds trust, shows proof, and points readers toward the offer.",
  },
  {
    value: "weekly_plan",
    label: "Weekly plan (Soon)",
    description: "Soon: generate a reusable multi-post weekly plan from one clear focus.",
    inputLabel: "What should the weekly plan focus on?",
    freshPlaceholder: "Describe the theme or campaign focus for the week.",
    disabled: true,
  },
];

function buildBusinessIntentOptions(
  businessType: WorkspaceBusinessType,
): IntentOption<BusinessGenerationIntent>[] {
  if (businessType === "daycare") {
    return [
      {
        value: "get_leads",
        label: "Fill empty spots",
        description: "Generate customer-facing marketing built around visibility, trust, and daycare enrollment demand.",
        inputLabel: "What campaign angle should help fill open spots?",
        freshPlaceholder: "Describe the enrollment push, local angle, or parent problem you want this campaign to solve.",
      },
      {
        value: "get_bookings",
        label: "Drive tours and inquiries",
        description: "Create a campaign pack that pushes parents toward tours, calls, and direct inquiries.",
        inputLabel: "What should make parents book a tour or reach out?",
        freshPlaceholder: "Describe the hook, proof, or reason parents should schedule a tour now.",
      },
      {
        value: "promote_offer",
        label: "Promote your daycare",
        description: "Package the offer, trust signals, and CTA into a visual-first post pack ready for business channels.",
        inputLabel: "What should this campaign promote?",
        freshPlaceholder: "Describe the listing, offer, or trust angle you want this campaign to push.",
      },
      {
        value: "weekly_plan",
        label: "Create weekly content (Soon)",
        description: "Soon: map a full week of daycare content from one customer outcome.",
        inputLabel: "What should the weekly plan focus on?",
        freshPlaceholder: "Describe the weekly campaign focus.",
        disabled: true,
      },
    ];
  }

  if (businessType === "salon") {
    return [
      {
        value: "get_bookings",
        label: "Get more appointments",
        description: "Create a local campaign that drives appointment demand, timely bookings, and clear service interest.",
        inputLabel: "What should make someone book now?",
        freshPlaceholder: "Describe the service, seasonal push, or reason clients should book this week.",
      },
      {
        value: "get_leads",
        label: "Capture more leads",
        description: "Generate marketing that attracts new local prospects and turns attention into inquiries.",
        inputLabel: "What customer problem should this campaign solve?",
        freshPlaceholder: "Describe the audience pain, transformation, or local demand you want to target.",
      },
      {
        value: "promote_offer",
        label: "Promote your salon",
        description: "Turn one offer, service, or promotion into a channel-ready visual pack with CTA.",
        inputLabel: "What offer should this campaign promote?",
        freshPlaceholder: "Describe the service, bundle, or promotion you want to feature.",
      },
      {
        value: "weekly_plan",
        label: "Create weekly content (Soon)",
        description: "Soon: map a week of salon posts from one offer or customer outcome.",
        inputLabel: "What should the weekly plan focus on?",
        freshPlaceholder: "Describe the weekly campaign focus.",
        disabled: true,
      },
    ];
  }

  if (businessType === "fitness") {
    return [
      {
        value: "get_bookings",
        label: "Drive memberships",
        description: "Generate a campaign that moves prospects into trials, memberships, and class signups.",
        inputLabel: "What should make someone join or sign up?",
        freshPlaceholder: "Describe the membership, class, or transformation angle you want this campaign to push.",
      },
      {
        value: "get_leads",
        label: "Capture more leads",
        description: "Create a direct-response campaign that brings in local leads and new member interest.",
        inputLabel: "What audience problem should this campaign address?",
        freshPlaceholder: "Describe the pain point, offer, or local angle you want to lead with.",
      },
      {
        value: "promote_offer",
        label: "Promote your fitness brand",
        description: "Turn one offer or positioning angle into a visual-first post pack ready for conversion.",
        inputLabel: "What offer should this campaign promote?",
        freshPlaceholder: "Describe the membership offer, class push, or promotion you want to feature.",
      },
      {
        value: "weekly_plan",
        label: "Create weekly content (Soon)",
        description: "Soon: map a weekly content run from one fitness offer or customer outcome.",
        inputLabel: "What should the weekly plan focus on?",
        freshPlaceholder: "Describe the weekly campaign focus.",
        disabled: true,
      },
    ];
  }

  return [
    {
      value: "get_leads",
      label: "Get more leads",
      description: "Generate a campaign pack aimed at attracting attention and turning it into inquiries.",
      inputLabel: "What campaign angle should drive more leads?",
      freshPlaceholder: "Describe the offer, audience pain, or reason someone should reach out.",
    },
    {
      value: "get_bookings",
      label: "Get more bookings",
      description: "Create a direct-response campaign designed to drive appointments, demos, or calls.",
      inputLabel: "What should make someone book now?",
      freshPlaceholder: "Describe the hook, offer, or urgency behind the booking push.",
    },
    {
      value: "promote_offer",
      label: "Promote an offer",
      description: "Package the offer and CTA into a visual-first campaign built for business channels.",
      inputLabel: "What offer should this campaign promote?",
      freshPlaceholder: "Describe the offer, service, or promotion you want to feature.",
    },
    {
      value: "weekly_plan",
      label: "Create weekly content (Soon)",
      description: "Soon: map a weekly content plan from one clear business outcome.",
      inputLabel: "What should the weekly plan focus on?",
      freshPlaceholder: "Describe the weekly campaign focus.",
      disabled: true,
    },
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeComparableText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function syncCreatorVariantsForEditedPost(
  variants: CreatorTextVariant[],
  previousPost: string,
  nextPost: string,
): CreatorTextVariant[] {
  if (variants.length === 0) {
    return variants;
  }

  const normalizedPreviousPost = normalizeComparableText(previousPost);
  const matchingIndex = variants.findIndex(
    (variant) => normalizeComparableText(variant.content) === normalizedPreviousPost,
  );
  const targetIndex = matchingIndex >= 0 ? matchingIndex : 0;

  return variants.map((variant, index) =>
    index === targetIndex
      ? {
          ...variant,
          content: nextPost,
        }
      : variant,
  );
}

function syncBusinessOutputForEditedPost(
  output: BusinessContentOutput,
  previousPost: string,
  nextPost: string,
): BusinessContentOutput {
  const normalizedPreviousPost = normalizeComparableText(previousPost);
  const captions = {
    ...output.captions,
  };
  const email = output.email
    ? {
        ...output.email,
      }
    : undefined;

  if (normalizeComparableText(captions.instagram) === normalizedPreviousPost) {
    captions.instagram = nextPost;
  } else if (normalizeComparableText(captions.facebook) === normalizedPreviousPost) {
    captions.facebook = nextPost;
  } else if (email && normalizeComparableText(email.body) === normalizedPreviousPost) {
    email.body = nextPost;
  }

  return {
    ...output,
    captions,
    email,
  };
}

function buildEditedRepurposeResult(
  result: RepurposeContentResponse,
  nextPost: string,
): RepurposeContentResponse {
  const nextGenerationOutput =
    result.generationOutput.kind === "creator_post"
      ? {
          ...result.generationOutput,
          post: nextPost,
          variants: syncCreatorVariantsForEditedPost(
            Array.isArray(result.generationOutput.variants) ? result.generationOutput.variants : [],
            result.post,
            nextPost,
          ),
        }
      : result.generationOutput.kind === "business_campaign"
        ? {
            ...result.generationOutput,
            content: syncBusinessOutputForEditedPost(result.generationOutput.content, result.post, nextPost),
          }
        : result.generationOutput;

  return {
    ...result,
    post: nextPost,
    generationOutput: nextGenerationOutput,
    businessOutput:
      result.businessOutput
        ? syncBusinessOutputForEditedPost(result.businessOutput, result.post, nextPost)
        : result.businessOutput,
  };
}

function syncCreatorGenerationOutputRecord(
  generationOutput: Record<string, unknown>,
  previousPost: string,
  nextPost: string,
): Record<string, unknown> {
  if (generationOutput.kind !== "creator_post") {
    return generationOutput;
  }

  const variants = Array.isArray(generationOutput.variants)
    ? generationOutput.variants.map((variant) =>
        isRecord(variant) ? { ...variant } : variant,
      )
    : [];
  const normalizedPreviousPost = normalizeComparableText(previousPost);
  const matchingIndex = variants.findIndex(
    (variant) => isRecord(variant) && normalizeComparableText(variant.content) === normalizedPreviousPost,
  );
  const targetIndex = matchingIndex >= 0 ? matchingIndex : 0;

  if (variants[targetIndex] && isRecord(variants[targetIndex])) {
    variants[targetIndex] = {
      ...variants[targetIndex],
      content: nextPost,
    };
  }

  return {
    ...generationOutput,
    post: nextPost,
    variants,
  };
}

function syncBusinessOutputRecord(
  businessOutput: Record<string, unknown>,
  previousPost: string,
  nextPost: string,
): Record<string, unknown> {
  const nextBusinessOutput = {
    ...businessOutput,
  };
  const captions = isRecord(nextBusinessOutput.captions)
    ? {
        ...nextBusinessOutput.captions,
      }
    : null;
  const email = isRecord(nextBusinessOutput.email)
    ? {
        ...nextBusinessOutput.email,
      }
    : null;
  const normalizedPreviousPost = normalizeComparableText(previousPost);

  if (captions) {
    if (normalizeComparableText(captions.instagram) === normalizedPreviousPost) {
      captions.instagram = nextPost;
    } else if (normalizeComparableText(captions.facebook) === normalizedPreviousPost) {
      captions.facebook = nextPost;
    }
    nextBusinessOutput.captions = captions;
  }

  if (email && normalizeComparableText(email.body) === normalizedPreviousPost) {
    email.body = nextPost;
    nextBusinessOutput.email = email;
  }

  return nextBusinessOutput;
}

function buildEditedContentBody(
  contentBody: Record<string, unknown> | null,
  previousPost: string,
  nextPost: string,
): Record<string, unknown> {
  const nextContentBody: Record<string, unknown> = {
    ...(contentBody ?? {}),
    post: nextPost,
  };

  if (isRecord(nextContentBody.generationOutput)) {
    nextContentBody.generationOutput = nextContentBody.generationOutput.kind === "business_campaign"
      ? {
          ...nextContentBody.generationOutput,
          content: isRecord(nextContentBody.generationOutput.content)
            ? syncBusinessOutputRecord(nextContentBody.generationOutput.content, previousPost, nextPost)
            : nextContentBody.generationOutput.content,
        }
      : syncCreatorGenerationOutputRecord(nextContentBody.generationOutput, previousPost, nextPost);
  }

  if (isRecord(nextContentBody.businessOutput)) {
    nextContentBody.businessOutput = syncBusinessOutputRecord(
      nextContentBody.businessOutput,
      previousPost,
      nextPost,
    );
  }

  return nextContentBody;
}

const input = ref("");
const tone = ref<GenerationToneMode>(DEFAULT_GENERATION_TONE);
const generationStrategy = ref<RepurposeStrategy>(DEFAULT_REPURPOSE_STRATEGY);
const hasToneOverride = ref(false);
const preserveInputText = ref(false);
const isLoading = ref(false);
const errorMessage = ref("");
const helperMessage = ref("Add a starting direction, offer, or rough note. Voice works too.");
const improvementSourceId = ref("");
const isSavingEdit = ref(false);
const editorFeedback = ref("");
const editorAiInstruction = ref("");
const editorAiPreview = ref<ContentAiEditPreview | null>(null);
const isPreviewingEditorAi = ref(false);
const editingStoredDraft = ref<ActivationDraftRecord | null>(null);
const editingPersistedAssetId = ref("");
const editingPersistedContentBody = ref<Record<string, unknown> | null>(null);
const originalEditPost = ref("");
const sourceMode = ref<GenerationSourceMode>("fresh");
const linkedinSourceUrl = ref("");
const instagramSourceUrl = ref("");
const facebookSourceUrl = ref("");
const blogSourceUrl = ref("");
const ingestedSourceItems = ref<ContentIngestionItem[]>([]);
const ingestionErrors = ref<string[]>([]);
const feedPreviewText = ref("");
const isPreviewingFeed = ref(false);
const isFeedPreviewDirty = ref(true);
const savedSources = ref<SavedContentSource[]>([]);
const isLoadingSavedSources = ref(false);
const brandProfile = ref<BrandProfile | null>(null);
const isLoadingBrandProfile = ref(false);
const socialAccounts = ref<SocialAccount[]>([]);
const isLoadingSocialAccounts = ref(false);
const generationSuggestions = ref<ContentGenerationSuggestion[]>([]);
const isLoadingGenerationSuggestions = ref(false);
const generationSuggestionError = ref("");
const isHydratingFeedDefaults = ref(false);
const hydratedSourceBusinessId = ref("");
const seededRepurposeSource = ref<RepurposeSeedPayload["source"] | "">("");
const pendingAutoGenerate = ref(false);
const creatorGenerationIntent = ref<CreatorGenerationIntent>("post_idea");
const creatorContentType = ref<CreatorContentType>("text_post");
const creatorVisualStyle = ref<CreatorVisualStyle>("minimal_text_card");
const businessGenerationIntent = ref<BusinessGenerationIntent>(DEFAULT_BUSINESS_GENERATION_INTENT);
const businessTone = ref<BusinessGenerationTone>(DEFAULT_BUSINESS_TONE);
const businessLocation = ref("");
const businessOffer = ref("");
const businessChannels = ref<BusinessGenerationChannel[]>([...DEFAULT_BUSINESS_CHANNELS]);
const generationStatusPhaseIndex = ref(0);
const generationElapsedSeconds = ref(0);
const isHydratingBusinessCampaignSetup = ref(false);
const businessCampaignSetupSaveState = ref<"idle" | "saving" | "saved" | "error">("idle");
const showAdvancedComposerControls = ref(false);
let businessLocationSyncTimer: ReturnType<typeof setTimeout> | null = null;
let businessCampaignSetupFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
let generationStatusPhaseTimer: ReturnType<typeof setInterval> | null = null;
let generationElapsedTimer: ReturnType<typeof setInterval> | null = null;

const isEditMode = computed(() => improvementSourceId.value !== "");
const pageTitle = computed(() =>
  isEditMode.value
      ? "Edit the draft you already have"
    : isBusinessWorkspace.value
      ? "What do you want to do today?"
      : "What do you want to do today?",
);
const pageDescription = computed(() =>
  isEditMode.value
      ? "Editor mode keeps the current draft intact. Save manual changes, ask AI for a specific improvement, or regenerate only when you want a new version."
    : isBusinessWorkspace.value
      ? isSingleBusinessChannelFlow.value
        ? businessPrimaryChannel.value === "email"
          ? "Choose the customer outcome first, then generate a ready-to-send email with clear copy and CTA."
          : `Choose the customer outcome first, then generate a ready-to-publish ${businessPrimaryChannelLabel.value.toLowerCase()} ${businessSingleOutputLabel.value} with visual direction and CTA.`
        : "Choose the customer outcome first, then generate a visual-first campaign pack with captions, CTA, and optional email."
      : "Choose the post intent first, then write from scratch or repurpose existing content without leaving the workflow.",
);
const isStrategyFlow = computed(
  () => !isEditMode.value && sourceMode.value === "fresh" && seededRepurposeSource.value !== "",
);
const showSuggestionPanel = computed(
  () =>
    !isBusinessWorkspace.value &&
    !improvementSourceId.value &&
    sourceMode.value === "fresh" &&
    seededRepurposeSource.value === "" &&
    hasActiveWorkspace.value &&
    input.value.trim() === "",
);
const shouldShowAdvancedComposerControls = computed(
  () =>
    isEditMode.value
    || showAdvancedComposerControls.value
    || sourceMode.value === "feed",
);
const canPreserveInputText = computed(
  () =>
    !isEditMode.value
    && !isBusinessWorkspace.value
    && sourceMode.value === "fresh"
    && seededRepurposeSource.value === "",
);
const advancedComposerSummary = computed(() => {
  if (isBusinessWorkspace.value) {
    return "Using workspace defaults for tone, brand context, and delivery channels. Open advanced controls only when this draft needs a different setup.";
  }

  return "Quick mode keeps this focused on idea, intent, and generation. Open advanced controls when you want repurpose, format, style, or tone overrides.";
});
const activeStrategyOption = computed(() => getRepurposeStrategyOption(generationStrategy.value));
const recommendedGenerationSuggestion = computed(
  () => generationSuggestions.value.find((suggestion) => suggestion.recommended) ?? generationSuggestions.value[0] ?? null,
);
const submitLabel = computed(() => {
  if (isLoading.value) {
    return isEditMode.value ? "Regenerating..." : "Generating...";
  }

  if (isEditMode.value) {
    return "Regenerate";
  }

  if (isBusinessWorkspace.value) {
    return isSingleBusinessChannelFlow.value
      ? businessPrimaryChannel.value === "email"
        ? "Generate email"
        : "Generate post"
      : "Generate post pack";
  }

  if (creatorContentType.value === "image_post") {
    return "Generate image post";
  }

  if (creatorContentType.value === "carousel") {
    return "Generate carousel";
  }

  if (creatorContentType.value === "quote_card") {
    return "Generate quote card";
  }

  if (creatorContentType.value === "promo_post") {
    return "Generate promotion";
  }

  if (canPreserveInputText.value && preserveInputText.value) {
    return "Use exact post";
  }

  return isStrategyFlow.value
    ? resolveRepurposeStrategySubmitLabel(generationStrategy.value)
    : "Generate post";
});
const saveEditLabel = computed(() => (isSavingEdit.value ? "Saving..." : "Save changes"));
const creatorIntentSelection = computed(
  () => creatorIntentOptions.find((option) => option.value === creatorGenerationIntent.value) ?? creatorIntentOptions[0],
);
const businessIntentOptions = computed(() => buildBusinessIntentOptions(businessWorkspaceType.value));
const businessIntentSelection = computed(
  () => businessIntentOptions.value.find((option) => option.value === businessGenerationIntent.value) ?? businessIntentOptions.value[0],
);
const selectedBusinessChannels = computed<BusinessGenerationChannel[]>(() => [...businessChannels.value]);
const selectedBusinessChannelCount = computed(() => selectedBusinessChannels.value.length);
const isSingleBusinessChannelFlow = computed(
  () => isBusinessWorkspace.value && selectedBusinessChannelCount.value === 1,
);
const businessPrimaryChannel = computed<BusinessGenerationChannel | null>(
  () => selectedBusinessChannels.value[0] ?? null,
);
const businessPrimaryChannelLabel = computed(() => {
  if (businessPrimaryChannel.value === "instagram") {
    return "Instagram";
  }

  if (businessPrimaryChannel.value === "facebook") {
    return "Facebook";
  }

  if (businessPrimaryChannel.value === "email") {
    return "Email";
  }

  return "Channel";
});
const businessSingleOutputLabel = computed(() =>
  businessPrimaryChannel.value === "email" ? "email" : "post",
);
const businessCampaignSetupHelper = computed(() => {
  if (businessCampaignSetupSaveState.value === "saving") {
    return "Saving campaign setup for this workspace...";
  }

  if (businessCampaignSetupSaveState.value === "saved") {
    return "Campaign setup saved for this workspace.";
  }

  if (businessCampaignSetupSaveState.value === "error") {
    return "Campaign setup is saved on this device. Location sync will retry when the workspace is available.";
  }

  return "Campaign setup is saved automatically for this workspace.";
});
const activeGenerationIntent = computed<GenerationIntent>(() =>
  isBusinessWorkspace.value ? businessGenerationIntent.value : creatorGenerationIntent.value,
);
const activeIntentOptions = computed(() =>
  isBusinessWorkspace.value ? businessIntentOptions.value : creatorIntentOptions,
);
const activeIntentSelection = computed(() =>
  isBusinessWorkspace.value ? businessIntentSelection.value : creatorIntentSelection.value,
);
const creatorContentTypeSelection = computed(
  () =>
    creatorContentTypeOptions.find((option) => option.value === creatorContentType.value)
    ?? creatorContentTypeOptions[0],
);
const creatorVisualStyleSelection = computed(
  () =>
    creatorVisualStyleOptions.find((option) => option.value === creatorVisualStyle.value)
    ?? creatorVisualStyleOptions[0],
);
const generationStatusHeadline = computed(() => {
  if (isEditMode.value) {
    return "Refreshing your draft";
  }

  if (isBusinessWorkspace.value) {
    return isSingleBusinessChannelFlow.value
      ? businessPrimaryChannel.value === "email"
        ? "Generating your email"
        : "Generating your post"
      : "Generating your campaign pack";
  }

  if (creatorContentType.value === "carousel") {
    return "Generating your carousel";
  }

  if (creatorContentType.value === "image_post") {
    return "Generating your image post";
  }

  if (creatorContentType.value === "quote_card") {
    return "Generating your quote card";
  }

  if (creatorContentType.value === "promo_post") {
    return "Generating your promotion";
  }

  return "Generating your post";
});
const generationStatusDescription = computed(() => {
  if (isEditMode.value) {
    return "The current draft stays intact until the next version is ready. Review the revision on the result page before publishing.";
  }

  if (isBusinessWorkspace.value) {
    return isSingleBusinessChannelFlow.value
      ? "The engine is matching your offer, brand tone, and selected channel so the result lands ready to review instead of needing manual cleanup."
      : "The engine is shaping one campaign idea into channel-ready assets with CTA, visual direction, and delivery-specific copy.";
  }

  if (canPreserveInputText.value && preserveInputText.value) {
    return "Keeping your copy unchanged and preparing it for review. No hook rewrite, tone pass, or post restructuring will run.";
  }

  return "The engine is structuring the idea, matching the chosen tone and format, and preparing a cleaner draft for the result page.";
});
const generationStatusSteps = computed<GenerationStatusStep[]>(() => {
  if (isEditMode.value) {
    return [
      {
        id: "review",
        label: "Reviewing the current draft",
        detail: "Preserving your latest edits before changing structure or tone.",
      },
      {
        id: "apply",
        label: "Applying the new direction",
        detail: "Reworking the hook, flow, or framing without resetting the core idea.",
      },
      {
        id: "shape",
        label: "Balancing readability",
        detail: "Tightening sentence length and sequencing so the update feels publishable.",
      },
      {
        id: "finish",
        label: "Finalizing the next version",
        detail: "Packaging the regenerated draft for preview and review.",
      },
    ];
  }

  if (isBusinessWorkspace.value) {
    return isSingleBusinessChannelFlow.value
      ? [
          {
            id: "context",
            label: "Matching local context",
            detail: "Mapping your offer, location, and brand signals into one focused campaign direction.",
          },
          {
            id: "caption",
            label: businessPrimaryChannel.value === "email" ? "Drafting the email flow" : "Drafting the platform copy",
            detail: businessPrimaryChannel.value === "email"
              ? "Building subject, body, and CTA structure around the selected outcome."
              : `Sizing the ${businessPrimaryChannelLabel.value.toLowerCase()} draft for a cleaner publish-ready first pass.`,
          },
          {
            id: "cta",
            label: "Sharpening the CTA",
            detail: "Making the ask clearer so the final asset has a stronger action point.",
          },
          {
            id: "finish",
            label: "Finalizing the handoff",
            detail: "Preparing the draft so result, preview, and publish stay aligned.",
          },
        ]
      : [
          {
            id: "direction",
            label: "Choosing the campaign direction",
            detail: "Turning the brief into one visual and messaging angle the whole pack can follow.",
          },
          {
            id: "channels",
            label: "Sizing copy per channel",
            detail: "Adjusting caption and email depth so each surface gets the right amount of content.",
          },
          {
            id: "cta",
            label: "Aligning CTA and offer",
            detail: "Keeping the action clear across the pack instead of repeating generic asks.",
          },
          {
            id: "finish",
            label: "Finalizing the pack",
            detail: "Bundling preview-ready assets for social, email, and downstream scheduling.",
          },
        ];
  }

  if (canPreserveInputText.value && preserveInputText.value) {
    return [
      {
        id: "read",
        label: "Reading your exact copy",
        detail: "The submitted post stays as the source of truth.",
      },
      {
        id: "package",
        label: "Packaging for review",
        detail: "Result metadata is prepared without changing your words.",
      },
      {
        id: "finish",
        label: "Opening the result",
        detail: "You can still add visuals, reorder media, or publish from the next screen.",
      },
    ];
  }

  return [
    {
      id: "angle",
      label: "Framing the core angle",
      detail: "Turning the brief into a clear point of view instead of a loose note.",
    },
    {
      id: "tone",
      label: "Matching tone and format",
      detail: `Adapting the draft to ${creatorContentTypeSelection.value.label.toLowerCase()} with ${creatorVisualStyleSelection.value.label.toLowerCase()} direction.`,
    },
    {
      id: "shape",
      label: "Sizing the draft for delivery",
      detail: "Breaking the copy into a stronger opening, body flow, and clearer takeaway.",
    },
    {
      id: "finish",
      label: "Finalizing the result",
      detail: "Preparing the draft so the next screen opens with a usable first version.",
    },
  ];
});
const activeGenerationStepIndex = computed(() =>
  Math.min(generationStatusPhaseIndex.value, Math.max(generationStatusSteps.value.length - 1, 0)),
);
const generationElapsedLabel = computed(() => {
  const minutes = Math.floor(generationElapsedSeconds.value / 60);
  const seconds = generationElapsedSeconds.value % 60;

  if (minutes === 0) {
    return `${seconds}s elapsed`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
});
const generationStatusContextChips = computed(() => {
  if (isEditMode.value) {
    return [
      "Editor mode",
      editorAiInstruction.value.trim() ? `Requested change: ${editorAiInstruction.value.trim()}` : "Keep manual control",
    ].filter((value) => value !== "");
  }

  if (isBusinessWorkspace.value) {
    const channelLabel = businessChannels.value
      .map((channel) => channel.charAt(0).toUpperCase() + channel.slice(1))
      .join(" + ");

    return [
      `Intent: ${activeIntentSelection.value.label}`,
      `Tone: ${businessToneOptions.find((option) => option.value === businessTone.value)?.label ?? "Friendly"}`,
      channelLabel ? `Channels: ${channelLabel}` : "",
      businessOffer.value.trim() ? `Offer: ${businessOffer.value.trim()}` : "",
    ].filter((value) => value !== "");
  }

  return [
    `Intent: ${activeIntentSelection.value.label}`,
    `Format: ${creatorContentTypeSelection.value.label}`,
    canPreserveInputText.value && preserveInputText.value
      ? "Writing mode: Keep exact copy"
      : `Tone: ${toneOptions.find((option) => option.value === tone.value)?.label ?? "Creator"}`,
    sourceMode.value === "feed" ? "Source mode: Repurpose" : "Source mode: Fresh",
  ];
});
const generationStatusWhatHappeningNotes = computed(() => {
  if (isEditMode.value) {
    return [
      "The existing draft remains the source of truth until the updated version is ready.",
      "Regeneration keeps the same workflow, so preview and publishing still happen from the result page.",
      "Nothing is published from this screen.",
    ];
  }

  if (isBusinessWorkspace.value) {
    return [
      "Brand profile, tone, location, and offer are being folded into the draft automatically.",
      "Channel-specific copy is being sized separately so social and email do not all inherit the same length.",
      "The result page is where you will still review, edit, preview, and publish.",
    ];
  }

  if (canPreserveInputText.value && preserveInputText.value) {
    return [
      "Your post text is not rewritten, shortened, expanded, or reformatted.",
      "The result page still gives you media, preview, scheduling, and publishing controls.",
      "Switch back to Shape with AI when you want hooks, variants, or a stronger structure.",
    ];
  }

  return [
    "The engine is converting your note or source material into a stronger opening, body, and ending.",
    "Format and visual-style choices are influencing how dense the copy should be on the result page.",
    "You still control the final edit, preview, and publish decision after generation completes.",
  ];
});
const inputPanelMeta = computed(() => {
  if (isEditMode.value) {
    return "Editor";
  }

  return isBusinessWorkspace.value ? "Brief" : "Input";
});
const intentPanelTitle = computed(() =>
  isBusinessWorkspace.value
    ? businessWorkspaceType.value === "daycare"
      ? "Choose the daycare outcome first"
      : "Choose the business outcome first"
    : "Choose the post intent first",
);
const intentHelperCopy = computed(() => activeIntentSelection.value.description);
const sourceInputLabel = computed(() =>
  isEditMode.value
    ? "Edit the current draft"
    : isBusinessWorkspace.value
    ? activeIntentSelection.value.inputLabel
    : isStrategyFlow.value
      ? activeStrategyOption.value.label
      : canPreserveInputText.value && preserveInputText.value
        ? "Paste the finished post you want to keep"
      : activeIntentSelection.value.inputLabel,
);
const sourceInputPlaceholder = computed(() =>
  isEditMode.value
    ? "Edit the current draft directly. AI will only change it when you explicitly preview or regenerate."
    : isBusinessWorkspace.value
    ? activeIntentSelection.value.freshPlaceholder
    : isStrategyFlow.value
      ? "Review the seeded post, tighten the framing if needed, then generate the next move."
      : sourceMode.value === "feed"
        ? (activeIntentSelection.value.feedPlaceholder ?? activeIntentSelection.value.freshPlaceholder)
        : canPreserveInputText.value && preserveInputText.value
          ? "Paste your final post here. We will keep the wording, line breaks, and structure unchanged."
        : activeIntentSelection.value.freshPlaceholder,
);
const hasFeedSources = computed(() => buildFeedSourceUrls().length > 0);
const isFeedPreviewReady = computed(() => feedPreviewText.value.trim() !== "" && !isFeedPreviewDirty.value);
const hasActiveWorkspace = computed(() => Boolean(bootstrap.value?.activeBusinessId));
const hasSavedSources = computed(() => savedSources.value.length > 0);
const hasBrandContext = computed(() => {
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
const brandContextChips = computed(() => {
  const profile = brandProfile.value;

  if (!profile) {
    return [];
  }

  return [
    profile.tone ? `Tone: ${profile.tone}` : "",
    profile.writingStyle ? `Style: ${profile.writingStyle}` : "",
    profile.visualStyle ? `Visuals: ${profile.visualStyle}` : "",
  ].filter((value) => value !== "");
});
const brandContextTopics = computed(() => brandProfile.value?.topics.slice(0, 4) ?? []);
const brandContextPatterns = computed(() => brandProfile.value?.patterns.slice(0, 2) ?? []);
const brandContextNarrativeFlow = computed(() => {
  const pattern = brandProfile.value?.patterns[0]?.trim() ?? "";

  if (!pattern) {
    return [];
  }

  const tokens = pattern
    .split(/\s*(?:->|=>|→|\||\/|,|\n)\s*/g)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const beats = tokens
    .map((token) => {
      if (/\b(takeaway|cta|close|closing|punchline|conclusion|invite|action)\b/.test(token)) {
        return "Takeaway";
      }

      if (/\b(breakdown|proof|example|steps?|framework|system|process|playbook|tactical)\b/.test(token)) {
        return "Breakdown";
      }

      if (/\b(insight|lesson|belief|reframe|answer|angle|thesis|point|observation)\b/.test(token)) {
        return "Insight";
      }

      if (/\b(hook|opening|opener|lead|setup|headline|story|question|challenge|contrarian|curiosity)\b/.test(token)) {
        return "Hook";
      }

      return "";
    })
    .filter((beat) => beat !== "");

  if (beats.length === 0) {
    return [];
  }

  return ["Hook", ...beats.filter((beat) => beat !== "Hook" && beat !== "Takeaway"), "Takeaway"]
    .filter((beat, index, values) => values.indexOf(beat) === index);
});
const workspaceDefaultGenerationTone = computed(() =>
  resolveGenerationToneMode(brandProfile.value?.tone ?? brandProfile.value?.preferredTone),
);
const connectedLinkedInAccount = computed(() => findConnectedLinkedInAccount(socialAccounts.value));
const connectedFacebookAccount = computed(() => findConnectedFacebookAccount(socialAccounts.value));
const connectedInstagramAccount = computed(() => findConnectedInstagramAccount(socialAccounts.value));
const linkedInOptimizationLabel = computed(() => {
  const connectedAccount = connectedLinkedInAccount.value;
  const selectedIdentityLabel = connectedAccount?.selectedIdentity?.displayName;

  if (selectedIdentityLabel) {
    return selectedIdentityLabel;
  }

  const linkedInName = connectedAccount?.metadata?.linkedInName;

  if (typeof linkedInName === "string" && linkedInName.trim() !== "") {
    return linkedInName.trim();
  }

  if (connectedAccount?.accountEmail) {
    return connectedAccount.accountEmail;
  }

  return "this workspace";
});

const connectedPublishingPlatforms = computed(() =>
  [
    connectedLinkedInAccount.value ? "LinkedIn" : "",
    connectedFacebookAccount.value ? "Facebook" : "",
    connectedInstagramAccount.value ? "Instagram" : "",
  ].filter((value) => value !== ""),
);

const channelContextTitle = computed(() => {
  if (connectedPublishingPlatforms.value.length === 0) {
    return "See publishing channels before you generate";
  }

  if (connectedPublishingPlatforms.value.length === 3) {
    return "This workspace is ready for multi-platform publishing";
  }

  return `Connected: ${connectedPublishingPlatforms.value.join(" + ")}`;
});

const channelContextDescription = computed(() => {
  if (connectedPublishingPlatforms.value.length === 0) {
    return "Generation still works without connected channels, but destination-aware workspaces hand off cleanly into LinkedIn, Facebook, and Instagram publishing.";
  }

  return "Generate first, then choose the destination that fits the draft. The post view and planner will carry the same channel model forward.";
});

function pickSavedSource(...types: SavedContentSource["sourceType"][]): SavedContentSource | null {
  return savedSources.value.find((source) => types.includes(source.sourceType)) ?? null;
}

function resolveWorkspaceSourceDefaultUrl(kind: "linkedin" | "instagram" | "facebook" | "website"): string {
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

const workspaceDefaultSources = computed(() =>
  [
    { label: "LinkedIn", url: resolveWorkspaceSourceDefaultUrl("linkedin") },
    { label: "Instagram", url: resolveWorkspaceSourceDefaultUrl("instagram") },
    { label: "Facebook", url: resolveWorkspaceSourceDefaultUrl("facebook") },
    { label: "Blog or website", url: resolveWorkspaceSourceDefaultUrl("website") },
  ].filter((source) => source.url !== ""),
);

const hasWorkspaceSourceDefaults = computed(() => workspaceDefaultSources.value.length > 0);
const isBusinessWorkspace = computed(() =>
  brandProfile.value?.workspaceMode === "business"
  || editingStoredDraft.value?.result.workspaceMode === "business"
  || (isRecord(editingPersistedContentBody.value) && editingPersistedContentBody.value.workspaceMode === "business"),
);
const businessWorkspaceType = computed(() => inferBusinessTypeFromBrandProfile(brandProfile.value));

function resolveSourceModeFromRoute(): GenerationSourceMode {
  return route.query.mode === "repurpose" ? "feed" : "fresh";
}

function resolveActivePostIdFromRoute(): string {
  if (typeof route.query.postId === "string" && route.query.postId.trim() !== "") {
    return route.query.postId.trim();
  }

  if (typeof route.query.improve === "string" && route.query.improve.trim() !== "") {
    return route.query.improve.trim();
  }

  return "";
}

function hydrateGenerationContextFromResult(result: RepurposeContentResponse | null | undefined): void {
  const generationOutput = result?.generationOutput;

  if (!generationOutput) {
    return;
  }

  if (generationOutput.kind === "creator_post") {
    creatorGenerationIntent.value = generationOutput.intent;
    creatorContentType.value = generationOutput.contentType;
    creatorVisualStyle.value = generationOutput.visualStyle ?? resolveDefaultCreatorVisualStyle(generationOutput.contentType);
    return;
  }

  if (generationOutput.kind === "business_campaign" || generationOutput.kind === "weekly_plan") {
    businessGenerationIntent.value = generationOutput.intent;
  }
}

function hydrateGenerationContextFromBody(contentBody: Record<string, unknown> | null): void {
  if (!contentBody || !isRecord(contentBody.generationOutput)) {
    return;
  }

  const generationOutput = contentBody.generationOutput;

  if (generationOutput.kind === "creator_post") {
    if (
      generationOutput.intent === "post_idea"
      || generationOutput.intent === "grow_audience"
      || generationOutput.intent === "promote_offer"
    ) {
      creatorGenerationIntent.value = generationOutput.intent;
    }

    if (
      generationOutput.contentType === "text_post"
      || generationOutput.contentType === "image_post"
      || generationOutput.contentType === "carousel"
      || generationOutput.contentType === "quote_card"
      || generationOutput.contentType === "promo_post"
    ) {
      creatorContentType.value = generationOutput.contentType;
    }

    if (
      generationOutput.visualStyle === "realistic_photo"
      || generationOutput.visualStyle === "minimal_text_card"
      || generationOutput.visualStyle === "mixed_carousel"
      || generationOutput.visualStyle === "quote_style"
    ) {
      creatorVisualStyle.value = generationOutput.visualStyle;
    }

    return;
  }

  if (
    generationOutput.intent === "get_leads"
    || generationOutput.intent === "get_bookings"
    || generationOutput.intent === "promote_offer"
    || generationOutput.intent === "weekly_plan"
  ) {
    businessGenerationIntent.value = generationOutput.intent;
  }
}

function extractEditablePostFromAssetContent(assetText: string | undefined, contentBody: unknown): string {
  if (isRecord(contentBody) && typeof contentBody.post === "string" && contentBody.post.trim() !== "") {
    return contentBody.post.trim();
  }

  return assetText?.trim() ?? "";
}

function getBusinessCampaignSetupStorageKey(businessId: string): string {
  return `${BUSINESS_CAMPAIGN_SETUP_STORAGE_PREFIX}:${businessId}`;
}

function isBusinessGenerationIntentValue(value: unknown): value is BusinessGenerationIntent {
  return typeof value === "string" && BUSINESS_GENERATION_INTENT_VALUES.includes(value as BusinessGenerationIntent);
}

function isBusinessToneValue(value: unknown): value is BusinessGenerationTone {
  return typeof value === "string" && BUSINESS_TONE_VALUES.includes(value as BusinessGenerationTone);
}

function normalizeBusinessChannelList(value: unknown): BusinessGenerationChannel[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const nextChannels = BUSINESS_CHANNEL_VALUES.filter((channel) => value.includes(channel));
  return nextChannels.length > 0 ? [...nextChannels] : undefined;
}

function readStoredBusinessCampaignSetup(
  businessId: string | undefined,
): StoredBusinessCampaignSetup | null {
  if (!businessId || typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(getBusinessCampaignSetupStorageKey(businessId));

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Record<string, unknown>;
    const nextState: StoredBusinessCampaignSetup = {};

    if (isBusinessGenerationIntentValue(parsed.intent)) {
      nextState.intent = parsed.intent;
    }

    if (isBusinessToneValue(parsed.tone)) {
      nextState.tone = parsed.tone;
    }

    if (typeof parsed.location === "string") {
      nextState.location = parsed.location;
    }

    if (typeof parsed.offer === "string") {
      nextState.offer = parsed.offer;
    }

    const nextChannels = normalizeBusinessChannelList(parsed.channels);

    if (nextChannels) {
      nextState.channels = nextChannels;
    }

    return nextState;
  } catch {
    return null;
  }
}

function persistBusinessCampaignSetupToStorage(): void {
  const businessId = bootstrap.value?.activeBusinessId;

  if (!businessId || !isBusinessWorkspace.value || typeof window === "undefined") {
    return;
  }

  const payload: StoredBusinessCampaignSetup = {
    intent: businessGenerationIntent.value,
    tone: businessTone.value,
    location: businessLocation.value,
    offer: businessOffer.value,
    channels: [...businessChannels.value],
  };

  try {
    window.localStorage.setItem(
      getBusinessCampaignSetupStorageKey(businessId),
      JSON.stringify(payload),
    );
  } catch {
    // Ignore local storage failures and keep the create flow usable.
  }
}

function scheduleBusinessCampaignSetupFeedbackReset(): void {
  if (businessCampaignSetupFeedbackTimer) {
    clearTimeout(businessCampaignSetupFeedbackTimer);
  }

  businessCampaignSetupFeedbackTimer = setTimeout(() => {
    if (businessCampaignSetupSaveState.value === "saved") {
      businessCampaignSetupSaveState.value = "idle";
    }
  }, 1800);
}

function hydrateBusinessCampaignSetupFromWorkspaceDefaults(force = false): void {
  const businessId = bootstrap.value?.activeBusinessId;

  if (!businessId || !isBusinessWorkspace.value) {
    if (!force) {
      return;
    }

    isHydratingBusinessCampaignSetup.value = true;

    try {
      businessGenerationIntent.value = DEFAULT_BUSINESS_GENERATION_INTENT;
      businessTone.value = DEFAULT_BUSINESS_TONE;
      businessLocation.value = "";
      businessOffer.value = "";
      businessChannels.value = [...DEFAULT_BUSINESS_CHANNELS];
    } finally {
      isHydratingBusinessCampaignSetup.value = false;
    }

    return;
  }

  const storedSetup = readStoredBusinessCampaignSetup(businessId);
  const profileLocation =
    brandProfile.value?.businessId === businessId
      ? brandProfile.value.location ?? ""
      : "";
  const hasStoredLocation = Boolean(storedSetup && Object.prototype.hasOwnProperty.call(storedSetup, "location"));
  const nextLocation = hasStoredLocation
    ? storedSetup?.location ?? ""
    : profileLocation;

  isHydratingBusinessCampaignSetup.value = true;

  try {
    if (force || storedSetup?.intent !== undefined) {
      businessGenerationIntent.value = storedSetup?.intent ?? DEFAULT_BUSINESS_GENERATION_INTENT;
    }

    if (force || storedSetup?.tone !== undefined) {
      businessTone.value = storedSetup?.tone ?? DEFAULT_BUSINESS_TONE;
    }

    if (force || storedSetup?.offer !== undefined) {
      businessOffer.value = storedSetup?.offer ?? "";
    }

    if (force || storedSetup?.channels !== undefined) {
      businessChannels.value = storedSetup?.channels?.length
        ? [...storedSetup.channels]
        : [...DEFAULT_BUSINESS_CHANNELS];
    }

    if (force || hasStoredLocation || businessLocation.value.trim() === "") {
      businessLocation.value = nextLocation;
    }
  } finally {
    isHydratingBusinessCampaignSetup.value = false;
  }
}

async function loadSavedSources(): Promise<void> {
  const businessId = bootstrap.value?.activeBusinessId;

  if (!businessId) {
    savedSources.value = [];
    hydratedSourceBusinessId.value = "";
    return;
  }

  isLoadingSavedSources.value = true;

  try {
    const response = await requestSavedContentSources(businessId);
    savedSources.value = response.sources;
    const shouldForceHydrate = hydratedSourceBusinessId.value !== businessId;
    hydrateFeedDefaultsFromWorkspaceDefaults(shouldForceHydrate);
    hydratedSourceBusinessId.value = businessId;
  } catch {
    savedSources.value = [];
  } finally {
    isLoadingSavedSources.value = false;
  }
}

async function loadBrandProfile(): Promise<void> {
  const businessId = bootstrap.value?.activeBusinessId;

  if (!businessId) {
    brandProfile.value = null;
    return;
  }

  isLoadingBrandProfile.value = true;

  try {
    const response = await requestBrandProfile(businessId);
    brandProfile.value = response.brandProfile;
    hydrateBusinessCampaignSetupFromWorkspaceDefaults();
    const shouldForceHydrate = hydratedSourceBusinessId.value !== businessId;
    hydrateFeedDefaultsFromWorkspaceDefaults(shouldForceHydrate);
  } catch {
    brandProfile.value = null;
  } finally {
    isLoadingBrandProfile.value = false;
  }
}

async function loadSocialAccounts(): Promise<void> {
  const businessId = bootstrap.value?.activeBusinessId;

  if (!businessId) {
    socialAccounts.value = [];
    return;
  }

  isLoadingSocialAccounts.value = true;

  try {
    const response = await requestSocialAccounts(businessId);
    socialAccounts.value = response.accounts;
  } catch {
    socialAccounts.value = [];
  } finally {
    isLoadingSocialAccounts.value = false;
  }
}

async function loadGenerationSuggestions(): Promise<void> {
  const businessId = bootstrap.value?.activeBusinessId;

  if (!businessId) {
    generationSuggestions.value = [];
    generationSuggestionError.value = "";
    return;
  }

  isLoadingGenerationSuggestions.value = true;
  generationSuggestionError.value = "";

  try {
    const response = await requestContentGenerationSuggestions(businessId);
    generationSuggestions.value = response.suggestions;
  } catch (error) {
    generationSuggestions.value = [];
    generationSuggestionError.value =
      error instanceof Error ? error.message : "Unable to load suggestion candidates right now.";
  } finally {
    isLoadingGenerationSuggestions.value = false;
  }
}

async function hydrateImprovementState(): Promise<void> {
  const improveId = resolveActivePostIdFromRoute();
  editorFeedback.value = "";
  editorAiInstruction.value = "";
  editorAiPreview.value = null;
  editingStoredDraft.value = null;
  editingPersistedAssetId.value = "";
  editingPersistedContentBody.value = null;
  originalEditPost.value = "";

  if (!improveId) {
    const repurposeSeed = consumeRepurposeSeed();

    improvementSourceId.value = "";
    pendingAutoGenerate.value = false;

    if (repurposeSeed) {
      sourceMode.value = "fresh";
      input.value = repurposeSeed.text;
      seededRepurposeSource.value = repurposeSeed.source;
      generationStrategy.value = repurposeSeed.strategy ?? DEFAULT_REPURPOSE_STRATEGY;
      pendingAutoGenerate.value = repurposeSeed.autoGenerate === true;
      helperMessage.value =
        repurposeSeed.source === "history"
          ? "History post loaded. Continue writing, deepen the point, or take a sharper next angle."
          : repurposeSeed.source === "result"
            ? "Saved draft loaded. Continue writing from it or push it into a stronger next version."
            : "Workspace seed loaded. Expand it into a fresh draft.";

      const nextQuery = { ...route.query };
      delete nextQuery.mode;
      void router.replace({
        path: appRoutes.appCreate,
        query: nextQuery,
      });
      return;
    }

    seededRepurposeSource.value = "";
    generationStrategy.value = DEFAULT_REPURPOSE_STRATEGY;
    sourceMode.value = resolveSourceModeFromRoute();
    input.value = typeof route.query.prefill === "string" ? route.query.prefill : "";
    if (!route.query.prefill && (helperMessage.value.includes("improving") || helperMessage.value.includes("editing"))) {
      helperMessage.value = "Add a starting direction, offer, or rough note. Voice works too.";
    }
    return;
  }

  improvementSourceId.value = improveId;
  seededRepurposeSource.value = "";
  generationStrategy.value = DEFAULT_REPURPOSE_STRATEGY;
  pendingAutoGenerate.value = false;
  sourceMode.value = "fresh";

  if (bootstrap.value?.activeBusinessId) {
    try {
      const response = await requestPipelineItem(bootstrap.value.activeBusinessId, improveId);
      improvementSourceId.value = response.asset.id;
      editingPersistedAssetId.value = response.asset.id;
      editingPersistedContentBody.value = isRecord(response.asset.contentBody) ? response.asset.contentBody : null;
      input.value = extractEditablePostFromAssetContent(response.asset.textContent, response.asset.contentBody);
      originalEditPost.value = input.value;
      hydrateGenerationContextFromBody(editingPersistedContentBody.value);
      helperMessage.value = "Editor mode is live. Save your changes, preview one AI improvement, or regenerate only if you want a new version.";
      return;
    } catch {
      // Fall through to session draft recovery.
    }
  }

  const storedDraft = getActivationDraft(improveId);

  if (!storedDraft) {
    helperMessage.value = "We could not load that saved post. Paste the post you want to improve.";
    return;
  }

  editingStoredDraft.value = storedDraft;
  editingPersistedAssetId.value = storedDraft.result.asset?.id ?? "";
  editingPersistedContentBody.value = isRecord(storedDraft.result.asset?.contentBody)
    ? storedDraft.result.asset.contentBody
    : null;
  input.value = storedDraft.result.post;
  originalEditPost.value = storedDraft.result.post;
  hydrateGenerationContextFromResult(storedDraft.result);
  helperMessage.value = "Editor mode is live. Save manual changes first, ask AI for one targeted improvement, or regenerate when you want a fresh version.";
}

function setSourceMode(nextMode: GenerationSourceMode): void {
  if (isBusinessWorkspace.value) {
    return;
  }

  sourceMode.value = nextMode;
  errorMessage.value = "";

  if (improvementSourceId.value) {
    return;
  }

  if (nextMode !== "fresh") {
    preserveInputText.value = false;
  }

  if (nextMode !== "fresh" || seededRepurposeSource.value) {
    seededRepurposeSource.value = "";
    generationStrategy.value = DEFAULT_REPURPOSE_STRATEGY;
    pendingAutoGenerate.value = false;
  }

  const nextQuery = { ...route.query };

  if (nextMode === "feed") {
    nextQuery.mode = "repurpose";
  } else {
    delete nextQuery.mode;
  }

  void router.replace({
    path: appRoutes.appCreate,
    query: nextQuery,
    hash: nextMode === "feed" ? "#repurpose-panel" : "",
  });
}

function buildFeedSourceUrls(): RepurposeSourceUrlInput[] {
  return [
    { label: "LinkedIn page or post", url: linkedinSourceUrl.value.trim() },
    { label: "Instagram page or post", url: instagramSourceUrl.value.trim() },
    { label: "Facebook page or post", url: facebookSourceUrl.value.trim() },
    { label: "Blog or website", url: blogSourceUrl.value.trim() },
  ].filter((source) => source.url !== "");
}

function buildCombinedFeedPreviewText(
  contextText: string,
  items: Array<Pick<ContentIngestionItem, "label" | "rawText">>,
): string {
  const normalizedContext = contextText.trim();

  return [
    normalizedContext ? `Priority context:\n${normalizedContext}` : "",
    ...items.map((item) => `${item.label}\n${item.rawText}`),
  ]
    .filter((segment) => segment !== "")
    .join("\n\n");
}

function hydrateFeedDefaultsFromWorkspaceDefaults(force = false): void {
  if (improvementSourceId.value || sourceMode.value !== "feed") {
    return;
  }

  const currentSources = buildFeedSourceUrls();

  if (!force && currentSources.length > 0) {
    return;
  }

  isHydratingFeedDefaults.value = true;
  linkedinSourceUrl.value = resolveWorkspaceSourceDefaultUrl("linkedin");
  instagramSourceUrl.value = resolveWorkspaceSourceDefaultUrl("instagram");
  facebookSourceUrl.value = resolveWorkspaceSourceDefaultUrl("facebook");
  blogSourceUrl.value = resolveWorkspaceSourceDefaultUrl("website");
  ingestedSourceItems.value = savedSources.value.map((source) => ({
    label: source.label,
    sourceType: source.sourceType,
    title: source.title,
    rawText: source.extractedText,
    metadata: source.metadata,
  }));
  ingestionErrors.value = [];
  feedPreviewText.value = buildCombinedFeedPreviewText(input.value, ingestedSourceItems.value);
  isFeedPreviewDirty.value = savedSources.value.length === 0;
  isHydratingFeedDefaults.value = false;
}

async function previewFeedSources(): Promise<void> {
  if (!bootstrap.value?.activeBusinessId) {
    errorMessage.value = "Select or create a workspace before previewing sources.";
    return;
  }

  const sourceUrls = buildFeedSourceUrls();

  if (sourceUrls.length === 0) {
    errorMessage.value = "Add at least one public source URL to preview.";
    return;
  }

  isPreviewingFeed.value = true;
  errorMessage.value = "";

  try {
    const response = await requestContentIngestionPreview({
      businessId: bootstrap.value.activeBusinessId,
      contextText: input.value.trim() || undefined,
      sourceUrls,
    });
    ingestedSourceItems.value = response.items;
    ingestionErrors.value = response.errors.map((error) => `${error.label}: ${error.message}`);
    feedPreviewText.value = buildCombinedFeedPreviewText(input.value, response.items);
    savedSources.value = response.savedSources;
    isFeedPreviewDirty.value = false;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to preview content sources right now.";
  } finally {
    isPreviewingFeed.value = false;
  }
}

async function previewEditorAiEdit(): Promise<void> {
  if (!isEditMode.value) {
    return;
  }

  if (!input.value.trim()) {
    editorFeedback.value = "Add or keep some draft content before asking AI to improve it.";
    return;
  }

  if (!bootstrap.value?.activeBusinessId) {
    editorFeedback.value = "Select a workspace before requesting AI edits.";
    return;
  }

  const instruction = editorAiInstruction.value.trim();

  if (!instruction) {
    editorFeedback.value = "Tell AI what to improve first.";
    return;
  }

  isPreviewingEditorAi.value = true;
  editorFeedback.value = "";
  editorAiPreview.value = null;

  try {
    const response = await requestContentAiEditPreview({
      businessId: bootstrap.value.activeBusinessId,
      assetId: editingPersistedAssetId.value || undefined,
      textContent: input.value.trim(),
      instruction,
    });

    editorAiPreview.value = response.preview;
  } catch (error) {
    editorFeedback.value =
      error instanceof Error ? error.message : "Unable to preview AI changes right now.";
  } finally {
    isPreviewingEditorAi.value = false;
  }
}

function applyEditorAiSuggestion(): void {
  const suggestedText = editorAiPreview.value?.suggestedText.trim();

  if (!suggestedText) {
    editorFeedback.value = "The AI preview did not return usable content.";
    return;
  }

  input.value = suggestedText;
  editorAiPreview.value = null;
  editorFeedback.value = "AI suggestion applied in the editor. Save when the draft looks right.";
}

async function saveEditedDraft(): Promise<void> {
  if (!isEditMode.value) {
    return;
  }

  const trimmedInput = input.value.trim();

  if (!trimmedInput) {
    errorMessage.value = "Add or keep some draft content before saving.";
    return;
  }

  isSavingEdit.value = true;
  errorMessage.value = "";
  editorFeedback.value = "";

  try {
    if (editingStoredDraft.value) {
      const nextResult = buildEditedRepurposeResult(editingStoredDraft.value.result, trimmedInput);
      let nextAsset = nextResult.asset;

      if (bootstrap.value?.activeBusinessId && nextAsset?.id) {
        const response = await requestUpdatePipelineItem({
          businessId: bootstrap.value.activeBusinessId,
          assetId: nextAsset.id,
          title: nextResult.idea.title,
          textContent: trimmedInput,
          contentBody: buildEditedContentBody(
            isRecord(nextAsset.contentBody) ? nextAsset.contentBody : null,
            editingStoredDraft.value.result.post,
            trimmedInput,
          ),
        });

        nextAsset = response.asset;
      } else if (bootstrap.value?.activeBusinessId) {
        const response = await requestCreatePipelineItem({
          businessId: bootstrap.value.activeBusinessId,
          title: nextResult.idea.title,
          textContent: trimmedInput,
          contentBody: buildEditedContentBody(
            nextResult.asset && isRecord(nextResult.asset.contentBody) ? nextResult.asset.contentBody : null,
            editingStoredDraft.value.result.post,
            trimmedInput,
          ),
          sourceKind: editingStoredDraft.value.mode === "improve" ? "remix" : "capture",
        });

        nextAsset = response.asset;
      }

      const nextDraftRecord = nextAsset?.id && nextAsset.id !== editingStoredDraft.value.id
        ? saveActivationDraft({
            input: trimmedInput,
            mode: editingStoredDraft.value.mode,
            result: {
              ...nextResult,
              asset: nextAsset,
            },
          })
        : replaceActivationDraft({
            ...editingStoredDraft.value,
            input: trimmedInput,
            result: {
              ...nextResult,
              asset: nextAsset,
            },
          });

      await router.push({
        path: appRoutes.appResult,
        query: {
          id: nextDraftRecord.id,
        },
      });
      return;
    }

    if (!bootstrap.value?.activeBusinessId || !editingPersistedAssetId.value) {
      errorMessage.value = "We could not resolve this draft for saving. Reopen it from planner, history, or result.";
      return;
    }

    const response = await requestUpdatePipelineItem({
      businessId: bootstrap.value.activeBusinessId,
      assetId: editingPersistedAssetId.value,
      textContent: trimmedInput,
      contentBody: buildEditedContentBody(
        editingPersistedContentBody.value,
        originalEditPost.value,
        trimmedInput,
      ),
    });

    await router.push({
      path: appRoutes.appResult,
      query: {
        id: response.asset.id,
      },
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to save this draft right now.";
  } finally {
    isSavingEdit.value = false;
  }
}

async function generatePost(selectedSuggestion?: RepurposeSuggestionSelection): Promise<void> {
  if (isBusinessWorkspace.value) {
    await generateBusinessCampaign();
    return;
  }

  if (sourceMode.value === "fresh" && !input.value.trim()) {
    errorMessage.value = "Add a starting direction before generating.";
    return;
  }

  if (sourceMode.value === "feed" && buildFeedSourceUrls().length === 0) {
    errorMessage.value = "Add at least one public source URL or switch back to Start fresh.";
    return;
  }

  if (sourceMode.value === "feed" && !improvementSourceId.value && !feedPreviewText.value.trim()) {
    errorMessage.value = "Preview your content sources before generating.";
    return;
  }

  if (sourceMode.value === "feed" && !improvementSourceId.value && isFeedPreviewDirty.value) {
    errorMessage.value = "Your source inputs changed. Refresh the preview before generating.";
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const usingFeedSources = !improvementSourceId.value && sourceMode.value === "feed";
    const usingSeededReference = isStrategyFlow.value;
    const response = await requestRepurposeContent({
      inputType: "text",
      intent: improvementSourceId.value || usingFeedSources || usingSeededReference ? "reference" : "capture",
      strategy: isStrategyFlow.value ? generationStrategy.value : undefined,
      assetId: improvementSourceId.value || undefined,
      selectedSuggestion,
      text: usingFeedSources ? feedPreviewText.value.trim() : input.value.trim() || undefined,
      tone: tone.value,
      generationIntent: creatorGenerationIntent.value,
      creatorContentType: creatorContentType.value,
      creatorVisualStyle: creatorVisualStyle.value,
      businessId: bootstrap.value?.activeBusinessId ?? undefined,
      preserveInputText: canPreserveInputText.value && preserveInputText.value,
    });
    const draft = saveActivationDraft({
      input:
        usingFeedSources
          ? buildFeedSourceUrls()
              .map((source) => source.url)
              .join("\n")
          : input.value.trim(),
      mode: improvementSourceId.value ? "improve" : "generate",
      result: response,
    });

    await router.push({
      path: appRoutes.appResult,
      query: {
        id: draft.id,
      },
    });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to generate a post right now.";
  } finally {
    isLoading.value = false;
  }
}

function inferBusinessTypeFromBrandProfile(
  profile: BrandProfile | null,
): "daycare" | "salon" | "fitness" | "general" {
  const normalized = [
    profile?.industry ?? "",
    ...(profile?.topics ?? []),
    profile?.websiteUrl ?? "",
    profile?.instagramUrl ?? "",
    profile?.facebookUrl ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (
    normalized.includes("daycare")
    || normalized.includes("childcare")
    || normalized.includes("preschool")
    || normalized.includes("kids")
  ) {
    return "daycare";
  }

  if (normalized.includes("salon") || normalized.includes("beauty") || normalized.includes("spa")) {
    return "salon";
  }

  if (normalized.includes("fitness") || normalized.includes("gym") || normalized.includes("wellness")) {
    return "fitness";
  }

  return "general";
}

function resolvePreferredBusinessDraftPost(
  output: BusinessContentOutput | undefined,
): string {
  if (!output) {
    return "";
  }

  for (const channel of businessChannels.value) {
    if (channel === "instagram" && output.captions.instagram?.trim()) {
      return output.captions.instagram.trim();
    }

    if (channel === "facebook" && output.captions.facebook?.trim()) {
      return output.captions.facebook.trim();
    }

    if (channel === "email" && output.email?.body?.trim()) {
      return output.email.body.trim();
    }
  }

  return output.captions.instagram?.trim()
    || output.captions.facebook?.trim()
    || output.email?.body?.trim()
    || "";
}

function buildBusinessDraftResult(
  response: BusinessGenerationResponse,
  sourceText: string,
): RepurposeContentResponse {
  const campaignOutput = response.kind === "business_campaign" ? response.content : undefined;
  const fallbackCaption =
    resolvePreferredBusinessDraftPost(campaignOutput)
    || (response.kind === "weekly_plan"
      ? response.days.map((day) => `Day ${day.dayNumber}: ${day.headline}\n${day.summary}`).join("\n\n")
      : [campaignOutput?.visual.headline, campaignOutput?.visual.subheadline].filter(Boolean).join("\n\n"));
  const channelList = businessChannels.value.map((channel) => channel.charAt(0).toUpperCase() + channel.slice(1));
  const isSingleChannel = businessChannels.value.length === 1;
  const primaryChannelLabel = channelList[0] ?? "Business";
  const draftTitle =
    response.kind === "business_campaign"
      ? response.content.visual.headline
      : response.days[0]?.headline || "Weekly campaign plan";
  const draftAngle =
    response.kind === "business_campaign"
      ? response.content.visual.subheadline
        ?? (isSingleChannel ? `${primaryChannelLabel} post ready` : `${channelList.join(" + ")} campaign ready`)
      : "7-day business content plan ready";

  return {
    inputType: "text",
    intent: "capture",
    strategy: "continue",
    generationOutput: response,
    workspaceMode: "business",
    generationIntent: businessGenerationIntent.value,
    sourceText,
    idea: {
      title: draftTitle,
      angle: draftAngle,
    },
    hooks:
      response.kind === "business_campaign" && response.content.hooks.length > 0
        ? response.content.hooks
        : [draftTitle],
    post: fallbackCaption,
    variations: [],
    visualNarrative: {
      format: "carousel",
      type: "framework",
      title: draftTitle,
      subtitle:
        response.kind === "business_campaign"
          ? response.content.visual.subheadline ?? response.content.cta.label
          : "7-day plan",
      slides: [],
    },
    carouselDraft: {
      title: draftTitle,
      subtitle:
        response.kind === "business_campaign"
          ? response.content.visual.subheadline ?? response.content.cta.label
          : "7-day plan",
      narrativeType: "framework",
      slides: [],
    },
    quickSignals: {
      readyLabel: response.kind === "weekly_plan" ? "Plan ready" : "Ready to launch",
      formatLabel:
        response.kind === "weekly_plan"
          ? "7-day business content plan ready for review."
          : isSingleChannel
            ? `${primaryChannelLabel} post with CTA ready to review.`
            : `${channelList.join(" + ")} post pack with CTA${businessChannels.value.includes("email") ? " and email" : ""}.`,
    },
    captionFooterCredit: "",
    businessOutput: campaignOutput,
  };
}

async function generateBusinessCampaign(): Promise<void> {
  if (!bootstrap.value?.activeBusinessId) {
    errorMessage.value = "Select a workspace before generating.";
    return;
  }

  if (businessChannels.value.length === 0) {
    errorMessage.value = "Select at least one delivery channel.";
    return;
  }

  if (!input.value.trim() && !businessOffer.value.trim()) {
    errorMessage.value = "Add the campaign angle or offer before generating.";
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await requestBusinessGeneration({
      businessId: bootstrap.value.activeBusinessId,
      goal: resolveBusinessGenerationGoal(businessGenerationIntent.value),
      generationIntent: businessGenerationIntent.value,
      businessType: inferBusinessTypeFromBrandProfile(brandProfile.value),
      location: businessLocation.value.trim() || undefined,
      offer: businessOffer.value.trim() || undefined,
      sourceIdea: input.value.trim() || undefined,
      tone: businessTone.value,
      channels: businessChannels.value,
    });

    const sourceText = [
      input.value.trim(),
      businessOffer.value.trim(),
      businessLocation.value.trim(),
    ]
      .filter(Boolean)
      .join("\n");
    const draft = saveActivationDraft({
      input: sourceText,
      mode: "generate",
      result: buildBusinessDraftResult(response, sourceText),
    });

    await router.push({
      path: appRoutes.appResult,
      query: {
        id: draft.id,
      },
    });
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to generate a business campaign right now.";
  } finally {
    isLoading.value = false;
  }
}

function toggleBusinessChannel(channel: BusinessGenerationChannel): void {
  if (businessChannels.value.includes(channel)) {
    businessChannels.value = businessChannels.value.filter((value) => value !== channel);
    return;
  }

  businessChannels.value = [...businessChannels.value, channel];
}

function selectGenerationIntent(intent: GenerationIntent): void {
  if (isBusinessWorkspace.value) {
    businessGenerationIntent.value = intent as BusinessGenerationIntent;
    return;
  }

  creatorGenerationIntent.value = intent as CreatorGenerationIntent;
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

function selectCreatorContentType(contentType: CreatorContentType): void {
  creatorContentType.value = contentType;
  creatorVisualStyle.value = resolveDefaultCreatorVisualStyle(contentType);
}

async function runSuggestedGeneration(suggestion: ContentGenerationSuggestion): Promise<void> {
  sourceMode.value = "fresh";
  preserveInputText.value = false;
  seededRepurposeSource.value = "dashboard";
  generationStrategy.value = suggestion.strategy;
  input.value = suggestion.sourceText;
  helperMessage.value = suggestion.rationale;
  pendingAutoGenerate.value = false;
  errorMessage.value = "";
  await generatePost({
    suggestionId: suggestion.id,
    sourceAssetId: suggestion.sourceAssetId,
    origin: "generate_for_me",
  });
}

function applyExample(value: string): void {
  input.value = value;
  seededRepurposeSource.value = "";
  pendingAutoGenerate.value = false;
  errorMessage.value = "";
}

function handleVoiceTranscript(value: string): void {
  sourceMode.value = "fresh";
  input.value = value;
  seededRepurposeSource.value = "";
  pendingAutoGenerate.value = false;
  helperMessage.value = "Transcript ready. Review it, then generate your post.";
  errorMessage.value = "";
}

function clearGenerationStatusTimers(): void {
  if (generationStatusPhaseTimer) {
    clearInterval(generationStatusPhaseTimer);
    generationStatusPhaseTimer = null;
  }

  if (generationElapsedTimer) {
    clearInterval(generationElapsedTimer);
    generationElapsedTimer = null;
  }
}

function resetGenerationStatus(): void {
  generationStatusPhaseIndex.value = 0;
  generationElapsedSeconds.value = 0;
}

function startGenerationStatus(): void {
  clearGenerationStatusTimers();
  resetGenerationStatus();

  generationElapsedTimer = setInterval(() => {
    generationElapsedSeconds.value += 1;
  }, 1000);

  generationStatusPhaseTimer = setInterval(() => {
    const lastIndex = Math.max(generationStatusSteps.value.length - 1, 0);

    generationStatusPhaseIndex.value = Math.min(generationStatusPhaseIndex.value + 1, lastIndex);

    if (generationStatusPhaseIndex.value >= lastIndex && generationStatusPhaseTimer) {
      clearInterval(generationStatusPhaseTimer);
      generationStatusPhaseTimer = null;
    }
  }, GENERATION_STATUS_ROTATE_MS);
}

function handleKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key !== "Enter") {
    return;
  }

  if (isLoading.value || isSavingEdit.value) {
    return;
  }

  event.preventDefault();

  if (isEditMode.value) {
    void saveEditedDraft();
    return;
  }

  void generatePost();
}

watch(
  () => [route.query.improve, route.query.postId, route.query.mode, bootstrap.value?.activeBusinessId],
  () => {
    void hydrateImprovementState();
    if (resolveSourceModeFromRoute() === "feed") {
      hydrateFeedDefaultsFromWorkspaceDefaults();
    }
  },
  { immediate: true },
);

watch([sourceMode, linkedinSourceUrl, instagramSourceUrl, facebookSourceUrl, blogSourceUrl], () => {
  if (isHydratingFeedDefaults.value) {
    return;
  }

  if (sourceMode.value === "feed" && !improvementSourceId.value) {
    isFeedPreviewDirty.value = true;
  }
});

watch(
  () => input.value,
  () => {
    if (isEditMode.value && editorAiPreview.value) {
      editorAiPreview.value = null;
    }

    if (sourceMode.value === "feed" && !improvementSourceId.value && ingestedSourceItems.value.length > 0) {
      feedPreviewText.value = buildCombinedFeedPreviewText(input.value, ingestedSourceItems.value);
    }
  },
);

watch(
  () => bootstrap.value?.activeBusinessId,
  () => {
    brandProfile.value = null;
    hydrateBusinessCampaignSetupFromWorkspaceDefaults(true);
    void loadGenerationSuggestions();
    void loadSavedSources();
    void loadBrandProfile();
    void loadSocialAccounts();
  },
  { immediate: true },
);

watch(
  [
    () => bootstrap.value?.activeBusinessId,
    isBusinessWorkspace,
    businessGenerationIntent,
    businessTone,
    businessLocation,
    businessOffer,
    () => businessChannels.value.join("|"),
  ],
  () => {
    if (isHydratingBusinessCampaignSetup.value || !isBusinessWorkspace.value) {
      return;
    }

    persistBusinessCampaignSetupToStorage();
  },
);

watch(
  [() => bootstrap.value?.activeBusinessId, isBusinessWorkspace, businessLocation],
  ([businessId, nextIsBusinessWorkspace, nextLocation]) => {
    if (businessLocationSyncTimer) {
      clearTimeout(businessLocationSyncTimer);
      businessLocationSyncTimer = null;
    }

    if (
      !businessId ||
      !nextIsBusinessWorkspace ||
      isHydratingBusinessCampaignSetup.value
    ) {
      return;
    }

    const normalizedNextLocation = nextLocation.trim();
    const normalizedProfileLocation = brandProfile.value?.location?.trim() ?? "";

    if (normalizedNextLocation === normalizedProfileLocation) {
      return;
    }

    businessCampaignSetupSaveState.value = "saving";
    businessLocationSyncTimer = setTimeout(async () => {
      try {
        const response = await requestUpdateBrandProfile({
          businessId,
          location: normalizedNextLocation,
          refreshFromSignals: false,
        });
        brandProfile.value = response.brandProfile;
        businessCampaignSetupSaveState.value = "saved";
        scheduleBusinessCampaignSetupFeedbackReset();
      } catch {
        businessCampaignSetupSaveState.value = "error";
      } finally {
        businessLocationSyncTimer = null;
      }
    }, 700);
  },
);

watch(
  workspaceDefaultGenerationTone,
  (nextTone) => {
    if (!hasToneOverride.value) {
      tone.value = nextTone ?? DEFAULT_GENERATION_TONE;
    }
  },
  { immediate: true },
);

watch(
  isBusinessWorkspace,
  (nextValue) => {
    if (nextValue) {
      sourceMode.value = "fresh";
    }
  },
  { immediate: true },
);

watch(
  [pendingAutoGenerate, isProductAccessReady],
  ([shouldAutoGenerate, productAccessReady]) => {
    if (!shouldAutoGenerate || !productAccessReady || isLoading.value) {
      return;
    }

    pendingAutoGenerate.value = false;
    void generatePost();
  },
  { immediate: true },
);

watch(
  isLoading,
  (nextValue) => {
    if (nextValue) {
      startGenerationStatus();
      return;
    }

    clearGenerationStatusTimers();
    resetGenerationStatus();
  },
);

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);

  if (businessLocationSyncTimer) {
    clearTimeout(businessLocationSyncTimer);
  }

  if (businessCampaignSetupFeedbackTimer) {
    clearTimeout(businessCampaignSetupFeedbackTimer);
  }

  clearGenerationStatusTimers();
});
</script>

<template>
  <main class="activation-shell">
    <section class="activation-hero">
      <p class="activation-eyebrow">/app/create</p>
      <h1>{{ pageTitle }}</h1>
      <p class="activation-description">{{ pageDescription }}</p>
      <div class="activation-chip-row">
        <span class="activation-chip">Value in one step</span>
        <span class="activation-chip">
          {{
            isEditMode
              ? "Manual edit + AI assist"
              : isBusinessWorkspace
                ? "Visual + captions + CTA"
                : "Hooks + post + next actions"
          }}
        </span>
        <span class="activation-chip">
          {{ isEditMode ? "Cmd/Ctrl + Enter to save" : "Cmd/Ctrl + Enter to generate" }}
        </span>
      </div>
      <div v-if="!isEditMode" class="composer-toggle-row">
        <p class="activation-helper">{{ advancedComposerSummary }}</p>
        <button
          type="button"
          class="secondary-action"
          @click="showAdvancedComposerControls = !showAdvancedComposerControls"
        >
          {{ showAdvancedComposerControls ? "Hide advanced controls" : "Adjust strategy, tone, and channels" }}
        </button>
      </div>
      <div
        v-if="shouldShowAdvancedComposerControls"
        class="channel-context-panel"
        :class="{ connected: connectedPublishingPlatforms.length > 0 }"
      >
        <div class="channel-context-copy">
          <p class="panel-meta">Distribution context</p>
          <h2>{{ channelContextTitle }}</h2>
          <p class="activation-helper">{{ channelContextDescription }}</p>
        </div>
        <div class="channel-context-platforms" aria-label="Publishing channels">
          <article class="channel-platform-card" :data-connected="Boolean(connectedLinkedInAccount)">
            <div class="channel-platform-card-topline">
              <strong>LinkedIn</strong>
              <span class="channel-platform-state" :data-connected="Boolean(connectedLinkedInAccount)">
                {{ connectedLinkedInAccount ? "Connected" : "Not connected" }}
              </span>
            </div>
            <p>
              {{
                connectedLinkedInAccount
                  ? linkedInOptimizationLabel
                  : "Professional feed and company/profile publishing"
              }}
            </p>
          </article>

          <article class="channel-platform-card" :data-connected="Boolean(connectedFacebookAccount)">
            <div class="channel-platform-card-topline">
              <strong>Facebook</strong>
              <span class="channel-platform-state" :data-connected="Boolean(connectedFacebookAccount)">
                {{ connectedFacebookAccount ? "Connected" : "Not connected" }}
              </span>
            </div>
            <p>
              {{
                connectedFacebookAccount
                  ? "Workspace Page is ready for direct publishing."
                  : "Connect a Facebook Page for text, image, and video publishing."
              }}
            </p>
          </article>

          <article class="channel-platform-card" :data-connected="Boolean(connectedInstagramAccount)">
            <div class="channel-platform-card-topline">
              <strong>Instagram</strong>
              <span class="channel-platform-state" :data-connected="Boolean(connectedInstagramAccount)">
                {{ connectedInstagramAccount ? "Connected" : "Not connected" }}
              </span>
            </div>
            <p>
              {{
                connectedInstagramAccount
                  ? "Derived from the linked Facebook Page for business publishing."
                  : "Unlocks automatically when the connected Facebook Page has an Instagram business account."
              }}
            </p>
          </article>
        </div>
        <div class="channel-context-actions">
          <span
            v-if="connectedPublishingPlatforms.length > 0"
            class="activation-chip channel-context-chip"
          >
            {{ `Ready: ${connectedPublishingPlatforms.join(" · ")}` }}
          </span>
          <span
            v-else-if="isLoadingSocialAccounts"
            class="activation-chip channel-context-chip"
          >
            Checking channels...
          </span>
          <span v-else class="activation-chip channel-context-chip">
            Choose a destination after generation
          </span>
          <router-link class="secondary-action inline-link" :to="appRoutes.settingsPreferences">
            {{ connectedPublishingPlatforms.length > 0 ? "Manage channels" : "Connect in settings" }}
          </router-link>
        </div>
      </div>

      <div
        v-if="shouldShowAdvancedComposerControls && !improvementSourceId && hasActiveWorkspace"
        class="brand-context-panel"
      >
        <div class="brand-context-header">
          <div>
            <p class="panel-meta">Brand context</p>
            <h2>
              {{
                hasBrandContext
                  ? "This workspace already shapes the draft"
                  : "Add brand context in settings to steer every draft"
              }}
            </h2>
            <p class="activation-helper">
              {{
                sourceMode === "fresh"
                  ? "Write-from-scratch mode still uses the saved voice, themes, and brand sources attached to this workspace."
                  : "Repurpose starts from the previewed source text, then layers this workspace’s voice and saved brand sources on top."
              }}
            </p>
          </div>
          <div class="brand-context-actions">
            <span v-if="isLoadingBrandProfile" class="activation-chip">Loading profile...</span>
            <span v-else-if="hasSavedSources" class="activation-chip">
              {{ savedSources.length }} saved source{{ savedSources.length === 1 ? "" : "s" }}
            </span>
            <router-link class="secondary-action inline-link" :to="appRoutes.settingsPreferences">
              Edit brand context
            </router-link>
          </div>
        </div>

        <div class="brand-context-grid">
          <div v-if="brandContextChips.length > 0" class="brand-context-block">
            <p class="panel-meta">Voice + style</p>
            <div class="saved-source-list">
              <span
                v-for="chip in brandContextChips"
                :key="chip"
                class="saved-source-chip"
              >
                {{ chip }}
              </span>
            </div>
          </div>

          <div v-if="brandContextTopics.length > 0" class="brand-context-block">
            <p class="panel-meta">Topics in rotation</p>
            <div class="saved-source-list">
              <span
                v-for="topic in brandContextTopics"
                :key="topic"
                class="saved-source-chip"
              >
                {{ topic }}
              </span>
            </div>
          </div>

          <div v-if="brandContextPatterns.length > 0" class="brand-context-block brand-context-patterns">
            <p class="panel-meta">Messaging patterns</p>
            <ul class="brand-pattern-list">
              <li v-for="pattern in brandContextPatterns" :key="pattern">{{ pattern }}</li>
            </ul>
          </div>

          <div v-if="brandContextNarrativeFlow.length > 0" class="brand-context-block">
            <p class="panel-meta">Narrative flow</p>
            <div class="saved-source-list">
              <span
                v-for="beat in brandContextNarrativeFlow"
                :key="beat"
                class="saved-source-chip"
              >
                {{ beat }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="shouldShowAdvancedComposerControls && showSuggestionPanel" class="suggestion-launch-panel">
        <div class="suggestion-launch-header">
          <div class="suggestion-launch-copy">
            <p class="panel-meta">Generate for me</p>
            <h2>Pick the next best post without starting from scratch</h2>
            <p class="activation-helper">
              These suggestions are built from recent workspace posts, stronger winners, and the same shared content engine.
            </p>
          </div>
          <button
            v-if="recommendedGenerationSuggestion"
            type="button"
            class="primary-action suggestion-generate-button"
            :disabled="isLoading"
            @click="void runSuggestedGeneration(recommendedGenerationSuggestion)"
          >
            {{ isLoading ? "Generating..." : "Generate for me" }}
          </button>
        </div>

        <p v-if="generationSuggestionError" class="activation-feedback error">
          {{ generationSuggestionError }}
        </p>
        <p v-else-if="isLoadingGenerationSuggestions" class="activation-feedback">
          Loading suggestion candidates...
        </p>
        <p v-else-if="generationSuggestions.length === 0" class="activation-feedback">
          No strong history-based suggestions yet. Publish or save a few posts and this panel will start proposing the next move automatically.
        </p>

        <div v-else class="generation-suggestion-grid">
          <article
            v-for="suggestion in generationSuggestions"
            :key="suggestion.id"
            class="generation-suggestion-card"
          >
            <div class="generation-suggestion-topline">
              <span class="activation-chip">
                {{ suggestion.recommended ? "Recommended" : "Suggested" }}
              </span>
              <span class="saved-source-chip">
                {{ getRepurposeStrategyOption(suggestion.strategy).shortLabel }}
              </span>
              <span v-if="suggestion.performanceLabel" class="saved-source-chip">
                {{ suggestion.performanceLabel }} signal
              </span>
            </div>
            <strong>{{ suggestion.title }}</strong>
            <p>{{ suggestion.description }}</p>
            <p class="activation-helper">{{ suggestion.rationale }}</p>
            <p class="generation-suggestion-preview">
              {{ suggestion.previewText }}
            </p>
            <button
              type="button"
              class="secondary-action"
              :disabled="isLoading"
              @click="void runSuggestedGeneration(suggestion)"
            >
              Generate this
            </button>
          </article>
        </div>
      </div>
    </section>

    <section class="activation-panel">
      <div v-if="isEditMode" class="editor-mode-panel">
        <div class="strategy-panel-copy">
          <p class="panel-meta">Editor mode</p>
          <h3>Edit first. Use AI only when you ask.</h3>
          <p class="activation-helper">
            Manual edits stay in control. Save changes returns you to the draft, AI preview suggests a revision without overwriting, and regenerate is a deliberate reset.
          </p>
        </div>
        <div class="saved-source-list">
          <span class="saved-source-chip">Same draft</span>
          <span class="saved-source-chip">No silent regeneration</span>
          <span class="saved-source-chip">AI assist is preview-first</span>
        </div>
      </div>

      <div
        v-if="!improvementSourceId && !isBusinessWorkspace && shouldShowAdvancedComposerControls"
        class="source-mode-row create-mode-row"
      >
        <button
          type="button"
          class="tone-chip"
          :class="{ active: sourceMode === 'fresh' }"
          @click="setSourceMode('fresh')"
        >
          Write from scratch
        </button>
        <button
          type="button"
          class="tone-chip"
          :class="{ active: sourceMode === 'feed' }"
          @click="setSourceMode('feed')"
        >
          Repurpose from content
        </button>
      </div>

      <div v-if="!improvementSourceId" class="strategy-panel">
        <div class="strategy-panel-copy">
          <p class="panel-meta">Intent</p>
          <h3>{{ intentPanelTitle }}</h3>
          <p class="activation-helper">
            {{ intentHelperCopy }}
          </p>
        </div>
        <div class="strategy-selector">
          <button
            v-for="option in activeIntentOptions"
            :key="option.value"
            type="button"
            class="tone-chip"
            :class="{ active: activeGenerationIntent === option.value }"
            :disabled="option.disabled"
            @click="selectGenerationIntent(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div
        v-if="!improvementSourceId && !isBusinessWorkspace && shouldShowAdvancedComposerControls"
        class="strategy-panel"
      >
        <div class="strategy-panel-copy">
          <p class="panel-meta">Format</p>
          <h3>Choose what you want to create</h3>
          <p class="activation-helper">
            {{ creatorContentTypeSelection.description }}
          </p>
        </div>
        <div class="strategy-selector">
          <button
            v-for="option in creatorContentTypeOptions"
            :key="option.value"
            type="button"
            class="tone-chip"
            :class="{ active: creatorContentType === option.value }"
            @click="selectCreatorContentType(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div
        v-if="!improvementSourceId && !isBusinessWorkspace && shouldShowAdvancedComposerControls"
        class="strategy-panel"
      >
        <div class="strategy-panel-copy">
          <p class="panel-meta">Visual style</p>
          <h3>Choose how this should look</h3>
          <p class="activation-helper">
            {{ creatorVisualStyleSelection.description }}
          </p>
        </div>
        <div class="strategy-selector">
          <button
            v-for="option in creatorVisualStyleOptions"
            :key="option.value"
            type="button"
            class="tone-chip"
            :class="{ active: creatorVisualStyle === option.value }"
            @click="creatorVisualStyle = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div class="activation-panel-header">
        <div class="activation-panel-copy">
          <p class="panel-meta">{{ inputPanelMeta }}</p>
          <h2>{{ sourceInputLabel }}</h2>
        </div>
        <div
          v-if="!isEditMode && (shouldShowAdvancedComposerControls || isBusinessWorkspace)"
          class="tone-selector"
        >
          <template v-if="isBusinessWorkspace">
            <button
              v-for="option in businessToneOptions"
              :key="option.value"
              type="button"
              class="tone-chip"
              :class="{ active: businessTone === option.value }"
              @click="businessTone = option.value"
            >
              {{ option.label }}
            </button>
          </template>
          <template v-else>
            <button
              v-for="option in toneOptions"
              :key="option.value"
              type="button"
              class="tone-chip"
              :class="{ active: tone === option.value }"
              @click="hasToneOverride = true; tone = option.value"
            >
              {{ option.label }}
            </button>
          </template>
        </div>
      </div>

      <div
        v-if="!isEditMode && isBusinessWorkspace && shouldShowAdvancedComposerControls"
        class="strategy-panel"
      >
        <div class="strategy-panel-copy">
          <p class="panel-meta">Campaign setup</p>
          <h3>Give the engine the local context</h3>
          <p class="activation-helper">
            Location and offer sharpen the visual direction, CTA, and channel copy automatically.
          </p>
        </div>
        <div class="source-grid business-campaign-grid">
          <label>
            <span>Location</span>
            <input
              v-model="businessLocation"
              type="text"
              placeholder="Texas, Dallas, Chicago, etc."
            />
          </label>
          <label>
            <span>Offer or CTA angle</span>
            <input
              v-model="businessOffer"
              type="text"
              placeholder="Claim your daycare listing"
            />
          </label>
        </div>
        <p class="activation-helper business-campaign-save-note">{{ businessCampaignSetupHelper }}</p>

        <div class="saved-sources-panel inline-saved-sources-panel">
          <div class="saved-sources-header">
            <div>
              <p class="panel-meta">Delivery channels</p>
              <h3>{{ isSingleBusinessChannelFlow ? "Choose where this post should be ready to publish" : "Choose where this pack should be ready to publish" }}</h3>
              <p class="activation-helper">Select one channel for a single post or multiple channels for a campaign pack.</p>
            </div>
          </div>
          <div class="saved-source-list">
            <button
              v-for="option in businessChannelOptions"
              :key="option.value"
              type="button"
              class="tone-chip"
              :class="{ active: businessChannels.includes(option.value) }"
              @click="toggleBusinessChannel(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>

      <div v-if="canPreserveInputText" class="writing-mode-panel">
        <div class="strategy-panel-copy">
          <p class="panel-meta">Writing mode</p>
          <h3>{{ preserveInputText ? "Keep this post exactly as written" : "Let AI shape the draft" }}</h3>
          <p class="activation-helper">
            {{
              preserveInputText
                ? "Best for polished copy. We keep your wording, line breaks, and structure unchanged."
                : "Best for rough ideas. We rewrite the note into a cleaner post with hooks and variants."
            }}
          </p>
        </div>
        <div class="writing-mode-actions" role="group" aria-label="Writing mode">
          <button
            type="button"
            class="writing-mode-card"
            :data-active="!preserveInputText"
            @click="preserveInputText = false"
          >
            <strong>Shape with AI</strong>
            <span>Rewrite and improve the idea.</span>
          </button>
          <button
            type="button"
            class="writing-mode-card"
            :data-active="preserveInputText"
            @click="preserveInputText = true"
          >
            <strong>Do not touch my text</strong>
            <span>Use the post as-is.</span>
          </button>
        </div>
      </div>

      <div v-if="isStrategyFlow && shouldShowAdvancedComposerControls" class="strategy-panel">
        <div class="strategy-panel-copy">
          <p class="panel-meta">Next move</p>
          <h3>Pick how this follow-up should evolve</h3>
          <p class="activation-helper">
            {{ activeStrategyOption.summary }}
          </p>
        </div>
        <div class="strategy-selector">
          <button
            v-for="option in REPURPOSE_STRATEGY_OPTIONS"
            :key="option.value"
            type="button"
            class="tone-chip"
            :class="{ active: generationStrategy === option.value }"
            @click="pendingAutoGenerate = false; generationStrategy = option.value"
          >
            {{ option.shortLabel }}
          </button>
        </div>
      </div>

      <div
        v-if="shouldShowAdvancedComposerControls && !improvementSourceId && (hasSavedSources || isLoadingSavedSources)"
        class="saved-sources-panel"
      >
        <div class="saved-sources-header">
          <div>
            <p class="panel-meta">Brand sources</p>
            <h3>Saved sources are reused automatically</h3>
          </div>
          <span v-if="isLoadingSavedSources" class="activation-chip">Loading sources...</span>
        </div>

        <div v-if="hasSavedSources" class="saved-source-list">
          <span
            v-for="source in savedSources"
            :key="source.id"
            class="saved-source-chip"
          >
            {{ source.title || source.label }}
          </span>
        </div>

        <p class="activation-helper">
          {{
            sourceMode === "fresh"
              ? "Fresh generation automatically blends these saved sources with your idea and brand context."
              : "Repurpose starts from the workspace source defaults below, then layers these saved sources and brand context on top."
          }}
        </p>
      </div>

      <textarea
        v-model="input"
        class="activation-textarea"
        :placeholder="sourceInputPlaceholder"
      />

      <div v-if="isEditMode" class="editor-ai-panel">
        <div class="strategy-panel-copy">
          <p class="panel-meta">AI assist</p>
          <h3>Preview an improvement before applying it</h3>
          <p class="activation-helper">
            Describe one specific change. AI suggests a revision, then you decide whether to apply it or keep editing manually.
          </p>
        </div>

        <input
          v-model="editorAiInstruction"
          type="text"
          class="editor-ai-input"
          placeholder="Example: tighten the hook, shorten this, sound more authoritative"
        />

        <div class="activation-actions editor-inline-actions">
          <button
            type="button"
            class="secondary-action"
            :disabled="isPreviewingEditorAi || isSavingEdit || isLoading"
            @click="void previewEditorAiEdit()"
          >
            {{ isPreviewingEditorAi ? "Previewing..." : "Improve with AI" }}
          </button>
          <button
            type="button"
            class="secondary-action"
            :disabled="isLoading || isSavingEdit"
            @click="void generatePost()"
          >
            {{ submitLabel }}
          </button>
        </div>

        <div v-if="editorAiPreview" class="preview-card">
          <div class="preview-section">
            <p class="panel-meta">AI suggestion</p>
            <strong>{{ editorAiPreview.summary }}</strong>
            <p class="activation-helper">{{ editorAiPreview.scopeHint }}</p>
          </div>

          <label class="preview-section">
            <span>Suggested revision</span>
            <textarea
              :value="editorAiPreview.suggestedText"
              class="activation-textarea preview-textarea"
              readonly
            />
          </label>

          <div class="activation-actions editor-inline-actions">
            <button
              type="button"
              class="primary-action"
              @click="applyEditorAiSuggestion"
            >
              Apply suggestion
            </button>
            <button
              type="button"
              class="secondary-action"
              @click="editorAiPreview = null"
            >
              Keep current draft
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="!improvementSourceId && !isBusinessWorkspace && sourceMode === 'feed' && shouldShowAdvancedComposerControls"
        id="repurpose-panel"
        class="feed-ingest-panel"
      >
        <p class="activation-helper">
          Use public page, post, or article URLs. Workspace source defaults are prefilled from settings, and private feeds or login-only pages still will not ingest.
        </p>
        <div
          v-if="hasWorkspaceSourceDefaults"
          class="saved-sources-panel inline-saved-sources-panel"
        >
          <div class="saved-sources-header">
            <div>
              <p class="panel-meta">Workspace source defaults</p>
              <h3>These public listings were loaded from settings</h3>
            </div>
            <router-link class="secondary-action inline-link" :to="appRoutes.settingsPreferences">
              Manage defaults
            </router-link>
          </div>

          <div class="saved-source-list">
            <span
              v-for="source in workspaceDefaultSources"
              :key="`${source.label}-${source.url}`"
              class="saved-source-chip"
            >
              {{ source.label }}
            </span>
          </div>

          <p class="activation-helper">
            Repurpose preloads these workspace listings automatically. Adjust the URLs below only when you want a temporary override or a fresh preview.
          </p>
        </div>
        <div class="source-grid">
          <label>
            <span>LinkedIn URL</span>
            <input
              v-model="linkedinSourceUrl"
              type="url"
              placeholder="https://www.linkedin.com/company/your-company/"
            />
          </label>
          <label>
            <span>Instagram URL</span>
            <input
              v-model="instagramSourceUrl"
              type="url"
              placeholder="https://www.instagram.com/yourbrand/"
            />
          </label>
          <label>
            <span>Facebook URL</span>
            <input
              v-model="facebookSourceUrl"
              type="url"
              placeholder="https://www.facebook.com/yourbrand/"
            />
          </label>
          <label>
            <span>Blog or website URL</span>
            <input
              v-model="blogSourceUrl"
              type="url"
              placeholder="https://example.com/blog/or-homepage"
            />
          </label>
        </div>

        <div class="activation-actions">
          <button
            type="button"
            class="secondary-action"
            :disabled="isPreviewingFeed || !hasFeedSources"
            @click="previewFeedSources"
          >
            {{ isPreviewingFeed ? "Previewing..." : "Preview sources" }}
          </button>
        </div>

        <div v-if="ingestedSourceItems.length > 0 || ingestionErrors.length > 0" class="preview-card">
          <div v-if="ingestedSourceItems.length > 0" class="preview-section">
            <p class="panel-meta">Source preview</p>
            <ul class="preview-source-list">
              <li
                v-for="item in ingestedSourceItems"
                :key="`${item.label}-${item.metadata?.finalUrl ?? item.metadata?.url ?? item.label}`"
              >
                <strong>{{ item.label }}</strong>
                <span v-if="item.title"> · {{ item.title }}</span>
              </li>
            </ul>
          </div>

          <label v-if="ingestedSourceItems.length > 0" class="preview-section">
            <span>Editable ingest text</span>
            <textarea
              v-model="feedPreviewText"
              class="activation-textarea preview-textarea"
              placeholder="Previewed source text will appear here."
            />
          </label>

          <div v-if="ingestionErrors.length > 0" class="preview-section">
            <p class="panel-meta">Skipped sources</p>
            <ul class="preview-source-list warning">
              <li v-for="message in ingestionErrors" :key="message">{{ message }}</li>
            </ul>
          </div>
        </div>
      </div>

      <div v-else-if="!isEditMode" class="activation-helper-row">
        <p class="activation-helper">{{ helperMessage }}</p>
        <VoiceRecorder
          title="Speak the idea instead"
          hint="Record one thought, review the transcript, then generate."
          @transcribed="handleVoiceTranscript"
        />
      </div>

      <div v-if="sourceMode === 'fresh' && !improvementSourceId && !isBusinessWorkspace" class="example-row">
        <button
          v-for="example in exampleIdeas"
          :key="example"
          type="button"
          class="example-chip"
          @click="applyExample(example)"
        >
          {{ example }}
        </button>
      </div>

      <p v-if="errorMessage" class="activation-feedback error">{{ errorMessage }}</p>
      <p v-else-if="editorFeedback" class="activation-feedback">
        {{ editorFeedback }}
      </p>
      <p v-else-if="!isBusinessWorkspace && sourceMode === 'feed' && !improvementSourceId" class="activation-feedback">
        {{
          isFeedPreviewReady
            ? "Preview ready. Generation will use the reviewed source text plus your workspace brand context."
            : hasFeedSources
              ? "Preview the public sources before generating."
              : "Add at least one public source URL, or switch back to Start fresh."
        }}
      </p>

      <div v-if="isLoading" class="generation-status-panel">
        <div class="generation-status-header">
          <div class="generation-status-copy">
            <p class="panel-meta">Generation in progress</p>
            <h3>{{ generationStatusHeadline }}</h3>
            <p class="activation-helper">
              {{ generationStatusDescription }}
            </p>
          </div>
          <span class="activation-chip generation-status-timer">{{ generationElapsedLabel }}</span>
        </div>

        <div class="generation-status-context">
          <span
            v-for="chip in generationStatusContextChips"
            :key="chip"
            class="saved-source-chip"
          >
            {{ chip }}
          </span>
        </div>

        <ol class="generation-status-list">
          <li
            v-for="(step, index) in generationStatusSteps"
            :key="step.id"
            class="generation-status-step"
            :data-state="index < activeGenerationStepIndex ? 'complete' : index === activeGenerationStepIndex ? 'active' : 'pending'"
          >
            <span class="generation-status-marker">
              {{ index < activeGenerationStepIndex ? "✓" : index + 1 }}
            </span>
            <div class="generation-status-step-copy">
              <strong>{{ step.label }}</strong>
              <p>{{ step.detail }}</p>
            </div>
          </li>
        </ol>

        <details class="generation-status-details">
          <summary>What’s happening</summary>
          <ul class="generation-status-note-list">
            <li
              v-for="note in generationStatusWhatHappeningNotes"
              :key="note"
            >
              {{ note }}
            </li>
          </ul>
        </details>
      </div>

      <div class="activation-actions">
        <button
          v-if="isEditMode"
          type="button"
          class="primary-action"
          :disabled="isSavingEdit || isLoading || !input.trim()"
          @click="void saveEditedDraft()"
        >
          {{ saveEditLabel }}
        </button>
        <button
          v-else
          type="button"
          class="primary-action"
          :disabled="isLoading || (!isBusinessWorkspace && !improvementSourceId && sourceMode === 'feed' && (!isFeedPreviewReady || isPreviewingFeed))"
          @click="void generatePost()"
        >
          {{ submitLabel }}
        </button>
        <router-link
          v-if="isEditMode"
          class="secondary-action"
          :to="{ path: appRoutes.appResult, query: { id: editingStoredDraft?.id || editingPersistedAssetId || improvementSourceId } }"
        >
          Back to draft
        </router-link>
        <router-link class="secondary-action" :to="appRoutes.dashboard">
          Go to dashboard later
        </router-link>
      </div>
    </section>
  </main>
</template>

<style scoped>
.activation-shell {
  width: min(100%, 960px);
  margin: 0 auto;
  padding: 48px 20px 80px;
}

.activation-hero {
  margin-bottom: 24px;
}

.activation-eyebrow,
.panel-meta {
  margin: 0 0 10px;
  color: var(--fc-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.activation-hero h1,
.activation-panel h2 {
  margin: 0;
  line-height: 1.02;
}

.activation-hero h1 {
  font-size: clamp(2.3rem, 5vw, 4rem);
}

.activation-description {
  max-width: 760px;
  margin: 16px 0 0;
  color: var(--fc-text-muted);
  font-size: 1rem;
  line-height: 1.75;
}

.activation-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.composer-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 18px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 88%, var(--fc-accent) 12%);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-surface-subtle) 80%, var(--fc-surface));
}

.composer-toggle-row .activation-helper {
  margin: 0;
}

.channel-context-panel {
  display: grid;
  gap: 18px;
  margin-top: 18px;
  padding: 18px 20px;
  border: 1px solid var(--fc-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--fc-surface-subtle) 84%, var(--fc-surface));
}

.channel-context-panel.connected {
  border-color: color-mix(in srgb, var(--fc-accent) 32%, var(--fc-border));
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--fc-surface) 92%, var(--fc-accent) 8%) 0%,
    color-mix(in srgb, var(--fc-surface-subtle) 88%, var(--fc-accent) 12%) 100%
  );
}

.brand-context-panel {
  display: grid;
  gap: 16px;
  margin-top: 18px;
  padding: 18px 20px;
  border: 1px solid var(--fc-border);
  border-radius: 22px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-subtle));
}

.suggestion-launch-panel {
  display: grid;
  gap: 16px;
  margin-top: 18px;
  padding: 20px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  border-radius: 24px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--fc-surface) 92%, var(--fc-accent) 8%) 0%,
    color-mix(in srgb, var(--fc-surface-subtle) 88%, var(--fc-accent) 12%) 100%
  );
}

.suggestion-launch-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.suggestion-launch-copy {
  display: grid;
  gap: 8px;
}

.suggestion-launch-copy h2 {
  margin: 0;
  font-size: clamp(1.1rem, 2.2vw, 1.45rem);
  line-height: 1.1;
}

.suggestion-generate-button {
  flex: 0 0 auto;
}

.generation-suggestion-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.generation-suggestion-card {
  display: grid;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: color-mix(in srgb, var(--fc-surface) 92%, white 8%);
}

.generation-suggestion-card strong {
  font-size: 1rem;
  line-height: 1.35;
}

.generation-suggestion-card p {
  margin: 0;
}

.generation-suggestion-topline {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.generation-suggestion-preview {
  color: var(--fc-text-muted);
  font-size: 0.92rem;
  line-height: 1.6;
}

.brand-context-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.brand-context-header h2 {
  margin: 0;
  font-size: clamp(1.1rem, 2.2vw, 1.45rem);
  line-height: 1.1;
}

.brand-context-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.brand-context-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.brand-context-block {
  display: grid;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-surface) 88%, white 12%);
}

.brand-context-patterns {
  grid-column: 1 / -1;
}

.brand-pattern-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.channel-context-copy {
  display: grid;
  gap: 8px;
}

.channel-context-platforms {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.channel-platform-card {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 84%, white 16%);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-surface) 92%, white 8%);
}

.channel-platform-card[data-connected="true"] {
  border-color: color-mix(in srgb, var(--fc-success-text) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg) 42%, var(--fc-panel-bg));
}

.channel-platform-card-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.channel-platform-card p {
  margin: 0;
  color: var(--fc-text-muted);
  font-size: 0.92rem;
  line-height: 1.5;
}

.channel-platform-state {
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

.channel-platform-state[data-connected="true"] {
  border-color: color-mix(in srgb, var(--fc-success-text) 16%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg) 82%, var(--fc-panel-bg));
  color: var(--fc-success-text);
}

.channel-context-copy h2 {
  margin: 0;
  font-size: clamp(1.1rem, 2.2vw, 1.45rem);
  line-height: 1.1;
}

.channel-context-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.channel-context-chip {
  background: var(--fc-surface);
}

.activation-chip,
.example-chip,
.tone-chip {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--fc-border);
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.activation-panel {
  padding: clamp(22px, 3vw, 34px);
  border: 1px solid var(--fc-border);
  border-radius: 28px;
  background: linear-gradient(180deg, var(--fc-surface) 0%, var(--fc-surface-subtle) 100%);
  box-shadow: var(--fc-card-shadow);
}

.activation-panel-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px 20px;
  align-items: flex-start;
}

.tone-selector,
.source-mode-row,
.example-row,
.activation-helper-row,
.activation-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.tone-chip {
  cursor: pointer;
}

.tone-chip.active {
  border-color: transparent;
  background: var(--fc-accent);
  color: var(--fc-accent-contrast);
}

.activation-textarea {
  width: 100%;
  min-height: 180px;
  margin-top: 20px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
  line-height: 1.7;
  resize: vertical;
}

.editor-ai-input {
  width: 100%;
  min-height: 52px;
  padding: 0 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.source-mode-row {
  margin-top: 18px;
}

.create-mode-row {
  margin-top: 0;
}

.activation-panel-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.tone-selector {
  justify-content: flex-end;
  align-self: start;
}

.saved-sources-panel {
  display: grid;
  gap: 12px;
  margin-top: 16px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: color-mix(in srgb, var(--fc-surface-subtle) 82%, var(--fc-surface));
}

.strategy-panel {
  display: grid;
  gap: 14px;
  margin-top: 16px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 16%, var(--fc-border));
  border-radius: 20px;
  background: color-mix(in srgb, var(--fc-accent) 6%, var(--fc-surface));
}

.writing-mode-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 0.8fr);
  gap: 16px;
  align-items: center;
  margin-top: 18px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--fc-info-text) 18%, var(--fc-border));
  border-radius: 20px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--fc-info-bg) 48%, var(--fc-surface)) 0%, var(--fc-surface) 100%);
}

.writing-mode-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.writing-mode-card {
  display: grid;
  gap: 6px;
  min-height: 92px;
  padding: 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
  color: var(--fc-text);
  text-align: left;
  cursor: pointer;
}

.writing-mode-card[data-active="true"] {
  border-color: color-mix(in srgb, var(--fc-info-text) 34%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-info-bg) 62%, var(--fc-surface));
}

.writing-mode-card strong {
  font-size: 0.96rem;
}

.writing-mode-card span {
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  line-height: 1.45;
}

.editor-mode-panel,
.editor-ai-panel {
  display: grid;
  gap: 14px;
  margin-top: 16px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  border-radius: 20px;
  background: color-mix(in srgb, var(--fc-surface-subtle) 84%, var(--fc-surface));
}

.strategy-panel-copy {
  display: grid;
  gap: 6px;
}

.strategy-panel-copy h3 {
  margin: 0;
  font-size: 1rem;
}

.strategy-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.saved-sources-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.saved-sources-header h3 {
  margin: 0;
  font-size: 1rem;
}

.saved-source-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.saved-source-chip {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font-size: 0.86rem;
  font-weight: 700;
}

.feed-ingest-panel {
  display: grid;
  gap: 16px;
  margin-top: 16px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: var(--fc-surface-subtle);
}

.source-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.source-grid label {
  display: grid;
  gap: 8px;
}

.source-grid span {
  font-size: 0.9rem;
  font-weight: 700;
}

.source-grid input {
  width: 100%;
  min-height: 50px;
  padding: 0 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-surface);
  color: var(--fc-text);
  font: inherit;
}

.preview-card {
  display: grid;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 20px;
  background: var(--fc-surface);
}

.preview-section {
  display: grid;
  gap: 10px;
}

.preview-source-list {
  margin: 0;
  padding-left: 20px;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.preview-source-list.warning {
  color: var(--fc-danger-text, #a63d32);
}

.preview-textarea {
  min-height: 220px;
  margin-top: 0;
}

.activation-helper-row {
  justify-content: space-between;
  align-items: flex-start;
  margin-top: 16px;
}

.activation-helper {
  flex: 1 1 320px;
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.example-row {
  margin-top: 18px;
}

.example-chip {
  cursor: pointer;
  text-align: left;
}

.activation-feedback {
  margin: 18px 0 0;
  font-weight: 700;
}

.activation-feedback.error {
  color: var(--fc-danger-text, #a63d32);
}

.generation-status-panel {
  display: grid;
  gap: 16px;
  margin-top: 18px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--fc-accent) 18%, var(--fc-border));
  border-radius: 22px;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--fc-surface) 94%, var(--fc-accent) 6%) 0%,
    color-mix(in srgb, var(--fc-surface-subtle) 88%, var(--fc-accent) 12%) 100%
  );
}

.generation-status-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.generation-status-copy {
  display: grid;
  gap: 8px;
}

.generation-status-copy h3 {
  margin: 0;
  font-size: clamp(1.05rem, 2vw, 1.25rem);
  line-height: 1.12;
}

.generation-status-timer {
  flex: 0 0 auto;
  background: var(--fc-surface);
}

.generation-status-context {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.generation-status-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.generation-status-step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: start;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-surface) 92%, white 8%);
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
}

.generation-status-step[data-state="active"] {
  border-color: color-mix(in srgb, var(--fc-accent) 30%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent) 10%, var(--fc-surface));
  transform: translateY(-1px);
}

.generation-status-step[data-state="complete"] {
  border-color: color-mix(in srgb, var(--fc-success-text) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg) 48%, var(--fc-surface));
}

.generation-status-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.84rem;
  font-weight: 800;
}

.generation-status-step[data-state="active"] .generation-status-marker {
  background: var(--fc-accent);
  color: var(--fc-accent-contrast);
}

.generation-status-step[data-state="complete"] .generation-status-marker {
  background: color-mix(in srgb, var(--fc-success-bg) 88%, var(--fc-panel-bg));
  color: var(--fc-success-text);
}

.generation-status-step-copy {
  display: grid;
  gap: 4px;
}

.generation-status-step-copy strong {
  line-height: 1.3;
}

.generation-status-step-copy p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.generation-status-details {
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-surface) 88%, white 12%);
}

.generation-status-details summary {
  cursor: pointer;
  padding: 14px 16px;
  font-weight: 800;
  list-style: none;
}

.generation-status-details summary::-webkit-details-marker {
  display: none;
}

.generation-status-note-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0 18px 18px 34px;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.activation-actions {
  align-items: center;
  margin-top: 24px;
}

.editor-inline-actions {
  margin-top: 0;
}

.primary-action,
.secondary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 50px;
  padding: 0 20px;
  border-radius: 999px;
  text-decoration: none;
  font-weight: 800;
}

.primary-action {
  border: none;
  background: linear-gradient(135deg, var(--fc-accent) 0%, var(--fc-accent-dark) 100%);
  box-shadow: var(--fc-accent-shadow);
  color: var(--fc-accent-contrast);
  cursor: pointer;
}

.primary-action:disabled {
  cursor: wait;
  opacity: 0.7;
}

.secondary-action {
  border: 1px solid var(--fc-border);
  color: var(--fc-text);
}

.inline-link {
  text-decoration: none;
}

@media (max-width: 720px) {
  .channel-context-panel,
  .brand-context-header,
  .suggestion-launch-header,
  .activation-helper-row,
  .generation-status-header {
    flex-direction: column;
  }

  .activation-panel-header {
    grid-template-columns: 1fr;
  }

  .tone-selector {
    justify-content: flex-start;
  }

  .brand-context-actions,
  .channel-context-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .saved-sources-header {
    flex-direction: column;
    align-items: stretch;
  }

  .generation-suggestion-grid,
  .writing-mode-panel,
  .writing-mode-actions,
  .brand-context-grid,
  .source-grid {
    grid-template-columns: 1fr;
  }

  .channel-context-platforms {
    grid-template-columns: 1fr;
  }
}
</style>
