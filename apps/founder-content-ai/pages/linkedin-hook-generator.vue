<script setup lang="ts">
import { ref } from "vue";
import { trackAnalyticsEvent } from "../services/admin-analytics-service";
import { requestHookGeneration } from "../services/generation-service";

const topic = ref("startup failure");
const hooks = ref<string[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");
const copyFeedback = ref("");

async function handleSubmit() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await requestHookGeneration({
      topic: topic.value,
    });

    hooks.value = response.hooks;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to generate LinkedIn hooks.";
  } finally {
    isLoading.value = false;
  }
}

async function copyHook(hook: string) {
  copyFeedback.value = "";

  try {
    await navigator.clipboard.writeText(hook);
    copyFeedback.value = "Hook copied.";
  } catch (error) {
    copyFeedback.value = error instanceof Error ? error.message : "Unable to copy hook.";
    return;
  }

  try {
    await trackAnalyticsEvent({
      eventType: "output_copied",
      metadata: {
        source: "linkedin-hook-generator",
        contentType: "hook",
        preview: hook.slice(0, 120),
      },
    });
  } catch {
    // Copy succeeded; analytics failure should not block the UX.
  }
}
</script>

<template>
  <main class="page-shell">
    <section class="hero">
      <p class="eyebrow">/linkedin-hook-generator</p>
      <h1>LinkedIn Hook Generator</h1>
      <p class="description">
        Generate founder-specific hook options for a topic you want to post about.
      </p>
    </section>

    <form class="card form-grid" @submit.prevent="handleSubmit">
      <label>
        <span>Topic</span>
        <input v-model="topic" type="text" placeholder="startup failure" />
      </label>

      <button type="submit" :disabled="isLoading">
        {{ isLoading ? "Generating..." : "Generate hooks" }}
      </button>
    </form>

    <p v-if="errorMessage" class="feedback error">{{ errorMessage }}</p>
    <p v-if="copyFeedback" class="feedback">{{ copyFeedback }}</p>

    <section v-if="hooks.length > 0" class="results-grid">
      <article v-for="hook in hooks" :key="hook" class="card">
        <h2>{{ hook }}</h2>
        <button type="button" class="secondary-button" @click="copyHook(hook)">Copy hook</button>
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

.eyebrow {
  margin: 0 0 12px;
  color: var(--fc-text-muted);
  font-size: 0.875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.description {
  max-width: 680px;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.card {
  padding: 24px;
  border: 1px solid var(--fc-border);
  border-radius: var(--fc-radius-panel);
  background: var(--fc-panel-bg);
  box-shadow: var(--fc-panel-shadow);
}

.form-grid {
  display: grid;
  gap: 16px;
}

label {
  display: grid;
  gap: 8px;
}

input {
  padding: 12px 14px;
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
  margin-top: 16px;
  background: var(--fc-surface-muted);
  color: var(--fc-text);
}

.results-grid {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}

h1,
h2 {
  margin: 0;
}

h2 {
  font-size: 1.1rem;
  line-height: 1.5;
}
</style>
