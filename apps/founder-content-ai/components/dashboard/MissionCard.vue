<script setup lang="ts">
import type { MissionState, MissionTask } from "./dashboard-types";

defineProps<{
  mission: MissionState | null;
}>();

const emit = defineEmits<{
  (event: "task-action", task: MissionTask): void;
  (event: "primary-action", task: MissionTask): void;
}>();
</script>

<template>
  <section class="dashboard-panel mission-card">
    <div class="mission-header">
      <div>
        <p class="panel-meta">Today's Mission</p>
        <h2>{{ mission?.missionAsset?.title ?? "Create your next post" }}</h2>
      </div>

      <div class="mission-score">
        <strong>{{ mission?.score ?? 56 }}</strong>
        <span>→ {{ mission?.targetScore ?? 85 }}</span>
      </div>
    </div>

    <div class="mission-checklist">
      <article v-for="task in mission?.tasks ?? []" :key="task.label" class="mission-task">
        <div class="mission-task-copy">
          <span class="mission-checkbox" aria-hidden="true" />
          <div>
            <strong>{{ task.label }}</strong>
            <p>{{ task.hint }}</p>
          </div>
        </div>

        <button
          type="button"
          class="dashboard-button secondary small-button"
          @click="emit('task-action', task)"
        >
          {{ task.actionLabel }}
        </button>
      </article>
    </div>

    <div
      v-if="mission?.consequence"
      class="mission-consequence"
      :data-tone="mission.consequenceTone ?? 'warning'"
    >
      <span>If you don't do this</span>
      <strong>{{ mission.consequence }}</strong>
    </div>

    <div class="mission-footer">
      <p class="mission-time">{{ mission?.bestTimeDescription }}</p>
      <button
        v-if="mission?.primaryAction"
        type="button"
        class="dashboard-button"
        @click="emit('primary-action', mission.primaryAction)"
      >
        {{ mission.primaryAction.actionLabel }} →
      </button>
    </div>
  </section>
</template>

<style scoped>
.mission-card {
  display: grid;
  gap: 18px;
}

.mission-header,
.mission-task,
.mission-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: start;
}

.mission-header h2 {
  margin: 0;
}

.mission-score {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--fc-accent) 12%, var(--fc-panel-bg));
}

.mission-score strong {
  font-size: 1.5rem;
}

.mission-score span {
  color: var(--fc-text-muted);
}

.mission-checklist {
  display: grid;
  gap: 12px;
}

.mission-consequence {
  display: grid;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--fc-error-text) 18%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--fc-error-bg) 48%, var(--fc-panel-bg));
}

.mission-consequence span {
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.mission-consequence[data-tone="warning"] {
  border-color: color-mix(in srgb, var(--fc-warning-text) 18%, transparent);
  background: color-mix(in srgb, var(--fc-warning-bg) 44%, var(--fc-panel-bg));
}

.mission-consequence[data-tone="critical"] {
  border-color: color-mix(in srgb, var(--fc-error-text) 18%, transparent);
  background: color-mix(in srgb, var(--fc-error-bg) 48%, var(--fc-panel-bg));
}

.mission-task {
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
}

.mission-task-copy {
  display: flex;
  gap: 12px;
}

.mission-task-copy p,
.mission-time {
  margin: 4px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.mission-checkbox {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border: 2px solid var(--fc-accent);
  border-radius: 999px;
}

@media (max-width: 760px) {
  .mission-header,
  .mission-task,
  .mission-footer {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
