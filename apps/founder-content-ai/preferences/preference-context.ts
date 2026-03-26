import type { InjectionKey, Ref } from "vue";
import { inject } from "vue";
import type { UpdateUserPreferencesRequest, UserPreferences } from "../../../packages/shared-types";

export interface PreferenceContextValue {
  preferences: Ref<UserPreferences>;
  isReady: Ref<boolean>;
  isSaving: Ref<boolean>;
  errorMessage: Ref<string>;
  updatePreferences: (input: UpdateUserPreferencesRequest) => Promise<void>;
  refreshPreferences: () => Promise<void>;
}

export const PreferenceContextKey = Symbol("PreferenceContext") as InjectionKey<PreferenceContextValue>;

export function usePreferenceContext(): PreferenceContextValue {
  const context = inject(PreferenceContextKey);

  if (!context) {
    throw new Error("Preference context is not available.");
  }

  return context;
}
