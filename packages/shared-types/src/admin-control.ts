import type {
  BusinessMediaProfileType,
  MediaRecommendationContentType,
  MediaRecommendationGoal,
  MediaSuggestionType,
} from "./media-intelligence.ts";

export type BusinessPlanCode = "free" | "pro" | "growth" | "custom";
export type FeatureFlagTargetType = "business" | "user";
export type AdminDecisionRuleScope = "global" | "business_type" | "workspace";
export type AdminWorkspaceAccessAction =
  | "grant_pro_access"
  | "set_plan"
  | "extend_trial"
  | "extend_grace"
  | "reset_limits"
  | "disable_business"
  | "enable_business";

export interface AdminWorkspaceLimitSnapshot {
  date: string;
  postsLimit: number;
  postsUsed: number;
  emailsLimit: number;
  emailsUsed: number;
  outreachLimit: number;
  outreachUsed: number;
}

export interface AdminWorkspaceAccessState {
  planCode: BusinessPlanCode;
  trialEndsAt?: string;
  graceUntil?: string;
  isActive: boolean;
  adminOverrideNote?: string;
  dailyLimits: AdminWorkspaceLimitSnapshot;
  recentAdminActionSummary?: string;
  recentAdminActionAt?: string;
}

export interface AdminFeatureFlagTarget {
  id: string;
  targetType: FeatureFlagTargetType;
  targetId: string;
  targetName?: string;
  enabled: boolean;
  createdAt: string;
}

export interface AdminFeatureFlag {
  id: string;
  key: string;
  description?: string;
  enabledGlobally: boolean;
  createdAt: string;
  targetCount: number;
  targets: AdminFeatureFlagTarget[];
}

export interface AdminFeatureFlagsResponse {
  flags: AdminFeatureFlag[];
}

export interface UpsertAdminFeatureFlagRequest {
  key: string;
  description?: string;
  enabledGlobally: boolean;
}

export interface UpsertAdminFeatureFlagResponse {
  flag: AdminFeatureFlag;
}

export interface UpsertAdminFeatureFlagTargetRequest {
  featureKey: string;
  targetType: FeatureFlagTargetType;
  targetId: string;
  enabled: boolean;
}

export interface UpsertAdminFeatureFlagTargetResponse {
  flag: AdminFeatureFlag;
}

export interface AdminMediaPresetRecord {
  id: string;
  slug: string;
  name: string;
  description?: string;
  supportedBusinessTypes: BusinessMediaProfileType[];
  supportedContentTypes: MediaRecommendationContentType[];
  supportedGoals: MediaRecommendationGoal[];
  mediaTypes: MediaSuggestionType[];
  fallbackOrder: MediaSuggestionType[];
  uiLabel?: string;
  priority: number;
  isActive: boolean;
  promptTemplateByMediaType: Partial<Record<MediaSuggestionType, string>>;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPromptTemplateRecord {
  id: string;
  slug: string;
  name: string;
  category: string;
  templateBody: string;
  variables: string[];
  notes?: string;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminDecisionRuleRecord {
  id: string;
  ruleName: string;
  ruleScope: AdminDecisionRuleScope;
  businessType?: BusinessMediaProfileType;
  businessId?: string;
  businessName?: string;
  conditions: Record<string, unknown>;
  outputs: Record<string, unknown>;
  priority: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminMediaRegistryOptions {
  businessTypes: BusinessMediaProfileType[];
  contentTypes: MediaRecommendationContentType[];
  goals: MediaRecommendationGoal[];
  mediaTypes: MediaSuggestionType[];
  ruleScopes: AdminDecisionRuleScope[];
  promptTemplateCategories: string[];
}

export interface AdminMediaRegistryResponse {
  options: AdminMediaRegistryOptions;
  presets: AdminMediaPresetRecord[];
  promptTemplates: AdminPromptTemplateRecord[];
  decisionRules: AdminDecisionRuleRecord[];
}

export interface UpsertAdminMediaPresetRequest {
  id?: string;
  slug: string;
  name: string;
  description?: string;
  supportedBusinessTypes: BusinessMediaProfileType[];
  supportedContentTypes: MediaRecommendationContentType[];
  supportedGoals: MediaRecommendationGoal[];
  mediaTypes: MediaSuggestionType[];
  fallbackOrder: MediaSuggestionType[];
  uiLabel?: string;
  priority: number;
  isActive: boolean;
  promptTemplateByMediaType: Partial<Record<MediaSuggestionType, string>>;
}

export interface UpsertAdminMediaPresetResponse {
  preset: AdminMediaPresetRecord;
}

export interface UpsertAdminPromptTemplateRequest {
  id?: string;
  slug: string;
  name: string;
  category: string;
  templateBody: string;
  variables: string[];
  notes?: string;
  version: number;
  isActive: boolean;
}

export interface UpsertAdminPromptTemplateResponse {
  promptTemplate: AdminPromptTemplateRecord;
}

export interface UpsertAdminDecisionRuleRequest {
  id?: string;
  ruleName: string;
  ruleScope: AdminDecisionRuleScope;
  businessType?: BusinessMediaProfileType;
  businessId?: string;
  conditions: Record<string, unknown>;
  outputs: Record<string, unknown>;
  priority: number;
  isActive: boolean;
}

export interface UpsertAdminDecisionRuleResponse {
  decisionRule: AdminDecisionRuleRecord;
}

export interface UpdateAdminWorkspaceAccessRequest {
  action: AdminWorkspaceAccessAction;
  planCode?: BusinessPlanCode;
  trialDays?: number;
  graceDays?: number;
  note?: string;
}

export interface UpdateAdminWorkspaceAccessResponse {
  businessId: string;
  access: AdminWorkspaceAccessState;
}
