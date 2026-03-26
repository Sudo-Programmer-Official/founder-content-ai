<script setup lang="ts">
import { computed } from "vue";
import type {
  AiAssistLevel,
  UiDensity,
  UiFontSize,
  UiLayoutMode,
  UiTheme,
  UpdateUserPreferencesRequest,
} from "../../../packages/shared-types";
import AiAssistPanel from "../components/AiAssistPanel.vue";
import { useAiAssistSuggestions } from "../composables/use-ai-assist";
import { usePreferenceContext } from "../preferences/preference-context";
import { appRoutes } from "../utils/routes";

const { preferences, isSaving, errorMessage, updatePreferences } = usePreferenceContext();

const themeModel = computed<UiTheme>({
  get: () => preferences.value.theme,
  set: (value) => {
    void updatePreference("theme", value);
  },
});

const fontSizeModel = computed<UiFontSize>({
  get: () => preferences.value.fontSize,
  set: (value) => {
    void updatePreference("fontSize", value);
  },
});

const densityModel = computed<UiDensity>({
  get: () => preferences.value.density,
  set: (value) => {
    void updatePreference("density", value);
  },
});

const layoutModeModel = computed<UiLayoutMode>({
  get: () => preferences.value.layoutMode,
  set: (value) => {
    void updatePreference("layoutMode", value);
  },
});

const aiAssistLevelModel = computed<AiAssistLevel>({
  get: () => preferences.value.aiAssistLevel,
  set: (value) => {
    void updatePreference("aiAssistLevel", value);
  },
});

async function updatePreference<T extends keyof typeof preferences.value>(
  key: T,
  value: (typeof preferences.value)[T],
) {
  const payload = {
    [key]: value,
  } as UpdateUserPreferencesRequest;
  await updatePreferences(payload);
}

const assistSuggestions = useAiAssistSuggestions([
  {
    id: "creator-mode",
    title: "Use creator layout while drafting",
    description: "Switch to the creator layout when you want a narrower reading width and less dashboard chrome.",
    minimumLevel: "minimal",
  },
  {
    id: "focus-theme",
    title: "Try the focus theme for writing sessions",
    description: "The focus theme reduces visual noise and works well with larger type when you are deep in content work.",
    minimumLevel: "balanced",
  },
  {
    id: "analytics-loop",
    title: "Pair planner layout with analytics review",
    description: "Planner mode gives you more horizontal room for scheduling and performance review workflows.",
    minimumLevel: "proactive",
    ctaLabel: "Open analytics",
    ctaTo: appRoutes.dashboardAnalytics,
  },
]);
</script>

<template>
  <main class="dashboard-shell">
    <section class="dashboard-hero">
      <p class="dashboard-eyebrow">/settings/preferences</p>
      <h1>Interface Preferences</h1>
      <p class="dashboard-description">
        Control theme, density, layout, and how much AI guidance the product surfaces while you work.
      </p>
    </section>

    <p v-if="errorMessage" class="dashboard-feedback error">{{ errorMessage }}</p>
    <p v-else-if="isSaving" class="dashboard-feedback">Saving preferences...</p>

    <section class="dashboard-grid-two">
      <article class="dashboard-panel">
        <p class="panel-meta">Appearance</p>
        <div class="settings-grid">
          <label class="dashboard-field">
            <span>Theme</span>
            <select v-model="themeModel">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="focus">Focus</option>
            </select>
          </label>

          <label class="dashboard-field">
            <span>Font Size</span>
            <select v-model="fontSizeModel">
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>

          <label class="dashboard-field">
            <span>Density</span>
            <select v-model="densityModel">
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
          </label>
        </div>
      </article>

      <article class="dashboard-panel">
        <p class="panel-meta">Workspace Mode</p>
        <div class="settings-grid">
          <label class="dashboard-field">
            <span>Layout Mode</span>
            <select v-model="layoutModeModel">
              <option value="dashboard">Dashboard</option>
              <option value="creator">Creator</option>
              <option value="planner">Planner</option>
            </select>
          </label>

          <label class="dashboard-field">
            <span>AI Assist</span>
            <select v-model="aiAssistLevelModel">
              <option value="off">Off</option>
              <option value="minimal">Minimal</option>
              <option value="balanced">Balanced</option>
              <option value="proactive">Proactive</option>
            </select>
          </label>
        </div>
      </article>
    </section>

    <section class="dashboard-panel preference-preview-panel">
      <p class="panel-meta">Live Preview</p>
      <div class="dashboard-card-grid">
        <article class="dashboard-card">
          <p class="dashboard-card-label">Theme</p>
          <strong>{{ preferences.theme }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Type Scale</p>
          <strong>{{ preferences.fontSize }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Density</p>
          <strong>{{ preferences.density }}</strong>
        </article>
        <article class="dashboard-card">
          <p class="dashboard-card-label">Layout</p>
          <strong>{{ preferences.layoutMode }}</strong>
        </article>
      </div>
    </section>

    <AiAssistPanel title="AI Assist Preview" :suggestions="assistSuggestions" />
  </main>
</template>

<style scoped>
.settings-grid {
  display: grid;
  gap: 16px;
}

.preference-preview-panel {
  margin-top: 18px;
}
</style>
