<script setup lang="ts">
import { ref } from "vue";
import { requestHookGeneration } from "../services/generation-service";

const topic = ref("startup failure");
const hooks = ref<string[]>([]);
const isLoading = ref(false);
const errorMessage = ref("");

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

    <section v-if="hooks.length > 0" class="results-grid">
      <article v-for="hook in hooks" :key="hook" class="card">
        <h2>{{ hook }}</h2>
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

h1,
h2 {
  margin: 0;
}

h2 {
  font-size: 1.1rem;
  line-height: 1.5;
}
</style>
