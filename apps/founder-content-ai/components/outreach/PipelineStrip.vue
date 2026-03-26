<script setup lang="ts">
import type { OutreachLeadStatus, OutreachPipelineStage } from "../../../../packages/shared-types";

defineProps<{
  stages: OutreachPipelineStage[];
  activeStatus: OutreachLeadStatus | null;
}>();

const emit = defineEmits<{
  (event: "select-stage", status: OutreachLeadStatus | null): void;
}>();
</script>

<template>
  <section class="dashboard-panel pipeline-strip">
    <div class="panel-header">
      <div>
        <p class="panel-meta">Pipeline</p>
        <h2>Lead Flow</h2>
      </div>
      <button
        type="button"
        class="topbar-pill"
        :data-active="activeStatus === null"
        @click="emit('select-stage', null)"
      >
        All leads
      </button>
    </div>

    <div class="pipeline-stage-row">
      <button
        v-for="stage in stages"
        :key="stage.key"
        type="button"
        class="pipeline-stage-button"
        :data-active="activeStatus === stage.key"
        @click="emit('select-stage', activeStatus === stage.key ? null : stage.key)"
      >
        <span>{{ stage.label }}</span>
        <strong>{{ stage.count }}</strong>
      </button>
    </div>
  </section>
</template>

<style scoped>
.pipeline-strip,
.pipeline-stage-row {
  display: grid;
  gap: 16px;
}

.pipeline-stage-row {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.pipeline-stage-button {
  display: grid;
  gap: 6px;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
  color: var(--fc-text);
  text-align: left;
  font: inherit;
  cursor: pointer;
}

.pipeline-stage-button span {
  color: var(--fc-text-muted);
  font-size: 0.82rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.pipeline-stage-button strong {
  font-size: 1.45rem;
}

.pipeline-stage-button[data-active="true"],
.topbar-pill[data-active="true"] {
  border-color: color-mix(in srgb, var(--fc-accent) 44%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent) 10%, var(--fc-panel-bg));
}

@media (max-width: 860px) {
  .pipeline-stage-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .pipeline-stage-row {
    grid-template-columns: 1fr;
  }
}
</style>
