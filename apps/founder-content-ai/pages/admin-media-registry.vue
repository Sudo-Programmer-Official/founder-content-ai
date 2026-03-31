<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import type {
  AdminDecisionRuleRecord,
  AdminDecisionRuleScope,
  AdminMediaPresetRecord,
  AdminMediaRegistryOptions,
  AdminPromptTemplateRecord,
  AdminWorkspaceListItem,
  MediaSuggestionType,
  UpsertAdminDecisionRuleRequest,
  UpsertAdminMediaPresetRequest,
  UpsertAdminPromptTemplateRequest,
} from "../../../packages/shared-types";
import {
  requestAdminDecisionRuleUpsert,
  requestAdminMediaPresetUpsert,
  requestAdminMediaRegistry,
  requestAdminPromptTemplateUpsert,
  requestAdminWorkspaces,
} from "../services/admin-analytics-service";

const registryOptions = ref<AdminMediaRegistryOptions | null>(null);
const presets = ref<AdminMediaPresetRecord[]>([]);
const promptTemplates = ref<AdminPromptTemplateRecord[]>([]);
const decisionRules = ref<AdminDecisionRuleRecord[]>([]);
const workspaces = ref<AdminWorkspaceListItem[]>([]);
const isLoading = ref(true);
const isSavingPreset = ref(false);
const isSavingPromptTemplate = ref(false);
const isSavingDecisionRule = ref(false);
const errorMessage = ref("");
const feedbackMessage = ref("");

const promptTemplateForm = reactive<UpsertAdminPromptTemplateRequest>({
  id: undefined,
  slug: "",
  name: "",
  category: "media",
  templateBody: "",
  variables: [],
  notes: "",
  version: 1,
  isActive: true,
});
const promptTemplateVariablesInput = ref("");

const presetForm = reactive<UpsertAdminMediaPresetRequest>({
  id: undefined,
  slug: "",
  name: "",
  description: "",
  supportedBusinessTypes: [],
  supportedContentTypes: [],
  supportedGoals: [],
  mediaTypes: [],
  fallbackOrder: [],
  uiLabel: "",
  priority: 100,
  isActive: true,
  promptTemplateByMediaType: {},
});

const decisionRuleForm = reactive<UpsertAdminDecisionRuleRequest>({
  id: undefined,
  ruleName: "",
  ruleScope: "global",
  businessType: undefined,
  businessId: undefined,
  conditions: {},
  outputs: {},
  priority: 100,
  isActive: true,
});
const decisionRuleConditionsInput = ref("{}");
const decisionRuleOutputsInput = ref("{}");

const mediaPromptTemplates = computed(() =>
  promptTemplates.value.filter((template) => template.category === "media"),
);

const registryCounts = computed(() => [
  {
    label: "Presets",
    value: presets.value.length,
    meta: `${presets.value.filter((preset) => preset.isActive).length} active`,
  },
  {
    label: "Prompt templates",
    value: promptTemplates.value.length,
    meta: `${promptTemplates.value.filter((template) => template.isActive).length} active`,
  },
  {
    label: "Decision rules",
    value: decisionRules.value.length,
    meta: `${decisionRules.value.filter((rule) => rule.isActive).length} active`,
  },
]);

function resetFeedback(): void {
  errorMessage.value = "";
  feedbackMessage.value = "";
}

function uniqueArray<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function toggleValue<T>(target: T[], value: T): void {
  const next = target.includes(value)
    ? target.filter((candidate) => candidate !== value)
    : [...target, value];

  target.splice(0, target.length, ...uniqueArray(next));
}

function resetPromptTemplateForm(): void {
  promptTemplateForm.id = undefined;
  promptTemplateForm.slug = "";
  promptTemplateForm.name = "";
  promptTemplateForm.category = "media";
  promptTemplateForm.templateBody = "";
  promptTemplateForm.variables = [];
  promptTemplateForm.notes = "";
  promptTemplateForm.version = 1;
  promptTemplateForm.isActive = true;
  promptTemplateVariablesInput.value = "";
}

function resetPresetForm(): void {
  presetForm.id = undefined;
  presetForm.slug = "";
  presetForm.name = "";
  presetForm.description = "";
  presetForm.supportedBusinessTypes = [];
  presetForm.supportedContentTypes = [];
  presetForm.supportedGoals = [];
  presetForm.mediaTypes = [];
  presetForm.fallbackOrder = [];
  presetForm.uiLabel = "";
  presetForm.priority = 100;
  presetForm.isActive = true;
  presetForm.promptTemplateByMediaType = {};
}

function resetDecisionRuleForm(): void {
  decisionRuleForm.id = undefined;
  decisionRuleForm.ruleName = "";
  decisionRuleForm.ruleScope = "global";
  decisionRuleForm.businessType = undefined;
  decisionRuleForm.businessId = undefined;
  decisionRuleForm.conditions = {};
  decisionRuleForm.outputs = {};
  decisionRuleForm.priority = 100;
  decisionRuleForm.isActive = true;
  decisionRuleConditionsInput.value = "{}";
  decisionRuleOutputsInput.value = "{}";
}

function editPromptTemplate(template: AdminPromptTemplateRecord): void {
  promptTemplateForm.id = template.id;
  promptTemplateForm.slug = template.slug;
  promptTemplateForm.name = template.name;
  promptTemplateForm.category = template.category;
  promptTemplateForm.templateBody = template.templateBody;
  promptTemplateForm.variables = [...template.variables];
  promptTemplateForm.notes = template.notes ?? "";
  promptTemplateForm.version = template.version;
  promptTemplateForm.isActive = template.isActive;
  promptTemplateVariablesInput.value = template.variables.join(", ");
}

function editPreset(preset: AdminMediaPresetRecord): void {
  presetForm.id = preset.id;
  presetForm.slug = preset.slug;
  presetForm.name = preset.name;
  presetForm.description = preset.description ?? "";
  presetForm.supportedBusinessTypes = [...preset.supportedBusinessTypes];
  presetForm.supportedContentTypes = [...preset.supportedContentTypes];
  presetForm.supportedGoals = [...preset.supportedGoals];
  presetForm.mediaTypes = [...preset.mediaTypes];
  presetForm.fallbackOrder = [...preset.fallbackOrder];
  presetForm.uiLabel = preset.uiLabel ?? "";
  presetForm.priority = preset.priority;
  presetForm.isActive = preset.isActive;
  presetForm.promptTemplateByMediaType = { ...preset.promptTemplateByMediaType };
}

function editDecisionRule(rule: AdminDecisionRuleRecord): void {
  decisionRuleForm.id = rule.id;
  decisionRuleForm.ruleName = rule.ruleName;
  decisionRuleForm.ruleScope = rule.ruleScope;
  decisionRuleForm.businessType = rule.businessType;
  decisionRuleForm.businessId = rule.businessId;
  decisionRuleForm.conditions = { ...rule.conditions };
  decisionRuleForm.outputs = { ...rule.outputs };
  decisionRuleForm.priority = rule.priority;
  decisionRuleForm.isActive = rule.isActive;
  decisionRuleConditionsInput.value = JSON.stringify(rule.conditions, null, 2);
  decisionRuleOutputsInput.value = JSON.stringify(rule.outputs, null, 2);
}

function parseJsonRecord(input: string, fieldName: string): Record<string, unknown> {
  if (!input.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(input);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${fieldName} must be a JSON object.`);
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      error instanceof Error ? `${fieldName}: ${error.message}` : `${fieldName} is invalid JSON.`,
    );
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function formatRuleScope(scope: AdminDecisionRuleScope): string {
  switch (scope) {
    case "business_type":
      return "Business type";
    case "workspace":
      return "Workspace";
    default:
      return "Global";
  }
}

async function loadRegistryState(): Promise<void> {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    const [registryResponse, workspaceResponse] = await Promise.all([
      requestAdminMediaRegistry(),
      requestAdminWorkspaces(),
    ]);

    registryOptions.value = registryResponse.options;
    presets.value = registryResponse.presets;
    promptTemplates.value = registryResponse.promptTemplates;
    decisionRules.value = registryResponse.decisionRules;
    workspaces.value = workspaceResponse.workspaces;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load the media registry.";
  } finally {
    isLoading.value = false;
  }
}

async function savePromptTemplate(): Promise<void> {
  resetFeedback();
  isSavingPromptTemplate.value = true;

  try {
    promptTemplateForm.variables = uniqueArray(
      promptTemplateVariablesInput.value
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const response = await requestAdminPromptTemplateUpsert({ ...promptTemplateForm });
    feedbackMessage.value = `Saved prompt template: ${response.promptTemplate.name}.`;
    await loadRegistryState();
    editPromptTemplate(response.promptTemplate);
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to save the prompt template.";
  } finally {
    isSavingPromptTemplate.value = false;
  }
}

async function savePreset(): Promise<void> {
  resetFeedback();
  isSavingPreset.value = true;

  try {
    const response = await requestAdminMediaPresetUpsert({
      ...presetForm,
      description: presetForm.description?.trim() || undefined,
      uiLabel: presetForm.uiLabel?.trim() || undefined,
      promptTemplateByMediaType: { ...presetForm.promptTemplateByMediaType },
    });
    feedbackMessage.value = `Saved media preset: ${response.preset.name}.`;
    await loadRegistryState();
    editPreset(response.preset);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to save the media preset.";
  } finally {
    isSavingPreset.value = false;
  }
}

async function saveDecisionRule(): Promise<void> {
  resetFeedback();
  isSavingDecisionRule.value = true;

  try {
    decisionRuleForm.conditions = parseJsonRecord(decisionRuleConditionsInput.value, "Conditions");
    decisionRuleForm.outputs = parseJsonRecord(decisionRuleOutputsInput.value, "Outputs");
    const response = await requestAdminDecisionRuleUpsert({ ...decisionRuleForm });
    feedbackMessage.value = `Saved decision rule: ${response.decisionRule.ruleName}.`;
    await loadRegistryState();
    editDecisionRule(response.decisionRule);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Unable to save the decision rule.";
  } finally {
    isSavingDecisionRule.value = false;
  }
}

watch(
  () => [...presetForm.mediaTypes],
  (mediaTypes) => {
    presetForm.fallbackOrder = presetForm.fallbackOrder.filter((mediaType) =>
      mediaTypes.includes(mediaType),
    );

    const nextPromptMap: Partial<Record<MediaSuggestionType, string>> = {};

    for (const mediaType of mediaTypes) {
      const existing = presetForm.promptTemplateByMediaType[mediaType];

      if (existing) {
        nextPromptMap[mediaType] = existing;
      }
    }

    presetForm.promptTemplateByMediaType = nextPromptMap;
  },
);

watch(
  () => decisionRuleForm.ruleScope,
  (scope) => {
    if (scope === "global") {
      decisionRuleForm.businessType = undefined;
      decisionRuleForm.businessId = undefined;
    } else if (scope === "business_type") {
      decisionRuleForm.businessId = undefined;
    } else if (scope === "workspace") {
      decisionRuleForm.businessType = undefined;
    }
  },
);

onMounted(() => {
  void loadRegistryState();
});
</script>

<template>
  <main class="dashboard-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/admin/media-registry</p>
      <h1>Media Registry</h1>
      <p class="dashboard-description">
        Control the shared preset catalog, prompt templates, and rule engine that workspace media resolution depends on.
      </p>
    </section>

    <p v-if="isLoading" class="dashboard-feedback">Loading media registry...</p>
    <p v-else-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>
    <p v-if="feedbackMessage" class="dashboard-feedback feature-feedback">{{ feedbackMessage }}</p>

    <template v-if="!isLoading && registryOptions">
      <section class="dashboard-card-grid">
        <article v-for="card in registryCounts" :key="card.label" class="dashboard-card">
          <p class="dashboard-card-label">{{ card.label }}</p>
          <strong>{{ card.value }}</strong>
          <span class="dashboard-card-meta">{{ card.meta }}</span>
        </article>
      </section>

      <section class="dashboard-panel registry-section">
        <div class="panel-header">
          <div>
            <p class="panel-meta">Prompt Templates</p>
            <h2>Shared template registry</h2>
            <p class="dashboard-description">
              Edit the actual template body and variables that presets map to.
            </p>
          </div>
          <button type="button" class="dashboard-button secondary" @click="resetPromptTemplateForm">
            New template
          </button>
        </div>

        <div class="registry-grid-two">
          <article class="registry-form-panel">
            <div class="registry-form-grid two">
              <label class="dashboard-field">
                <span>Slug</span>
                <input v-model="promptTemplateForm.slug" type="text" placeholder="media.quote_card.default" />
              </label>

              <label class="dashboard-field">
                <span>Name</span>
                <input v-model="promptTemplateForm.name" type="text" placeholder="Quote card default" />
              </label>

              <label class="dashboard-field">
                <span>Category</span>
                <input v-model="promptTemplateForm.category" type="text" placeholder="media" />
              </label>

              <label class="dashboard-field">
                <span>Version</span>
                <input v-model.number="promptTemplateForm.version" type="number" min="1" step="1" />
              </label>
            </div>

            <label class="dashboard-field">
              <span>Variables</span>
              <input
                v-model="promptTemplateVariablesInput"
                type="text"
                placeholder="headline, supportingText, brandTone"
              />
            </label>

            <label class="dashboard-field">
              <span>Notes</span>
              <textarea
                v-model="promptTemplateForm.notes"
                rows="3"
                placeholder="Explain where this template should be used."
              />
            </label>

            <label class="dashboard-field">
              <span>Template body</span>
              <textarea
                v-model="promptTemplateForm.templateBody"
                rows="10"
                placeholder="Create a bold quote-card visual using the supplied headline..."
              />
            </label>

            <div class="registry-toggle-row">
              <label class="checkbox-field">
                <input v-model="promptTemplateForm.isActive" type="checkbox" />
                <span>Active</span>
              </label>
            </div>

            <div class="registry-action-row">
              <button
                type="button"
                class="dashboard-button"
                :disabled="isSavingPromptTemplate"
                @click="savePromptTemplate"
              >
                {{ isSavingPromptTemplate ? "Saving..." : "Save template" }}
              </button>
              <button type="button" class="dashboard-button secondary" @click="resetPromptTemplateForm">
                Reset
              </button>
            </div>
          </article>

          <article class="registry-list-panel">
            <article
              v-for="template in promptTemplates"
              :key="template.id"
              class="registry-list-card"
              :class="{ inactive: !template.isActive }"
            >
              <div class="registry-list-header">
                <div>
                  <p class="panel-meta">{{ template.category }}</p>
                  <h3>{{ template.name }}</h3>
                </div>
                <button type="button" class="dashboard-button secondary" @click="editPromptTemplate(template)">
                  Edit
                </button>
              </div>

              <div class="registry-chip-row">
                <span class="topbar-pill" :data-state="template.isActive ? 'on' : 'off'">
                  {{ template.isActive ? "Active" : "Inactive" }}
                </span>
                <span class="topbar-pill muted">v{{ template.version }}</span>
                <span class="topbar-pill muted">{{ template.slug }}</span>
              </div>

              <p class="registry-card-copy">{{ template.notes || "No notes yet." }}</p>
              <p class="registry-card-meta">Updated {{ formatDate(template.updatedAt) }}</p>
            </article>
          </article>
        </div>
      </section>

      <section class="dashboard-panel registry-section">
        <div class="panel-header">
          <div>
            <p class="panel-meta">Media Presets</p>
            <h2>Preset and prompt-map registry</h2>
            <p class="dashboard-description">
              Define which media types a preset supports and which prompt template each type should use.
            </p>
          </div>
          <button type="button" class="dashboard-button secondary" @click="resetPresetForm">
            New preset
          </button>
        </div>

        <div class="registry-grid-two">
          <article class="registry-form-panel">
            <div class="registry-form-grid two">
              <label class="dashboard-field">
                <span>Slug</span>
                <input v-model="presetForm.slug" type="text" placeholder="saas-authority" />
              </label>

              <label class="dashboard-field">
                <span>Name</span>
                <input v-model="presetForm.name" type="text" placeholder="SaaS authority pack" />
              </label>

              <label class="dashboard-field">
                <span>UI label</span>
                <input v-model="presetForm.uiLabel" type="text" placeholder="SaaS" />
              </label>

              <label class="dashboard-field">
                <span>Priority</span>
                <input v-model.number="presetForm.priority" type="number" min="1" step="1" />
              </label>
            </div>

            <label class="dashboard-field">
              <span>Description</span>
              <textarea
                v-model="presetForm.description"
                rows="3"
                placeholder="Text-led visual defaults for SaaS authority and product education."
              />
            </label>

            <div class="registry-option-group">
              <span class="option-group-label">Business types</span>
              <div class="registry-chip-row">
                <button
                  v-for="option in registryOptions.businessTypes"
                  :key="option"
                  type="button"
                  class="topbar-pill option-chip"
                  :data-state="presetForm.supportedBusinessTypes.includes(option) ? 'on' : 'off'"
                  @click="toggleValue(presetForm.supportedBusinessTypes, option)"
                >
                  {{ option }}
                </button>
              </div>
            </div>

            <div class="registry-option-group">
              <span class="option-group-label">Content types</span>
              <div class="registry-chip-row">
                <button
                  v-for="option in registryOptions.contentTypes"
                  :key="option"
                  type="button"
                  class="topbar-pill option-chip"
                  :data-state="presetForm.supportedContentTypes.includes(option) ? 'on' : 'off'"
                  @click="toggleValue(presetForm.supportedContentTypes, option)"
                >
                  {{ option }}
                </button>
              </div>
            </div>

            <div class="registry-option-group">
              <span class="option-group-label">Goals</span>
              <div class="registry-chip-row">
                <button
                  v-for="option in registryOptions.goals"
                  :key="option"
                  type="button"
                  class="topbar-pill option-chip"
                  :data-state="presetForm.supportedGoals.includes(option) ? 'on' : 'off'"
                  @click="toggleValue(presetForm.supportedGoals, option)"
                >
                  {{ option }}
                </button>
              </div>
            </div>

            <div class="registry-option-group">
              <span class="option-group-label">Media types</span>
              <div class="registry-chip-row">
                <button
                  v-for="option in registryOptions.mediaTypes"
                  :key="option"
                  type="button"
                  class="topbar-pill option-chip"
                  :data-state="presetForm.mediaTypes.includes(option) ? 'on' : 'off'"
                  @click="toggleValue(presetForm.mediaTypes, option)"
                >
                  {{ option }}
                </button>
              </div>
            </div>

            <div class="registry-option-group">
              <span class="option-group-label">Fallback order</span>
              <div class="registry-chip-row">
                <button
                  v-for="option in presetForm.mediaTypes"
                  :key="option"
                  type="button"
                  class="topbar-pill option-chip"
                  :data-state="presetForm.fallbackOrder.includes(option) ? 'on' : 'off'"
                  @click="toggleValue(presetForm.fallbackOrder, option)"
                >
                  {{ option }}
                </button>
              </div>
            </div>

            <div v-if="presetForm.mediaTypes.length > 0" class="registry-mapping-grid">
              <label
                v-for="mediaType in presetForm.mediaTypes"
                :key="mediaType"
                class="dashboard-field"
              >
                <span>{{ mediaType }} template</span>
                <select v-model="presetForm.promptTemplateByMediaType[mediaType]">
                  <option value="">Use no mapping</option>
                  <option
                    v-for="template in mediaPromptTemplates"
                    :key="template.id"
                    :value="template.id"
                  >
                    {{ template.name }} · {{ template.slug }}
                  </option>
                </select>
              </label>
            </div>

            <div class="registry-toggle-row">
              <label class="checkbox-field">
                <input v-model="presetForm.isActive" type="checkbox" />
                <span>Active</span>
              </label>
            </div>

            <div class="registry-action-row">
              <button
                type="button"
                class="dashboard-button"
                :disabled="isSavingPreset"
                @click="savePreset"
              >
                {{ isSavingPreset ? "Saving..." : "Save preset" }}
              </button>
              <button type="button" class="dashboard-button secondary" @click="resetPresetForm">
                Reset
              </button>
            </div>
          </article>

          <article class="registry-list-panel">
            <article
              v-for="preset in presets"
              :key="preset.id"
              class="registry-list-card"
              :class="{ inactive: !preset.isActive }"
            >
              <div class="registry-list-header">
                <div>
                  <p class="panel-meta">{{ preset.slug }}</p>
                  <h3>{{ preset.name }}</h3>
                </div>
                <button type="button" class="dashboard-button secondary" @click="editPreset(preset)">
                  Edit
                </button>
              </div>

              <div class="registry-chip-row">
                <span class="topbar-pill" :data-state="preset.isActive ? 'on' : 'off'">
                  {{ preset.isActive ? "Active" : "Inactive" }}
                </span>
                <span class="topbar-pill muted">Priority {{ preset.priority }}</span>
                <span class="topbar-pill muted">{{ preset.mediaTypes.length }} media types</span>
              </div>

              <p class="registry-card-copy">{{ preset.description || "No description yet." }}</p>
              <p class="registry-card-meta">
                {{ preset.supportedBusinessTypes.join(", ") || "All business types" }} ·
                {{ preset.supportedContentTypes.join(", ") || "All content types" }}
              </p>
            </article>
          </article>
        </div>
      </section>

      <section class="dashboard-panel registry-section">
        <div class="panel-header">
          <div>
            <p class="panel-meta">Decision Rules</p>
            <h2>Global and scoped rule registry</h2>
            <p class="dashboard-description">
              Keep conditions and outputs explicit so recommendation behavior stays auditable.
            </p>
          </div>
          <button type="button" class="dashboard-button secondary" @click="resetDecisionRuleForm">
            New rule
          </button>
        </div>

        <div class="registry-grid-two">
          <article class="registry-form-panel">
            <div class="registry-form-grid two">
              <label class="dashboard-field">
                <span>Rule name</span>
                <input
                  v-model="decisionRuleForm.ruleName"
                  type="text"
                  placeholder="prefer_existing_assets_when_available"
                />
              </label>

              <label class="dashboard-field">
                <span>Scope</span>
                <select v-model="decisionRuleForm.ruleScope">
                  <option v-for="scope in registryOptions.ruleScopes" :key="scope" :value="scope">
                    {{ formatRuleScope(scope) }}
                  </option>
                </select>
              </label>

              <label v-if="decisionRuleForm.ruleScope === 'business_type'" class="dashboard-field">
                <span>Business type</span>
                <select v-model="decisionRuleForm.businessType">
                  <option value="">Select business type</option>
                  <option v-for="option in registryOptions.businessTypes" :key="option" :value="option">
                    {{ option }}
                  </option>
                </select>
              </label>

              <label v-if="decisionRuleForm.ruleScope === 'workspace'" class="dashboard-field">
                <span>Workspace</span>
                <select v-model="decisionRuleForm.businessId">
                  <option value="">Select workspace</option>
                  <option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">
                    {{ workspace.name }}
                  </option>
                </select>
              </label>

              <label class="dashboard-field">
                <span>Priority</span>
                <input v-model.number="decisionRuleForm.priority" type="number" min="1" step="1" />
              </label>
            </div>

            <label class="dashboard-field">
              <span>Conditions JSON</span>
              <textarea
                v-model="decisionRuleConditionsInput"
                rows="8"
                placeholder='{"hasUploadedAssets": true}'
              />
            </label>

            <label class="dashboard-field">
              <span>Outputs JSON</span>
              <textarea
                v-model="decisionRuleOutputsInput"
                rows="8"
                placeholder='{"recommendedAction": "use_existing_asset"}'
              />
            </label>

            <div class="registry-toggle-row">
              <label class="checkbox-field">
                <input v-model="decisionRuleForm.isActive" type="checkbox" />
                <span>Active</span>
              </label>
            </div>

            <div class="registry-action-row">
              <button
                type="button"
                class="dashboard-button"
                :disabled="isSavingDecisionRule"
                @click="saveDecisionRule"
              >
                {{ isSavingDecisionRule ? "Saving..." : "Save rule" }}
              </button>
              <button type="button" class="dashboard-button secondary" @click="resetDecisionRuleForm">
                Reset
              </button>
            </div>
          </article>

          <article class="registry-list-panel">
            <article
              v-for="rule in decisionRules"
              :key="rule.id"
              class="registry-list-card"
              :class="{ inactive: !rule.isActive }"
            >
              <div class="registry-list-header">
                <div>
                  <p class="panel-meta">{{ formatRuleScope(rule.ruleScope) }}</p>
                  <h3>{{ rule.ruleName }}</h3>
                </div>
                <button type="button" class="dashboard-button secondary" @click="editDecisionRule(rule)">
                  Edit
                </button>
              </div>

              <div class="registry-chip-row">
                <span class="topbar-pill" :data-state="rule.isActive ? 'on' : 'off'">
                  {{ rule.isActive ? "Active" : "Inactive" }}
                </span>
                <span class="topbar-pill muted">Priority {{ rule.priority }}</span>
                <span v-if="rule.businessType" class="topbar-pill muted">{{ rule.businessType }}</span>
                <span v-if="rule.businessName" class="topbar-pill muted">{{ rule.businessName }}</span>
              </div>

              <p class="registry-card-copy">
                Conditions: {{ JSON.stringify(rule.conditions) }}
              </p>
              <p class="registry-card-meta">
                Outputs: {{ JSON.stringify(rule.outputs) }}
              </p>
            </article>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.feature-feedback {
  color: var(--fc-success-text);
}

.dashboard-card-meta {
  display: block;
  margin-top: 8px;
  color: var(--fc-text-muted);
  font-size: 0.9rem;
}

.registry-section,
.registry-list-panel,
.registry-list-card {
  display: grid;
  gap: 18px;
}

.registry-grid-two {
  display: grid;
  gap: 20px;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
}

.registry-form-panel,
.registry-list-panel {
  min-width: 0;
}

.registry-form-grid {
  display: grid;
  gap: 16px;
}

.registry-form-grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.registry-option-group {
  display: grid;
  gap: 10px;
}

.option-group-label {
  font-size: 0.86rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fc-text-muted);
}

.registry-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.topbar-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 7px 13px;
  border: 1px solid rgba(122, 74, 48, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.75);
  color: var(--fc-text);
  font-size: 0.86rem;
  font-weight: 700;
}

.topbar-pill[data-state="on"] {
  background: rgba(212, 104, 43, 0.12);
  border-color: rgba(212, 104, 43, 0.24);
  color: var(--fc-accent-strong);
}

.topbar-pill[data-state="off"],
.topbar-pill.muted {
  color: var(--fc-text-muted);
}

.option-chip {
  cursor: pointer;
}

.registry-mapping-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.registry-toggle-row,
.registry-action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.checkbox-field {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
}

.registry-list-card {
  padding: 18px 20px;
  border: 1px solid rgba(122, 74, 48, 0.1);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 18px 36px rgba(122, 74, 48, 0.08);
}

.registry-list-card.inactive {
  opacity: 0.72;
}

.registry-list-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.registry-list-header h3 {
  margin: 4px 0 0;
  font-size: 1.1rem;
}

.registry-card-copy,
.registry-card-meta {
  margin: 0;
  color: var(--fc-text-muted);
  line-height: 1.55;
}

@media (max-width: 1080px) {
  .registry-grid-two,
  .registry-form-grid.two,
  .registry-mapping-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
