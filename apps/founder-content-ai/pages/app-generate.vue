<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProductAccessContext } from "../access/product-access-context";
import VoiceRecorder from "../components/VoiceRecorder.vue";
import { requestRepurposeContent } from "../services/generation-service";
import {
  getActivationDraft,
  saveActivationDraft,
} from "../services/activation-flow-service";
import { appRoutes } from "../utils/routes";

const exampleIdeas = [
  "Building in public is messy, but it makes trust compound faster.",
  "Most founders do not need more ideas. They need a system to ship content consistently.",
  "The loneliest part of building a startup is acting confident while everything feels uncertain.",
];

const toneOptions = [
  { label: "Founder", value: "storytelling" },
  { label: "Direct", value: "direct" },
  { label: "Professional", value: "professional" },
] as const;

const route = useRoute();
const router = useRouter();
const { bootstrap } = useProductAccessContext();

const input = ref("");
const tone = ref<(typeof toneOptions)[number]["value"]>("storytelling");
const isLoading = ref(false);
const errorMessage = ref("");
const helperMessage = ref("Paste a thought, saved post, or rough idea. Voice works too.");
const improvementSourceId = ref("");

const pageTitle = computed(() =>
  improvementSourceId.value ? "Improve the post you already have" : "Turn your idea into a post",
);
const pageDescription = computed(() =>
  improvementSourceId.value
    ? "We will use your previous draft as input and tighten the hook, structure, and clarity."
    : "Start with one thought. Get a usable post, hooks, and next actions in one step.",
);
const submitLabel = computed(() => (isLoading.value ? "Generating..." : "Generate post"));

async function hydrateImprovementState(): Promise<void> {
  const improveId = typeof route.query.improve === "string" ? route.query.improve : "";

  if (!improveId) {
    improvementSourceId.value = "";
    if (!route.query.prefill && helperMessage.value.includes("improving")) {
      helperMessage.value = "Paste a thought, saved post, or rough idea. Voice works too.";
    }
    return;
  }

  const storedDraft = getActivationDraft(improveId);

  if (!storedDraft) {
    improvementSourceId.value = "";
    helperMessage.value = "We could not load that previous draft. Paste the post you want to improve.";
    return;
  }

  improvementSourceId.value = storedDraft.id;
  input.value = storedDraft.result.post;
  helperMessage.value = "You are improving a previous draft. Adjust the input before regenerating if needed.";
}

async function generatePost(): Promise<void> {
  if (!input.value.trim()) {
    errorMessage.value = "Add one idea before generating.";
    return;
  }

  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await requestRepurposeContent({
      inputType: "text",
      intent: improvementSourceId.value ? "reference" : "capture",
      text: input.value.trim(),
      tone: tone.value,
      businessId: bootstrap.value?.activeBusinessId ?? undefined,
    });
    const draft = saveActivationDraft({
      input: input.value.trim(),
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
  () => route.query.improve,
  () => {
    void hydrateImprovementState();
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
      <p class="activation-eyebrow">/app/generate</p>
      <h1>{{ pageTitle }}</h1>
      <p class="activation-description">{{ pageDescription }}</p>
      <div class="activation-chip-row">
        <span class="activation-chip">Value in one step</span>
        <span class="activation-chip">Hooks + post + next actions</span>
        <span class="activation-chip">Cmd/Ctrl + Enter to generate</span>
      </div>
    </section>

    <section class="activation-panel">
      <div class="activation-panel-header">
        <div>
          <p class="panel-meta">Input</p>
          <h2>Bring one idea</h2>
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

      <textarea
        v-model="input"
        class="activation-textarea"
        placeholder="Paste your idea, tweet, thought, or rough note here..."
      />

      <div class="activation-helper-row">
        <p class="activation-helper">{{ helperMessage }}</p>
        <VoiceRecorder
          title="Speak the idea instead"
          hint="Record one thought, review the transcript, then generate."
          @transcribed="handleVoiceTranscript"
        />
      </div>

      <div class="example-row">
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

      <div class="activation-actions">
        <button type="button" class="primary-action" :disabled="isLoading" @click="generatePost">
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

@media (max-width: 720px) {
  .activation-helper-row {
    flex-direction: column;
  }
}
</style>
