<script setup lang="ts">
import { ref } from "vue";
import { requestIdeaGeneration } from "../services/generation-service";
import type { IdeaOption } from "../../../packages/shared-types";

const industry = ref("SaaS");
const stage = ref("early startup");
const ideas = ref<IdeaOption[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");

async function handleSubmit() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await requestIdeaGeneration({
      industry: industry.value,
      stage: stage.value,
    });

    ideas.value = response.ideas;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to generate founder content ideas.";
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <main class="page-shell">
    <section class="hero">
      <p class="eyebrow">/founder-content-ideas</p>
      <h1>Founder Content Ideas</h1>
      <p class="description">
        Generate founder-specific ideas based on your industry and startup stage.
      </p>
    </section>

    <form class="card form-grid" @submit.prevent="handleSubmit">
      <label>
        <span>Industry</span>
        <input v-model="industry" type="text" placeholder="SaaS" />
      </label>

      <label>
        <span>Stage</span>
        <input v-model="stage" type="text" placeholder="early startup" />
      </label>

      <button type="submit" :disabled="isLoading">
        {{ isLoading ? "Generating..." : "Generate ideas" }}
      </button>
    </form>

    <p v-if="errorMessage" class="feedback error">{{ errorMessage }}</p>

    <section v-if="ideas.length > 0" class="results-grid">
      <article v-for="idea in ideas" :key="idea.title" class="card">
        <h2>{{ idea.title }}</h2>
        <p>{{ idea.angle }}</p>
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
}

p {
  line-height: 1.6;
}
</style>
