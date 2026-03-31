import type {
  AdminMediaRegistryResponse,
  AdminErrorsResponse,
  AdminOverviewResponse,
  AdminOpsOverviewResponse,
  AdminFeatureFlagsResponse,
  AdminUsageResponse,
  AdminUsersResponse,
  AdminWorkspacesResponse,
  ApiError,
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
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  getPlatformOverview,
  getUsageSummary,
  listAdminUsers,
} from "../services/analytics/analyticsService.ts";
import { ensureCurrentUser } from "../services/authBusinessService.ts";
import {
  listAdminMediaRegistry,
  upsertAdminDecisionRule,
  upsertAdminMediaPreset,
  upsertAdminPromptTemplate,
} from "../services/adminMediaRegistryService.ts";
import {
  listAdminFeatureFlags,
  listAdminWorkspacesWithAccess,
  updateAdminWorkspaceAccess,
  upsertAdminFeatureFlag,
  upsertAdminFeatureFlagTarget,
} from "../services/adminControlService.ts";
import { evaluateAlerts } from "../services/analytics/alertService.ts";
import { getAICostSummary } from "../services/analytics/costService.ts";
import { getAdminOpsOverview as loadAdminOpsOverview } from "../services/opsService.ts";
import {
  listRecentSystemErrorLogs,
  listTopSystemErrorCodes,
} from "../services/systemErrorLogService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getAdminOverview(
  request: Request,
  response: Response<AdminOverviewResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const overview = await getPlatformOverview();
    response.json({ overview });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_overview_failed",
      message: "Unable to load admin overview.",
      logMessage: "Failed to load admin overview.",
    });
  }
}

export async function getAdminUsers(
  request: Request,
  response: Response<AdminUsersResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const users = await listAdminUsers();
    response.json({
      users,
      totalUsers: users.length,
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_users_failed",
      message: "Unable to load admin users.",
      logMessage: "Failed to load admin users.",
    });
  }
}

export async function getAdminWorkspaces(
  request: Request,
  response: Response<AdminWorkspacesResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const workspaces = await listAdminWorkspacesWithAccess();
    response.json({
      workspaces,
      totalWorkspaces: workspaces.length,
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_workspaces_failed",
      message: "Unable to load admin workspaces.",
      logMessage: "Failed to load admin workspaces.",
    });
  }
}

export async function patchAdminWorkspaceAccess(
  request: Request<{ workspaceId: string }, unknown, UpdateAdminWorkspaceAccessRequest>,
  response: Response<UpdateAdminWorkspaceAccessResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const actor = await ensureCurrentUser(request.auth);
    const access = await updateAdminWorkspaceAccess(
      request.params.workspaceId,
      actor.id,
      request.body,
    );

    response.json({
      businessId: request.params.workspaceId,
      access,
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_workspace_access_update_failed",
      message: "Unable to update workspace access.",
      logMessage: "Failed to update workspace access.",
    });
  }
}

export async function getAdminFeatureFlags(
  request: Request,
  response: Response<AdminFeatureFlagsResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const result = await listAdminFeatureFlags();
    response.json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_feature_flags_failed",
      message: "Unable to load feature flags.",
      logMessage: "Failed to load feature flags.",
    });
  }
}

export async function getAdminMediaRegistry(
  request: Request,
  response: Response<AdminMediaRegistryResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const registry = await listAdminMediaRegistry();
    response.json(registry);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_media_registry_failed",
      message: "Unable to load the media registry.",
      logMessage: "Failed to load admin media registry.",
    });
  }
}

export async function postAdminFeatureFlag(
  request: Request<unknown, unknown, UpsertAdminFeatureFlagRequest>,
  response: Response<UpsertAdminFeatureFlagResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const actor = await ensureCurrentUser(request.auth);
    const flag = await upsertAdminFeatureFlag(request.body, actor.id);
    response.json({ flag });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_feature_flag_upsert_failed",
      message: "Unable to save feature flag.",
      logMessage: "Failed to save feature flag.",
    });
  }
}

export async function postAdminMediaPreset(
  request: Request<unknown, unknown, UpsertAdminMediaPresetRequest>,
  response: Response<UpsertAdminMediaPresetResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const actor = await ensureCurrentUser(request.auth);
    const preset = await upsertAdminMediaPreset(request.body, actor.id);
    response.json({ preset });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_media_preset_upsert_failed",
      message: "Unable to save the media preset.",
      logMessage: "Failed to save admin media preset.",
    });
  }
}

export async function postAdminPromptTemplate(
  request: Request<unknown, unknown, UpsertAdminPromptTemplateRequest>,
  response: Response<UpsertAdminPromptTemplateResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const actor = await ensureCurrentUser(request.auth);
    const promptTemplate = await upsertAdminPromptTemplate(request.body, actor.id);
    response.json({ promptTemplate });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_prompt_template_upsert_failed",
      message: "Unable to save the prompt template.",
      logMessage: "Failed to save admin prompt template.",
    });
  }
}

export async function postAdminDecisionRule(
  request: Request<unknown, unknown, UpsertAdminDecisionRuleRequest>,
  response: Response<UpsertAdminDecisionRuleResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const actor = await ensureCurrentUser(request.auth);
    const decisionRule = await upsertAdminDecisionRule(request.body, actor.id);
    response.json({ decisionRule });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_decision_rule_upsert_failed",
      message: "Unable to save the decision rule.",
      logMessage: "Failed to save admin decision rule.",
    });
  }
}

export async function postAdminFeatureFlagTarget(
  request: Request<unknown, unknown, UpsertAdminFeatureFlagTargetRequest>,
  response: Response<UpsertAdminFeatureFlagTargetResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const actor = await ensureCurrentUser(request.auth);
    const flag = await upsertAdminFeatureFlagTarget(request.body, actor.id);
    response.json({ flag });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_feature_flag_target_upsert_failed",
      message: "Unable to save feature flag target.",
      logMessage: "Failed to save feature flag target.",
    });
  }
}

export async function getAdminUsage(
  request: Request,
  response: Response<AdminUsageResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const [usageSummary, aiCostSummary, alerts] = await Promise.all([
      getUsageSummary(),
      getAICostSummary(),
      evaluateAlerts(),
    ]);

    response.json({
      usageSummary,
      aiCostSummary,
      alerts,
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_usage_failed",
      message: "Unable to load admin usage.",
      logMessage: "Failed to load admin usage.",
    });
  }
}

export async function getAdminOpsOverview(
  request: Request,
  response: Response<AdminOpsOverviewResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const overview = await loadAdminOpsOverview();
    response.json({ overview });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_ops_overview_failed",
      message: "Unable to load admin ops overview.",
      logMessage: "Failed to load admin ops overview.",
    });
  }
}

export async function getAdminErrors(
  request: Request,
  response: Response<AdminErrorsResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const [errors, topCodes] = await Promise.all([
      listRecentSystemErrorLogs(),
      listTopSystemErrorCodes(),
    ]);

    response.json({
      errors,
      topCodes,
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "admin_errors_failed",
      message: "Unable to load admin errors.",
      logMessage: "Failed to load admin errors.",
    });
  }
}
