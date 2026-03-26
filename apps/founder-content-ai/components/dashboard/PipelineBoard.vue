<script setup lang="ts">
import type { ContentAsset } from "../../../../packages/shared-types";
import PipelineCard from "./PipelineCard.vue";
import type { PipelineCardModel, PipelineColumnModel, PipelineDraftState } from "./dashboard-types";

defineProps<{
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
</script>

<template>
  <section id="dashboard-pipeline" class="dashboard-panel">
    <div class="panel-header">
      <div>
        <p class="panel-meta">Content Pipeline</p>
        <h2>Draft → Review → Scheduled → Posted</h2>
      </div>

      <button type="button" class="dashboard-button secondary" @click="emit('open-creator')">
        Create
      </button>
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

    <div class="pipeline-grid">
      <article
        v-for="column in columns"
        :key="column.stage"
        class="pipeline-column"
      >
        <div class="pipeline-column-header">
          <strong>{{ column.label }}</strong>
          <span>{{ column.items.length }}</span>
        </div>

        <p v-if="column.items.length === 0" class="pipeline-empty">
          No items in {{ column.label.toLowerCase() }}.
        </p>

        <PipelineCard
          v-for="item in column.items"
          :key="item.asset.id"
          :model="item"
          @edit="emit('edit', $event)"
          @advance="emit('advance', $event)"
          @save="emit('save', $event)"
          @close="emit('close')"
          @open-creator="emit('open-creator')"
          @update-draft="(assetId, draft) => emit('update-draft', assetId, draft)"
        />
      </article>
    </div>
  </section>
</template>

<style scoped>
.pipeline-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 18px;
  align-items: start;
}

.pipeline-column {
  display: grid;
  gap: 12px;
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
  .pipeline-grid {
    grid-template-columns: 1fr;
  }
}
</style>
