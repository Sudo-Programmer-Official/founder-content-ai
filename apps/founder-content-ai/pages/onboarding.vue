<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import VoiceRecorder from "../components/VoiceRecorder.vue";
import type {
  BrandTone,
  ContentIngestionItem,
  OnboardingChannel,
  OnboardingGoal,
  OnboardingProfile,
  OnboardingStatusResponse,
  OnboardingUseCase,
  RepurposeSourceUrlInput,
  StructuredContentResponse,
} from "../../../packages/shared-types";
import { trackAnalyticsEvent } from "../services/admin-analytics-service";
import {
  requestCaptureContent,
  requestContentIngestionPreview,
  requestRemixContent,
} from "../services/generation-service";
import {
  requestOnboardingComplete,
  requestOnboardingPreferences,
  requestOnboardingStart,
  requestOnboardingStatus,
  requestOnboardingWorkspace,
} from "../services/onboarding-service";
import { appRoutes } from "../utils/routes";

const router = useRouter();
const totalSteps = 4;
type ActiveOnboardingStep = "intent" | "workspace" | "generate" | "activate";
type GenerationInputMode = "fresh" | "feed";
const generationStatusMessages = [
  "Analyzing your idea...",
  "Crafting viral hooks...",
  "Writing your post...",
];

const useCaseOptions: Array<{ value: OnboardingUseCase; label: string; description: string }> = [
  {
    value: "personal_brand",
    label: "Personal Brand",
    description: "Grow your reputation with founder-led content.",
  },
  {
    value: "business_marketing",
    label: "Business Marketing",
    description: "Keep the company visible without waiting on a content team.",
  },
  {
    value: "agency_clients",
    label: "Agency / Clients",
    description: "Create repeatable content workflows for multiple brands.",
  },
];

const channelOptions: Array<{ value: OnboardingChannel; label: string }> = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "email", label: "Email" },
];

const goalOptions: Array<{ value: OnboardingGoal; label: string }> = [
  { value: "get_clients", label: "Get clients" },
  { value: "build_audience", label: "Build audience" },
  { value: "stay_consistent", label: "Stay consistent" },
  { value: "promote_product_service", label: "Promote product/service" },
];

const toneOptions: Array<{ value: BrandTone; label: string }> = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "bold", label: "Bold" },
];

const industryOptions = [
  "SaaS",
  "AI",
  "Agency",
  "Ecommerce",
  "Consulting",
  "Education",
  "Fintech",
];

const onboarding = ref<OnboardingProfile | null>(null);
const currentStep = ref<ActiveOnboardingStep>("intent");
const isBooting = ref(true);
const errorMessage = ref("");
const actionMessage = ref("");
const generationMessage = ref(generationStatusMessages[0]);
const generatedContent = ref<StructuredContentResponse | null>(null);
const copyFeedback = ref("");
const hasGeneratedDuringFlow = ref(false);
const hasCopiedDuringFlow = ref(false);

const selectedUseCase = ref<OnboardingUseCase>("personal_brand");
const selectedChannels = ref<OnboardingChannel[]>(["linkedin"]);
const selectedGoal = ref<OnboardingGoal>("build_audience");
const preferredTone = ref<BrandTone>("professional");

const workspaceName = ref("");
const workspaceIndustry = ref("SaaS");
const websiteUrl = ref("");
const timezone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

const rawInput = ref("");
const uploadedImageName = ref("");
const uploadedImageDataUrl = ref("");
const voiceTranscriptCaptured = ref(false);
const generationInputMode = ref<GenerationInputMode>("fresh");
const linkedinSourceUrl = ref("");
const instagramSourceUrl = ref("");
const facebookSourceUrl = ref("");
const blogSourceUrl = ref("");
const ingestedSourceItems = ref<ContentIngestionItem[]>([]);
const ingestionErrors = ref<string[]>([]);
const feedPreviewText = ref("");
const isPreviewingFeed = ref(false);
const isFeedPreviewDirty = ref(true);

const selectedConnectedChannel = ref<OnboardingChannel | "skip">("skip");
const selectedScheduleMode = ref<"skip" | "today" | "tomorrow" | "custom">("skip");
const customScheduleDate = ref("");

const isSavingIntent = ref(false);
const isCreatingWorkspace = ref(false);
const isGenerating = ref(false);
const isRemixing = ref(false);
const isCompleting = ref(false);

let generationTimer: number | undefined;

const currentStepNumber = computed(() => {
  if (currentStep.value === "intent") {
    return 1;
  }

  if (currentStep.value === "workspace") {
    return 2;
  }

  if (currentStep.value === "generate") {
    return 3;
  }

  return 4;
});

const progressWidth = computed(() => `${(currentStepNumber.value / totalSteps) * 100}%`);
const businessId = computed(() => onboarding.value?.businessId);
const activationChannelOptions = computed(() => {
  const channels = selectedChannels.value.length > 0 ? selectedChannels.value : defaultChannels();
  return uniqueChannels(channels);
});

const canContinueToActivate = computed(() => generatedContent.value !== null);
const hasFeedSources = computed(
  () =>
    buildFeedSourceUrls().length > 0,
);
const freshInputLabel = computed(() =>
  generationInputMode.value === "feed" ? "What should this post emphasize?" : "Idea, screenshot text, or topic",
);
const freshInputPlaceholder = computed(() =>
  generationInputMode.value === "feed"
    ? "Example: focus on customer trust, founder story, and practical lessons."
    : "Nobody talks about how lonely building a startup can feel.",
);
const isFeedPreviewReady = computed(() => feedPreviewText.value.trim() !== "" && !isFeedPreviewDirty.value);

function uniqueChannels(values: OnboardingChannel[]): OnboardingChannel[] {
  return [...new Set(values)];
}

function defaultChannels(): OnboardingChannel[] {
  return ["linkedin"];
}

function toActiveStep(step: OnboardingProfile["currentStep"]): ActiveOnboardingStep {
  return step === "completed" ? "activate" : step;
}

function startGenerationSequence() {
  generationMessage.value = generationStatusMessages[0];
  let index = 0;

  generationTimer = window.setInterval(() => {
    index = Math.min(index + 1, generationStatusMessages.length - 1);
    generationMessage.value = generationStatusMessages[index];
  }, 900);
}

function stopGenerationSequence() {
  if (generationTimer !== undefined) {
    window.clearInterval(generationTimer);
    generationTimer = undefined;
  }
}

function applyStatus(status: OnboardingStatusResponse) {
  onboarding.value = status.onboarding;
  selectedUseCase.value = status.onboarding.useCase ?? "personal_brand";
  selectedChannels.value = uniqueChannels(
    status.onboarding.targetChannels.length > 0 ? status.onboarding.targetChannels : defaultChannels(),
  );
  selectedGoal.value = status.onboarding.goals[0] ?? "build_audience";
  preferredTone.value =
    status.brandProfile?.preferredTone ?? status.onboarding.preferredTone ?? "professional";
  workspaceName.value = status.business?.name ?? workspaceName.value;
  workspaceIndustry.value = status.brandProfile?.industry ?? workspaceIndustry.value;
  websiteUrl.value = status.business?.websiteUrl ?? websiteUrl.value;
  blogSourceUrl.value = blogSourceUrl.value || status.business?.websiteUrl || "";
  timezone.value = status.business?.timezone ?? timezone.value;

  if (status.onboarding.status === "completed") {
    void router.replace(appRoutes.appGenerate);
    return;
  }

  currentStep.value = toActiveStep(status.onboarding.currentStep);
}

function buildFeedSourceUrls(): RepurposeSourceUrlInput[] {
  return [
    { label: "LinkedIn page or post", url: linkedinSourceUrl.value.trim() },
    { label: "Instagram page or post", url: instagramSourceUrl.value.trim() },
    { label: "Facebook page or post", url: facebookSourceUrl.value.trim() },
    { label: "Blog or website", url: blogSourceUrl.value.trim() },
  ].filter((source) => source.url !== "");
}

function resetFeedPreview(): void {
  feedPreviewText.value = "";
  ingestedSourceItems.value = [];
  ingestionErrors.value = [];
  isFeedPreviewDirty.value = generationInputMode.value === "feed";
}

async function previewFeedSources() {
  if (!businessId.value) {
    errorMessage.value = "Create a workspace before previewing sources.";
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
      businessId: businessId.value,
      contextText: rawInput.value.trim() || undefined,
      sourceUrls,
    });
    ingestedSourceItems.value = response.items;
    ingestionErrors.value = response.errors.map((error) => `${error.label}: ${error.message}`);
    feedPreviewText.value = response.combinedText;
    isFeedPreviewDirty.value = false;
    actionMessage.value = "Source preview ready. Review it before generating.";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to preview content sources right now.";
  } finally {
    isPreviewingFeed.value = false;
  }
}

async function initializeOnboarding() {
  isBooting.value = true;
  errorMessage.value = "";

  try {
    const status = await requestOnboardingStatus();
    applyStatus(status);

    if (status.onboarding.status === "not_started") {
      const started = await requestOnboardingStart({
        entryPoint: "onboarding_page",
      });

      onboarding.value = started.onboarding;
      currentStep.value = "intent";
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? error.message
        : "Unable to initialize onboarding. Authentication is required.";
  } finally {
    isBooting.value = false;
  }
}

async function saveIntent() {
  isSavingIntent.value = true;
  errorMessage.value = "";

  try {
    const response = await requestOnboardingPreferences({
      useCase: selectedUseCase.value,
      targetChannels: uniqueChannels(selectedChannels.value),
      goals: [selectedGoal.value],
      preferredTone: preferredTone.value,
    });

    onboarding.value = response.onboarding;
    currentStep.value = toActiveStep(response.onboarding.currentStep);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to save onboarding preferences.";
  } finally {
    isSavingIntent.value = false;
  }
}

async function createWorkspace() {
  isCreatingWorkspace.value = true;
  errorMessage.value = "";

  try {
    const response = await requestOnboardingWorkspace({
      name: workspaceName.value,
      industry: workspaceIndustry.value,
      tone: preferredTone.value,
      websiteUrl: websiteUrl.value || undefined,
      timezone: timezone.value,
    });

    onboarding.value = response.onboarding;
    blogSourceUrl.value = blogSourceUrl.value || response.business.websiteUrl || "";
    currentStep.value = toActiveStep(response.onboarding.currentStep);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to create your workspace.";
  } finally {
    isCreatingWorkspace.value = false;
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

async function handleImageUpload(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];

  if (!file) {
    uploadedImageName.value = "";
    uploadedImageDataUrl.value = "";
    return;
  }

  uploadedImageName.value = file.name;
  voiceTranscriptCaptured.value = false;

  try {
    uploadedImageDataUrl.value = await readFileAsDataUrl(file);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to process the uploaded image.";
  }
}

function handleVoiceTranscript(text: string) {
  generationInputMode.value = "fresh";
  rawInput.value = text;
  uploadedImageName.value = "";
  uploadedImageDataUrl.value = "";
  voiceTranscriptCaptured.value = true;
  errorMessage.value = "";
  actionMessage.value = "Voice note transcribed. Review it, then generate content.";
}

async function generateFirstContent() {
  if (!businessId.value) {
    errorMessage.value = "Create a workspace before generating content.";
    return;
  }

  isGenerating.value = true;
  errorMessage.value = "";
  actionMessage.value = "";
  copyFeedback.value = "";
  startGenerationSequence();

  try {
    if (generationInputMode.value === "feed") {
      if (!feedPreviewText.value.trim()) {
        errorMessage.value = "Preview your content sources before generating.";
        return;
      }

      if (isFeedPreviewDirty.value) {
        errorMessage.value = "Your source inputs changed. Refresh the preview before generating.";
        return;
      }

      generatedContent.value = await requestRemixContent({
        referenceText: feedPreviewText.value.trim(),
        tone: preferredTone.value,
        businessId: businessId.value,
      });
      actionMessage.value = "Pulled your existing content into a first draft.";
    } else {
      generatedContent.value = await requestCaptureContent({
        text: rawInput.value || undefined,
        image: uploadedImageDataUrl.value || undefined,
        source: voiceTranscriptCaptured.value ? "voice" : uploadedImageDataUrl.value ? "image" : "text",
        tone: preferredTone.value,
        businessId: businessId.value,
      });
      actionMessage.value = "Your first content set is ready.";
    }

    hasGeneratedDuringFlow.value = true;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to generate content right now.";
  } finally {
    stopGenerationSequence();
    isGenerating.value = false;
  }
}

watch(
  [generationInputMode, rawInput, linkedinSourceUrl, instagramSourceUrl, facebookSourceUrl, blogSourceUrl],
  () => {
    if (generationInputMode.value === "feed") {
      isFeedPreviewDirty.value = true;
      generatedContent.value = null;
      actionMessage.value = "";
    }
  },
);

async function remixContent() {
  if (!generatedContent.value || !businessId.value) {
    return;
  }

  isRemixing.value = true;
  errorMessage.value = "";

  try {
    generatedContent.value = await requestRemixContent({
      referenceText: generatedContent.value.post,
      tone: preferredTone.value,
      businessId: businessId.value,
    });
    actionMessage.value = "Remixed with a fresh angle.";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to remix this draft.";
  } finally {
    isRemixing.value = false;
  }
}

async function copyText(value: string, contentType: "hook" | "post") {
  copyFeedback.value = "";

  try {
    await navigator.clipboard.writeText(value);
    hasCopiedDuringFlow.value = true;
    copyFeedback.value = contentType === "post" ? "Post copied." : "Hook copied.";
  } catch (error) {
    copyFeedback.value = error instanceof Error ? error.message : "Unable to copy content.";
    return;
  }

  if (!businessId.value) {
    return;
  }

  try {
    await trackAnalyticsEvent({
      eventType: "output_copied",
      businessId: businessId.value,
      metadata: {
        source: "onboarding",
        contentType,
        preview: value.slice(0, 120),
      },
    });
  } catch {
    // The copy action already succeeded.
  }
}

function continueToActivation() {
  if (!generatedContent.value) {
    errorMessage.value = "Generate your first content before continuing.";
    return;
  }

  currentStep.value = "activate";
}

function resolveScheduledFor(): string | undefined {
  if (selectedScheduleMode.value === "today") {
    return new Date().toISOString();
  }

  if (selectedScheduleMode.value === "tomorrow") {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString();
  }

  if (selectedScheduleMode.value === "custom" && customScheduleDate.value) {
    return new Date(customScheduleDate.value).toISOString();
  }

  return undefined;
}

async function finishOnboarding() {
  if (!businessId.value) {
    errorMessage.value = "Create a workspace before finishing onboarding.";
    return;
  }

  isCompleting.value = true;
  errorMessage.value = "";

  try {
    const response = await requestOnboardingComplete({
      businessId: businessId.value,
      firstContentGenerated: hasGeneratedDuringFlow.value,
      firstContentCopied: hasCopiedDuringFlow.value,
      connectedChannel:
        selectedConnectedChannel.value === "skip" ? undefined : selectedConnectedChannel.value,
      scheduledFor: resolveScheduledFor(),
    });

    onboarding.value = response.onboarding;
    await router.replace(appRoutes.appGenerate);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to complete onboarding.";
  } finally {
    isCompleting.value = false;
  }
}

onMounted(() => {
  void initializeOnboarding();
});

onBeforeUnmount(() => {
  stopGenerationSequence();
});
</script>

<template>
  <main class="onboarding-shell">
    <section class="onboarding-hero">
      <p class="onboarding-eyebrow">/onboarding</p>
      <div class="onboarding-hero-row">
        <div>
          <h1>Get your marketing team in 60 seconds.</h1>
          <p class="onboarding-description">
            Set intent, create a workspace, and generate your first post before you ever land on a
            dashboard.
          </p>
        </div>

        <div class="progress-card">
          <p>Step {{ currentStepNumber }} of {{ totalSteps }}</p>
          <div class="progress-track">
            <span class="progress-fill" :style="{ width: progressWidth }"></span>
          </div>
        </div>
      </div>
    </section>

    <p v-if="isBooting" class="onboarding-feedback">Preparing your onboarding workspace...</p>
    <p v-else-if="errorMessage" class="onboarding-feedback error">{{ errorMessage }}</p>

    <template v-else>
      <section v-if="currentStep === 'intent'" class="onboarding-card onboarding-grid">
        <div class="intent-copy">
          <p class="panel-label">Welcome</p>
          <h2>Create your first post in 30 seconds.</h2>
          <p>
            The goal here is not setup for setup’s sake. It is to understand what you want to grow,
            then move you into the first content win immediately.
          </p>
          <div class="intent-note">
            <strong>Fast defaults</strong>
            <span>LinkedIn is preselected. Professional tone is the default. Everything else can change later.</span>
          </div>
        </div>

        <form class="onboarding-form" @submit.prevent="saveIntent">
          <fieldset>
            <legend>What are you using this for?</legend>
            <div class="choice-grid">
              <button
                v-for="option in useCaseOptions"
                :key="option.value"
                :class="['choice-card', { selected: selectedUseCase === option.value }]"
                type="button"
                @click="selectedUseCase = option.value"
              >
                <strong>{{ option.label }}</strong>
                <span>{{ option.description }}</span>
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend>Where do you want to grow?</legend>
            <div class="chip-row">
              <button
                v-for="channel in channelOptions"
                :key="channel.value"
                :class="['chip-button', { selected: selectedChannels.includes(channel.value) }]"
                type="button"
                @click="
                  selectedChannels = selectedChannels.includes(channel.value)
                    ? selectedChannels.filter((value) => value !== channel.value)
                    : [...selectedChannels, channel.value]
                "
              >
                {{ channel.label }}
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend>What’s your goal?</legend>
            <div class="chip-row">
              <button
                v-for="goal in goalOptions"
                :key="goal.value"
                :class="['chip-button', { selected: selectedGoal === goal.value }]"
                type="button"
                @click="selectedGoal = goal.value"
              >
                {{ goal.label }}
              </button>
            </div>
          </fieldset>

          <fieldset>
            <legend>Tone</legend>
            <div class="chip-row">
              <button
                v-for="tone in toneOptions"
                :key="tone.value"
                :class="['chip-button', { selected: preferredTone === tone.value }]"
                type="button"
                @click="preferredTone = tone.value"
              >
                {{ tone.label }}
              </button>
            </div>
          </fieldset>

          <button class="primary-button" type="submit" :disabled="isSavingIntent">
            {{ isSavingIntent ? "Saving..." : "Continue to workspace" }}
          </button>
        </form>
      </section>

      <section v-else-if="currentStep === 'workspace'" class="onboarding-card">
        <div class="section-header">
          <div>
            <p class="panel-label">Workspace</p>
            <h2>Let’s set up your workspace.</h2>
          </div>
        </div>

        <form class="onboarding-form workspace-grid" @submit.prevent="createWorkspace">
          <label>
            <span>Business name</span>
            <input v-model="workspaceName" type="text" placeholder="Acme AI" />
          </label>

          <label>
            <span>Industry</span>
            <select v-model="workspaceIndustry">
              <option v-for="industry in industryOptions" :key="industry" :value="industry">
                {{ industry }}
              </option>
            </select>
          </label>

          <label>
            <span>Brand website</span>
            <input v-model="websiteUrl" type="url" placeholder="https://example.com" />
          </label>

          <label>
            <span>Timezone</span>
            <input v-model="timezone" type="text" />
          </label>

          <button class="primary-button" type="submit" :disabled="isCreatingWorkspace">
            {{ isCreatingWorkspace ? "Creating..." : "Create workspace" }}
          </button>
        </form>
      </section>

      <section v-else-if="currentStep === 'generate'" class="onboarding-card generate-layout">
        <div class="generate-entry">
          <div class="section-header">
            <div>
              <p class="panel-label">First Value</p>
              <h2>Drop anything and get your first post.</h2>
            </div>
          </div>

          <form class="onboarding-form" @submit.prevent="generateFirstContent">
            <fieldset>
              <legend>How do you want to start?</legend>
              <div class="choice-grid">
                <button
                  :class="['choice-card', { selected: generationInputMode === 'fresh' }]"
                  type="button"
                  @click="generationInputMode = 'fresh'"
                >
                  <strong>Start fresh</strong>
                  <span>Type a new idea, record a thought, or upload a screenshot.</span>
                </button>
                <button
                  :class="['choice-card', { selected: generationInputMode === 'feed' }]"
                  type="button"
                  @click="generationInputMode = 'feed'"
                >
                  <strong>Use existing content</strong>
                  <span>Pull context from your public LinkedIn, Instagram, Facebook, or blog content.</span>
                </button>
              </div>
            </fieldset>

            <label>
              <span>{{ freshInputLabel }}</span>
              <textarea
                v-model="rawInput"
                rows="7"
                :placeholder="freshInputPlaceholder"
              ></textarea>
            </label>

            <template v-if="generationInputMode === 'fresh'">
              <VoiceRecorder
                title="Or speak the idea"
                hint="Use voice if typing slows you down. We will transcribe it and drop it into the input above."
                @transcribed="handleVoiceTranscript"
              />

              <label class="upload-field">
                <span>Optional screenshot upload</span>
                <input type="file" accept="image/*" @change="handleImageUpload" />
                <small v-if="uploadedImageName">{{ uploadedImageName }}</small>
              </label>
            </template>

            <template v-else>
              <div class="source-note">
                Use public page, post, or article URLs. Private feeds and login-only pages will not ingest.
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

              <div class="cta-inline">
                <button
                  class="secondary-button"
                  type="button"
                  :disabled="isPreviewingFeed || !hasFeedSources"
                  @click="previewFeedSources"
                >
                  {{ isPreviewingFeed ? "Previewing..." : "Preview sources" }}
                </button>
                <span class="helper-copy">
                  {{
                    isFeedPreviewReady
                      ? "Preview ready. You can edit the merged source text before generating."
                      : "Preview first so you can inspect what we pulled from your public content."
                  }}
                </span>
              </div>
            </template>

            <div class="cta-inline">
              <button
                class="primary-button"
                type="submit"
                :disabled="
                  isGenerating
                  || isRemixing
                  || (generationInputMode === 'feed' && (!isFeedPreviewReady || isPreviewingFeed))
                "
              >
                {{ isGenerating ? generationMessage : "Generate content" }}
              </button>
              <span class="helper-copy">
                {{
                  generationInputMode === "feed"
                    ? isFeedPreviewReady
                      ? "Generation will use the previewed source text, not refetch the URLs again."
                      : "Add at least one source URL and preview it before generating."
                    : "No blank dashboard. First value comes here."
                }}
              </span>
            </div>
          </form>
        </div>

        <div class="generate-output">
          <p v-if="actionMessage" class="onboarding-feedback">{{ actionMessage }}</p>
          <p v-if="copyFeedback" class="onboarding-feedback">{{ copyFeedback }}</p>

          <template v-if="generatedContent">
            <article class="output-panel">
              <p class="panel-label">Idea</p>
              <h3>{{ generatedContent.idea.title }}</h3>
              <p>{{ generatedContent.idea.angle }}</p>
            </article>

            <article class="output-panel">
              <div class="section-header compact">
                <div>
                  <p class="panel-label">Hooks</p>
                  <h3>Pick an angle</h3>
                </div>
                <button class="secondary-button" type="button" @click="remixContent" :disabled="isRemixing">
                  {{ isRemixing ? "Remixing..." : "Remix" }}
                </button>
              </div>

              <ul class="output-list">
                <li v-for="hook in generatedContent.hooks" :key="hook">
                  <span>{{ hook }}</span>
                  <button class="ghost-button" type="button" @click="copyText(hook, 'hook')">Copy</button>
                </li>
              </ul>
            </article>

            <article class="output-panel">
              <div class="section-header compact">
                <div>
                  <p class="panel-label">Post</p>
                  <h3>Ready to publish</h3>
                </div>
                <button class="secondary-button" type="button" @click="copyText(generatedContent.post, 'post')">
                  Copy post
                </button>
              </div>
              <pre>{{ generatedContent.post }}</pre>
            </article>

            <button class="primary-button" type="button" :disabled="!canContinueToActivate" @click="continueToActivation">
              Continue to activation
            </button>
          </template>

          <template v-else-if="generationInputMode === 'feed' && (isFeedPreviewReady || ingestionErrors.length > 0)">
            <article v-if="ingestedSourceItems.length > 0" class="output-panel">
              <p class="panel-label">Source preview</p>
              <h3>We found content from these sources</h3>
              <ul class="output-list">
                <li v-for="item in ingestedSourceItems" :key="`${item.label}-${item.metadata?.finalUrl ?? item.metadata?.url ?? item.label}`">
                  <span>
                    <strong>{{ item.label }}</strong>
                    <small v-if="item.title"> · {{ item.title }}</small>
                  </span>
                </li>
              </ul>
            </article>

            <article v-if="ingestedSourceItems.length > 0" class="output-panel">
              <p class="panel-label">Editable ingest text</p>
              <h3>Review before generation</h3>
              <textarea v-model="feedPreviewText" rows="10"></textarea>
            </article>

            <article v-if="ingestionErrors.length > 0" class="output-panel">
              <p class="panel-label">Skipped sources</p>
              <h3>These URLs could not be read</h3>
              <ul class="placeholder-panel">
                <li v-for="message in ingestionErrors" :key="message">{{ message }}</li>
              </ul>
            </article>
          </template>

          <article v-else class="placeholder-panel">
            <p class="panel-label">Examples</p>
            <h3>Try one of these:</h3>
            <ul>
              <li>AI is replacing jobs</li>
              <li>Customer objections I hear every week</li>
              <li>Why startup momentum disappears after the first launch</li>
            </ul>
          </article>
        </div>
      </section>

      <section v-else class="onboarding-card activation-grid">
        <article class="activation-panel">
          <p class="panel-label">Optional</p>
          <h2>Choose the next activation step.</h2>
          <p>
            These are lightweight preferences for now. They keep the onboarding fast and give the
            dashboard better context without forcing integrations.
          </p>
        </article>

        <article class="activation-panel">
          <h3>Connect a priority channel</h3>
          <div class="chip-row">
            <button
              v-for="channel in activationChannelOptions"
              :key="channel"
              :class="['chip-button', { selected: selectedConnectedChannel === channel }]"
              type="button"
              @click="selectedConnectedChannel = channel"
            >
              {{ channel }}
            </button>
            <button
              :class="['chip-button', { selected: selectedConnectedChannel === 'skip' }]"
              type="button"
              @click="selectedConnectedChannel = 'skip'"
            >
              Skip for now
            </button>
          </div>
        </article>

        <article class="activation-panel">
          <h3>Schedule your first post</h3>
          <div class="chip-row">
            <button
              :class="['chip-button', { selected: selectedScheduleMode === 'today' }]"
              type="button"
              @click="selectedScheduleMode = 'today'"
            >
              Today
            </button>
            <button
              :class="['chip-button', { selected: selectedScheduleMode === 'tomorrow' }]"
              type="button"
              @click="selectedScheduleMode = 'tomorrow'"
            >
              Tomorrow
            </button>
            <button
              :class="['chip-button', { selected: selectedScheduleMode === 'custom' }]"
              type="button"
              @click="selectedScheduleMode = 'custom'"
            >
              Pick date
            </button>
            <button
              :class="['chip-button', { selected: selectedScheduleMode === 'skip' }]"
              type="button"
              @click="selectedScheduleMode = 'skip'"
            >
              Skip for now
            </button>
          </div>

          <label v-if="selectedScheduleMode === 'custom'" class="inline-field">
            <span>Date</span>
            <input v-model="customScheduleDate" type="date" />
          </label>
        </article>

        <div class="activation-actions">
          <button class="primary-button" type="button" :disabled="isCompleting" @click="finishOnboarding">
            {{ isCompleting ? "Finishing..." : "Go to dashboard" }}
          </button>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.onboarding-shell {
  width: min(1160px, calc(100% - 40px));
  margin: 0 auto;
  padding: 40px 0 88px;
}

.onboarding-hero,
.onboarding-card {
  border: 1px solid rgba(112, 84, 62, 0.14);
  border-radius: 28px;
  background: rgba(255, 250, 245, 0.88);
  box-shadow: 0 24px 70px rgba(68, 44, 20, 0.08);
}

.onboarding-hero {
  padding: 32px;
  margin-bottom: 22px;
}

.onboarding-eyebrow,
.panel-label {
  margin: 0 0 10px;
  color: #6b5a4f;
  font-size: 0.82rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.onboarding-hero-row {
  display: flex;
  gap: 24px;
  align-items: flex-start;
  justify-content: space-between;
}

.onboarding-hero h1,
.onboarding-card h2,
.onboarding-card h3 {
  margin: 0;
  font-family: "Fraunces", Georgia, serif;
}

.onboarding-hero h1 {
  font-size: clamp(2.4rem, 5vw, 4.4rem);
  line-height: 0.98;
}

.onboarding-description {
  max-width: 720px;
  margin: 16px 0 0;
  color: #5b4f47;
  line-height: 1.7;
}

.progress-card {
  min-width: 260px;
  padding: 18px;
  border-radius: 18px;
  background: rgba(250, 239, 230, 0.9);
}

.progress-card p {
  margin: 0 0 12px;
  color: #5b4f47;
  font-weight: 700;
}

.progress-track {
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: rgba(112, 84, 62, 0.12);
  overflow: hidden;
}

.progress-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(135deg, #d76634 0%, #24474d 100%);
}

.onboarding-card {
  padding: 28px;
}

.onboarding-grid,
.generate-layout {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr);
  gap: 24px;
}

.intent-copy {
  display: grid;
  gap: 16px;
  align-content: start;
}

.intent-copy p {
  margin: 0;
  color: #5b4f47;
  line-height: 1.7;
}

.intent-note {
  display: grid;
  gap: 6px;
  padding: 18px;
  border-radius: 18px;
  background: #f7efe7;
}

.onboarding-form {
  display: grid;
  gap: 20px;
}

fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  display: grid;
  gap: 12px;
}

legend,
label span {
  margin-bottom: 4px;
  color: #5b4f47;
  font-weight: 700;
}

.choice-grid {
  display: grid;
  gap: 12px;
}

.choice-card,
.chip-button,
.ghost-button,
.secondary-button,
.primary-button {
  font: inherit;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease,
    border-color 0.18s ease;
}

.choice-card {
  display: grid;
  gap: 6px;
  padding: 16px;
  border: 1px solid rgba(112, 84, 62, 0.14);
  border-radius: 18px;
  background: #fff9f4;
  text-align: left;
}

.choice-card span {
  color: #6b5a4f;
  font-weight: 500;
}

.choice-card.selected,
.chip-button.selected {
  border-color: rgba(215, 102, 52, 0.5);
  box-shadow: 0 16px 30px rgba(215, 102, 52, 0.12);
  transform: translateY(-1px);
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.chip-button {
  min-height: 42px;
  padding: 0 16px;
  border: 1px solid rgba(112, 84, 62, 0.18);
  border-radius: 999px;
  background: #fff9f4;
}

.primary-button {
  min-height: 48px;
  padding: 0 20px;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #d76634 0%, #b94b24 100%);
  box-shadow: 0 14px 30px rgba(185, 75, 36, 0.22);
  color: #fff8f3;
  font-weight: 800;
}

.secondary-button {
  min-height: 40px;
  padding: 0 16px;
  border: 1px solid rgba(112, 84, 62, 0.16);
  border-radius: 999px;
  background: #efe5da;
  color: #1f1814;
  font-weight: 700;
}

.ghost-button {
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid rgba(112, 84, 62, 0.16);
  border-radius: 999px;
  background: transparent;
}

.workspace-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

label {
  display: grid;
  gap: 8px;
}

input,
select,
textarea {
  width: 100%;
  padding: 13px 14px;
  border: 1px solid rgba(112, 84, 62, 0.16);
  border-radius: 16px;
  background: #fffaf5;
  color: #1f1814;
}

textarea {
  resize: vertical;
  min-height: 170px;
}

.upload-field small,
.helper-copy {
  color: #6b5a4f;
}

.cta-inline {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.source-note {
  padding: 14px 16px;
  border-radius: 16px;
  background: #f7efe7;
  color: #5b4f47;
  line-height: 1.6;
}

.source-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.generate-output {
  display: grid;
  gap: 14px;
}

.output-panel,
.placeholder-panel,
.activation-panel {
  padding: 20px;
  border-radius: 22px;
  background: #fff9f4;
}

.output-panel p,
.placeholder-panel li,
.activation-panel p {
  color: #5b4f47;
  line-height: 1.7;
}

.output-list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.output-list li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(112, 84, 62, 0.1);
}

pre {
  margin: 0;
  white-space: pre-wrap;
  font-family: inherit;
  line-height: 1.7;
  color: #1f1814;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.section-header.compact {
  margin-bottom: 14px;
}

.activation-grid {
  display: grid;
  gap: 16px;
}

.activation-actions {
  display: flex;
  justify-content: flex-start;
}

.inline-field {
  max-width: 240px;
  margin-top: 12px;
}

.onboarding-feedback {
  margin: 0 0 18px;
  color: #5b4f47;
}

.onboarding-feedback.error {
  color: #b42318;
}

button:disabled {
  opacity: 0.7;
  cursor: progress;
}

@media (max-width: 920px) {
  .onboarding-hero-row,
  .onboarding-grid,
  .generate-layout {
    grid-template-columns: 1fr;
  }

  .progress-card {
    min-width: 0;
  }

  .workspace-grid {
    grid-template-columns: 1fr;
  }

  .source-grid {
    grid-template-columns: 1fr;
  }
}
</style>
