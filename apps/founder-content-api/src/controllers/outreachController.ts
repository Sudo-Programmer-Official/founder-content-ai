import type {
  ApiError,
  CreateOutreachMessageRequest,
  CreateOutreachMessageResponse,
  ImportOutreachLeadsRequest,
  ImportOutreachLeadsResponse,
  OutreachLeadFilters,
  OutreachLeadHistoryResponse,
  OutreachLeadListResponse,
  OutreachMessageDraftRequest,
  OutreachMessageDraftResponse,
  OutreachOverviewResponse,
  OutreachPlatform,
  OutreachPriority,
  OutreachQueue,
  OutreachReplyDraftRequest,
  OutreachReplyDraftResponse,
  OutreachLeadStatus,
  UpdateOutreachLeadStatusRequest,
  UpdateOutreachLeadStatusResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { ensureCurrentUser } from "../services/authBusinessService.ts";
import { enforceWorkspaceReadAccess, enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import {
  createOutreachMessage,
  generateOutreachMessageDraft,
  generateOutreachReplyDraft,
  getOutreachOverview,
  getOutreachLeadHistory,
  importOutreachLeads,
  listOutreachLeads,
  updateOutreachLeadStatus,
} from "../services/outreach/outreachService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

function resolvePlatform(value: unknown): OutreachPlatform | "all" | undefined {
  if (value === "linkedin" || value === "reddit" || value === "x" || value === "all") {
    return value;
  }

  return undefined;
}

function resolveStatus(value: unknown): OutreachLeadStatus | "all" | undefined {
  if (value === "new" || value === "contacted" || value === "replied" || value === "activated" || value === "all") {
    return value;
  }

  return undefined;
}

function resolvePriority(value: unknown): OutreachPriority | "all" | undefined {
  if (value === "high" || value === "medium" || value === "low" || value === "all") {
    return value;
  }

  return undefined;
}

function resolveQueue(value: unknown): OutreachQueue | undefined {
  if (value === "new" || value === "followups") {
    return value;
  }

  return undefined;
}

function readFilters(request: Request): OutreachLeadFilters {
  return {
    platform: resolvePlatform(request.query.platform),
    status: resolveStatus(request.query.status),
    priority: resolvePriority(request.query.priority),
    queue: resolveQueue(request.query.queue),
  };
}

export async function getAdminOutreachOverview(
  request: Request,
  response: Response<OutreachOverviewResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const overview = await getOutreachOverview();
    response.json({ overview });
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "outreach_overview_failed",
      message: "Unable to load outreach overview.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "outreach_overview_failed",
      message: "Unable to load outreach overview.",
      logMessage: "Failed to load outreach overview.",
    });
  }
}

export async function getAdminOutreachLeads(
  request: Request,
  response: Response<OutreachLeadListResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const filters = readFilters(request);
    const leads = await listOutreachLeads(filters);
    response.json({ leads, filters });
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "outreach_leads_failed",
      message: "Unable to load outreach leads.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "outreach_leads_failed",
      message: "Unable to load outreach leads.",
      logMessage: "Failed to load outreach leads.",
    });
  }
}

export async function postAdminOutreachMessageDraft(
  request: Request<unknown, unknown, OutreachMessageDraftRequest>,
  response: Response<OutreachMessageDraftResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const draft = await generateOutreachMessageDraft(request.body);
    response.json(draft);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "outreach_message_draft_failed",
      message: "Unable to generate outreach message.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "outreach_message_draft_failed",
      message: "Unable to generate outreach message.",
      logMessage: "Failed to generate outreach message draft.",
    });
  }
}

export async function postAdminOutreachFollowupDraft(
  request: Request<unknown, unknown, OutreachMessageDraftRequest>,
  response: Response<OutreachMessageDraftResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const draft = await generateOutreachMessageDraft(request.body);
    response.json(draft);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "outreach_followup_draft_failed",
      message: "Unable to generate follow-up message.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "outreach_followup_draft_failed",
      message: "Unable to generate follow-up message.",
      logMessage: "Failed to generate outreach follow-up draft.",
    });
  }
}

export async function postAdminOutreachReplyDraft(
  request: Request<unknown, unknown, OutreachReplyDraftRequest>,
  response: Response<OutreachReplyDraftResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const draft = await generateOutreachReplyDraft(request.body);
    response.json(draft);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "outreach_reply_draft_failed",
      message: "Unable to generate reply message.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "outreach_reply_draft_failed",
      message: "Unable to generate reply message.",
      logMessage: "Failed to generate outreach reply draft.",
    });
  }
}

export async function patchAdminOutreachLeadStatus(
  request: Request<{ leadId: string }, unknown, UpdateOutreachLeadStatusRequest>,
  response: Response<UpdateOutreachLeadStatusResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const lead = await updateOutreachLeadStatus(request.params.leadId, request.body);
    response.json({ lead });
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "outreach_status_update_failed",
      message: "Unable to update outreach lead.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "outreach_status_update_failed",
      message: "Unable to update outreach lead.",
      logMessage: "Failed to update outreach lead status.",
    });
  }
}

function resolveBusinessId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export async function getWorkspaceOutreachLeads(
  request: Request,
  response: Response<OutreachLeadListResponse | ApiError>,
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
    await enforceWorkspaceReadAccess(request.auth, businessId, "outreach");
    const filters = {
      ...readFilters(request),
      businessId,
    };
    const leads = await listOutreachLeads(filters);
    response.json({ leads, filters });
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "workspace_outreach_leads_failed",
      message: "Unable to load workspace outreach leads.",
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_outreach_leads_failed",
      message: "Unable to load workspace outreach leads.",
      logMessage: "Failed to load workspace outreach leads.",
    });
  }
}

export async function postWorkspaceOutreachLeadImport(
  request: Request<unknown, unknown, ImportOutreachLeadsRequest>,
  response: Response<ImportOutreachLeadsResponse | ApiError>,
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
      featureKey: "outreach",
    });
    const result = await importOutreachLeads({
      ...request.body,
      businessId,
    });
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "outreach_import_failed",
      message: "Unable to import outreach leads.",
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "outreach_import_failed",
      message: "Unable to import outreach leads.",
      logMessage: "Failed to import outreach leads.",
    });
  }
}

export async function postWorkspaceOutreachMessage(
  request: Request<unknown, unknown, CreateOutreachMessageRequest>,
  response: Response<CreateOutreachMessageResponse | ApiError>,
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
      featureKey: "outreach",
      usageMetric: "outreach",
    });
    const actor = await ensureCurrentUser(request.auth);
    const result = await createOutreachMessage(
      {
        ...request.body,
        businessId,
      },
      actor.id,
    );
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "outreach_message_send_failed",
      message: "Unable to log outreach message.",
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "outreach_message_send_failed",
      message: "Unable to log outreach message.",
      logMessage: "Failed to log outreach message.",
    });
  }
}

export async function getWorkspaceOutreachLeadHistory(
  request: Request<{ leadId: string }>,
  response: Response<OutreachLeadHistoryResponse | ApiError>,
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
    await enforceWorkspaceReadAccess(request.auth, businessId, "outreach");
    const history = await getOutreachLeadHistory(businessId, request.params.leadId);
    response.json(history);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "outreach_history_failed",
      message: "Unable to load outreach history.",
      businessId,
      userId: request.auth.userId,
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "outreach_history_failed",
      message: "Unable to load outreach history.",
      logMessage: "Failed to load outreach history.",
    });
  }
}
