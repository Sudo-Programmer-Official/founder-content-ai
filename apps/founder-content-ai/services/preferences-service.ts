import type {
  GetUserPreferencesResponse,
  UpdateUserPreferencesRequest,
  UpdateUserPreferencesResponse,
  UserPreferences,
} from "../../../packages/shared-types";
import { apiGet, apiPost } from "./api-client";
import {
  DEFAULT_USER_PREFERENCES,
  LOCAL_PREFERENCES_STORAGE_KEY,
  mergePreferences,
} from "../preferences/defaults";

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadStoredPreferences(): UserPreferences {
  if (!canUseBrowserStorage()) {
    return DEFAULT_USER_PREFERENCES;
  }

  const rawValue = window.localStorage.getItem(LOCAL_PREFERENCES_STORAGE_KEY);

  if (!rawValue) {
    return DEFAULT_USER_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<UserPreferences>;
    return mergePreferences(DEFAULT_USER_PREFERENCES, parsed);
  } catch {
    return DEFAULT_USER_PREFERENCES;
  }
}

export function storePreferences(preferences: UserPreferences): void {
  if (!canUseBrowserStorage()) {
    return;
  }

  window.localStorage.setItem(LOCAL_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export async function requestUserPreferences(): Promise<GetUserPreferencesResponse> {
  return apiGet<GetUserPreferencesResponse>("/preferences");
}

export async function requestUpdateUserPreferences(
  input: UpdateUserPreferencesRequest,
): Promise<UpdateUserPreferencesResponse> {
  return apiPost<UpdateUserPreferencesRequest, UpdateUserPreferencesResponse>("/preferences", input);
}
