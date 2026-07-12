import type { ApiError } from "../../../../packages/shared-types/index.ts";
import type {
  RevenueAgentActionRequest,
  RevenueAgentActionResponse,
  RevenueAgentFeedRequest,
  RevenueAgentFeedResponse,
  RevenueAgentReplyAnalysisRequest,
  RevenueAgentReplyAnalysisResponse,
  RevenueAgentResearchResponse,
  RevenueAgentWorkflowResponse,
  RevenueAgentWorkspaceResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { ensureCurrentUser } from "../services/authBusinessService.ts";
import { enforceWorkspaceReadAccess, enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import {
  analyzeRevenueAgentReply,
  getRevenueAgentProspectExportHtml,
  getRevenueAgentProspectWorkflow,
  getRevenueAgentWorkspace,
  performRevenueAgentAction,
  regenerateRevenueAgentResearch,
  runRevenueAgentFeed,
} from "../services/revenueAgent/revenueAgentService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

function readBusinessIdFromQuery(query: Request["query"]): string | undefined {
  return typeof query.businessId === "string" && query.businessId.trim() ? query.businessId.trim() : undefined;
}

function readBusinessIdFromBody(body: { businessId?: unknown }): string | undefined {
  return typeof body.businessId === "string" && body.businessId.trim() ? body.businessId.trim() : undefined;
}

function readOptionalProvider(value: unknown): RevenueAgentFeedRequest["provider"] | undefined {
  return value === "google_business" || value === "csv_import" ? value : undefined;
}

function readReplyText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function getRevenueAgentWorkspaceController(
  request: Request,
  response: Response<RevenueAgentWorkspaceResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessIdFromQuery(request.query);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "outreach");
    const workspace = await getRevenueAgentWorkspace(businessId);
    response.json(workspace);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "revenue_agent_workspace_failed",
      message: "Unable to load revenue agent workspace.",
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "revenue_agent_workspace_failed",
      message: "Unable to load revenue agent workspace.",
      logMessage: "Failed to load revenue agent workspace.",
    });
  }
}

export async function getRevenueAgentProspectExportController(
  request: Request<{ prospectId: string }>,
  response: Response<string | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessIdFromQuery(request.query);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "outreach");
    const html = await getRevenueAgentProspectExportHtml(businessId, request.params.prospectId);
    response.type("html").send(html);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "revenue_agent_export_failed",
      message: "Unable to export revenue agent prospect.",
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "revenue_agent_export_failed",
      message: "Unable to export revenue agent prospect.",
      logMessage: "Failed to export revenue agent prospect.",
    });
  }
}

export async function getRevenueAgentProspectWorkflowController(
  request: Request<{ prospectId: string }>,
  response: Response<RevenueAgentWorkflowResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessIdFromQuery(request.query);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "outreach");
    const workflow = await getRevenueAgentProspectWorkflow(businessId, request.params.prospectId);
    response.json(workflow);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "revenue_agent_workflow_failed",
      message: "Unable to load revenue agent workflow.",
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "revenue_agent_workflow_failed",
      message: "Unable to load revenue agent workflow.",
      logMessage: "Failed to load revenue agent workflow.",
    });
  }
}

export async function postRevenueAgentFeedController(
  request: Request<unknown, unknown, RevenueAgentFeedRequest>,
  response: Response<RevenueAgentFeedResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessIdFromBody(request.body);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "outreach",
      usageMetric: "outreach",
    });
    const actor = await ensureCurrentUser(request.auth);
    const feed = await runRevenueAgentFeed({
      ...request.body,
      businessId,
      provider: readOptionalProvider(request.body.provider),
    });
    void actor;
    response.json(feed);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "revenue_agent_feed_failed",
      message: "Unable to run revenue agent feed.",
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "revenue_agent_feed_failed",
      message: "Unable to run revenue agent feed.",
      logMessage: "Failed to run revenue agent feed.",
    });
  }
}

export async function patchRevenueAgentProspectController(
  request: Request<{ prospectId: string }, unknown, RevenueAgentActionRequest>,
  response: Response<RevenueAgentActionResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessIdFromBody(request.body);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "outreach",
      usageMetric: "outreach",
    });
    const actor = await ensureCurrentUser(request.auth);
    const action = await performRevenueAgentAction(request.params.prospectId, {
      ...request.body,
      businessId,
    });
    void actor;
    response.json(action);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "revenue_agent_action_failed",
      message: "Unable to update revenue agent prospect.",
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "revenue_agent_action_failed",
      message: "Unable to update revenue agent prospect.",
      logMessage: "Failed to update revenue agent prospect.",
    });
  }
}

export async function postRevenueAgentResearchController(
  request: Request<{ prospectId: string }, unknown, { businessId?: unknown }>,
  response: Response<RevenueAgentResearchResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessIdFromBody(request.body);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "outreach",
      usageMetric: "outreach",
    });
    const actor = await ensureCurrentUser(request.auth);
    const research = await regenerateRevenueAgentResearch(request.params.prospectId, { businessId });
    void actor;
    response.json(research);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "revenue_agent_research_failed",
      message: "Unable to regenerate revenue agent research.",
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "revenue_agent_research_failed",
      message: "Unable to regenerate revenue agent research.",
      logMessage: "Failed to regenerate revenue agent research.",
    });
  }
}

export async function postRevenueAgentReplyAnalysisController(
  request: Request<{ prospectId: string }, unknown, RevenueAgentReplyAnalysisRequest>,
  response: Response<RevenueAgentReplyAnalysisResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessIdFromBody(request.body);
  const replyText = readReplyText(request.body.replyText);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  if (!replyText) {
    sendApiError(response, 400, "reply_text_required", "replyText is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "outreach",
      usageMetric: "outreach",
    });
    const actor = await ensureCurrentUser(request.auth);
    const analysis = await analyzeRevenueAgentReply(request.params.prospectId, {
      businessId,
      replyText,
    });
    void actor;
    response.json(analysis);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "revenue_agent_reply_analysis_failed",
      message: "Unable to analyze revenue agent reply.",
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "revenue_agent_reply_analysis_failed",
      message: "Unable to analyze revenue agent reply.",
      logMessage: "Failed to analyze revenue agent reply.",
    });
  }
}
