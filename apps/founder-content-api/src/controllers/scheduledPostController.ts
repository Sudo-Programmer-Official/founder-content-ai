import type {
  ApiError,
  SchedulePostRequest,
  SchedulePostResponse,
  ScheduledPostsQuery,
  ScheduledPostsResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { createScheduledPost, listScheduledPosts } from "../services/scheduledPostService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function schedulePost(
  request: Request<unknown, SchedulePostResponse | ApiError, Partial<SchedulePostRequest>>,
  response: Response<SchedulePostResponse | ApiError>,
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

  if (request.body?.platform !== "linkedin") {
    sendApiError(response, 400, "bad_request", "Only LinkedIn scheduling is supported.");
    return;
  }

  try {
    response.status(201).json(
      await createScheduledPost(request.auth, {
        businessId,
        platform: "linkedin",
        contentText: request.body?.contentText?.trim() ?? "",
        assetGroupId: request.body?.assetGroupId?.trim(),
        slides: request.body?.slides ?? [],
        scheduledAt: request.body?.scheduledAt?.trim() ?? "",
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "schedule_post_failed",
      message: "Unable to schedule LinkedIn post.",
      logMessage: "Failed to schedule LinkedIn post.",
    });
  }
}

export async function getScheduledPosts(
  request: Request<
    unknown,
    ScheduledPostsResponse | ApiError,
    unknown,
    Partial<ScheduledPostsQuery>
  >,
  response: Response<ScheduledPostsResponse | ApiError>,
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
    response.json(await listScheduledPosts(request.auth, businessId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "scheduled_posts_lookup_failed",
      message: "Unable to load scheduled posts.",
      logMessage: "Failed to load scheduled posts.",
    });
  }
}
