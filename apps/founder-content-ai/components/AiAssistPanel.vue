<script setup lang="ts">
import type { AiAssistSuggestion } from "../composables/use-ai-assist";

defineProps<{
  title?: string;
  suggestions: AiAssistSuggestion[];
}>();
</script>

<template>
  <section v-if="suggestions.length > 0" class="ai-assist-panel">
    <div class="ai-assist-header">
      <p class="dashboard-eyebrow">AI Assist</p>
      <h2>{{ title ?? "Suggested next moves" }}</h2>
    </div>

    <div class="ai-assist-grid">
      <article v-for="suggestion in suggestions" :key="suggestion.id" class="ai-assist-card">
        <strong>{{ suggestion.title }}</strong>
        <p>{{ suggestion.description }}</p>
        <router-link
          v-if="suggestion.ctaLabel && suggestion.ctaTo"
          class="dashboard-button secondary"
          :to="suggestion.ctaTo"
        >
          {{ suggestion.ctaLabel }}
        </router-link>
      </article>
    </div>
  </section>
</template>
