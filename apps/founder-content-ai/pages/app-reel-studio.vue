<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type {
  ReelAudience,
  ReelDurationSeconds,
  ReelLanguage,
  ReelProject,
  ReelProjectSummary,
  ReelRenderStage,
  ReelScene,
  ReelSceneType,
  ReelStoryboard,
  ReelVisualStyle,
  ReelVoice,
  ReelYouTubeConnection,
  ReelYouTubeVisibility,
} from "../../../packages/shared-types";
import { useProductAccessContext } from "../access/product-access-context";
import {
  requestReelProject,
  requestReelProjectDelete,
  requestReelProjects,
  requestReelRender,
  requestReelApproval,
  requestReelReview,
  requestReelSceneRegenerate,
  requestReelStoryboard,
  requestReelStoryboardUpdate,
  requestReelYouTubeAuth,
  requestReelYouTubeConnection,
  requestReelYouTubePublish,
} from "../services/reel-studio-service";
import { actionIcons, aiFeatureIcons, iconSizes, iconStrokeWidth } from "../src/icons";

const POLL_INTERVAL_MS = 3000;

const LANGUAGE_OPTIONS: Array<{ value: ReelLanguage; label: string }> = [
  { value: "english", label: "English" },
  { value: "hindi", label: "Hindi" },
  { value: "hinglish", label: "Hinglish" },
  { value: "spanish", label: "Spanish" },
];
const DURATION_OPTIONS: ReelDurationSeconds[] = [15, 30, 45, 60];
const STYLE_OPTIONS: Array<{ value: ReelVisualStyle; label: string; hint: string }> = [
  { value: "neon_tech", label: "Neon Tech", hint: "Dark, glowing system-design look" },
  { value: "minimal_motion", label: "Minimal Motion", hint: "Clean light canvas, bold type" },
];
const AUDIENCE_OPTIONS: Array<{ value: ReelAudience; label: string }> = [
  { value: "developers", label: "Developers" },
  { value: "beginners", label: "Beginners" },
  { value: "students", label: "Students" },
  { value: "general", label: "General audience" },
];
const VOICE_OPTIONS: ReelVoice[] = ["nova", "alloy", "ash", "coral", "echo", "onyx", "sage", "shimmer"];
const SCENE_TYPE_LABELS: Record<ReelSceneType, string> = {
  title: "Hook",
  bullets: "Key points",
  flow: "Diagram",
  stat: "Big number",
  comparison: "Comparison",
  code: "Code",
  outro: "Outro",
};
const STAGE_LABELS: Record<ReelRenderStage, string> = {
  voice: "Recording narration",
  compose: "Composing scenes",
  render: "Rendering video",
  upload: "Saving your reel",
};
const STAGE_ORDER: ReelRenderStage[] = ["voice", "compose", "render", "upload"];
const WORKFLOW_LABELS = {
  script_draft: "Script draft",
  approved: "Approved for render",
  rendered: "Ready for review",
  reviewed: "Reviewed and ready to share",
  published: "Published",
} as const;
const PROMPT_EXAMPLES = [
  "Explain how 100 microservices communicate, using a real-world example. Make it engaging for software engineers.",
  "What happens when you type a URL into the browser? Step by step.",
  "Explain database indexing using a library book analogy.",
];

const route = useRoute();
const router = useRouter();
const { activeBusinessId, isFeatureEnabled } = useProductAccessContext();

const prompt = ref("");
const language = ref<ReelLanguage>("english");
const durationSeconds = ref<ReelDurationSeconds>(30);
const style = ref<ReelVisualStyle>("neon_tech");
const audience = ref<ReelAudience>("developers");
const voice = ref<ReelVoice>("nova");
const showCaptions = ref(true);
const brandHandle = ref("");

const projects = ref<ReelProjectSummary[]>([]);
const project = ref<ReelProject | null>(null);
const draft = ref<ReelStoryboard | null>(null);
const isDirty = ref(false);
const isGenerating = ref(false);
const isSaving = ref(false);
const isQueueing = ref(false);
const isYouTubeConnecting = ref(false);
const isPublishingYouTube = ref(false);
const isLoadingProjects = ref(false);
const regeneratingSceneId = ref("");
const sceneInstructions = ref<Record<string, string>>({});
const errorMessage = ref("");
const noticeMessage = ref("");
const youtubeConnection = ref<ReelYouTubeConnection>({ connected: false });
const youtubeVisibility = ref<ReelYouTubeVisibility>("public");
const youtubeVideoUrl = ref("");
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const businessId = computed(() => activeBusinessId.value?.trim() || "");
const canUseReelStudio = computed(() => Boolean(businessId.value) && isFeatureEnabled("visual_generation"));
const isRendering = computed(() => project.value?.status === "queued" || project.value?.status === "rendering");
const canEdit = computed(() => Boolean(project.value) && !isRendering.value);
const isScriptDraft = computed(() => project.value?.workflowStage === "script_draft");
const isApproved = computed(() => project.value?.workflowStage === "approved");
const isReadyForReview = computed(() => project.value?.workflowStage === "rendered" && project.value?.status === "ready");
const isReviewed = computed(() => project.value?.workflowStage === "reviewed" || project.value?.workflowStage === "published");
const narrationWords = computed(() =>
  (draft.value?.scenes ?? []).reduce((sum, scene) => sum + countWords(scene.narration), 0),
);
// Rough read-aloud estimate; the real length comes from the recorded narration.
const estimatedSeconds = computed(() => Math.round(narrationWords.value / 2.5 + (draft.value?.scenes.length ?? 0) * 0.6));
const progressPercent = computed(() => {
  const progress = project.value?.progress;
  if (!progress) {
    return project.value?.status === "queued" ? 2 : 0;
  }
  // Weight stages by typical wall-clock share so the bar moves evenly.
  const weights: Record<ReelRenderStage, [number, number]> = {
    voice: [0, 20],
    compose: [20, 25],
    render: [25, 95],
    upload: [95, 100],
  };
  const [start, end] = weights[progress.stage];
  return Math.round(start + ((end - start) * progress.percent) / 100);
});
const progressLabel = computed(() => {
  if (project.value?.status === "queued" && !project.value.progress?.percent) {
    return "Waiting for a render worker…";
  }
  return project.value?.progress ? STAGE_LABELS[project.value.progress.stage] : "Starting…";
});
const captionWithTags = computed(() => {
  const storyboard = project.value?.storyboard;
  return storyboard ? [storyboard.caption, storyboard.hashtags.join(" ")].filter(Boolean).join("\n\n") : "";
});

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function cloneStoryboard(storyboard: ReelStoryboard): ReelStoryboard {
  return JSON.parse(JSON.stringify(storyboard)) as ReelStoryboard;
}

function readError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDuration(ms?: number): string {
  if (!ms) {
    return "";
  }
  return `${Math.round(ms / 1000)}s`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function workflowLabel(stage: ReelProjectSummary["workflowStage"]): string {
  return WORKFLOW_LABELS[stage];
}

function applyProject(next: ReelProject, options: { resetDraft?: boolean } = {}): void {
  project.value = next;

  if (options.resetDraft || !isDirty.value) {
    draft.value = cloneStoryboard(next.storyboard);
    isDirty.value = false;
  }

  const summary: ReelProjectSummary = {
    id: next.id,
    title: next.storyboard.title,
    status: next.status,
    workflowStage: next.workflowStage,
    settings: next.settings,
    durationMs: next.durationMs,
    posterUrl: next.posterUrl,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
  };
  const index = projects.value.findIndex((entry) => entry.id === next.id);
  if (index >= 0) {
    projects.value.splice(index, 1, summary);
  } else {
    projects.value.unshift(summary);
  }

  schedulePoll();
}

function stopPolling(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function schedulePoll(): void {
  stopPolling();

  if (!isRendering.value || !project.value) {
    return;
  }

  const projectId = project.value.id;
  pollTimer = setTimeout(async () => {
    if (!businessId.value || project.value?.id !== projectId) {
      return;
    }

    try {
      const response = await requestReelProject(businessId.value, projectId);
      const wasRendering = isRendering.value;
      applyProject(response.project, { resetDraft: true });

      if (wasRendering && response.project.status === "ready") {
        noticeMessage.value = "Your reel is ready.";
      } else if (wasRendering && response.project.status === "failed") {
        errorMessage.value = response.project.errorMessage || "Rendering failed.";
      }
    } catch {
      // Transient network errors: keep polling.
      schedulePoll();
    }
  }, POLL_INTERVAL_MS);
}

async function loadProjects(): Promise<void> {
  if (!canUseReelStudio.value) {
    projects.value = [];
    return;
  }

  isLoadingProjects.value = true;

  try {
    projects.value = (await requestReelProjects(businessId.value)).projects;
  } catch (error) {
    errorMessage.value = readError(error, "Unable to load your reels.");
  } finally {
    isLoadingProjects.value = false;
  }
}

async function loadYouTubeConnection(): Promise<void> {
  if (!businessId.value) {
    youtubeConnection.value = { connected: false };
    return;
  }

  try {
    youtubeConnection.value = await requestReelYouTubeConnection(businessId.value);
  } catch {
    youtubeConnection.value = { connected: false };
  }
}

async function openProject(projectId: string): Promise<void> {
  if (!businessId.value) {
    return;
  }

  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    const response = await requestReelProject(businessId.value, projectId);
    applyProject(response.project, { resetDraft: true });
    prompt.value = response.project.prompt;
    language.value = response.project.settings.language;
    durationSeconds.value = response.project.settings.durationSeconds;
    style.value = response.project.settings.style;
    audience.value = response.project.settings.audience;
    voice.value = response.project.settings.voice;
    showCaptions.value = response.project.settings.showCaptions;
    brandHandle.value = response.project.settings.brandHandle ?? "";

    if (route.query.project !== projectId) {
      void router.replace({ query: { ...route.query, project: projectId } });
    }
  } catch (error) {
    errorMessage.value = readError(error, "Unable to open this reel.");
  }
}

function startNew(): void {
  stopPolling();
  project.value = null;
  draft.value = null;
  isDirty.value = false;
  errorMessage.value = "";
  noticeMessage.value = "";
  const { project: _removed, ...query } = route.query;
  void router.replace({ query });
}

async function generateStoryboard(): Promise<void> {
  if (!canUseReelStudio.value || isGenerating.value) {
    return;
  }

  if (prompt.value.trim().length < 8) {
    errorMessage.value = "Describe what the reel should explain — a sentence is enough.";
    return;
  }

  isGenerating.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    const response = await requestReelStoryboard({
      businessId: businessId.value,
      prompt: prompt.value.trim(),
      language: language.value,
      durationSeconds: durationSeconds.value,
      style: style.value,
      audience: audience.value,
      voice: voice.value,
      showCaptions: showCaptions.value,
      brandHandle: brandHandle.value.trim() || undefined,
    });
    applyProject(response.project, { resetDraft: true });
    void router.replace({ query: { ...route.query, project: response.project.id } });
  } catch (error) {
    errorMessage.value = readError(error, "Unable to generate a storyboard right now.");
  } finally {
    isGenerating.value = false;
  }
}

function currentSettingsPatch() {
  return {
    style: style.value,
    voice: voice.value,
    showCaptions: showCaptions.value,
    brandHandle: brandHandle.value.trim(),
  };
}

async function saveDraft(): Promise<boolean> {
  if (!project.value || !draft.value) {
    return false;
  }

  isSaving.value = true;
  errorMessage.value = "";

  try {
    const response = await requestReelStoryboardUpdate(project.value.id, {
      businessId: businessId.value,
      storyboard: draft.value,
      settings: currentSettingsPatch(),
    });
    isDirty.value = false;
    applyProject(response.project, { resetDraft: true });
    return true;
  } catch (error) {
    errorMessage.value = readError(error, "Unable to save your edits.");
    return false;
  } finally {
    isSaving.value = false;
  }
}

async function renderReel(): Promise<void> {
  if (!project.value || isQueueing.value) {
    return;
  }

  isQueueing.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    // Persist edits only when there are edits. Saving a draft intentionally returns
    // the project to script_draft, which requires a fresh approval before render.
    if (isDirty.value && !(await saveDraft())) {
      return;
    }

    if (project.value.workflowStage !== "approved") {
      errorMessage.value = "Approve this updated storyboard before rendering it.";
      return;
    }

    const response = await requestReelRender(businessId.value, project.value.id);
    applyProject(response.project, { resetDraft: true });
  } catch (error) {
    errorMessage.value = readError(error, "Unable to start rendering.");
  } finally {
    isQueueing.value = false;
  }
}

async function approveStoryboard(): Promise<void> {
  if (!project.value || isSaving.value || isRendering.value) {
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    if (isDirty.value && !(await saveDraft())) {
      return;
    }
    const response = await requestReelApproval(project.value.id, { businessId: businessId.value });
    applyProject(response.project, { resetDraft: true });
    noticeMessage.value = "Storyboard approved. Render it when you are ready.";
  } catch (error) {
    errorMessage.value = readError(error, "Unable to approve this storyboard.");
  } finally {
    isSaving.value = false;
  }
}

async function markReviewed(): Promise<void> {
  if (!project.value || !isReadyForReview.value) {
    return;
  }

  errorMessage.value = "";
  noticeMessage.value = "";

  try {
    const response = await requestReelReview(project.value.id, { businessId: businessId.value });
    applyProject(response.project, { resetDraft: true });
    noticeMessage.value = "Review saved. Your reel is ready to share.";
  } catch (error) {
    errorMessage.value = readError(error, "Unable to save the review.");
  }
}

async function connectYouTube(): Promise<void> {
  if (!businessId.value || isYouTubeConnecting.value) {
    return;
  }

  isYouTubeConnecting.value = true;
  errorMessage.value = "";
  try {
    const response = await requestReelYouTubeAuth({ businessId: businessId.value, returnPath: route.fullPath });
    window.location.assign(response.authorizationUrl);
  } catch (error) {
    errorMessage.value = readError(error, "Unable to connect YouTube. Add the YouTube OAuth settings first.");
    isYouTubeConnecting.value = false;
  }
}

async function publishToYouTube(): Promise<void> {
  if (!project.value || project.value.workflowStage !== "reviewed" || !youtubeConnection.value.connected || isPublishingYouTube.value) {
    return;
  }

  isPublishingYouTube.value = true;
  errorMessage.value = "";
  try {
    const response = await requestReelYouTubePublish(project.value.id, {
      businessId: businessId.value,
      visibility: youtubeVisibility.value,
    });
    applyProject(response.project, { resetDraft: true });
    youtubeVideoUrl.value = response.publication.videoUrl;
    noticeMessage.value = "Published to YouTube.";
  } catch (error) {
    errorMessage.value = readError(error, "Unable to publish this reel to YouTube.");
  } finally {
    isPublishingYouTube.value = false;
  }
}

async function regenerateScene(sceneId: string): Promise<void> {
  if (!project.value || regeneratingSceneId.value) {
    return;
  }

  if (isDirty.value && !(await saveDraft())) {
    return;
  }

  regeneratingSceneId.value = sceneId;
  errorMessage.value = "";

  try {
    const response = await requestReelSceneRegenerate(project.value.id, sceneId, {
      businessId: businessId.value,
      instruction: sceneInstructions.value[sceneId]?.trim() || undefined,
    });
    sceneInstructions.value[sceneId] = "";
    applyProject(response.project, { resetDraft: true });
  } catch (error) {
    errorMessage.value = readError(error, "Unable to regenerate this scene.");
  } finally {
    regeneratingSceneId.value = "";
  }
}

async function deleteProject(projectId: string): Promise<void> {
  if (!window.confirm("Delete this reel? This cannot be undone.")) {
    return;
  }

  try {
    await requestReelProjectDelete(businessId.value, projectId);
    projects.value = projects.value.filter((entry) => entry.id !== projectId);
    if (project.value?.id === projectId) {
      startNew();
    }
  } catch (error) {
    errorMessage.value = readError(error, "Unable to delete this reel.");
  }
}

function markDirty(): void {
  isDirty.value = true;
}

function linesOf(items: string[]): string {
  return items.join("\n");
}

function toLines(value: string, max: number): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, max);
}

function updateLines(target: { [key: string]: unknown }, key: string, value: string, max: number): void {
  target[key] = toLines(value, max);
  markDirty();
}

function sceneWordHint(scene: ReelScene): string {
  const words = countWords(scene.narration);
  return `${words} words · ~${Math.max(2, Math.round(words / 2.5))}s`;
}

async function copyCaption(): Promise<void> {
  try {
    await navigator.clipboard.writeText(captionWithTags.value);
    noticeMessage.value = "Caption copied.";
  } catch {
    errorMessage.value = "Copy failed. Select the caption text and copy it manually.";
  }
}

async function downloadVideo(): Promise<void> {
  const url = project.value?.videoUrl;

  if (!url) {
    return;
  }

  const fileName = `${(project.value?.storyboard.title || "reel").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mp4`;

  try {
    const blob = await (await fetch(url)).blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Cross-origin storage without CORS: fall back to opening the file.
    window.open(url, "_blank", "noopener");
  }
}

async function shareVideo(): Promise<void> {
  const url = project.value?.videoUrl;

  if (!url) {
    return;
  }

  const title = project.value?.storyboard.title || "AI idea reel";
  const fileName = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "reel"}.mp4`;

  try {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], fileName, { type: "video/mp4" });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title, text: captionWithTags.value, files: [file] });
      noticeMessage.value = "Shared.";
      return;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
  }

  await downloadVideo();
  try {
    await navigator.clipboard.writeText(captionWithTags.value);
    noticeMessage.value = "Video downloaded and caption copied. It is ready to post.";
  } catch {
    noticeMessage.value = "Video downloaded. Copy the caption from the panel before posting.";
  }
}

watch(
  () => businessId.value,
  async (next, previous) => {
    if (next && next !== previous) {
      startNew();
      await loadProjects();
      await loadYouTubeConnection();
    }
  },
);

onMounted(async () => {
  await loadProjects();
  await loadYouTubeConnection();
  if (route.query.youtube === "connected") {
    noticeMessage.value = "YouTube connected. Reviewed reels can now be published.";
  } else if (route.query.youtube === "error") {
    errorMessage.value = typeof route.query.message === "string" ? route.query.message : "YouTube connection failed.";
  }
  const projectId = typeof route.query.project === "string" ? route.query.project : "";
  if (projectId) {
    await openProject(projectId);
  }
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <section class="reel-page">
    <header class="reel-header">
      <div>
        <p class="reel-eyebrow">Reel Studio</p>
        <h1>Turn any concept into an animated explainer reel.</h1>
        <p class="reel-copy">
          Describe the idea. The AI director writes the script, picks animated scenes, records narration, and renders a
          ready-to-post 9:16 video.
        </p>
      </div>
      <button v-if="project" type="button" class="reel-button reel-button-ghost" @click="startNew">
        <component :is="actionIcons.add" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
        New reel
      </button>
    </header>

    <p v-if="!canUseReelStudio" class="reel-feedback reel-feedback-error">
      Reel Studio needs an active workspace with visual generation enabled.
    </p>
    <p v-if="errorMessage" class="reel-feedback reel-feedback-error">{{ errorMessage }}</p>
    <p v-if="noticeMessage" class="reel-feedback reel-feedback-success">{{ noticeMessage }}</p>

    <div class="reel-layout">
      <div class="reel-main">
        <!-- Step 1: prompt -->
        <section class="reel-card">
          <div class="reel-card-header">
            <span class="reel-step">1</span>
            <h2>What's your reel about?</h2>
          </div>

          <textarea
            v-model="prompt"
            class="reel-prompt"
            rows="4"
            maxlength="2000"
            placeholder="Describe anything you want to explain…"
            :disabled="isGenerating || isRendering"
          />
          <div v-if="!project" class="reel-examples">
            <button v-for="example in PROMPT_EXAMPLES" :key="example" type="button" class="reel-chip" @click="prompt = example">
              {{ example }}
            </button>
          </div>

          <div class="reel-settings">
            <label class="reel-field">
              <span>Language</span>
              <select v-model="language" :disabled="Boolean(project)">
                <option v-for="option in LANGUAGE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="reel-field">
              <span>Duration</span>
              <select v-model.number="durationSeconds" :disabled="Boolean(project)">
                <option v-for="option in DURATION_OPTIONS" :key="option" :value="option">{{ option }} seconds</option>
              </select>
            </label>
            <label class="reel-field">
              <span>Audience</span>
              <select v-model="audience" :disabled="Boolean(project)">
                <option v-for="option in AUDIENCE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="reel-field">
              <span>Voice</span>
              <select v-model="voice" :disabled="isRendering" @change="project && markDirty()">
                <option v-for="option in VOICE_OPTIONS" :key="option" :value="option">{{ option }}</option>
              </select>
            </label>
            <label class="reel-field">
              <span>Handle (optional)</span>
              <input v-model="brandHandle" type="text" maxlength="32" placeholder="@yourhandle" :disabled="isRendering" @input="project && markDirty()" />
            </label>
            <label class="reel-field reel-field-inline">
              <input v-model="showCaptions" type="checkbox" :disabled="isRendering" @change="project && markDirty()" />
              <span>Burn-in captions</span>
            </label>
          </div>

          <div class="reel-styles">
            <button
              v-for="option in STYLE_OPTIONS"
              :key="option.value"
              type="button"
              class="reel-style"
              :class="[`reel-style-${option.value}`, { 'reel-style-active': style === option.value }]"
              :disabled="isRendering"
              @click="style = option.value; project && markDirty()"
            >
              <span class="reel-style-swatch" />
              <strong>{{ option.label }}</strong>
              <small>{{ option.hint }}</small>
            </button>
          </div>

          <div class="reel-actions">
            <button
              v-if="!project"
              type="button"
              class="reel-button reel-button-primary"
              :disabled="isGenerating || !canUseReelStudio"
              @click="generateStoryboard"
            >
              <component :is="aiFeatureIcons.generate" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
              {{ isGenerating ? "Directing your storyboard…" : "Generate storyboard" }}
            </button>
            <p v-else class="reel-hint">Language, length and audience are locked for this storyboard. Start a new reel to change them.</p>
          </div>
        </section>

        <!-- Step 2: storyboard -->
        <section v-if="draft" class="reel-card">
          <div class="reel-card-header">
            <span class="reel-step">2</span>
            <h2>{{ draft.title }}</h2>
            <span class="reel-meta">{{ draft.scenes.length }} scenes · {{ narrationWords }} words · ~{{ estimatedSeconds }}s</span>
            <span v-if="project" class="reel-workflow-chip" :class="`reel-workflow-${project.workflowStage}`">
              {{ WORKFLOW_LABELS[project.workflowStage] }}
            </span>
          </div>

          <ol class="reel-scenes">
            <li v-for="(scene, index) in draft.scenes" :key="scene.id" class="reel-scene">
              <div class="reel-scene-top">
                <span class="reel-scene-index">{{ index + 1 }}</span>
                <span class="reel-scene-type">{{ SCENE_TYPE_LABELS[scene.type] }}</span>
                <span class="reel-scene-words">{{ sceneWordHint(scene) }}</span>
              </div>

              <label class="reel-field">
                <span>Narration</span>
                <textarea v-model="scene.narration" rows="2" :disabled="!canEdit" @input="markDirty" />
              </label>

              <div class="reel-scene-fields">
                <template v-if="scene.type === 'title'">
                  <label class="reel-field"><span>Kicker</span><input v-model="scene.kicker" :disabled="!canEdit" @input="markDirty" /></label>
                  <label class="reel-field"><span>Title</span><input v-model="scene.title" :disabled="!canEdit" @input="markDirty" /></label>
                  <label class="reel-field"><span>Subtitle</span><input v-model="scene.subtitle" :disabled="!canEdit" @input="markDirty" /></label>
                </template>

                <template v-else-if="scene.type === 'bullets'">
                  <label class="reel-field"><span>Heading</span><input v-model="scene.heading" :disabled="!canEdit" @input="markDirty" /></label>
                  <label class="reel-field">
                    <span>Bullets (one per line, max 4)</span>
                    <textarea
                      :value="linesOf(scene.bullets)"
                      rows="3"
                      :disabled="!canEdit"
                      @change="updateLines(scene, 'bullets', ($event.target as HTMLTextAreaElement).value, 4)"
                    />
                  </label>
                </template>

                <template v-else-if="scene.type === 'flow'">
                  <label class="reel-field"><span>Heading</span><input v-model="scene.heading" :disabled="!canEdit" @input="markDirty" /></label>
                  <div class="reel-node-list">
                    <label v-for="node in scene.nodes" :key="node.id" class="reel-field reel-node">
                      <span>{{ node.icon }}</span>
                      <input v-model="node.label" maxlength="22" :disabled="!canEdit" @input="markDirty" />
                    </label>
                  </div>
                </template>

                <template v-else-if="scene.type === 'stat'">
                  <label class="reel-field"><span>Value</span><input v-model="scene.value" maxlength="12" :disabled="!canEdit" @input="markDirty" /></label>
                  <label class="reel-field"><span>Label</span><input v-model="scene.label" :disabled="!canEdit" @input="markDirty" /></label>
                  <label class="reel-field"><span>Context</span><input v-model="scene.context" :disabled="!canEdit" @input="markDirty" /></label>
                </template>

                <template v-else-if="scene.type === 'comparison'">
                  <label class="reel-field"><span>Heading</span><input v-model="scene.heading" :disabled="!canEdit" @input="markDirty" /></label>
                  <div class="reel-compare">
                    <div>
                      <label class="reel-field"><span>Left</span><input v-model="scene.left.title" :disabled="!canEdit" @input="markDirty" /></label>
                      <textarea
                        :value="linesOf(scene.left.points)"
                        rows="3"
                        :disabled="!canEdit"
                        @change="updateLines(scene.left, 'points', ($event.target as HTMLTextAreaElement).value, 3)"
                      />
                    </div>
                    <div>
                      <label class="reel-field"><span>Right</span><input v-model="scene.right.title" :disabled="!canEdit" @input="markDirty" /></label>
                      <textarea
                        :value="linesOf(scene.right.points)"
                        rows="3"
                        :disabled="!canEdit"
                        @change="updateLines(scene.right, 'points', ($event.target as HTMLTextAreaElement).value, 3)"
                      />
                    </div>
                  </div>
                </template>

                <template v-else-if="scene.type === 'code'">
                  <label class="reel-field"><span>Heading</span><input v-model="scene.heading" :disabled="!canEdit" @input="markDirty" /></label>
                  <label class="reel-field">
                    <span>Code ({{ scene.language }})</span>
                    <textarea v-model="scene.code" class="reel-code" rows="6" :disabled="!canEdit" @input="markDirty" />
                  </label>
                </template>

                <template v-else-if="scene.type === 'outro'">
                  <label class="reel-field"><span>Takeaway</span><input v-model="scene.title" :disabled="!canEdit" @input="markDirty" /></label>
                  <label class="reel-field"><span>Call to action</span><input v-model="scene.cta" :disabled="!canEdit" @input="markDirty" /></label>
                </template>
              </div>

              <div v-if="canEdit" class="reel-regenerate">
                <input
                  v-model="sceneInstructions[scene.id]"
                  type="text"
                  maxlength="500"
                  placeholder="Optional: how should this scene change?"
                  @keydown.enter.prevent="regenerateScene(scene.id)"
                />
                <button
                  type="button"
                  class="reel-button reel-button-ghost"
                  :disabled="Boolean(regeneratingSceneId)"
                  @click="regenerateScene(scene.id)"
                >
                  <component :is="actionIcons.refresh" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                  {{ regeneratingSceneId === scene.id ? "Rewriting…" : "Regenerate" }}
                </button>
              </div>
            </li>
          </ol>

          <div class="reel-actions">
            <button v-if="isDirty" type="button" class="reel-button reel-button-ghost" :disabled="isSaving || !canEdit" @click="saveDraft">
              <component :is="actionIcons.save" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
              {{ isSaving ? "Saving…" : "Save edits" }}
            </button>
            <button
              v-if="isScriptDraft"
              type="button"
              class="reel-button reel-button-primary"
              :disabled="!canEdit || isQueueing || isSaving"
              @click="approveStoryboard"
            >
              <component :is="actionIcons.approve" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
              {{ isSaving ? "Approving…" : "Approve storyboard" }}
            </button>
            <button
              v-else-if="isApproved"
              type="button"
              class="reel-button reel-button-primary"
              :disabled="!canEdit || isQueueing || isSaving"
              @click="renderReel"
            >
              <component :is="aiFeatureIcons.publish" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
              {{ project?.status === "failed" ? "Retry render" : "Render reel" }}
            </button>
            <p v-else-if="isReadyForReview" class="reel-hint">Watch the video, then mark it reviewed before sharing.</p>
            <p v-else-if="isReviewed" class="reel-hint">This reel is reviewed. Edit the storyboard to create a new revision.</p>
          </div>
        </section>
      </div>

      <aside class="reel-side">
        <!-- Step 3: output -->
        <section v-if="project" class="reel-card reel-output">
          <div class="reel-card-header">
            <span class="reel-step">3</span>
            <h2>Your reel</h2>
          </div>

          <div class="reel-player" :class="{ 'reel-player-empty': !project.videoUrl }">
            <video v-if="project.videoUrl" :key="project.videoUrl" :src="project.videoUrl" :poster="project.posterUrl" controls playsinline />
            <div v-else-if="isRendering" class="reel-progress">
              <strong>{{ progressLabel }}</strong>
              <div class="reel-progress-track"><div class="reel-progress-fill" :style="{ width: `${progressPercent}%` }" /></div>
              <ol class="reel-stages">
                <li
                  v-for="stage in STAGE_ORDER"
                  :key="stage"
                  :class="{
                    'reel-stage-done': project.progress && STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf(project.progress.stage),
                    'reel-stage-active': project.progress?.stage === stage,
                  }"
                >
                  {{ STAGE_LABELS[stage] }}
                </li>
              </ol>
              <small>Usually 1–3 minutes. You can leave this page; the render keeps going.</small>
            </div>
            <div v-else-if="project.status === 'failed'" class="reel-progress">
              <strong>Rendering failed</strong>
              <small>{{ project.errorMessage }}</small>
            </div>
            <div v-else class="reel-progress">
              <strong>Not rendered yet</strong>
              <small>Review the storyboard, then hit “Render reel”.</small>
            </div>
          </div>

          <div v-if="project.videoUrl" class="reel-actions reel-actions-stack">
            <button type="button" class="reel-button reel-button-primary" @click="downloadVideo">
              <component :is="actionIcons.download" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
              Download MP4 {{ formatDuration(project.durationMs) ? `(${formatDuration(project.durationMs)})` : "" }}
            </button>
            <button v-if="isReadyForReview" type="button" class="reel-button reel-button-ghost" @click="markReviewed">
              <component :is="actionIcons.approve" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
              Mark as reviewed
            </button>
            <button v-if="isReviewed" type="button" class="reel-button reel-button-primary" @click="shareVideo">
              <component :is="actionIcons.share" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
              Share reel
            </button>
          </div>

          <div v-if="captionWithTags" class="reel-caption">
            <div class="reel-caption-header">
              <span>Caption</span>
              <button type="button" class="reel-link" @click="copyCaption">
                <component :is="actionIcons.copy" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
                Copy
              </button>
            </div>
            <p>{{ captionWithTags }}</p>
          </div>

          <div v-if="isReviewed" class="reel-youtube">
            <div class="reel-caption-header">
              <span>YouTube</span>
              <span v-if="youtubeConnection.connected" class="reel-youtube-connected">Connected</span>
            </div>
            <p v-if="!youtubeConnection.connected" class="reel-hint">
              Connect your channel to publish this reviewed video. Nothing is uploaded automatically.
            </p>
            <button v-if="!youtubeConnection.connected" type="button" class="reel-button reel-button-ghost" :disabled="isYouTubeConnecting" @click="connectYouTube">
              {{ isYouTubeConnecting ? "Connecting…" : "Connect YouTube" }}
            </button>
            <div v-else-if="project.workflowStage === 'reviewed'" class="reel-youtube-controls">
              <select v-model="youtubeVisibility" aria-label="YouTube visibility">
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
              <button type="button" class="reel-button reel-button-primary" :disabled="isPublishingYouTube" @click="publishToYouTube">
                {{ isPublishingYouTube ? "Publishing…" : "Publish to YouTube" }}
              </button>
            </div>
            <p v-else class="reel-hint">Published to YouTube. Edit the storyboard to create a new publishable revision.</p>
            <a v-if="youtubeVideoUrl" class="reel-link" :href="youtubeVideoUrl" target="_blank" rel="noreferrer">Open on YouTube</a>
          </div>
        </section>

        <section class="reel-card">
          <div class="reel-card-header">
            <h2>Recent reels</h2>
          </div>
          <p v-if="isLoadingProjects" class="reel-hint">Loading…</p>
          <p v-else-if="projects.length === 0" class="reel-hint">Your reels will show up here.</p>
          <ul v-else class="reel-history">
            <li v-for="entry in projects" :key="entry.id" :class="{ 'reel-history-active': entry.id === project?.id }">
              <button type="button" class="reel-history-open" @click="openProject(entry.id)">
                <img v-if="entry.posterUrl" :src="entry.posterUrl" alt="" />
                <span v-else class="reel-history-thumb" :class="`reel-style-${entry.settings.style}`" />
                <span class="reel-history-text">
                  <strong>{{ entry.title }}</strong>
                  <small>
                    <span class="reel-status" :class="`reel-status-${entry.status}`">{{ workflowLabel(entry.workflowStage) }}</span>
                    {{ formatDate(entry.createdAt) }}
                  </small>
                </span>
              </button>
              <button
                type="button"
                class="reel-icon-button"
                aria-label="Delete reel"
                :disabled="entry.status === 'queued' || entry.status === 'rendering'"
                @click="deleteProject(entry.id)"
              >
                <component :is="actionIcons.delete" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
              </button>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.reel-page {
  display: grid;
  gap: 1.25rem;
}

.reel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.reel-header h1 {
  margin: 0.25rem 0 0.5rem;
  font-family: var(--fc-font-family-display);
  font-size: clamp(1.6rem, 3vw, 2.3rem);
  line-height: 1.15;
}

.reel-eyebrow {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fc-accent);
}

.reel-copy {
  margin: 0;
  max-width: 62ch;
  color: var(--fc-text-muted);
}

.reel-feedback {
  margin: 0;
  padding: 0.75rem 1rem;
  border-radius: var(--fc-radius-control);
}

.reel-feedback-error {
  background: var(--fc-error-bg);
  color: var(--fc-error-text, #9f2a1c);
}

.reel-feedback-success {
  background: var(--fc-success-bg);
  color: var(--fc-success-text);
}

.reel-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 1.25rem;
  align-items: start;
}

.reel-main,
.reel-side {
  display: grid;
  gap: 1.25rem;
}

.reel-side {
  position: sticky;
  top: 1rem;
}

.reel-card {
  display: grid;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid var(--fc-border);
  border-radius: var(--fc-radius-panel);
  background: var(--fc-panel-bg);
  box-shadow: var(--fc-panel-shadow);
}

.reel-card-header {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.reel-card-header h2 {
  margin: 0;
  font-size: 1.1rem;
}

.reel-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background: var(--fc-accent);
  color: var(--fc-accent-contrast);
  font-weight: 700;
  font-size: 0.85rem;
}

.reel-meta,
.reel-hint,
.reel-scene-words {
  margin: 0;
  font-size: 0.85rem;
  color: var(--fc-text-muted);
}

.reel-meta {
  margin-left: auto;
}

.reel-workflow-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.3rem 0.55rem;
  border: 1px solid rgba(111, 126, 162, 0.25);
  border-radius: 999px;
  color: #52607a;
  font-size: 0.72rem;
  font-weight: 700;
  white-space: nowrap;
}

.reel-workflow-approved,
.reel-workflow-rendered {
  border-color: rgba(69, 114, 214, 0.3);
  color: #315fae;
}

.reel-workflow-reviewed,
.reel-workflow-published {
  border-color: rgba(30, 142, 93, 0.3);
  color: #19704b;
}

.reel-prompt,
.reel-field input,
.reel-field select,
.reel-field textarea,
.reel-compare textarea,
.reel-regenerate input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--fc-input-border, var(--fc-border));
  border-radius: var(--fc-radius-control);
  background: var(--fc-input-bg, var(--fc-surface-strong));
  color: var(--fc-text);
  font: inherit;
}

.reel-prompt {
  resize: vertical;
  font-size: 1rem;
}

.reel-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.reel-chip {
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: var(--fc-chip-bg, var(--fc-surface-muted));
  color: var(--fc-text-muted);
  font: inherit;
  font-size: 0.82rem;
  text-align: left;
  cursor: pointer;
}

.reel-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
}

.reel-field {
  display: grid;
  gap: 0.35rem;
  font-size: 0.85rem;
}

.reel-field > span {
  font-weight: 600;
  color: var(--fc-text-muted);
}

.reel-field-inline {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  align-self: end;
  padding-bottom: 0.65rem;
}

.reel-field-inline input {
  width: auto;
}

.reel-styles {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}

.reel-style {
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem;
  border: 2px solid var(--fc-border);
  border-radius: var(--fc-radius-control);
  background: var(--fc-surface-strong);
  color: var(--fc-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.reel-style small {
  color: var(--fc-text-muted);
}

.reel-style-active {
  border-color: var(--fc-accent);
}

.reel-style-swatch,
.reel-history-thumb {
  display: block;
  height: 2.5rem;
  border-radius: 8px;
}

.reel-style-neon_tech .reel-style-swatch,
.reel-history-thumb.reel-style-neon_tech {
  background: radial-gradient(circle at 20% 30%, #b45cff88, transparent 60%), radial-gradient(circle at 80% 80%, #22e4ff77, transparent 60%), #050712;
}

.reel-style-minimal_motion .reel-style-swatch,
.reel-history-thumb.reel-style-minimal_motion {
  background: radial-gradient(circle at 85% 20%, #ff5a3640, transparent 50%), #f6f3ec;
  border: 1px solid var(--fc-border);
}

.reel-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.reel-actions-stack {
  justify-content: stretch;
}

.reel-actions-stack .reel-button {
  flex: 1;
  justify-content: center;
}

.reel-button {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.65rem 1.1rem;
  border-radius: var(--fc-radius-control);
  border: 1px solid transparent;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.reel-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.reel-button-primary {
  background: var(--fc-accent);
  color: var(--fc-accent-contrast);
  box-shadow: var(--fc-accent-shadow);
}

.reel-button-ghost {
  background: transparent;
  border-color: var(--fc-border);
  color: var(--fc-text);
}

.reel-scenes {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reel-scene {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--fc-border);
  border-radius: var(--fc-radius-control);
  background: var(--fc-surface-strong);
}

.reel-scene-top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.reel-scene-index {
  font-weight: 700;
  color: var(--fc-text-muted);
}

.reel-scene-type {
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--fc-chip-bg, var(--fc-surface-muted));
  font-size: 0.78rem;
  font-weight: 700;
}

.reel-scene-words {
  margin-left: auto;
}

.reel-scene-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
}

.reel-node-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 0.5rem;
  grid-column: 1 / -1;
}

.reel-compare {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  grid-column: 1 / -1;
}

.reel-compare > div {
  display: grid;
  gap: 0.5rem;
}

.reel-code {
  font-family: ui-monospace, "SFMono-Regular", Menlo, monospace;
  font-size: 0.85rem;
}

.reel-regenerate {
  display: flex;
  gap: 0.5rem;
}

.reel-player {
  overflow: hidden;
  aspect-ratio: 9 / 16;
  border-radius: var(--fc-radius-control);
  background: #050712;
}

.reel-player video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.reel-player-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

.reel-progress {
  display: grid;
  gap: 0.75rem;
  width: 100%;
  padding: 1.5rem;
  box-sizing: border-box;
  color: #e6e9f5;
  text-align: center;
}

.reel-progress small {
  color: #9aa4c7;
}

.reel-progress-track {
  height: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.reel-progress-fill {
  height: 100%;
  border-radius: 8px;
  background: linear-gradient(90deg, #22e4ff, #b45cff);
  transition: width 0.6s ease;
}

.reel-stages {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 0.85rem;
  color: #6b7394;
  text-align: left;
}

.reel-stage-done {
  color: #9aa4c7;
  text-decoration: line-through;
}

.reel-stage-active {
  color: #22e4ff;
  font-weight: 700;
}

.reel-caption {
  display: grid;
  gap: 0.4rem;
  font-size: 0.88rem;
}

.reel-caption-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
  color: var(--fc-text-muted);
}

.reel-caption p {
  margin: 0;
  white-space: pre-line;
}

.reel-youtube {
  display: grid;
  gap: 0.7rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--fc-border-subtle);
}

.reel-youtube-connected {
  color: #19704b;
  font-size: 0.75rem;
  font-weight: 700;
}

.reel-youtube-controls {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.reel-youtube-controls select {
  min-height: 2.25rem;
  padding: 0 0.6rem;
  border: 1px solid var(--fc-border);
  border-radius: 0.55rem;
  background: var(--fc-surface);
  color: var(--fc-text);
}

.reel-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: none;
  background: none;
  color: var(--fc-accent);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.reel-history {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.reel-history li {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: var(--fc-radius-control);
}

.reel-history-active {
  background: var(--fc-surface-muted);
}

.reel-history-open {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 0.65rem;
  padding: 0.4rem;
  border: none;
  background: none;
  color: var(--fc-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.reel-history-open img,
.reel-history-thumb {
  flex-shrink: 0;
  width: 2.5rem;
  height: 4.4rem;
  border-radius: 6px;
  object-fit: cover;
}

.reel-history-text {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.reel-history-text strong {
  overflow: hidden;
  font-size: 0.88rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reel-history-text small {
  color: var(--fc-text-muted);
}

.reel-status {
  margin-right: 0.35rem;
  font-weight: 700;
}

.reel-status-ready {
  color: var(--fc-success-text);
}

.reel-status-failed {
  color: var(--fc-error-text, #b42318);
}

.reel-status-queued,
.reel-status-rendering {
  color: var(--fc-accent);
}

.reel-icon-button {
  padding: 0.45rem;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--fc-text-muted);
  cursor: pointer;
}

.reel-icon-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 980px) {
  .reel-layout {
    grid-template-columns: 1fr;
  }

  .reel-side {
    position: static;
  }

  .reel-output .reel-player {
    max-width: 360px;
    margin: 0 auto;
  }
}

@media (max-width: 560px) {
  .reel-header {
    flex-direction: column;
  }

  .reel-styles,
  .reel-compare {
    grid-template-columns: 1fr;
  }

  .reel-regenerate {
    flex-direction: column;
  }
}
</style>
