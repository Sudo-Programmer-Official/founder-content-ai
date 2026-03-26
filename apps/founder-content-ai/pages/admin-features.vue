<script setup lang="ts">
import type {
  AdminFeatureFlag,
  AdminWorkspaceListItem,
  UpsertAdminFeatureFlagRequest,
} from "../../../packages/shared-types";
import { computed, onMounted, reactive, ref } from "vue";
import {
  requestAdminFeatureFlags,
  requestAdminFeatureFlagTargetUpsert,
  requestAdminFeatureFlagUpsert,
  requestAdminWorkspaces,
} from "../services/admin-analytics-service";

const flags = ref<AdminFeatureFlag[]>([]);
const workspaces = ref<AdminWorkspaceListItem[]>([]);
const isLoading = ref(true);
const isSaving = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");
const targetSelection = reactive<Record<string, string>>({});
const targetEnabled = reactive<Record<string, "enable" | "disable">>({});
const draftFlag = reactive<UpsertAdminFeatureFlagRequest>({
  key: "",
  description: "",
  enabledGlobally: false,
});

const hasFlags = computed(() => flags.value.length > 0);

async function loadFeatureControlState(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const [flagResponse, workspaceResponse] = await Promise.all([
      requestAdminFeatureFlags(),
      requestAdminWorkspaces(),
    ]);

    flags.value = flagResponse.flags;
    workspaces.value = workspaceResponse.workspaces;

    for (const flag of flagResponse.flags) {
      targetSelection[flag.key] ||= workspaceResponse.workspaces[0]?.id ?? "";
      targetEnabled[flag.key] ||= "enable";
    }
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load feature control state.";
  } finally {
    isLoading.value = false;
  }
}

async function createOrUpdateFlag(): Promise<void> {
  if (!draftFlag.key.trim()) {
    errorMessage.value = "Feature key is required.";
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    await requestAdminFeatureFlagUpsert({
      key: draftFlag.key.trim(),
      description: draftFlag.description?.trim() || undefined,
      enabledGlobally: draftFlag.enabledGlobally,
    });
    feedbackMessage.value = "Feature flag saved.";
    draftFlag.key = "";
    draftFlag.description = "";
    draftFlag.enabledGlobally = false;
    await loadFeatureControlState();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to save feature flag.";
  } finally {
    isSaving.value = false;
  }
}

async function toggleGlobal(flag: AdminFeatureFlag): Promise<void> {
  isSaving.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    await requestAdminFeatureFlagUpsert({
      key: flag.key,
      description: flag.description,
      enabledGlobally: !flag.enabledGlobally,
    });
    feedbackMessage.value = `Global state updated for ${flag.key}.`;
    await loadFeatureControlState();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to update feature flag.";
  } finally {
    isSaving.value = false;
  }
}

async function applyWorkspaceTarget(flag: AdminFeatureFlag): Promise<void> {
  const targetId = targetSelection[flag.key];

  if (!targetId) {
    errorMessage.value = "Select a workspace target first.";
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  feedbackMessage.value = "";

  try {
    await requestAdminFeatureFlagTargetUpsert({
      featureKey: flag.key,
      targetType: "business",
      targetId,
      enabled: targetEnabled[flag.key] !== "disable",
    });
    feedbackMessage.value = `Workspace override updated for ${flag.key}.`;
    await loadFeatureControlState();
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to update workspace override.";
  } finally {
    isSaving.value = false;
  }
}

onMounted(() => {
  void loadFeatureControlState();
});
</script>

<template>
  <main class="dashboard-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/admin/features</p>
      <h1>Feature Flags</h1>
      <p class="dashboard-description">
        Roll features out globally or target specific workspaces without exposing unfinished behavior to everyone.
      </p>
    </section>

    <p v-if="isLoading" class="dashboard-feedback">Loading feature flags...</p>
    <p v-else-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>
    <p v-if="feedbackMessage" class="dashboard-feedback feature-feedback">{{ feedbackMessage }}</p>

    <template v-if="!isLoading">
      <section class="dashboard-panel feature-create-panel">
        <div class="panel-header">
          <div>
            <p class="panel-meta">Create Flag</p>
            <h2>Ship behind a switch</h2>
          </div>
        </div>

        <div class="feature-create-grid">
          <label class="dashboard-field">
            <span>Key</span>
            <input v-model="draftFlag.key" type="text" placeholder="mission_v2" />
          </label>

          <label class="dashboard-field">
            <span>Description</span>
            <input
              v-model="draftFlag.description"
              type="text"
              placeholder="Mission UI beta for operator workspaces"
            />
          </label>

          <label class="dashboard-field feature-toggle-field">
            <span>Global</span>
            <select v-model="draftFlag.enabledGlobally">
              <option :value="false">Disabled by default</option>
              <option :value="true">Enabled globally</option>
            </select>
          </label>

          <button type="button" class="dashboard-button" :disabled="isSaving" @click="createOrUpdateFlag">
            {{ isSaving ? "Saving..." : "Save flag" }}
          </button>
        </div>
      </section>

      <section v-if="hasFlags" class="feature-flag-list">
        <article v-for="flag in flags" :key="flag.id" class="dashboard-panel feature-flag-card">
          <div class="panel-header">
            <div>
              <p class="panel-meta">Feature Flag</p>
              <h2>{{ flag.key }}</h2>
              <p class="feature-description">{{ flag.description || "No description yet." }}</p>
            </div>
            <button type="button" class="dashboard-button secondary" :disabled="isSaving" @click="toggleGlobal(flag)">
              {{ flag.enabledGlobally ? "Disable globally" : "Enable globally" }}
            </button>
          </div>

          <div class="feature-metadata-row">
            <span class="topbar-pill" :data-state="flag.enabledGlobally ? 'on' : 'off'">
              {{ flag.enabledGlobally ? "Global on" : "Global off" }}
            </span>
            <span class="topbar-pill muted">{{ flag.targetCount }} overrides</span>
            <span class="topbar-pill muted">Created {{ flag.createdAt.slice(0, 10) }}</span>
          </div>

          <div class="feature-target-grid">
            <label class="dashboard-field">
              <span>Workspace</span>
              <select v-model="targetSelection[flag.key]">
                <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">
                  {{ workspace.name }}
                </option>
              </select>
            </label>

            <label class="dashboard-field">
              <span>Override</span>
              <select v-model="targetEnabled[flag.key]">
                <option value="enable">Enable</option>
                <option value="disable">Disable</option>
              </select>
            </label>

            <button
              type="button"
              class="dashboard-button secondary"
              :disabled="isSaving || workspaces.length === 0"
              @click="applyWorkspaceTarget(flag)"
            >
              Apply workspace override
            </button>
          </div>

          <div class="feature-target-list">
            <article
              v-for="target in flag.targets"
              :key="target.id"
              class="feature-target-item"
            >
              <strong>{{ target.targetName || target.targetId }}</strong>
              <span>{{ target.targetType }}</span>
              <span>{{ target.enabled ? "enabled" : "disabled" }}</span>
            </article>
            <p v-if="flag.targets.length === 0" class="feature-empty-copy">
              No targeted overrides yet.
            </p>
          </div>
        </article>
      </section>

      <section v-else class="dashboard-panel">
        <p class="panel-meta">Feature Flags</p>
        <h2>No flags yet</h2>
        <p class="dashboard-description">
          Start with one rollout switch so you can ship gradually instead of exposing new behavior to every workspace at once.
        </p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.feature-feedback {
  color: var(--fc-success-text);
}

.feature-create-panel,
.feature-flag-list,
.feature-flag-card,
.feature-target-list {
  display: grid;
  gap: 16px;
}

.feature-create-grid,
.feature-target-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.feature-toggle-field select {
  max-width: none;
}

.feature-description,
.feature-empty-copy {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.6;
}

.feature-metadata-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.topbar-pill[data-state="on"] {
  border-color: color-mix(in srgb, var(--fc-success-text) 34%, var(--fc-border));
  background: color-mix(in srgb, var(--fc-success-bg) 45%, var(--fc-panel-bg));
}

.feature-target-item {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--fc-border);
  border-radius: 16px;
  background: var(--fc-input-bg);
}

.feature-target-item span {
  color: var(--fc-text-muted);
}

@media (max-width: 980px) {
  .feature-create-grid,
  .feature-target-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .feature-create-grid,
  .feature-target-grid {
    grid-template-columns: 1fr;
  }
}
</style>
