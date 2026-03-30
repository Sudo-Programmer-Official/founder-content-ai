import type { UserPreferences } from "../../../packages/shared-types";

export const LOCAL_PREFERENCES_STORAGE_KEY = "founder-content-user-preferences";

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  userId: "local-user",
  theme: "light",
  fontSize: "medium",
  density: "comfortable",
  layoutMode: "dashboard",
  aiAssistLevel: "balanced",
  notifyPostPublished: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

export function mergePreferences(
  base: UserPreferences,
  next: Partial<UserPreferences>,
): UserPreferences {
  return {
    ...base,
    ...next,
  };
}
