import type {
  AdminMediaRegistryResponse,
  AdminErrorsResponse,
  AdminFeatureFlagsResponse,
  AdminOverviewResponse,
  AdminOpsOverviewResponse,
  AdminUsageResponse,
  AdminUsersResponse,
  AdminWorkspacesResponse,
  MyBusinessesResponse,
  TrackAnalyticsEventRequest,
  TrackAnalyticsEventResponse,
  UpdateAdminWorkspaceAccessRequest,
  UpdateAdminWorkspaceAccessResponse,
  UpsertAdminDecisionRuleRequest,
  UpsertAdminDecisionRuleResponse,
  UpsertAdminFeatureFlagRequest,
  UpsertAdminFeatureFlagResponse,
  UpsertAdminFeatureFlagTargetRequest,
  UpsertAdminFeatureFlagTargetResponse,
  UpsertAdminMediaPresetRequest,
  UpsertAdminMediaPresetResponse,
  UpsertAdminPromptTemplateRequest,
  UpsertAdminPromptTemplateResponse,
  WorkspaceAnalyticsOverviewResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPatch, apiPost } from "./api-client";

export async function requestAdminOverview(): Promise<AdminOverviewResponse> {
  return apiGet<AdminOverviewResponse>("/admin/overview");
}

export async function requestAdminUsers(): Promise<AdminUsersResponse> {
  return apiGet<AdminUsersResponse>("/admin/users");
}

export async function requestAdminWorkspaces(): Promise<AdminWorkspacesResponse> {
  return apiGet<AdminWorkspacesResponse>("/admin/workspaces");
}

export async function requestAdminWorkspaceAccessUpdate(
  workspaceId: string,
  payload: UpdateAdminWorkspaceAccessRequest,
): Promise<UpdateAdminWorkspaceAccessResponse> {
  const encodedWorkspaceId = encodeURIComponent(workspaceId);
  return apiPatch<UpdateAdminWorkspaceAccessRequest, UpdateAdminWorkspaceAccessResponse>(
    `/admin/workspaces/${encodedWorkspaceId}/access`,
    payload,
  );
}

export async function requestAdminFeatureFlags(): Promise<AdminFeatureFlagsResponse> {
  return apiGet<AdminFeatureFlagsResponse>("/admin/feature-flags");
}

export async function requestAdminMediaRegistry(): Promise<AdminMediaRegistryResponse> {
  return apiGet<AdminMediaRegistryResponse>("/admin/media-registry");
}

export async function requestAdminFeatureFlagUpsert(
  payload: UpsertAdminFeatureFlagRequest,
): Promise<UpsertAdminFeatureFlagResponse> {
  return apiPost<UpsertAdminFeatureFlagRequest, UpsertAdminFeatureFlagResponse>(
    "/admin/feature-flags",
    payload,
  );
}

export async function requestAdminMediaPresetUpsert(
  payload: UpsertAdminMediaPresetRequest,
): Promise<UpsertAdminMediaPresetResponse> {
  return apiPost<UpsertAdminMediaPresetRequest, UpsertAdminMediaPresetResponse>(
    "/admin/media-registry/presets",
    payload,
  );
}

export async function requestAdminPromptTemplateUpsert(
  payload: UpsertAdminPromptTemplateRequest,
): Promise<UpsertAdminPromptTemplateResponse> {
  return apiPost<UpsertAdminPromptTemplateRequest, UpsertAdminPromptTemplateResponse>(
    "/admin/media-registry/prompt-templates",
    payload,
  );
}

export async function requestAdminDecisionRuleUpsert(
  payload: UpsertAdminDecisionRuleRequest,
): Promise<UpsertAdminDecisionRuleResponse> {
  return apiPost<UpsertAdminDecisionRuleRequest, UpsertAdminDecisionRuleResponse>(
    "/admin/media-registry/decision-rules",
    payload,
  );
}

export async function requestAdminFeatureFlagTargetUpsert(
  payload: UpsertAdminFeatureFlagTargetRequest,
): Promise<UpsertAdminFeatureFlagTargetResponse> {
  return apiPost<UpsertAdminFeatureFlagTargetRequest, UpsertAdminFeatureFlagTargetResponse>(
    "/admin/feature-flags/targets",
    payload,
  );
}

export async function requestAdminUsage(): Promise<AdminUsageResponse> {
  return apiGet<AdminUsageResponse>("/admin/usage");
}

export async function requestAdminOpsOverview(): Promise<AdminOpsOverviewResponse> {
  return apiGet<AdminOpsOverviewResponse>("/admin/ops/overview");
}

export async function requestAdminErrors(): Promise<AdminErrorsResponse> {
  return apiGet<AdminErrorsResponse>("/admin/errors");
}

export async function requestMyBusinesses(): Promise<MyBusinessesResponse> {
  return apiGet<MyBusinessesResponse>("/me/businesses");
}

export async function requestWorkspaceAnalyticsOverview(
  businessId: string,
): Promise<WorkspaceAnalyticsOverviewResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<WorkspaceAnalyticsOverviewResponse>(
    `/workspace/analytics/overview?businessId=${encodedBusinessId}`,
  );
}

export async function trackAnalyticsEvent(
  payload: TrackAnalyticsEventRequest,
): Promise<TrackAnalyticsEventResponse> {
  return apiPost<TrackAnalyticsEventRequest, TrackAnalyticsEventResponse>(
    "/workspace/analytics/events",
    payload,
  );
}
