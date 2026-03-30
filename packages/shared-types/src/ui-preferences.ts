export type UiTheme = "light" | "dark" | "focus";
export type UiFontSize = "small" | "medium" | "large";
export type UiDensity = "compact" | "comfortable" | "spacious";
export type UiLayoutMode = "dashboard" | "creator" | "planner";
export type AiAssistLevel = "off" | "minimal" | "balanced" | "proactive";

export interface UserPreferences {
  userId: string;
  theme: UiTheme;
  fontSize: UiFontSize;
  density: UiDensity;
  layoutMode: UiLayoutMode;
  aiAssistLevel: AiAssistLevel;
  notifyPostPublished: boolean;
  notifyEmailCampaignUpdates: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GetUserPreferencesResponse {
  preferences: UserPreferences;
  source: "default" | "database";
}

export interface UpdateUserPreferencesRequest {
  theme?: UiTheme;
  fontSize?: UiFontSize;
  density?: UiDensity;
  layoutMode?: UiLayoutMode;
  aiAssistLevel?: AiAssistLevel;
  notifyPostPublished?: boolean;
  notifyEmailCampaignUpdates?: boolean;
}

export interface UpdateUserPreferencesResponse {
  preferences: UserPreferences;
}
