<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ContentAsset } from "../../../../packages/shared-types";
import PipelineCard from "./PipelineCard.vue";
import type { PipelineCardModel, PipelineColumnModel, PipelineDraftState } from "./dashboard-types";

const props = defineProps<{
  columns: PipelineColumnModel[];
  empty: boolean;
}>();

const emit = defineEmits<{
  (event: "edit", asset: ContentAsset): void;
  (event: "advance", asset: ContentAsset): void;
  (event: "save", asset: ContentAsset): void;
  (event: "close"): void;
  (event: "open-creator"): void;
  (event: "update-draft", assetId: string, draft: PipelineDraftState): void;
  (event: "speak-now"): void;
}>();

const selectedStage = ref<PipelineColumnModel["stage"] | "">("");

const stageTabs = computed(() => props.columns);
const activeColumn = computed(() => {
  if (stageTabs.value.length === 0) {
    return null;
  }

  return (
    stageTabs.value.find((column) => column.stage === selectedStage.value) ??
    stageTabs.value.find((column) => column.items.length > 0) ??
    stageTabs.value[0]
  );
});

watch(
  () => props.columns,
  (columns) => {
    if (columns.length === 0) {
      selectedStage.value = "";
      return;
    }

    const hasSelectedColumn = columns.some((column) => column.stage === selectedStage.value);

    if (!hasSelectedColumn) {
      selectedStage.value = columns.find((column) => column.items.length > 0)?.stage ?? columns[0].stage;
    }
  },
  { immediate: true },
);
</script>

<template>
  <section id="dashboard-pipeline" class="dashboard-panel">
    <div class="panel-header">
      <div>
        <p class="panel-meta">Content Pipeline</p>
        <h2>Draft → Ready → Scheduled → Posted</h2>
      </div>
    </div>

    <div v-if="empty" class="pipeline-empty-state">
      <p class="pipeline-empty">No content yet. Start by speaking your first idea or generating a draft.</p>
      <div class="action-row">
        <button type="button" class="dashboard-button" @click="emit('speak-now')">
          Speak now
        </button>
        <button type="button" class="dashboard-button secondary" @click="emit('open-creator')">
          Write now
        </button>
      </div>
    </div>

    <div class="pipeline-tabs" role="tablist" aria-label="Pipeline stages">
      <button
        v-for="column in stageTabs"
        :key="column.stage"
        type="button"
        class="pipeline-tab"
        :class="{ active: activeColumn?.stage === column.stage }"
        @click="selectedStage = column.stage"
      >
        <span>{{ column.label }}</span>
        <strong>{{ column.items.length }}</strong>
      </button>
    </div>

    <article v-if="activeColumn" class="pipeline-stage-panel">
      <div class="pipeline-column-header">
        <div>
          <strong>{{ activeColumn.label }}</strong>
          <p class="pipeline-stage-copy">
            {{ activeColumn.items.length === 0 ? `No items in ${activeColumn.label.toLowerCase()}.` : `${activeColumn.items.length} item${activeColumn.items.length === 1 ? "" : "s"} in ${activeColumn.label.toLowerCase()}.` }}
          </p>
        </div>
        <span>{{ activeColumn.items.length }}</span>
      </div>

      <p v-if="activeColumn.items.length === 0" class="pipeline-empty">
        No items in {{ activeColumn.label.toLowerCase() }}.
      </p>

      <div v-else class="pipeline-stage-stack">
        <PipelineCard
          v-for="item in activeColumn.items"
          :key="item.asset.id"
          :model="item"
          @edit="emit('edit', $event)"
          @advance="emit('advance', $event)"
          @save="emit('save', $event)"
          @close="emit('close')"
          @open-creator="emit('open-creator')"
          @update-draft="(assetId, draft) => emit('update-draft', assetId, draft)"
        />
      </div>
    </article>
  </section>
</template>

<style scoped>
.pipeline-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.pipeline-tab {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 18px;
  border: 1px solid var(--fc-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-panel-bg) 90%, var(--fc-surface-muted));
  color: var(--fc-text);
  font: inherit;
  cursor: pointer;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease;
}

.pipeline-tab strong {
  display: inline-flex;
  min-width: 28px;
  justify-content: center;
  color: var(--fc-text-muted);
}

.pipeline-tab.active {
  border-color: color-mix(in srgb, var(--fc-accent) 45%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-accent) 14%, var(--fc-panel-bg));
}

.pipeline-tab.active strong {
  color: var(--fc-accent-strong);
}

.pipeline-stage-panel {
  display: grid;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--fc-border);
  border-radius: calc(var(--fc-radius-panel) - 2px);
  background: color-mix(in srgb, var(--fc-panel-bg) 90%, var(--fc-surface-muted));
}

.pipeline-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.pipeline-column-header span {
  color: var(--fc-text-muted);
  font-size: 0.92rem;
}

.pipeline-stage-copy {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  line-height: 1.5;
}

.pipeline-stage-stack {
  display: grid;
  gap: 16px;
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

@media (max-width: 760px) {
  .pipeline-tab {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
