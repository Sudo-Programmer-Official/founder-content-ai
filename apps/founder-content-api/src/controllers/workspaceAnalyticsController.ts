import type {
  ApiError,
  TrackAnalyticsEventRequest,
  TrackAnalyticsEventResponse,
  WorkspaceAnalyticsOverviewQuery,
  WorkspaceAnalyticsOverviewResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { requireBusinessMembership } from "../services/authBusinessService.ts";
import { getWorkspaceOverview } from "../services/analytics/analyticsService.ts";
import { logEvent } from "../services/analytics/eventLoggingService.ts";
import { recordStyleSignal } from "../services/styleProfileService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

function getStringMetadataValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export async function getWorkspaceAnalyticsOverview(
  request: Request<unknown, WorkspaceAnalyticsOverviewResponse | ApiError, unknown, Partial<WorkspaceAnalyticsOverviewQuery>>,
  response: Response<WorkspaceAnalyticsOverviewResponse | ApiError>,
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
    await requireBusinessMembership(request.auth, businessId);
    const overview = await getWorkspaceOverview(businessId);
    response.json({ overview });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_analytics_failed",
      message: "Unable to load workspace analytics.",
      logMessage: "Failed to load workspace analytics.",
    });
  }
}

export async function trackWorkspaceAnalyticsEvent(
  request: Request<unknown, TrackAnalyticsEventResponse | ApiError, Partial<TrackAnalyticsEventRequest>>,
  response: Response<TrackAnalyticsEventResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const eventType = request.body?.eventType;
  const businessId = request.body?.businessId?.trim();

  if (!eventType) {
    sendApiError(response, 400, "bad_request", "eventType is required.");
    return;
  }

  try {
    if (businessId) {
      await requireBusinessMembership(request.auth, businessId);
    }

    const metadata = request.body?.metadata ?? {};

    const event = await logEvent(
      eventType,
      request.auth.userId,
      businessId,
      metadata,
    );

    await recordStyleSignal({
      userId: request.auth.userId,
      businessId,
      tone: getStringMetadataValue(metadata, "tone"),
      contentType: getStringMetadataValue(metadata, "contentType"),
      acceptedOutput: eventType === "output_copied",
      edited: eventType === "content_edited",
    });

    response.status(201).json({ event });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_event_tracking_failed",
      message: "Unable to track workspace analytics event.",
      logMessage: "Failed to track workspace analytics event.",
    });
  }
}
