<script setup lang="ts">
import type { OutreachLead } from "../../../../packages/shared-types";
import { iconSizes, iconStrokeWidth, resolveProspectStatusIcon } from "../../src/icons";

defineProps<{
  lead: OutreachLead;
  selected?: boolean;
}>();

const emit = defineEmits<{
  (event: "select", lead: OutreachLead): void;
}>();
</script>

<template>
  <button
    type="button"
    class="lead-card"
    :data-selected="selected"
    :data-priority="lead.priority"
    @click="emit('select', lead)"
  >
    <div class="lead-card-top">
      <div>
        <strong>{{ lead.name }}</strong>
        <p>{{ lead.role }}</p>
      </div>
      <span class="lead-meta-stack">
        <span class="lead-status-pill" :data-status="lead.status">
          <component
            :is="resolveProspectStatusIcon(lead.status)"
            :size="iconSizes.dense"
            :stroke-width="iconStrokeWidth"
          />
          {{ lead.status }}
        </span>
        <span class="lead-platform">{{ lead.platform }}</span>
      </span>
    </div>

    <p class="lead-post">{{ lead.recentPost }}</p>

    <div class="lead-meta-row">
      <span>Engagement: {{ lead.engagementLabel }}</span>
      <span>Priority: {{ lead.priority }}</span>
    </div>

    <div class="lead-meta-row">
      <span>Status: {{ lead.status }}</span>
      <span>Score: {{ lead.priorityScore }}</span>
    </div>
  </button>
</template>

<style scoped>
.lead-card {
  display: grid;
  gap: 12px;
  width: 100%;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
  color: var(--fc-text);
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.lead-card[data-selected="true"] {
  border-color: color-mix(in srgb, var(--fc-accent) 46%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent) 8%, var(--fc-panel-bg));
}

.lead-card[data-priority="high"] {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fc-success-text) 18%, transparent);
}

.lead-card-top,
.lead-meta-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: start;
}

.lead-card-top p,
.lead-post,
.lead-meta-row span {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.lead-platform {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--fc-surface-muted);
  color: var(--fc-text);
  font-size: 0.8rem;
  text-transform: capitalize;
}

.lead-meta-stack {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.lead-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-accent) 10%, var(--fc-surface-muted));
  color: var(--fc-text);
  font-size: 0.8rem;
  text-transform: capitalize;
}

.lead-status-pill :deep(svg) {
  display: block;
}

.lead-post {
  color: var(--fc-text);
}
</style>
