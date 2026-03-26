export type BusinessPlanCode = "free" | "pro" | "growth" | "custom";
export type FeatureFlagTargetType = "business" | "user";
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
