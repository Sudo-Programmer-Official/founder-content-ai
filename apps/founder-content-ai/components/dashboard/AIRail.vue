<script setup lang="ts">
import { computed } from "vue";
import type { AISuggestion } from "./dashboard-types";

const props = defineProps<{
  suggestions: AISuggestion[];
}>();

const emit = defineEmits<{
  (event: "action", suggestion: AISuggestion): void;
}>();

const primarySuggestion = computed(
  () => props.suggestions.find((suggestion) => suggestion.recommended) ?? props.suggestions[0] ?? null,
);
const secondarySuggestions = computed(() =>
  props.suggestions.filter((suggestion) => suggestion !== primarySuggestion.value),
);
</script>

<template>
  <section class="dashboard-panel suggestion-panel" id="ai-suggestions">
    <div class="panel-header">
      <div>
        <p class="panel-meta">AI Strategist</p>
        <h2>Decision Engine</h2>
      </div>
      <span class="topbar-pill">{{ suggestions.length }}</span>
    </div>

    <article
      v-if="primarySuggestion"
      class="primary-recommendation"
      :data-severity="primarySuggestion.severity ?? 'important'"
    >
      <span class="suggestion-type">Recommended next move</span>
      <strong>{{ primarySuggestion.title }}</strong>
      <p>{{ primarySuggestion.description }}</p>
      <button
        type="button"
        class="dashboard-button"
        @click="emit('action', primarySuggestion)"
      >
        {{ primarySuggestion.actionLabel }}
      </button>
    </article>

    <div class="suggestion-grid">
      <article
        v-for="suggestion in secondarySuggestions"
        :key="`${suggestion.type}-${suggestion.title}`"
        class="suggestion-card"
      >
        <span class="suggestion-type">{{ suggestion.type }}</span>
        <strong>{{ suggestion.title }}</strong>
        <p>{{ suggestion.description }}</p>
        <button
          type="button"
          class="dashboard-button secondary small-button"
          @click="emit('action', suggestion)"
        >
          {{ suggestion.actionLabel }}
        </button>
      </article>

      <div v-if="suggestions.length === 0" class="pipeline-empty-state">
        <p class="pipeline-empty">No suggestions right now. The execution loop looks healthy.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.suggestion-panel {
  position: sticky;
  top: calc(var(--fc-header-padding-y) + 84px);
}

.suggestion-grid {
  display: grid;
  gap: 12px;
}

.primary-recommendation,
.suggestion-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
}

.primary-recommendation {
  margin-bottom: 12px;
}

.primary-recommendation[data-severity="critical"] {
  border-color: color-mix(in srgb, var(--fc-error-text) 18%, transparent);
  background: color-mix(in srgb, var(--fc-error-bg) 46%, var(--fc-panel-bg));
}

.primary-recommendation[data-severity="important"] {
  border-color: color-mix(in srgb, var(--fc-warning-text) 18%, transparent);
  background: color-mix(in srgb, var(--fc-warning-bg) 40%, var(--fc-panel-bg));
}

.primary-recommendation[data-severity="optional"] {
  border-color: color-mix(in srgb, var(--fc-success-text) 18%, transparent);
  background: color-mix(in srgb, var(--fc-success-bg) 40%, var(--fc-panel-bg));
}

.suggestion-type {
  color: var(--fc-text-muted);
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.suggestion-card p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.pipeline-empty-state {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px dashed var(--fc-border);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
}

.pipeline-empty {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

@media (max-width: 1080px) {
  .suggestion-panel {
    position: static;
  }
}
</style>
