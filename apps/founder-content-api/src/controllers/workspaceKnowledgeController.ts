import type {
  ApiError,
  CreateWorkspaceKnowledgeSourceRequest,
  CreateWorkspaceKnowledgeSourceResponse,
  RefreshWorkspaceKnowledgeRequest,
  RefreshWorkspaceKnowledgeResponse,
  WorkspaceKnowledgeQuery,
  WorkspaceKnowledgeResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  createWorkspaceKnowledgeSource,
  getWorkspaceKnowledge,
  refreshWorkspaceKnowledge,
} from "../services/brandIntelligence/workspaceKnowledgeService.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "../services/governanceService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getWorkspaceKnowledgeController(
  request: Request<unknown, WorkspaceKnowledgeResponse | ApiError, unknown, Partial<WorkspaceKnowledgeQuery>>,
  response: Response<WorkspaceKnowledgeResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.query.businessId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "brand_intelligence");
    response.json(await getWorkspaceKnowledge(request.auth, businessId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_knowledge_lookup_failed",
      message: "Unable to load workspace knowledge.",
      logMessage: "Failed to load workspace knowledge.",
    });
  }
}

export async function postWorkspaceKnowledgeSourceController(
  request: Request<unknown, CreateWorkspaceKnowledgeSourceResponse | ApiError, Partial<CreateWorkspaceKnowledgeSourceRequest>>,
  response: Response<CreateWorkspaceKnowledgeSourceResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  if (request.body?.sourceType !== "website" && request.body?.sourceType !== "note") {
    sendApiError(response, 400, "bad_request", "sourceType must be website or note.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "brand_intelligence",
    });
    response.status(201).json(
      await createWorkspaceKnowledgeSource(request.auth, {
        businessId,
        sourceType: request.body.sourceType,
        title: request.body?.title?.trim(),
        sourceUrl: request.body?.sourceUrl?.trim(),
        rawText: request.body?.rawText,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_knowledge_create_failed",
      message: "Unable to save workspace knowledge.",
      logMessage: "Failed to save workspace knowledge.",
    });
  }
}

export async function postWorkspaceKnowledgeRefreshController(
  request: Request<unknown, RefreshWorkspaceKnowledgeResponse | ApiError, Partial<RefreshWorkspaceKnowledgeRequest>>,
  response: Response<RefreshWorkspaceKnowledgeResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "brand_intelligence",
    });
    response.json(await refreshWorkspaceKnowledge(request.auth, businessId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_knowledge_refresh_failed",
      message: "Unable to refresh workspace knowledge.",
      logMessage: "Failed to refresh workspace knowledge.",
    });
  }
}
