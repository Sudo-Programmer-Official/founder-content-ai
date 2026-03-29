import type {
  ApiError,
  CreateGrowthLeadRequest,
  CreateGrowthLeadResponse,
  GrowthAutomationFlowListQuery,
  GrowthAutomationFlowListResponse,
  GrowthLeadEventListQuery,
  GrowthLeadEventListResponse,
  GrowthLeadListQuery,
  GrowthLeadListResponse,
  UpdateGrowthLeadStatusRequest,
  UpdateGrowthLeadStatusResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { enforceWorkspaceReadAccess, enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import {
  createGrowthLead,
  listGrowthAutomationFlows,
  listGrowthLeadEvents,
  listGrowthLeads,
  updateGrowthLeadStatus,
} from "../services/growth/growthAutomationService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

function resolveBusinessId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export async function getGrowthLeadsController(
  request: Request<unknown, GrowthLeadListResponse | ApiError, unknown, Partial<GrowthLeadListQuery>>,
  response: Response<GrowthLeadListResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = resolveBusinessId(request.query.businessId);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    response.json(await listGrowthLeads(businessId));
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      businessId,
      code: "growth_leads_load_failed",
      message: "Unable to load growth leads.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "growth_leads_load_failed",
      message: "Unable to load growth leads.",
      logMessage: "Failed to load growth leads.",
    });
  }
}

export async function postGrowthLeadController(
  request: Request<unknown, CreateGrowthLeadResponse | ApiError, CreateGrowthLeadRequest>,
  response: Response<CreateGrowthLeadResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = resolveBusinessId(request.body.businessId);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    response.status(201).json(await createGrowthLead({ ...request.body, businessId }));
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      businessId,
      code: "growth_lead_create_failed",
      message: "Unable to create growth lead.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "growth_lead_create_failed",
      message: "Unable to create growth lead.",
      logMessage: "Failed to create growth lead.",
    });
  }
}

export async function patchGrowthLeadStatusController(
  request: Request<{ leadId: string }, UpdateGrowthLeadStatusResponse | ApiError, UpdateGrowthLeadStatusRequest>,
  response: Response<UpdateGrowthLeadStatusResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = resolveBusinessId(request.body.businessId);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    response.json(await updateGrowthLeadStatus(request.params.leadId, { ...request.body, businessId }));
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      businessId,
      code: "growth_lead_status_update_failed",
      message: "Unable to update growth lead.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "growth_lead_status_update_failed",
      message: "Unable to update growth lead.",
      logMessage: "Failed to update growth lead status.",
    });
  }
}

export async function getGrowthFlowsController(
  request: Request<
    unknown,
    GrowthAutomationFlowListResponse | ApiError,
    unknown,
    Partial<GrowthAutomationFlowListQuery>
  >,
  response: Response<GrowthAutomationFlowListResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = resolveBusinessId(request.query.businessId);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    response.json(await listGrowthAutomationFlows(businessId));
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      businessId,
      code: "growth_flows_load_failed",
      message: "Unable to load growth automation flows.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "growth_flows_load_failed",
      message: "Unable to load growth automation flows.",
      logMessage: "Failed to load growth automation flows.",
    });
  }
}

export async function getGrowthLeadEventsController(
  request: Request<
    { leadId: string },
    GrowthLeadEventListResponse | ApiError,
    unknown,
    Partial<GrowthLeadEventListQuery>
  >,
  response: Response<GrowthLeadEventListResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = resolveBusinessId(request.query.businessId);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    response.json(await listGrowthLeadEvents(businessId, request.params.leadId));
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      businessId,
      code: "growth_lead_events_load_failed",
      message: "Unable to load growth lead activity.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "growth_lead_events_load_failed",
      message: "Unable to load growth lead activity.",
      logMessage: "Failed to load growth lead activity.",
    });
  }
}
