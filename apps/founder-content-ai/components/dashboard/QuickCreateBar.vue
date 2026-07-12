<script setup lang="ts">
import InactivityPulse from "./InactivityPulse.vue";
import { aiFeatureIcons, iconSizes, iconStrokeWidth } from "../../src/icons";

defineProps<{
  bestTimeLabel: string;
  inactivityMessage: string;
  inactivityActive: boolean;
  dailyIdeaLoading?: boolean;
  writeDisabled?: boolean;
  dailyIdeaDisabled?: boolean;
}>();

const emit = defineEmits<{
  (event: "write"): void;
  (event: "daily-idea"): void;
}>();
</script>

<template>
  <div class="quick-create-bar">
    <div class="quick-create-copy">
      <p class="panel-meta">New Post</p>
      <h2>Start one clear move.</h2>
      <p class="quick-create-description">
        Use the creator for writing, voice capture, or repurposing. Keep the dashboard focused on the next decision.
      </p>
    </div>

    <div class="quick-create-actions">
      <button type="button" class="dashboard-button" :disabled="writeDisabled" @click="emit('write')">
        <span class="quick-create-button-icon">
          <component :is="aiFeatureIcons.generate" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
        </span>
        New post
      </button>
      <button
        type="button"
        class="dashboard-button secondary"
        :disabled="dailyIdeaLoading || dailyIdeaDisabled"
        @click="emit('daily-idea')"
      >
        <span class="quick-create-button-icon">
          <component :is="aiFeatureIcons.idea" :size="iconSizes.dense" :stroke-width="iconStrokeWidth" />
        </span>
        {{ dailyIdeaLoading ? "Thinking..." : "Get today's idea" }}
      </button>
    </div>

    <div class="quick-create-status">
      <span class="topbar-pill">{{ bestTimeLabel }}</span>
      <InactivityPulse :active="inactivityActive" :message="inactivityMessage" />
    </div>
  </div>
</template>

<style scoped>
.quick-create-bar {
  display: grid;
  gap: 16px;
}

.quick-create-copy,
.quick-create-actions,
.quick-create-status {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.quick-create-copy {
  display: grid;
  gap: 8px;
}

.quick-create-copy h2 {
  margin: 0;
}

.quick-create-description {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.quick-create-actions {
  align-items: stretch;
}

.quick-create-button-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
}

.quick-create-button-icon :deep(svg) {
  display: block;
}

.quick-create-status {
  justify-content: flex-start;
}

@media (max-width: 760px) {
  .quick-create-copy,
  .quick-create-actions,
  .quick-create-status {
    width: 100%;
  }
}
</style>
