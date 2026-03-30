<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  BrandProfile,
  ContentIngestionItem,
  RepurposeSourceUrlInput,
  SavedContentSource,
  SocialAccount,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import VoiceRecorder from "../components/VoiceRecorder.vue";
import {
  requestContentIngestionPreview,
  requestRepurposeContent,
  requestSavedContentSources,
} from "../services/generation-service";
import { requestBrandProfile } from "../services/brand-profile-service";
import {
  getActivationDraft,
  saveActivationDraft,
} from "../services/activation-flow-service";
import { requestPipelineItem } from "../services/control-dashboard-service";
import { requestSocialAccounts } from "../services/publishing-service";
import { appRoutes } from "../utils/routes";

const exampleIdeas = [
  "Building in public is messy, but it makes trust compound faster.",
  "Most founders do not need more ideas. They need a system to ship content consistently.",
  "The loneliest part of building a startup is acting confident while everything feels uncertain.",
];

const toneOptions = [
  { label: "Founder", value: "storytelling" },
  { label: "Direct", value: "direct" },
  { label: "Structured", value: "professional" },
] as const;

const route = useRoute();
const router = useRouter();
const { bootstrap } = useProductAccessContext();

type GenerationSourceMode = "fresh" | "feed";

const input = ref("");
const tone = ref<(typeof toneOptions)[number]["value"]>("storytelling");
const isLoading = ref(false);
const errorMessage = ref("");
const helperMessage = ref("Paste a thought, saved post, or rough idea. Voice works too.");
const improvementSourceId = ref("");
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

const pageTitle = computed(() =>
  improvementSourceId.value ? "Improve the post you already have" : "Create your next post",
);
const pageDescription = computed(() =>
  improvementSourceId.value
    ? "We will use your previous draft as input and tighten the hook, structure, and clarity."
    : "Write from scratch or repurpose existing content in one place. Generate, refine, and move toward publishing without switching tools.",
);
const submitLabel = computed(() => (isLoading.value ? "Generating..." : "Generate post"));
const sourceInputLabel = computed(() =>
  sourceMode.value === "feed" ? "Repurpose with context" : "Bring one idea",
);
const sourceInputPlaceholder = computed(() =>
  sourceMode.value === "feed"
    ? "Example: turn these sources into a founder post about customer trust, product lessons, and practical proof. Your saved brand context will still shape the result."
    : "Paste your idea, tweet, thought, or rough note here...",
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
const connectedLinkedInAccount = computed(() =>
  socialAccounts.value.find((account) => account.platform === "linkedin" && account.status === "connected"),
);
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

async function loadSavedSources(): Promise<void> {
  const businessId = bootstrap.value?.activeBusinessId;

  if (!businessId) {
    savedSources.value = [];
    return;
  }

  isLoadingSavedSources.value = true;

  try {
    const response = await requestSavedContentSources(businessId);
    savedSources.value = response.sources;
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

async function hydrateImprovementState(): Promise<void> {
  const improveId = resolveActivePostIdFromRoute();

  if (!improveId) {
    improvementSourceId.value = "";
    sourceMode.value = resolveSourceModeFromRoute();
    input.value = typeof route.query.prefill === "string" ? route.query.prefill : "";
    if (!route.query.prefill && helperMessage.value.includes("improving")) {
      helperMessage.value = "Paste a thought, saved post, or rough idea. Voice works too.";
    }
    return;
  }

  improvementSourceId.value = improveId;
  sourceMode.value = "fresh";

  if (bootstrap.value?.activeBusinessId) {
    try {
      const response = await requestPipelineItem(bootstrap.value.activeBusinessId, improveId);
      input.value = response.asset.textContent ?? "";
      helperMessage.value = "You are editing a saved post. Regenerating will update this same draft.";
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

  input.value = storedDraft.result.post;
  helperMessage.value = "You are improving a saved draft. Regenerating will update this same post.";
}

function setSourceMode(nextMode: GenerationSourceMode): void {
  sourceMode.value = nextMode;
  errorMessage.value = "";

  if (improvementSourceId.value) {
    return;
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
    feedPreviewText.value = response.combinedText;
    savedSources.value = response.savedSources;
    isFeedPreviewDirty.value = false;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to preview content sources right now.";
  } finally {
    isPreviewingFeed.value = false;
  }
}

async function generatePost(): Promise<void> {
  if (sourceMode.value === "fresh" && !input.value.trim()) {
    errorMessage.value = "Add one idea before generating.";
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
    const response = await requestRepurposeContent({
      inputType: "text",
      intent: improvementSourceId.value || usingFeedSources ? "reference" : "capture",
      assetId: improvementSourceId.value || undefined,
      text: usingFeedSources ? feedPreviewText.value.trim() : input.value.trim() || undefined,
      tone: tone.value,
      businessId: bootstrap.value?.activeBusinessId ?? undefined,
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

function applyExample(value: string): void {
  input.value = value;
  errorMessage.value = "";
}

function handleVoiceTranscript(value: string): void {
  sourceMode.value = "fresh";
  input.value = value;
  helperMessage.value = "Transcript ready. Review it, then generate your post.";
  errorMessage.value = "";
}

function handleKeydown(event: KeyboardEvent): void {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key !== "Enter") {
    return;
  }

  if (isLoading.value) {
    return;
  }

  event.preventDefault();
  void generatePost();
}

watch(
  () => [route.query.improve, route.query.postId, route.query.mode, bootstrap.value?.activeBusinessId],
  () => {
    void hydrateImprovementState();
  },
  { immediate: true },
);

watch([sourceMode, input, linkedinSourceUrl, instagramSourceUrl, facebookSourceUrl, blogSourceUrl], () => {
  if (sourceMode.value === "feed" && !improvementSourceId.value) {
    isFeedPreviewDirty.value = true;
  }
});

watch(
  () => bootstrap.value?.activeBusinessId,
  () => {
    void loadSavedSources();
    void loadBrandProfile();
    void loadSocialAccounts();
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
  <main class="activation-shell">
    <section class="activation-hero">
      <p class="activation-eyebrow">/app/create</p>
      <h1>{{ pageTitle }}</h1>
      <p class="activation-description">{{ pageDescription }}</p>
      <div class="activation-chip-row">
        <span class="activation-chip">Value in one step</span>
        <span class="activation-chip">Hooks + post + next actions</span>
        <span class="activation-chip">Cmd/Ctrl + Enter to generate</span>
      </div>
      <div class="channel-context-panel" :class="{ connected: Boolean(connectedLinkedInAccount) }">
        <div class="channel-context-copy">
          <p class="panel-meta">Distribution context</p>
          <h2>
            {{
              connectedLinkedInAccount
                ? `Publishing to LinkedIn${linkedInOptimizationLabel ? ` (${linkedInOptimizationLabel})` : ""}`
                : "Connect LinkedIn to optimize for publishing"
            }}
          </h2>
          <p class="activation-helper">
            {{
              connectedLinkedInAccount
                ? "This workspace will shape output for direct LinkedIn publishing and handoff to the post view."
                : "Generation still works without a channel, but connected workspaces get formatting tuned for direct LinkedIn publishing."
            }}
          </p>
        </div>
        <div class="channel-context-actions">
          <span
            v-if="connectedLinkedInAccount"
            class="activation-chip channel-context-chip"
          >
            Connected: LinkedIn
          </span>
          <span
            v-else-if="isLoadingSocialAccounts"
            class="activation-chip channel-context-chip"
          >
            Checking channels...
          </span>
          <router-link class="secondary-action inline-link" :to="appRoutes.settingsPreferences">
            {{ connectedLinkedInAccount ? "Manage channels" : "Connect in settings" }}
          </router-link>
        </div>
      </div>

      <div
        v-if="!improvementSourceId && hasActiveWorkspace"
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
        </div>
      </div>
    </section>

    <section class="activation-panel">
      <div v-if="!improvementSourceId" class="source-mode-row create-mode-row">
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

      <div class="activation-panel-header">
        <div>
          <p class="panel-meta">Input</p>
          <h2>{{ sourceInputLabel }}</h2>
        </div>
        <div class="tone-selector">
          <button
            v-for="option in toneOptions"
            :key="option.value"
            type="button"
            class="tone-chip"
            :class="{ active: tone === option.value }"
            @click="tone = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div
        v-if="!improvementSourceId && (hasSavedSources || isLoadingSavedSources)"
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
              : "Repurpose starts from the reviewed source preview, then layers these saved sources and brand context on top."
          }}
        </p>
      </div>

      <textarea
        v-model="input"
        class="activation-textarea"
        :placeholder="sourceInputPlaceholder"
      />

      <div
        v-if="!improvementSourceId && sourceMode === 'feed'"
        id="repurpose-panel"
        class="feed-ingest-panel"
      >
        <p class="activation-helper">
          Use public page, post, or article URLs. Private feeds and login-only pages will not ingest. Your workspace brand memory is applied automatically after preview.
        </p>
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

      <div v-else class="activation-helper-row">
        <p class="activation-helper">{{ helperMessage }}</p>
        <VoiceRecorder
          title="Speak the idea instead"
          hint="Record one thought, review the transcript, then generate."
          @transcribed="handleVoiceTranscript"
        />
      </div>

      <div v-if="sourceMode === 'fresh' && !improvementSourceId" class="example-row">
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
      <p v-else-if="sourceMode === 'feed' && !improvementSourceId" class="activation-feedback">
        {{
          isFeedPreviewReady
            ? "Preview ready. Generation will use the reviewed source text plus your workspace brand context."
            : hasFeedSources
              ? "Preview the public sources before generating."
              : "Add at least one public source URL, or switch back to Start fresh."
        }}
      </p>

      <div class="activation-actions">
        <button
          type="button"
          class="primary-action"
          :disabled="isLoading || (!improvementSourceId && sourceMode === 'feed' && (!isFeedPreviewReady || isPreviewingFeed))"
          @click="generatePost"
        >
          {{ submitLabel }}
        </button>
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

.channel-context-panel {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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

.channel-context-copy h2 {
  margin: 0;
  font-size: clamp(1.1rem, 2.2vw, 1.45rem);
  line-height: 1.1;
}

.channel-context-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
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
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
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

.source-mode-row {
  margin-top: 18px;
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

.activation-actions {
  align-items: center;
  margin-top: 24px;
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
  .activation-helper-row {
    flex-direction: column;
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

  .brand-context-grid,
  .source-grid {
    grid-template-columns: 1fr;
  }
}
</style>
