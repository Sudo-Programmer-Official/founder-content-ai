<script setup lang="ts">
import { onMounted, provide, ref, watch } from "vue";
import type { UpdateUserPreferencesRequest, UserPreferences } from "../../../packages/shared-types";
import { DEFAULT_USER_PREFERENCES, mergePreferences } from "./defaults";
import { PreferenceContextKey } from "./preference-context";
import {
  loadStoredPreferences,
  requestUpdateUserPreferences,
  requestUserPreferences,
  storePreferences,
} from "../services/preferences-service";

const preferences = ref<UserPreferences>(DEFAULT_USER_PREFERENCES);
const isReady = ref(false);
const isSaving = ref(false);
const errorMessage = ref("");

function applyPreferencesToDocument(nextPreferences: UserPreferences): void {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = nextPreferences.theme;
  document.documentElement.dataset.fontSize = nextPreferences.fontSize;
  document.documentElement.dataset.density = nextPreferences.density;
  document.documentElement.dataset.layoutMode = nextPreferences.layoutMode;
  document.documentElement.dataset.aiAssistLevel = nextPreferences.aiAssistLevel;
}

async function refreshPreferences(): Promise<void> {
  try {
    const response = await requestUserPreferences();
    preferences.value = response.preferences;
    storePreferences(response.preferences);
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to load saved interface preferences.";
  }
}

async function updatePreferences(input: UpdateUserPreferencesRequest): Promise<void> {
  const optimisticPreferences = mergePreferences(preferences.value, {
    ...input,
    updatedAt: new Date().toISOString(),
  });

  preferences.value = optimisticPreferences;
  storePreferences(optimisticPreferences);
  isSaving.value = true;

  try {
    const response = await requestUpdateUserPreferences(input);
    preferences.value = response.preferences;
    storePreferences(response.preferences);
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : "Unable to save interface preferences.";
  } finally {
    isSaving.value = false;
  }
}

provide(PreferenceContextKey, {
  preferences,
  isReady,
  isSaving,
  errorMessage,
  updatePreferences,
  refreshPreferences,
});

watch(
  preferences,
  (nextPreferences) => {
    applyPreferencesToDocument(nextPreferences);
  },
  { deep: true, immediate: true },
);

onMounted(async () => {
  const storedPreferences = loadStoredPreferences();
  preferences.value = storedPreferences;
  applyPreferencesToDocument(storedPreferences);
  isReady.value = true;
  await refreshPreferences();
});
</script>

<template>
  <slot />
</template>
