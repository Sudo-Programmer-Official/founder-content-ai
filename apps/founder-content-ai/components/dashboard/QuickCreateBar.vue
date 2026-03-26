<script setup lang="ts">
import InactivityPulse from "./InactivityPulse.vue";

defineProps<{
  bestTimeLabel: string;
  inactivityMessage: string;
  inactivityActive: boolean;
  dailyIdeaLoading?: boolean;
}>();

const emit = defineEmits<{
  (event: "speak"): void;
  (event: "write"): void;
  (event: "repurpose"): void;
  (event: "daily-idea"): void;
}>();
</script>

<template>
  <div class="quick-create-bar">
    <div class="quick-create-actions">
      <button type="button" class="dashboard-button secondary" @click="emit('speak')">
        Speak
      </button>
      <button type="button" class="dashboard-button" @click="emit('write')">
        Write
      </button>
      <button type="button" class="dashboard-button secondary" @click="emit('repurpose')">
        Repurpose
      </button>
      <button
        type="button"
        class="dashboard-button secondary"
        :disabled="dailyIdeaLoading"
        @click="emit('daily-idea')"
      >
        {{ dailyIdeaLoading ? "Thinking..." : "What should I post today?" }}
      </button>
    </div>

    <div class="quick-create-status">
      <span class="topbar-pill">{{ bestTimeLabel }}</span>
      <InactivityPulse :active="inactivityActive" :message="inactivityMessage" />
    </div>
  </div>
</template>

<style scoped>
.quick-create-bar,
.quick-create-actions,
.quick-create-status {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.quick-create-bar {
  display: grid;
  gap: 14px;
  justify-content: stretch;
}

.quick-create-actions {
  align-items: stretch;
}

.quick-create-status {
  justify-content: flex-start;
}

@media (max-width: 760px) {
  .quick-create-actions,
  .quick-create-status {
    width: 100%;
  }
}
</style>
