<script setup lang="ts">
import { computed } from "vue";
import type { ContentAsset } from "../../../../packages/shared-types";
import type { PipelineCardModel, PipelineDraftState } from "./dashboard-types";

const props = defineProps<{
  model: PipelineCardModel;
}>();

const emit = defineEmits<{
  (event: "edit", asset: ContentAsset): void;
  (event: "advance", asset: ContentAsset): void;
  (event: "save", asset: ContentAsset): void;
  (event: "close"): void;
  (event: "open-creator"): void;
  (event: "update-draft", assetId: string, draft: PipelineDraftState): void;
}>();

function updateDraft(patch: Partial<PipelineDraftState>) {
  emit("update-draft", props.model.asset.id, {
    ...props.model.draft,
    ...patch,
  });
}

const activeScore = computed(() => (props.model.isEditing ? props.model.draftScore : props.model.score));
const previewImpactDelta = computed(() => Math.max(0, props.model.draftScore.viralScore - props.model.score.viralScore));
const titlePreview = computed(() => props.model.asset.title?.trim() || "Untitled draft");
const excerptPreview = computed(() => {
  const rawText = props.model.asset.textContent?.replace(/\s+/g, " ").trim();

  if (!rawText) {
    return "No editable content preview available yet.";
  }

  return rawText.length > 220 ? `${rawText.slice(0, 217).trimEnd()}...` : rawText;
});
</script>

<template>
  <article :id="`asset-${model.asset.id}`" class="pipeline-item refined-pipeline-item">
    <div class="pipeline-item-header">
      <div>
        <div class="pipeline-badges">
          <span class="status-tag">{{ model.asset.contentType }}</span>
          <span class="status-tag accent">{{ model.asset.pipelineStage ?? "draft" }}</span>
          <span v-if="model.score.highlight" class="status-tag" data-tone="positive">
            High viral potential
          </span>
        </div>
        <strong class="pipeline-title">{{ titlePreview }}</strong>
        <p class="pipeline-meta">
          {{ model.asset.sourceKind ?? "generated" }} ·
          {{ new Date(model.asset.updatedAt ?? model.asset.createdAt).toLocaleString() }}
        </p>
      </div>

      <button
        type="button"
        class="dashboard-button secondary small-button"
        @click="emit('edit', model.asset)"
      >
        {{ model.isEditing ? "Editing" : "Edit" }}
      </button>
    </div>

    <p class="pipeline-excerpt">
      {{ excerptPreview }}
    </p>

    <div
      v-if="model.primaryVerdict"
      class="pipeline-verdict"
      :data-severity="model.primaryVerdict.severity"
      :data-tone="model.primaryVerdict.tone"
    >
      <strong>{{ model.primaryVerdict.label }}</strong>
      <p>{{ model.primaryVerdict.message }}</p>
    </div>

    <div class="pipeline-score-row">
      <div class="score-chip" :data-highlight="activeScore.highlight">
        <strong>{{ activeScore.score }}</strong>
        <span>content score</span>
      </div>
      <div class="score-copy">
        <strong>{{ activeScore.label }}</strong>
        <p>{{ activeScore.detail }}</p>
      </div>
    </div>

    <p class="next-action-copy">{{ model.nextActionCopy }}</p>

    <div class="impact-preview">
      <strong>Impact preview</strong>
      <p>Expected reach: {{ activeScore.expectedReach }}</p>
      <p>{{ activeScore.engagementOutlook }}</p>
    </div>

    <div class="micro-reward-row">
      <span class="reward-chip" :data-highlight="activeScore.highlight">
        {{ activeScore.label }}
      </span>
      <span
        v-if="(model.asset.pipelineStage ?? 'draft') === 'scheduled'"
        class="reward-chip muted"
      >
        Ready to post
      </span>
      <span
        v-if="model.isEditing && previewImpactDelta > 0"
        class="reward-chip"
        data-highlight="true"
      >
        +{{ previewImpactDelta }}% more likely to perform
      </span>
    </div>

    <div class="action-row pipeline-actions">
      <button
        v-if="model.stageActionLabel"
        type="button"
        class="dashboard-button secondary small-button"
        :disabled="model.isSaving"
        @click="emit('advance', model.asset)"
      >
        {{ model.isSaving ? "Updating..." : model.stageActionLabel }}
      </button>
      <button type="button" class="dashboard-button secondary small-button" @click="emit('open-creator')">
        Open editor
      </button>
    </div>

    <div v-if="model.isEditing" class="pipeline-editor">
      <label class="dashboard-field">
        <span>Title</span>
        <input
          :value="model.draft.title"
          type="text"
          @input="updateDraft({ title: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <label class="dashboard-field">
        <span>Content</span>
        <textarea
          :value="model.draft.textContent"
          rows="8"
          @input="updateDraft({ textContent: ($event.target as HTMLTextAreaElement).value })"
        />
      </label>

      <label class="dashboard-field">
        <span>Status</span>
        <select
          :value="model.draft.status"
          @change="updateDraft({ status: ($event.target as HTMLSelectElement).value as PipelineDraftState['status'] })"
        >
          <option value="draft">Draft</option>
          <option value="review">Review</option>
          <option value="scheduled">Scheduled</option>
          <option value="posted">Posted</option>
        </select>
      </label>

      <div class="action-row">
        <button
          type="button"
          class="dashboard-button"
          :disabled="model.isSaving"
          @click="emit('save', model.asset)"
        >
          {{ model.isSaving ? "Saving..." : "Save changes" }}
        </button>
        <button type="button" class="dashboard-button secondary" @click="emit('close')">
          Close
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.pipeline-item {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
}

.pipeline-item-header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.pipeline-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--fc-surface-muted);
  color: var(--fc-text-muted);
  font-size: 0.8rem;
  text-transform: capitalize;
}

.status-tag.accent,
.status-tag[data-tone="positive"] {
  background: color-mix(in srgb, var(--fc-success-bg) 72%, var(--fc-panel-bg));
  color: var(--fc-success-text);
}

.pipeline-meta {
  margin: 6px 0 0;
  color: var(--fc-text-muted);
  font-size: 0.88rem;
  line-height: 1.5;
}

.pipeline-title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.pipeline-verdict,
.impact-preview {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid var(--fc-border);
  background: color-mix(in srgb, var(--fc-panel-bg) 84%, var(--fc-surface-muted));
}

.pipeline-verdict p,
.impact-preview p {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.pipeline-verdict[data-severity="critical"] {
  border-color: color-mix(in srgb, var(--fc-error-text) 18%, transparent);
  background: color-mix(in srgb, var(--fc-error-bg) 46%, var(--fc-panel-bg));
}

.pipeline-verdict[data-severity="important"] {
  border-color: color-mix(in srgb, var(--fc-warning-text) 18%, transparent);
  background: color-mix(in srgb, var(--fc-warning-bg) 40%, var(--fc-panel-bg));
}

.pipeline-verdict[data-severity="optional"][data-tone="positive"] {
  border-color: color-mix(in srgb, var(--fc-success-text) 18%, transparent);
  background: color-mix(in srgb, var(--fc-success-bg) 40%, var(--fc-panel-bg));
}

.pipeline-excerpt {
  margin: 0;
  color: var(--fc-text);
  line-height: 1.6;
  white-space: normal;
  overflow: hidden;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
}

.pipeline-score-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: center;
}

.score-chip {
  display: grid;
  gap: 2px;
  min-width: 92px;
  padding: 10px 12px;
  border-radius: 16px;
  background: var(--fc-surface-muted);
  color: var(--fc-text);
  text-align: center;
}

.score-chip strong {
  font-size: 1.2rem;
}

.score-chip span {
  color: var(--fc-text-muted);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.score-chip[data-highlight="true"] {
  background: color-mix(in srgb, var(--fc-success-bg) 72%, var(--fc-panel-bg));
}

.score-copy {
  display: grid;
  gap: 4px;
}

.score-copy p,
.next-action-copy {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

.micro-reward-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reward-chip {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--fc-success-bg) 62%, var(--fc-panel-bg));
  color: var(--fc-success-text);
  font-size: 0.82rem;
}

.reward-chip[data-highlight="false"] {
  background: var(--fc-surface-muted);
  color: var(--fc-text);
}

.reward-chip.muted {
  background: color-mix(in srgb, var(--fc-info-bg) 60%, var(--fc-panel-bg));
  color: var(--fc-info-text);
}

.pipeline-editor {
  display: grid;
  gap: 12px;
}

.pipeline-actions {
  margin-top: 0;
}

@media (max-width: 760px) {
  .pipeline-item-header {
    flex-direction: column;
    align-items: stretch;
  }

  .pipeline-score-row {
    grid-template-columns: 1fr;
  }
}
</style>
