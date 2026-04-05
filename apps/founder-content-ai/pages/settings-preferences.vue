<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  AiAssistLevel,
  AuthIdentityProvider,
  BrandKit,
  BrandKitAccentStyle,
  BrandKitBackgroundStyle,
  BrandKitBrandPlacement,
  BrandKitTone,
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
import { useAuthContext } from "../auth/auth-context";
import AiAssistPanel from "../components/AiAssistPanel.vue";
import MetaPageSelectionModal from "../components/MetaPageSelectionModal.vue";
import { useAiAssistSuggestions } from "../composables/use-ai-assist";
import { usePreferenceContext } from "../preferences/preference-context";
import {
  requestCreateWorkspaceKnowledgeSource,
  requestBrandProfile,
  requestRefreshWorkspaceKnowledge,
  requestUpdateWorkspaceKnowledgeProfile,
  requestUpdateBrandProfile,
  requestWorkspaceKnowledge,
} from "../services/brand-profile-service";
import {
  requestBrandKit,
  requestUpdateBrandKit,
} from "../services/brand-kit-service";
import {
  requestContentIngestionPreview,
  requestSavedContentSources,
} from "../services/generation-service";
import {
  requestDisconnectSocialAccount,
  requestLinkedInSocialAuthStart,
  requestMetaSocialAuthStart,
  requestSelectSocialAccountIdentity,
  requestSocialAccounts,
} from "../services/publishing-service";
import { appRoutes } from "../utils/routes";
import {
  resolveInstagramIdentity,
  resolvePublishingDescriptor,
} from "../utils/social-platforms";
import { toFriendlySocialAuthMessage } from "../utils/social-auth-errors";

type WorkspaceChannelKey = "linkedin" | "facebook" | "instagram" | "reddit";

interface WorkspaceChannelDefinition {
  key: WorkspaceChannelKey;
  label: string;
  description: string;
  availability: "live" | "coming_soon";
}

type BrandThemePresetKey =
  | "minimal"
  | "bold"
  | "editorial"
  | "high-contrast"
  | "modern-saas";

interface BrandThemePreset {
  key: BrandThemePresetKey;
  label: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundStyle: BrandKitBackgroundStyle;
  tone: BrandKitTone;
  accentStyle: BrandKitAccentStyle;
  brandPlacement: BrandKitBrandPlacement;
}

interface BrandThemePreviewCard {
  key: "quote" | "framework" | "carousel";
  label: string;
  eyebrow: string;
  title: string;
  accent: string;
  body?: string;
  bullets?: string[];
  meta?: string;
}

interface BrandThemeConsistencyCheck {
  key: "contrast" | "accent" | "brand" | "placement";
  label: string;
  tone: "pass" | "warn";
  detail: string;
}

interface PublicVoiceChecklistItem {
  key: "positioning" | "audience" | "tone" | "angles" | "narrative";
  label: string;
  tone: "pass" | "warn";
  detail: string;
}

const FOUNDER_VOICE_STARTER = {
  positioning: "Founder Content AI helps founders turn ideas into consistent, high-quality content without overthinking.",
  audience: "Early-stage founders, indie builders, and developers trying to grow through content but struggling with consistency.",
  tone: "Direct, system-thinking, insight-driven, no fluff, slightly contrarian",
  writingStyle: "Short paragraphs, sharp hooks, practical breakdowns, and clear takeaways.",
  visualStyle: "LinkedIn-first, text-first, editorial minimal, bold contrast, edge-locked branding.",
  contentAngles: [
    "Content systems instead of vague creativity",
    "Founder struggles and execution friction",
    "Build-in-public lessons from shipping product",
    "Product thinking behind feature decisions",
    "Before vs after content transformation",
  ],
  narrativePatterns: [
    "Hook -> insight -> breakdown -> takeaway",
    "Lead with the problem before introducing the system",
    "Prefer direct lessons over generic inspiration",
  ],
} as const;

const { preferences, isSaving, errorMessage, updatePreferences } = usePreferenceContext();
const { bootstrap } = useProductAccessContext();
const auth = useAuthContext();
const route = useRoute();
const router = useRouter();
const accountFullNameInput = ref("");
const isSavingAccount = ref(false);
const isSendingPasswordReset = ref(false);
const accountFeedback = ref("");
const accountError = ref("");

const socialAccounts = ref<SocialAccount[]>([]);
const isLoadingChannels = ref(false);
const isStartingChannelConnect = ref<WorkspaceChannelKey | "">("");
const disconnectingAccountId = ref("");
const selectingIdentityAccountId = ref("");
const isMetaSelectionModalOpen = ref(false);
const pendingMetaSession = ref("");
const pendingMetaPlatform = ref<"facebook" | "instagram">("facebook");
const channelFeedback = ref("");
const channelError = ref("");
const brandProfile = ref<BrandProfile | null>(null);
const brandSignalSummary = ref<BrandSignalSummary | null>(null);
const suggestedCompetitors = ref<BrandCompetitorReference[]>([]);
const selectedCompetitorsInput = ref<BrandCompetitorReference[]>([]);
const workspaceModeInput = ref<"founder" | "business">("founder");
const toneInput = ref("");
const writingStyleInput = ref("");
const visualStyleInput = ref("");
const brandPositioningInput = ref("");
const brandAudienceInput = ref("");
const topicsInput = ref("");
const patternsInput = ref("");
const customCompetitorLabelInput = ref("");
const customCompetitorUrlInput = ref("");
const isLoadingBrandContext = ref(false);
const isSavingBrandContext = ref(false);
const brandContextFeedback = ref("");
const brandContextError = ref("");
const brandTheme = ref<BrandKit | null>(null);
const brandThemePrimaryColorInput = ref("");
const brandThemeSecondaryColorInput = ref("");
const brandThemeBackgroundStyleInput = ref<BrandKitBackgroundStyle>("dark");
const brandThemeToneInput = ref<BrandKitTone>("professional");
const brandThemeAccentStyleInput = ref<BrandKitAccentStyle>("highlight_box");
const brandThemeBrandPlacementInput = ref<BrandKitBrandPlacement>("top_left");
const isLoadingBrandTheme = ref(false);
const isSavingBrandTheme = ref(false);
const brandThemeFeedback = ref("");
const brandThemeError = ref("");
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
    key: "facebook",
    label: "Facebook",
    description: "Connect the workspace Facebook Page. This is the Meta source of truth for Facebook publishing and Instagram derivation.",
    availability: "live",
  },
  {
    key: "instagram",
    label: "Instagram",
    description: "Connect Instagram through the linked Facebook Page. Founder Content derives the Instagram business account from the Page you choose.",
    availability: "live",
  },
  {
    key: "reddit",
    label: "Reddit",
    description: "Prepare for community-first publishing per workspace without mixing accounts across products.",
    availability: "coming_soon",
  },
];

const BRAND_THEME_PRESETS: readonly BrandThemePreset[] = [
  {
    key: "minimal",
    label: "Minimal",
    description: "Quiet, premium, and restrained. Best when the copy should do the heavy lifting.",
    primaryColor: "#111827",
    secondaryColor: "#F8FAFC",
    backgroundStyle: "dark",
    tone: "professional",
    accentStyle: "underline",
    brandPlacement: "top_left",
  },
  {
    key: "bold",
    label: "Bold",
    description: "Sharper contrast and stronger emphasis for founder POV posts that need to hit harder.",
    primaryColor: "#101418",
    secondaryColor: "#F97316",
    backgroundStyle: "dark",
    tone: "bold",
    accentStyle: "highlight_box",
    brandPlacement: "top_left",
  },
  {
    key: "editorial",
    label: "Editorial",
    description: "Clean light surfaces with restrained accents for polished operator content.",
    primaryColor: "#F7F0E6",
    secondaryColor: "#1F2937",
    backgroundStyle: "light",
    tone: "professional",
    accentStyle: "underline",
    brandPlacement: "top_left",
  },
  {
    key: "high-contrast",
    label: "High Contrast",
    description: "Aggressive hierarchy, obvious signature, and a more conversion-focused finish.",
    primaryColor: "#111111",
    secondaryColor: "#FACC15",
    backgroundStyle: "dark",
    tone: "bold",
    accentStyle: "bold",
    brandPlacement: "bottom_right",
  },
  {
    key: "modern-saas",
    label: "Modern SaaS",
    description: "Controlled gradient energy with enough structure to still feel product-led.",
    primaryColor: "#0F172A",
    secondaryColor: "#14B8A6",
    backgroundStyle: "gradient",
    tone: "professional",
    accentStyle: "highlight_box",
    brandPlacement: "side_label",
  },
] as const;

const currentUserFullName = computed(
  () =>
    auth.currentUser.value?.fullName?.trim() ||
    auth.authSession.value?.displayName?.trim() ||
    "",
);
const currentUserEmail = computed(
  () =>
    auth.currentUser.value?.email?.trim() ||
    auth.authSession.value?.email?.trim() ||
    "",
);
const authProviders = computed<readonly AuthIdentityProvider[]>(
  () => auth.appSession.value?.authProviders ?? [],
);
const hasPasswordProvider = computed(() => authProviders.value.includes("firebase_password"));
const canSaveAccountName = computed(
  () =>
    !auth.isUsingStub.value &&
    accountFullNameInput.value.trim().length > 0 &&
    accountFullNameInput.value.trim() !== currentUserFullName.value,
);
const canSendPasswordReset = computed(
  () => !auth.isUsingStub.value && hasPasswordProvider.value && currentUserEmail.value !== "",
);
const passwordResetHelpText = computed(() => {
  if (auth.isUsingStub.value) {
    return "Password reset is disabled while development stub auth is active.";
  }

  if (hasPasswordProvider.value) {
    return "Email yourself a reset link for this account and choose a new password securely.";
  }

  if (authProviders.value.includes("google")) {
    return "This account signs in with Google, so there is no separate Founder Content password to reset.";
  }

  return "Password reset is only available for email and password accounts.";
});

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

async function saveAccountName(): Promise<void> {
  const normalizedName = accountFullNameInput.value.trim();

  if (!normalizedName) {
    accountError.value = "Your name is required.";
    accountFeedback.value = "";
    return;
  }

  if (auth.isUsingStub.value) {
    accountError.value = "Account profile editing is disabled while stub auth is active.";
    accountFeedback.value = "";
    return;
  }

  if (normalizedName === currentUserFullName.value) {
    accountFeedback.value = "Your account name is already up to date.";
    accountError.value = "";
    return;
  }

  isSavingAccount.value = true;
  accountError.value = "";
  accountFeedback.value = "";

  try {
    await auth.updateDisplayName(normalizedName);
    accountFeedback.value = "Your account name was updated.";
  } catch (error) {
    accountError.value = error instanceof Error ? error.message : "Unable to update your account name.";
  } finally {
    isSavingAccount.value = false;
  }
}

async function sendPasswordResetLink(): Promise<void> {
  if (!currentUserEmail.value) {
    accountError.value = "This account does not have a usable email address.";
    accountFeedback.value = "";
    return;
  }

  if (!canSendPasswordReset.value) {
    accountError.value = passwordResetHelpText.value;
    accountFeedback.value = "";
    return;
  }

  isSendingPasswordReset.value = true;
  accountError.value = "";
  accountFeedback.value = "";

  try {
    await auth.requestPasswordReset(currentUserEmail.value);
    accountFeedback.value = `Password reset link sent to ${currentUserEmail.value}.`;
  } catch (error) {
    accountError.value = error instanceof Error ? error.message : "Unable to send the password reset email.";
  } finally {
    isSendingPasswordReset.value = false;
  }
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

  const unlimitedGenerations = bootstrap.value?.access?.unlimitedGenerations ?? false;

  return [
    {
      label: "Generations today",
      remainingLabel: unlimitedGenerations
        ? "Unlimited override active"
        : `${usageLimits.value.generationDailyRemaining} left`,
      detail: unlimitedGenerations
        ? `${usageLimits.value.generationDailyUsed} generations tracked today`
        : `${usageLimits.value.generationDailyUsed} used of ${usageLimits.value.generationDailyLimit} today`,
    },
    {
      label: "Generations this month",
      remainingLabel: unlimitedGenerations
        ? "Unlimited override active"
        :
        usageLimits.value.generationMonthlyRemaining === null
          ? "Custom workspace cap"
          : `${usageLimits.value.generationMonthlyRemaining} left`,
      detail: unlimitedGenerations
        ? `${usageLimits.value.generationMonthlyUsed} generations tracked this month`
        :
        usageLimits.value.generationMonthlyLimit === null
          ? `${usageLimits.value.generationMonthlyUsed} used this month`
          : `${usageLimits.value.generationMonthlyUsed} used of ${usageLimits.value.generationMonthlyLimit} this month`,
    },
    {
      label: "Emails",
      remainingLabel: `${usageLimits.value.emailsRemaining} left`,
      detail: `${usageLimits.value.emailsUsed} used of ${usageLimits.value.emailsLimit} total today`,
    },
    {
      label: "Outreach",
      remainingLabel: `${usageLimits.value.outreachRemaining} left`,
      detail: `${usageLimits.value.outreachUsed} used of ${usageLimits.value.outreachLimit} total today`,
    },
  ];
});
const isReadOnly = computed(() => bootstrap.value?.access?.readOnly ?? false);
const workspaceChannels = computed(() =>
  workspaceChannelDefinitions.map((definition) => {
    const account =
      definition.key === "linkedin"
        ? socialAccounts.value.find((candidate) => candidate.platform === "linkedin") ?? null
        : definition.key === "facebook"
          ? socialAccounts.value.find((candidate) => candidate.platform === "facebook") ?? null
          : definition.key === "instagram"
            ? socialAccounts.value.find((candidate) =>
              candidate.platform === "facebook"
              && candidate.availableIdentities.some((identity) => identity.platform === "instagram"),
            ) ?? null
            : null;
    const selectedIdentity =
      definition.key === "linkedin"
        ? account?.selectedIdentity
        : definition.key === "facebook"
          ? (
            account?.availableIdentities.find((identity) =>
              identity.platform === "facebook" && identity.id === account.selectedIdentity?.id,
            ) ?? account?.availableIdentities.find((identity) => identity.platform === "facebook")
          )
          : definition.key === "instagram"
            ? resolveInstagramIdentity(account)
            : undefined;
    const identityOptions =
      definition.key === "linkedin"
        ? account?.availableIdentities ?? []
        : definition.key === "facebook"
          ? account?.availableIdentities.filter((identity) => identity.platform === "facebook") ?? []
          : [];
    const connectedLabel =
      definition.key === "linkedin" || definition.key === "facebook" || definition.key === "instagram"
        ? resolvePublishingDescriptor(definition.key, account)
        : undefined;
    const status =
      definition.availability === "coming_soon"
        ? "coming_soon"
        : definition.key === "instagram"
          ? (account && selectedIdentity ? account.status : "not_connected")
          : account?.status ?? "not_connected";

    return {
      ...definition,
      account,
      selectedIdentity,
      identityOptions,
      connectedLabel,
      status,
    };
  }),
);
const hasBrandProfile = computed(() => {
  const profile = brandProfile.value;
  const hasPositioning = brandPositioningInput.value.trim() !== "";
  const hasAudience = brandAudienceInput.value.trim() !== "";

  return Boolean(
    hasPositioning
      || hasAudience
      || (
        profile &&
          (
            profile.tone ||
            profile.writingStyle ||
            profile.visualStyle ||
            profile.topics.length > 0 ||
            profile.patterns.length > 0
          )
      ),
  );
});
const brandContextChips = computed(() =>
  [
    workspaceModeInput.value === "business" ? "Mode: business growth" : "Mode: creator",
    toneInput.value ? `Tone: ${toneInput.value}` : "",
    writingStyleInput.value ? `Style: ${writingStyleInput.value}` : "",
    visualStyleInput.value ? `Visuals: ${visualStyleInput.value}` : "",
  ].filter((value) => value !== ""),
);
const publicVoiceChecklist = computed<PublicVoiceChecklistItem[]>(() => {
  const angles = parseList(topicsInput.value);
  const patterns = parseList(patternsInput.value);

  return [
    {
      key: "positioning",
      label: "Positioning",
      tone: brandPositioningInput.value.trim() !== "" ? "pass" : "warn",
      detail:
        brandPositioningInput.value.trim() !== ""
          ? "The workspace has a clear public promise."
          : "Add one sentence that explains the problem you solve and the outcome you create.",
    },
    {
      key: "audience",
      label: "Audience",
      tone: brandAudienceInput.value.trim() !== "" ? "pass" : "warn",
      detail:
        brandAudienceInput.value.trim() !== ""
          ? "The system knows who this workspace is talking to."
          : "Define the specific people this workspace wants to reach in public.",
    },
    {
      key: "tone",
      label: "Tone",
      tone: toneInput.value.trim() !== "" && writingStyleInput.value.trim() !== "" ? "pass" : "warn",
      detail:
        toneInput.value.trim() !== "" && writingStyleInput.value.trim() !== ""
          ? "Voice and writing style are both locked."
          : "Add a clear tone and a practical writing style so outputs stop drifting.",
    },
    {
      key: "angles",
      label: "Content angles",
      tone: angles.length >= 3 ? "pass" : "warn",
      detail:
        angles.length >= 3
          ? `${angles.length} repeatable angles are ready for generation.`
          : "Add at least 3 repeatable content angles so the workspace has a real engine.",
    },
    {
      key: "narrative",
      label: "Narrative system",
      tone: patterns.length > 0 ? "pass" : "warn",
      detail:
        patterns.length > 0
          ? "Default narrative guidance is set for create and repurpose."
          : "Save at least one narrative pattern, such as hook -> insight -> breakdown -> takeaway.",
    },
  ];
});
const brandContextTopicPreview = computed(() => {
  const parsed = parseList(topicsInput.value);
  return parsed.length > 0 ? parsed : (brandProfile.value?.topics ?? []);
});
const brandContextPatternPreview = computed(() => {
  const parsed = parseList(patternsInput.value);
  return parsed.length > 0 ? parsed : (brandProfile.value?.patterns ?? []);
});
const brandThemeChips = computed(() =>
  [
    `Background: ${formatBrandThemeBackgroundStyle(brandThemeBackgroundStyleInput.value)}`,
    `Accent: ${formatBrandThemeAccentStyle(brandThemeAccentStyleInput.value)}`,
    `Placement: ${formatBrandThemePlacement(brandThemeBrandPlacementInput.value)}`,
    `Tone: ${formatBrandThemeTone(brandThemeToneInput.value)}`,
  ].filter((value) => value !== ""),
);
const effectiveMarketReferencePreview = computed(() =>
  selectedCompetitorsInput.value.length > 0
    ? selectedCompetitorsInput.value
    : suggestedCompetitors.value.slice(0, 3),
);
const brandThemeDomainPreview = computed(() =>
  resolveBrandSourceDefaultUrl("website") || "",
);
const brandThemeSignatureLabel = computed(() =>
  brandThemeDomainPreview.value || "yourbrand.com",
);
const brandThemePreviewStyles = computed<Record<string, string>>(() => {
  const primaryColor = normalizeHexColor(brandThemePrimaryColorInput.value) || "#111827";
  const secondaryColor = normalizeHexColor(brandThemeSecondaryColorInput.value) || "#F8FAFC";
  const background =
    brandThemeBackgroundStyleInput.value === "gradient"
      ? `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`
      : brandThemeBackgroundStyleInput.value === "light"
        ? "#FFF8F1"
        : primaryColor;

  return {
    background,
    color: brandThemeBackgroundStyleInput.value === "light" ? "#161616" : "#FFF8F1",
    "--brand-theme-primary": primaryColor,
    "--brand-theme-secondary": secondaryColor,
  };
});
const activeBrandThemePresetKey = computed<BrandThemePresetKey | null>(() => {
  const primaryColor = normalizeHexColor(brandThemePrimaryColorInput.value);
  const secondaryColor = normalizeHexColor(brandThemeSecondaryColorInput.value);
  const match = BRAND_THEME_PRESETS.find((preset) =>
    primaryColor === preset.primaryColor
    && secondaryColor === preset.secondaryColor
    && brandThemeBackgroundStyleInput.value === preset.backgroundStyle
    && brandThemeToneInput.value === preset.tone
    && brandThemeAccentStyleInput.value === preset.accentStyle
    && brandThemeBrandPlacementInput.value === preset.brandPlacement,
  );

  return match?.key ?? null;
});
const brandThemePreviewCards = computed<BrandThemePreviewCard[]>(() => [
  {
    key: "quote",
    label: "Quote card",
    eyebrow: "QUOTE CARD",
    title: "Content creation",
    accent: "shouldn't feel like guesswork",
    body: "Lead with the strongest thought and let the brand stay quietly recognizable.",
  },
  {
    key: "framework",
    label: "Framework card",
    eyebrow: "FRAMEWORK CARD",
    title: "What happens next",
    accent: "make the system recognizable",
    bullets: [
      "Lock the brand to one edge",
      "Keep spacing predictable",
      "Reuse the same accent logic",
    ],
  },
  {
    key: "carousel",
    label: "Carousel slide",
    eyebrow: "CAROUSEL SLIDE",
    title: "One idea",
    accent: "one signature system",
    body: "Slide 1 should feel obviously related to slide 5 even when the content changes.",
    meta: "1 / 5",
  },
]);
const brandThemeConsistencyChecks = computed<BrandThemeConsistencyCheck[]>(() => {
  const primaryColor = normalizeHexColor(brandThemePrimaryColorInput.value) || "#111827";
  const secondaryColor = normalizeHexColor(brandThemeSecondaryColorInput.value) || "#F8FAFC";
  const previewBackground =
    brandThemeBackgroundStyleInput.value === "light" ? "#FFF8F1" : primaryColor;
  const previewText = brandThemeBackgroundStyleInput.value === "light" ? "#161616" : "#FFF8F1";
  const contrastRatioValue = calculateContrastRatio(previewBackground, previewText);
  const accentDistance = calculateColorDistance(primaryColor, secondaryColor);
  const hasConnectedBrandSurface = brandThemeDomainPreview.value.trim() !== "";
  const placementLabel = formatBrandThemePlacement(brandThemeBrandPlacementInput.value);

  return [
    {
      key: "contrast",
      label: "Contrast",
      tone: contrastRatioValue >= 4.5 ? "pass" : "warn",
      detail:
        contrastRatioValue >= 4.5
          ? "Text remains readable across locked preview formats."
          : "Primary and text color are too close. Increase separation before saving.",
    },
    {
      key: "accent",
      label: "Accent separation",
      tone: accentDistance >= 90 ? "pass" : "warn",
      detail:
        accentDistance >= 90
          ? "Highlight treatment is distinct enough to stay visible without overpowering the layout."
          : "Primary and accent colors are too similar. The highlight treatment may disappear in feeds.",
    },
    {
      key: "brand",
      label: "Brand surface",
      tone: hasConnectedBrandSurface ? "pass" : "warn",
      detail: hasConnectedBrandSurface
        ? `Signature will resolve to ${brandThemeSignatureLabel.value}.`
        : "Connect a website in Brand Sources so previews stop falling back to a placeholder domain.",
    },
    {
      key: "placement",
      label: "Placement",
      tone: "pass",
      detail: `${placementLabel} stays locked to the edge across quote, framework, and carousel formats.`,
    },
  ];
});
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

function normalizeHexColor(value: string): string {
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : "";
}

function parseHexColorChannels(value: string): [number, number, number] | null {
  const normalized = normalizeHexColor(value);

  if (!normalized) {
    return null;
  }

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function normalizeChannelForLuminance(value: number): number {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function calculateRelativeLuminance(value: string): number {
  const channels = parseHexColorChannels(value);

  if (!channels) {
    return 0;
  }

  const [red, green, blue] = channels.map((channel) => normalizeChannelForLuminance(channel));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function calculateContrastRatio(left: string, right: string): number {
  const leftLuminance = calculateRelativeLuminance(left);
  const rightLuminance = calculateRelativeLuminance(right);
  const brightest = Math.max(leftLuminance, rightLuminance);
  const darkest = Math.min(leftLuminance, rightLuminance);

  return (brightest + 0.05) / (darkest + 0.05);
}

function calculateColorDistance(left: string, right: string): number {
  const leftChannels = parseHexColorChannels(left);
  const rightChannels = parseHexColorChannels(right);

  if (!leftChannels || !rightChannels) {
    return 0;
  }

  return Math.sqrt(
    ((leftChannels[0] - rightChannels[0]) ** 2)
    + ((leftChannels[1] - rightChannels[1]) ** 2)
    + ((leftChannels[2] - rightChannels[2]) ** 2),
  );
}

function formatBrandThemeBackgroundStyle(value: BrandKitBackgroundStyle): string {
  if (value === "light") {
    return "Light";
  }

  if (value === "gradient") {
    return "Gradient";
  }

  return "Dark";
}

function formatBrandThemeAccentStyle(value: BrandKitAccentStyle): string {
  if (value === "underline") {
    return "Underline";
  }

  if (value === "bold") {
    return "Bold emphasis";
  }

  return "Highlight box";
}

function formatBrandThemePlacement(value: BrandKitBrandPlacement): string {
  if (value === "bottom_right") {
    return "Bottom right";
  }

  if (value === "side_label") {
    return "Side label";
  }

  return "Top left";
}

function formatBrandThemeTone(value: BrandKitTone): string {
  if (value === "bold") {
    return "Bold";
  }

  if (value === "friendly") {
    return "Friendly";
  }

  return "Professional";
}

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
  workspaceModeInput.value = profile?.workspaceMode ?? "founder";
  toneInput.value = profile?.tone ?? "";
  writingStyleInput.value = profile?.writingStyle ?? "";
  visualStyleInput.value = profile?.visualStyle ?? "";
  topicsInput.value = joinList(profile?.topics ?? []);
  patternsInput.value = joinList(profile?.patterns ?? []);
}

function hydratePublicVoiceForm(profile: WorkspaceKnowledgeProfile | null | undefined): void {
  brandAudienceInput.value = profile?.audienceSummary ?? "";
  brandPositioningInput.value = profile?.positioningSummary ?? "";
}

function hydrateBrandThemeForm(nextBrandKit: BrandKit | null): void {
  brandTheme.value = nextBrandKit;
  brandThemePrimaryColorInput.value = nextBrandKit?.primaryColor ?? "#111827";
  brandThemeSecondaryColorInput.value = nextBrandKit?.secondaryColor ?? "#F8FAFC";
  brandThemeBackgroundStyleInput.value = nextBrandKit?.backgroundStyle ?? "dark";
  brandThemeToneInput.value = nextBrandKit?.tone ?? "professional";
  brandThemeAccentStyleInput.value = nextBrandKit?.accentStyle ?? "highlight_box";
  brandThemeBrandPlacementInput.value = nextBrandKit?.brandPlacement ?? "top_left";
}

function applyBrandThemePreset(key: BrandThemePresetKey): void {
  const preset = BRAND_THEME_PRESETS.find((candidate) => candidate.key === key);

  if (!preset) {
    return;
  }

  brandThemePrimaryColorInput.value = preset.primaryColor;
  brandThemeSecondaryColorInput.value = preset.secondaryColor;
  brandThemeBackgroundStyleInput.value = preset.backgroundStyle;
  brandThemeToneInput.value = preset.tone;
  brandThemeAccentStyleInput.value = preset.accentStyle;
  brandThemeBrandPlacementInput.value = preset.brandPlacement;
  brandThemeFeedback.value = "";
  brandThemeError.value = "";
}

function applyFounderVoiceStarter(): void {
  workspaceModeInput.value = "founder";
  toneInput.value = FOUNDER_VOICE_STARTER.tone;
  writingStyleInput.value = FOUNDER_VOICE_STARTER.writingStyle;
  visualStyleInput.value = FOUNDER_VOICE_STARTER.visualStyle;
  brandPositioningInput.value = FOUNDER_VOICE_STARTER.positioning;
  brandAudienceInput.value = FOUNDER_VOICE_STARTER.audience;
  topicsInput.value = joinList([...FOUNDER_VOICE_STARTER.contentAngles]);
  patternsInput.value = joinList([...FOUNDER_VOICE_STARTER.narrativePatterns]);
  brandContextFeedback.value = "";
  brandContextError.value = "";
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
      workspaceMode: workspaceModeInput.value,
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
    const [brandResponse, knowledgeResponse] = await Promise.all([
      requestUpdateBrandProfile({
        businessId,
        workspaceMode: workspaceModeInput.value,
        tone: toneInput.value.trim(),
        writingStyle: writingStyleInput.value.trim(),
        visualStyle: visualStyleInput.value.trim(),
        topics: parseList(topicsInput.value),
        patterns: parseList(patternsInput.value),
        selectedCompetitors: selectedCompetitorsInput.value,
        refreshFromSignals: false,
      }),
      requestUpdateWorkspaceKnowledgeProfile({
        businessId,
        audienceSummary: brandAudienceInput.value.trim(),
        positioningSummary: brandPositioningInput.value.trim(),
      }),
    ]);
    brandProfile.value = brandResponse.brandProfile;
    brandSignalSummary.value = brandResponse.signalSummary;
    hydrateBrandContextForm(brandResponse.brandProfile);
    hydrateCompetitorState(brandResponse.brandProfile, brandResponse.suggestedCompetitors);
    workspaceKnowledgeProfile.value = knowledgeResponse.profile ?? null;
    workspaceKnowledgeSources.value = knowledgeResponse.sources;
    hydratePublicVoiceForm(knowledgeResponse.profile);
    brandContextFeedback.value = "Public voice saved for this workspace.";
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

async function loadBrandTheme(): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    hydrateBrandThemeForm(null);
    return;
  }

  isLoadingBrandTheme.value = true;
  brandThemeError.value = "";

  try {
    const response = await requestBrandKit(businessId);
    hydrateBrandThemeForm(response.brandKit);
  } catch (error) {
    hydrateBrandThemeForm(null);
    brandThemeError.value =
      error instanceof Error ? error.message : "Unable to load the workspace brand theme.";
  } finally {
    isLoadingBrandTheme.value = false;
  }
}

async function handleBrandThemeSave(): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    return;
  }

  const primaryColor = normalizeHexColor(brandThemePrimaryColorInput.value);
  const secondaryColor = normalizeHexColor(brandThemeSecondaryColorInput.value);

  if (!primaryColor || !secondaryColor) {
    brandThemeError.value = "Use full hex colors like #111827 and #F8FAFC.";
    brandThemeFeedback.value = "";
    return;
  }

  isSavingBrandTheme.value = true;
  brandThemeFeedback.value = "";
  brandThemeError.value = "";

  try {
    const response = await requestUpdateBrandKit({
      businessId,
      brandKit: {
        primaryColor,
        secondaryColor,
        backgroundStyle: brandThemeBackgroundStyleInput.value,
        tone: brandThemeToneInput.value,
        accentStyle: brandThemeAccentStyleInput.value,
        brandPlacement: brandThemeBrandPlacementInput.value,
      },
    });
    hydrateBrandThemeForm(response.brandKit);
    brandThemeFeedback.value = "Brand theme saved. New visuals will reuse this system automatically.";
  } catch (error) {
    brandThemeError.value =
      error instanceof Error ? error.message : "Unable to save the workspace brand theme.";
  } finally {
    isSavingBrandTheme.value = false;
  }
}

async function loadWorkspaceKnowledge(): Promise<void> {
  const businessId = activeBusinessId.value;

  if (!businessId) {
    workspaceKnowledgeProfile.value = null;
    workspaceKnowledgeSources.value = [];
    hydratePublicVoiceForm(null);
    return;
  }

  isLoadingWorkspaceKnowledge.value = true;
  workspaceKnowledgeError.value = "";

  try {
    const response = await requestWorkspaceKnowledge(businessId);
    workspaceKnowledgeProfile.value = response.profile ?? null;
    workspaceKnowledgeSources.value = response.sources;
    hydratePublicVoiceForm(response.profile);
  } catch (error) {
    workspaceKnowledgeProfile.value = null;
    workspaceKnowledgeSources.value = [];
    hydratePublicVoiceForm(null);
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
    hydratePublicVoiceForm(response.profile);
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
    hydratePublicVoiceForm(response.profile);
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

  if (!businessId || platform === "reddit") {
    return;
  }

  isStartingChannelConnect.value = platform;
  channelError.value = "";

  try {
    if (platform === "linkedin") {
      const response = await requestLinkedInSocialAuthStart({
        businessId,
        returnPath: route.fullPath,
      });
      window.location.href = response.authorizationUrl;
      return;
    }

    pendingMetaPlatform.value = platform === "instagram" ? "instagram" : "facebook";
    const response = await requestMetaSocialAuthStart({
      businessId,
      platform: pendingMetaPlatform.value,
      returnPath: route.fullPath,
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
  platform: Extract<WorkspaceChannelKey, "linkedin" | "facebook">,
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
    channelFeedback.value =
      platform === "facebook"
        ? "Facebook publishing target updated for this workspace."
        : "LinkedIn publishing target updated for this workspace.";
    await loadWorkspaceChannels();
  } catch (error) {
    channelError.value =
      error instanceof Error
        ? error.message
        : platform === "facebook"
          ? "Unable to update the Facebook publishing target."
          : "Unable to update the LinkedIn publishing target.";
  } finally {
    selectingIdentityAccountId.value = "";
  }
}

function closeMetaSelectionModal(): void {
  isMetaSelectionModalOpen.value = false;
  pendingMetaSession.value = "";
  isStartingChannelConnect.value = "";
}

async function handleMetaConnected(): Promise<void> {
  closeMetaSelectionModal();
  channelError.value = "";
  channelFeedback.value =
    pendingMetaPlatform.value === "facebook"
      ? "Facebook connected for this workspace."
      : "Instagram connected for this workspace.";
  await loadWorkspaceChannels();
}

function handleMetaSelectionError(message: string): void {
  channelError.value = message;
  isStartingChannelConnect.value = "";
}

watch(
  activeBusinessId,
  () => {
    channelFeedback.value = "";
    brandThemeFeedback.value = "";
    brandContextFeedback.value = "";
    brandSourcesFeedback.value = "";
    workspaceKnowledgeFeedback.value = "";
    void loadWorkspaceChannels();
    void loadBrandTheme();
    void loadBrandContext();
    void loadBrandSources();
    void loadWorkspaceKnowledge();
  },
  { immediate: true },
);

watch(
  () => [route.query.linkedin, route.query.meta, route.query.message, route.query.session, route.query.platform],
  async ([linkedInStatus, metaStatus, message, session, platform]) => {
    if (
      typeof linkedInStatus !== "string"
      && typeof metaStatus !== "string"
      && typeof message !== "string"
      && typeof session !== "string"
      && typeof platform !== "string"
    ) {
      return;
    }

    if (platform === "facebook" || platform === "instagram") {
      pendingMetaPlatform.value = platform;
    }

    if (linkedInStatus === "connected") {
      channelFeedback.value = "LinkedIn connected for this workspace.";
      channelError.value = "";
      await loadWorkspaceChannels();
    } else if (linkedInStatus === "error") {
      channelError.value = typeof message === "string" && message.trim() !== ""
        ? toFriendlySocialAuthMessage(message, "linkedin")
        : toFriendlySocialAuthMessage(undefined, "linkedin");
    }

    if (metaStatus === "connected") {
      channelFeedback.value =
        pendingMetaPlatform.value === "facebook"
          ? "Facebook connected for this workspace."
          : "Instagram connected for this workspace.";
      channelError.value = "";
      await loadWorkspaceChannels();
    } else if (metaStatus === "error") {
      channelError.value =
        typeof message === "string" && message.trim() !== ""
          ? toFriendlySocialAuthMessage(message, pendingMetaPlatform.value)
          : toFriendlySocialAuthMessage(undefined, pendingMetaPlatform.value);
    } else if (metaStatus === "select_page" && typeof session === "string" && session.trim() !== "") {
      pendingMetaSession.value = session.trim();
      isMetaSelectionModalOpen.value = true;
    }

    const nextQuery = { ...route.query };
    delete nextQuery.linkedin;
    delete nextQuery.meta;
    delete nextQuery.message;
    delete nextQuery.session;
    delete nextQuery.platform;
    void router.replace({ query: nextQuery });
    isStartingChannelConnect.value = "";
  },
  { immediate: true },
);

watch(
  currentUserFullName,
  (nextValue) => {
    accountFullNameInput.value = nextValue;
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

    <section class="dashboard-panel account-panel">
      <div class="account-panel-header">
        <div>
          <p class="panel-meta">Account</p>
          <h2>Update your name and security settings.</h2>
          <p class="dashboard-description">
            Keep your profile current and send yourself a reset link when you want to rotate your password.
          </p>
        </div>
        <span class="channel-status-badge" :class="{ connected: hasPasswordProvider }">
          {{ hasPasswordProvider ? "Password account" : "External sign-in" }}
        </span>
      </div>

      <p v-if="accountError" class="dashboard-feedback error">{{ accountError }}</p>
      <p v-else-if="accountFeedback" class="dashboard-feedback account-feedback">{{ accountFeedback }}</p>

      <div class="account-grid">
        <article class="account-card">
          <label class="dashboard-field">
            <span>Full name</span>
            <input
              v-model="accountFullNameInput"
              type="text"
              autocomplete="name"
              placeholder="Your name"
              :disabled="auth.isUsingStub.value || isSavingAccount"
            />
          </label>

          <label class="dashboard-field">
            <span>Email</span>
            <input :value="currentUserEmail" type="email" readonly disabled />
          </label>

          <div class="account-action-row">
            <button
              type="button"
              class="dashboard-button"
              :disabled="!canSaveAccountName || isSavingAccount"
              @click="void saveAccountName()"
            >
              {{ isSavingAccount ? "Saving..." : "Save account name" }}
            </button>
          </div>
        </article>

        <article class="account-card">
          <p class="panel-meta">Password</p>
          <h3>Reset password</h3>
          <p class="dashboard-description">
            {{ passwordResetHelpText }}
          </p>

          <div class="account-action-row">
            <button
              type="button"
              class="dashboard-button secondary"
              :disabled="!canSendPasswordReset || isSendingPasswordReset"
              @click="void sendPasswordResetLink()"
            >
              {{ isSendingPasswordReset ? "Sending link..." : "Email reset link" }}
            </button>
          </div>
        </article>
      </div>
    </section>

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
        Every workspace should keep its own publishing channels. Connect LinkedIn and Meta per workspace so Facebook and Instagram stay tied to the right brand.
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
              <strong>
                {{
                  channel.availability !== "live"
                    ? "Coming soon"
                    : channel.key === "instagram"
                      ? "Derived from Meta connection"
                      : "Workspace connection"
                }}
              </strong>
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
                channel.key === "instagram"
                  ? "Managed through the connected Facebook Page"
                  : channel.account.accountEmail
                  ? channel.account.accountEmail
                  : `Connected ${new Date(channel.account.updatedAt).toLocaleDateString()}`
              }}
            </small>
          </div>

          <label
            v-if="channel.account && channel.identityOptions.length > 0 && channel.key !== 'instagram'"
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
                  channel.key as 'linkedin' | 'facebook',
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
                isStartingChannelConnect === channel.key
                  ? channel.key === "linkedin"
                    ? "Connecting..."
                    : "Opening Meta..."
                  : channel.key === "instagram"
                    ? channel.status === "connected"
                      ? "Refresh Meta setup"
                      : "Connect via Meta"
                    : channel.status === "connected"
                      ? "Reconnect"
                      : "Connect"
              }}
            </button>

            <button
              v-if="channel.account && channel.key !== 'instagram'"
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

      <MetaPageSelectionModal
        :open="isMetaSelectionModalOpen"
        :business-id="activeBusinessId ?? undefined"
        :session="pendingMetaSession"
        :platform="pendingMetaPlatform"
        @close="closeMetaSelectionModal"
        @connected="void handleMetaConnected()"
        @error="handleMetaSelectionError"
      />
    </section>

    <section class="dashboard-panel brand-theme-panel">
      <div class="brand-context-panel-header">
        <div>
          <p class="panel-meta">Brand Theme</p>
          <h2>Lock visuals to one recognizable system instead of a generic template.</h2>
        </div>
        <span class="usage-badge">
          {{ activeBusinessId ? "Applied in visual generation" : "Select a workspace first" }}
        </span>
      </div>

      <p class="dashboard-description">
        This theme controls the repeatable visual rules behind generated images. Logo stays connected through the Asset Hub, and domain stays connected through Brand Sources.
      </p>

      <p v-if="brandThemeFeedback" class="dashboard-feedback">{{ brandThemeFeedback }}</p>
      <p v-if="brandThemeError" class="dashboard-feedback error">{{ brandThemeError }}</p>

      <div class="brand-context-layout">
        <div class="brand-context-form">
          <div class="brand-theme-preset-grid">
            <button
              v-for="preset in BRAND_THEME_PRESETS"
              :key="preset.key"
              type="button"
              class="brand-theme-preset-button"
              :data-active="activeBrandThemePresetKey === preset.key"
              :disabled="isLoadingBrandTheme || isSavingBrandTheme || !activeBusinessId"
              @click="applyBrandThemePreset(preset.key)"
            >
              <span class="brand-theme-preset-title">{{ preset.label }}</span>
              <span class="brand-theme-preset-copy">{{ preset.description }}</span>
            </button>
          </div>

          <div class="settings-grid brand-context-grid">
            <label class="dashboard-field">
              <span>Primary color</span>
              <input
                v-model="brandThemePrimaryColorInput"
                type="text"
                :disabled="isLoadingBrandTheme || isSavingBrandTheme || !activeBusinessId"
                placeholder="#111827"
              />
            </label>

            <label class="dashboard-field">
              <span>Accent color</span>
              <input
                v-model="brandThemeSecondaryColorInput"
                type="text"
                :disabled="isLoadingBrandTheme || isSavingBrandTheme || !activeBusinessId"
                placeholder="#F8FAFC"
              />
            </label>

            <label class="dashboard-field">
              <span>Background style</span>
              <select
                v-model="brandThemeBackgroundStyleInput"
                :disabled="isLoadingBrandTheme || isSavingBrandTheme || !activeBusinessId"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="gradient">Gradient</option>
              </select>
            </label>

            <label class="dashboard-field">
              <span>Tone</span>
              <select
                v-model="brandThemeToneInput"
                :disabled="isLoadingBrandTheme || isSavingBrandTheme || !activeBusinessId"
              >
                <option value="professional">Professional</option>
                <option value="bold">Bold</option>
                <option value="friendly">Friendly</option>
              </select>
            </label>

            <label class="dashboard-field">
              <span>Accent style</span>
              <select
                v-model="brandThemeAccentStyleInput"
                :disabled="isLoadingBrandTheme || isSavingBrandTheme || !activeBusinessId"
              >
                <option value="highlight_box">Highlight box</option>
                <option value="underline">Underline</option>
                <option value="bold">Bold emphasis</option>
              </select>
            </label>

            <label class="dashboard-field">
              <span>Brand placement</span>
              <select
                v-model="brandThemeBrandPlacementInput"
                :disabled="isLoadingBrandTheme || isSavingBrandTheme || !activeBusinessId"
              >
                <option value="top_left">Top left</option>
                <option value="bottom_right">Bottom right</option>
                <option value="side_label">Side label</option>
              </select>
            </label>
          </div>

          <div class="channel-actions">
            <button
              type="button"
              class="dashboard-button"
              :disabled="isSavingBrandTheme || isLoadingBrandTheme || !activeBusinessId || isReadOnly"
              @click="void handleBrandThemeSave()"
            >
              {{ isSavingBrandTheme ? "Saving..." : "Save brand theme" }}
            </button>

            <router-link class="dashboard-button secondary link-button" :to="appRoutes.appAssets">
              Open asset hub
            </router-link>
          </div>
        </div>

        <aside class="brand-context-preview">
          <div>
            <p class="panel-meta">Visual system preview</p>
            <h3>Generated images now inherit this signature automatically.</h3>
            <p class="dashboard-description">
              The renderer keeps the brand off the bottom center, aligns brand padding with content padding, and reuses the same accent treatment every time.
            </p>
          </div>

          <div class="brand-theme-swatches">
            <article class="brand-theme-swatch-card">
              <div class="brand-theme-swatch-chip" :style="{ background: brandThemePrimaryColorInput || '#111827' }"></div>
              <strong>{{ brandThemePrimaryColorInput || "#111827" }}</strong>
              <span>Primary</span>
            </article>
            <article class="brand-theme-swatch-card">
              <div class="brand-theme-swatch-chip" :style="{ background: brandThemeSecondaryColorInput || '#F8FAFC' }"></div>
              <strong>{{ brandThemeSecondaryColorInput || "#F8FAFC" }}</strong>
              <span>Accent</span>
            </article>
          </div>

          <div class="brand-theme-preview-grid">
            <article
              v-for="preview in brandThemePreviewCards"
              :key="preview.key"
              class="brand-theme-preview-shell"
              :data-format="preview.key"
              :style="brandThemePreviewStyles"
            >
              <div class="brand-theme-preview-header">
                <span class="brand-theme-preview-format">{{ preview.label }}</span>
                <span v-if="preview.meta" class="brand-theme-preview-meta">{{ preview.meta }}</span>
              </div>
              <div
                class="brand-theme-preview-brand"
                :class="`placement-${brandThemeBrandPlacementInput}`"
              >
                {{ brandThemeSignatureLabel }}
              </div>
              <p class="brand-theme-preview-eyebrow">{{ preview.eyebrow }}</p>
              <h4>{{ preview.title }}</h4>
              <p
                class="brand-theme-preview-accent"
                :class="`accent-${brandThemeAccentStyleInput}`"
              >
                {{ preview.accent }}
              </p>
              <p v-if="preview.body" class="brand-theme-preview-copy">{{ preview.body }}</p>
              <ul v-if="preview.bullets?.length" class="brand-theme-preview-bullets">
                <li v-for="bullet in preview.bullets" :key="bullet">{{ bullet }}</li>
              </ul>
            </article>
          </div>

          <div v-if="brandThemeChips.length > 0" class="saved-source-list">
            <span
              v-for="chip in brandThemeChips"
              :key="chip"
              class="saved-source-chip"
            >
              {{ chip }}
            </span>
          </div>

          <div class="brand-theme-consistency-panel">
            <p class="panel-meta">Theme health</p>
            <div class="brand-theme-consistency-list">
              <article
                v-for="check in brandThemeConsistencyChecks"
                :key="check.key"
                class="brand-theme-consistency-card"
                :data-tone="check.tone"
              >
                <div class="brand-theme-consistency-header">
                  <strong>{{ check.label }}</strong>
                  <span class="brand-theme-consistency-badge">
                    {{ check.tone === "pass" ? "Pass" : "Review" }}
                  </span>
                </div>
                <p>{{ check.detail }}</p>
              </article>
            </div>
          </div>

          <div class="brand-preview-block">
            <p class="panel-meta">Connected brand surfaces</p>
            <ul class="brand-preview-list">
              <li>
                <strong>Logo:</strong>
                {{ brandTheme?.logoUrl ? "Connected through the Asset Hub." : "Not connected yet. Add it in the Asset Hub." }}
              </li>
              <li>
                <strong>Domain:</strong>
                {{ brandThemeDomainPreview || "Not connected yet. Add a website in Brand Sources." }}
              </li>
            </ul>
          </div>
        </aside>
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
          <section class="brand-context-starter-card">
            <div>
              <p class="panel-meta">Minimal setup</p>
              <h3>Treat this workspace like your public voice system.</h3>
              <p class="dashboard-description">
                Start with one sharp positioning line, a specific audience, 3 to 5 repeatable angles, and one default narrative pattern. That is enough to make generation feel intentional.
              </p>
            </div>
            <div class="channel-actions">
              <button
                type="button"
                class="dashboard-button secondary"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                @click="applyFounderVoiceStarter()"
              >
                Apply founder starter
              </button>
            </div>
          </section>

          <div class="settings-grid brand-context-grid">
            <label class="dashboard-field brand-context-field-wide">
              <span>Public positioning</span>
              <textarea
                v-model="brandPositioningInput"
                rows="3"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                placeholder="Founder Content AI helps founders turn ideas into consistent, high-quality content without overthinking."
              />
            </label>

            <label class="dashboard-field brand-context-field-wide">
              <span>Target audience</span>
              <textarea
                v-model="brandAudienceInput"
                rows="3"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                placeholder="Early-stage founders, indie builders, and developers trying to grow through content but struggling with consistency."
              />
            </label>

            <label class="dashboard-field">
              <span>Workspace mode</span>
              <select
                v-model="workspaceModeInput"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
              >
                <option value="founder">Creator mode</option>
                <option value="business">Business growth mode</option>
              </select>
            </label>

            <label class="dashboard-field">
              <span>Brand tone</span>
              <input
                v-model="toneInput"
                type="text"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                placeholder="Direct, system-thinking, insight-driven, no fluff"
              />
            </label>

            <label class="dashboard-field">
              <span>Writing style</span>
              <input
                v-model="writingStyleInput"
                type="text"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                placeholder="Short paragraphs, sharp hooks, practical breakdowns"
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
              <span>Content angles</span>
              <textarea
                v-model="topicsInput"
                rows="3"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                placeholder="Content systems, founder struggles, build-in-public lessons, product thinking, before vs after transformations"
              />
            </label>

            <label class="dashboard-field brand-context-field-wide">
              <span>Default narrative pattern and messaging cues</span>
              <textarea
                v-model="patternsInput"
                rows="3"
                :disabled="isLoadingBrandContext || isSavingBrandContext || !activeBusinessId"
                placeholder="Hook -> insight -> breakdown -> takeaway"
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

          <div
            v-if="brandPositioningInput || workspaceKnowledgeProfile?.positioningSummary"
            class="brand-preview-block"
          >
            <p class="panel-meta">Positioning</p>
            <p class="market-reference-note">
              {{ brandPositioningInput || workspaceKnowledgeProfile?.positioningSummary }}
            </p>
          </div>

          <div
            v-if="brandAudienceInput || workspaceKnowledgeProfile?.audienceSummary"
            class="brand-preview-block"
          >
            <p class="panel-meta">Audience</p>
            <p class="market-reference-note">
              {{ brandAudienceInput || workspaceKnowledgeProfile?.audienceSummary }}
            </p>
          </div>

          <div class="brand-context-checklist">
            <p class="panel-meta">Ready to post checklist</p>
            <div class="brand-context-checklist-grid">
              <article
                v-for="item in publicVoiceChecklist"
                :key="item.key"
                class="brand-context-checklist-card"
                :data-tone="item.tone"
              >
                <div class="brand-context-checklist-header">
                  <strong>{{ item.label }}</strong>
                  <span class="brand-context-checklist-badge">
                    {{ item.tone === "pass" ? "Ready" : "Needs input" }}
                  </span>
                </div>
                <p>{{ item.detail }}</p>
              </article>
            </div>
          </div>

          <div v-if="brandContextTopicPreview.length > 0" class="brand-preview-block">
            <p class="panel-meta">Angles in rotation</p>
            <div class="saved-source-list">
              <span
                v-for="topic in brandContextTopicPreview"
                :key="topic"
                class="saved-source-chip"
              >
                {{ topic }}
              </span>
            </div>
          </div>

          <div v-if="brandContextPatternPreview.length > 0" class="brand-preview-block">
            <p class="panel-meta">Narrative cues</p>
            <ul class="brand-preview-list">
              <li v-for="pattern in brandContextPatternPreview" :key="pattern">{{ pattern }}</li>
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
          <strong>{{ card.remainingLabel }}</strong>
          <p>{{ card.detail }}</p>
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

.account-panel {
  display: grid;
  gap: 18px;
  margin-top: 18px;
}

.account-panel-header {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.account-panel-header h2,
.account-card h3 {
  margin: 0;
}

.account-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.account-card {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
}

.account-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.account-feedback {
  color: var(--fc-success-text);
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

.brand-theme-panel {
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

.brand-context-starter-card {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
}

.brand-context-starter-card h3 {
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

.brand-context-checklist {
  display: grid;
  gap: 12px;
}

.brand-context-checklist-grid {
  display: grid;
  gap: 10px;
}

.brand-context-checklist-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-panel-bg) 88%, white 12%);
}

.brand-context-checklist-card[data-tone="pass"] {
  border-color: color-mix(in srgb, var(--fc-success-text, #2c6b35) 18%, var(--fc-border));
}

.brand-context-checklist-card[data-tone="warn"] {
  border-color: color-mix(in srgb, var(--fc-warning-text, #8a5200) 18%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-warning-bg, #f8b84e) 18%, var(--fc-panel-bg));
}

.brand-context-checklist-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.brand-context-checklist-header strong {
  font-size: 0.92rem;
}

.brand-context-checklist-badge {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.brand-context-checklist-card[data-tone="pass"] .brand-context-checklist-badge {
  background: color-mix(in srgb, var(--fc-success-bg, rgba(56, 142, 60, 0.12)) 82%, var(--fc-panel-bg));
  color: var(--fc-success-text, #2c6b35);
}

.brand-context-checklist-card[data-tone="warn"] .brand-context-checklist-badge {
  background: var(--fc-warning-bg, #f8b84e);
  color: var(--fc-warning-text, #8a5200);
}

.brand-context-checklist-card p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.brand-theme-swatches {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.brand-theme-preset-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.brand-theme-preset-button {
  display: grid;
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 86%, var(--fc-surface-muted));
  color: var(--fc-text);
  text-align: left;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}

.brand-theme-preset-button:hover:enabled,
.brand-theme-preset-button:focus-visible {
  border-color: color-mix(in srgb, var(--fc-accent) 28%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft, var(--fc-panel-bg)) 18%, var(--fc-panel-bg));
  transform: translateY(-1px);
}

.brand-theme-preset-button[data-active="true"] {
  border-color: color-mix(in srgb, var(--fc-accent) 34%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent-soft, var(--fc-panel-bg)) 28%, var(--fc-panel-bg));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fc-accent) 18%, transparent);
}

.brand-theme-preset-button:disabled {
  cursor: not-allowed;
  opacity: 0.66;
}

.brand-theme-preset-title {
  font-size: 0.94rem;
  font-weight: 800;
}

.brand-theme-preset-copy {
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  line-height: 1.55;
}

.brand-theme-swatch-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--fc-border);
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-panel-bg) 86%, white 14%);
}

.brand-theme-swatch-card strong {
  font-size: 0.95rem;
}

.brand-theme-swatch-card span {
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  font-weight: 700;
}

.brand-theme-swatch-chip {
  width: 100%;
  height: 42px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--fc-border) 72%, transparent);
}

.brand-theme-preview-shell {
  position: relative;
  display: grid;
  gap: 12px;
  min-height: 260px;
  padding: 24px;
  border-radius: 22px;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--brand-theme-secondary, var(--fc-border)) 22%, transparent);
}

.brand-theme-preview-grid {
  display: grid;
  gap: 14px;
}

.brand-theme-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.brand-theme-preview-format,
.brand-theme-preview-meta {
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.82;
}

.brand-theme-preview-brand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--brand-theme-secondary, #F8FAFC) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand-theme-secondary, #F8FAFC) 36%, transparent);
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.brand-theme-preview-brand.placement-top_left {
  justify-self: start;
}

.brand-theme-preview-brand.placement-bottom_right {
  justify-self: end;
  align-self: end;
  margin-top: auto;
}

.brand-theme-preview-brand.placement-side_label {
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%) rotate(90deg);
  transform-origin: center;
}

.brand-theme-preview-eyebrow {
  margin: 0;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.2em;
  opacity: 0.82;
}

.brand-theme-preview-shell h4 {
  margin: 0;
  max-width: 12ch;
  font-size: clamp(2rem, 4vw, 3.2rem);
  line-height: 0.96;
}

.brand-theme-preview-accent {
  margin: 8px 0 0;
  max-width: fit-content;
  font-size: 1.15rem;
  font-weight: 800;
}

.brand-theme-preview-accent.accent-highlight_box {
  padding: 10px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--brand-theme-secondary, #F8FAFC) 88%, white 12%);
  color: #101826;
}

.brand-theme-preview-accent.accent-underline {
  padding-bottom: 8px;
  border-bottom: 6px solid var(--brand-theme-secondary, #F8FAFC);
}

.brand-theme-preview-accent.accent-bold {
  color: var(--brand-theme-secondary, #F8FAFC);
  font-size: 1.3rem;
  letter-spacing: 0.02em;
}

.brand-theme-preview-copy {
  margin: 0;
  max-width: 28ch;
  line-height: 1.5;
  opacity: 0.92;
}

.brand-theme-preview-bullets {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.brand-theme-preview-bullets li {
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--brand-theme-secondary, #F8FAFC) 18%, transparent);
  border-radius: 14px;
  background: color-mix(in srgb, var(--brand-theme-secondary, #F8FAFC) 9%, transparent);
  line-height: 1.45;
}

.brand-theme-preview-shell[data-format="quote"] {
  justify-content: start;
}

.brand-theme-preview-shell[data-format="quote"] .brand-theme-preview-header {
  order: 2;
  margin-top: auto;
}

.brand-theme-preview-shell[data-format="quote"] .brand-theme-preview-brand.placement-bottom_right {
  margin-top: 0;
}

.brand-theme-preview-shell[data-format="framework"] {
  align-content: start;
}

.brand-theme-preview-shell[data-format="framework"] h4 {
  max-width: 10ch;
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  line-height: 1.02;
}

.brand-theme-preview-shell[data-format="framework"] .brand-theme-preview-accent {
  margin-top: 2px;
  font-size: 1rem;
}

.brand-theme-preview-shell[data-format="framework"] .brand-theme-preview-copy {
  max-width: 24ch;
}

.brand-theme-preview-shell[data-format="carousel"] {
  min-height: 240px;
  padding-right: 56px;
}

.brand-theme-preview-shell[data-format="carousel"]::after {
  content: "";
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 18px;
  height: 4px;
  border-radius: 999px;
  background:
    linear-gradient(
      to right,
      var(--brand-theme-secondary, #F8FAFC) 0%,
      var(--brand-theme-secondary, #F8FAFC) 22%,
      color-mix(in srgb, var(--brand-theme-secondary, #F8FAFC) 20%, transparent) 22%,
      color-mix(in srgb, var(--brand-theme-secondary, #F8FAFC) 20%, transparent) 100%
    );
}

.brand-theme-preview-shell[data-format="carousel"] h4 {
  max-width: 9ch;
  font-size: clamp(1.5rem, 3vw, 2rem);
}

.brand-theme-preview-shell[data-format="carousel"] .brand-theme-preview-copy {
  max-width: 25ch;
}

.brand-theme-consistency-panel {
  display: grid;
  gap: 12px;
}

.brand-theme-consistency-list {
  display: grid;
  gap: 10px;
}

.brand-theme-consistency-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-panel-bg) 88%, white 12%);
}

.brand-theme-consistency-card[data-tone="pass"] {
  border-color: color-mix(in srgb, var(--fc-success-text) 18%, var(--fc-border));
}

.brand-theme-consistency-card[data-tone="warn"] {
  border-color: color-mix(in srgb, var(--fc-warning-text) 22%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-warning-bg) 42%, var(--fc-panel-bg));
}

.brand-theme-consistency-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.brand-theme-consistency-header strong {
  font-size: 0.92rem;
}

.brand-theme-consistency-badge {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--fc-surface-subtle);
  color: var(--fc-text-muted);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.brand-theme-consistency-card[data-tone="pass"] .brand-theme-consistency-badge {
  background: color-mix(in srgb, var(--fc-success-bg) 82%, var(--fc-panel-bg));
  color: var(--fc-success-text);
}

.brand-theme-consistency-card[data-tone="warn"] .brand-theme-consistency-badge {
  background: var(--fc-warning-bg);
  color: var(--fc-warning-text);
}

.brand-theme-consistency-card p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
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
  .account-grid,
  .channel-grid,
  .usage-grid {
    grid-template-columns: 1fr;
  }

  .brand-context-grid,
  .brand-signal-grid,
  .brand-competitor-grid,
  .competitor-suggestion-grid,
  .brand-theme-swatches,
  .brand-theme-preset-grid {
    grid-template-columns: 1fr;
  }
}
</style>
