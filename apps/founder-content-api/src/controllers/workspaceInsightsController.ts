import type {
  ApiError,
  WorkspaceInsightsQuery,
  WorkspaceInsightsResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { getWorkspaceInsights } from "../services/workspaceInsightsService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getWorkspaceInsightsController(
  request: Request<unknown, WorkspaceInsightsResponse | ApiError, unknown, Partial<WorkspaceInsightsQuery>>,
  response: Response<WorkspaceInsightsResponse | ApiError>,
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
    response.json(await getWorkspaceInsights(request.auth, businessId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_insights_lookup_failed",
      message: "Unable to load workspace insights.",
      logMessage: "Failed to load workspace insights.",
    });
  }
}
