<script setup lang="ts">
import { ref } from "vue";
import { requestLinkedInPostGeneration } from "../services/generation-service";
import type { LinkedInPostVariation } from "../../../packages/shared-types";

const topic = ref("startup failure lesson");
const tone = ref("storytelling");
const length = ref("medium");
const selectedHook = ref("");
const variations = ref<LinkedInPostVariation[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");

async function handleSubmit() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const response = await requestLinkedInPostGeneration({
      topic: topic.value,
      tone: tone.value,
      length: length.value,
      selectedHook: selectedHook.value || undefined,
    });

    variations.value = response.variations;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to generate LinkedIn posts.";
  } finally {
    isLoading.value = false;
  }
}
</script>

<template>
  <main class="page-shell">
    <section class="hero">
      <p class="eyebrow">/linkedin-post-generator</p>
      <h1>LinkedIn Post Generator</h1>
      <p class="description">
        Generate three LinkedIn-ready founder post variations from a single topic.
      </p>
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
        <input v-model="selectedHook" type="text" placeholder="The mistake that almost killed my startup" />
      </label>

      <button type="submit" :disabled="isLoading">
        {{ isLoading ? "Generating..." : "Generate posts" }}
      </button>
    </form>

    <p v-if="errorMessage" class="feedback error">{{ errorMessage }}</p>

    <section v-if="variations.length > 0" class="results-grid">
      <article v-for="variation in variations" :key="variation.angle" class="card">
        <p class="result-label">{{ variation.angle }}</p>
        <pre>{{ variation.content }}</pre>
      </article>
    </section>
  </main>
</template>

<style scoped>
.page-shell {
  margin: 0 auto;
  max-width: 960px;
  padding: 48px 24px 72px;
  color: #1c1917;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
}

.hero {
  margin-bottom: 24px;
}

.eyebrow {
  margin: 0 0 12px;
  color: #78716c;
  font-size: 0.875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.description {
  max-width: 680px;
  color: #57534e;
  line-height: 1.6;
}

.card {
  padding: 24px;
  border: 1px solid #e7e5e4;
  border-radius: 20px;
  background: #fafaf9;
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
  border: 1px solid #d6d3d1;
  border-radius: 12px;
  font: inherit;
}

button {
  width: fit-content;
  padding: 12px 18px;
  border: 0;
  border-radius: 999px;
  background: #1c1917;
  color: #fafaf9;
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
  color: #b91c1c;
}

.results-grid {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}

.result-label {
  margin: 0 0 12px;
  color: #78716c;
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

h1 {
  margin: 0;
}
</style>
