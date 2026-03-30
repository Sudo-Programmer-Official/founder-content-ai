import type {
  ApiError,
  PublishPostRequest,
  PublishPostResponse,
  SchedulePostRequest,
  SchedulePostResponse,
  UpdateScheduledPostPerformanceRequest,
  UpdateScheduledPostPerformanceResponse,
  UpdateScheduledPostRequest,
  UpdateScheduledPostResponse,
  ScheduledPostsQuery,
  ScheduledPostsResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  createScheduledPost,
  listScheduledPosts,
  publishPostNow,
  updateScheduledPost,
  updateScheduledPostPerformance,
} from "../services/scheduledPostService.ts";
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
        audienceTimezone: request.body?.audienceTimezone?.trim(),
        ignoreSafetyWarnings: request.body?.ignoreSafetyWarnings === true,
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

export async function publishPost(
  request: Request<unknown, PublishPostResponse | ApiError, Partial<PublishPostRequest>>,
  response: Response<PublishPostResponse | ApiError>,
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
    sendApiError(response, 400, "bad_request", "Only LinkedIn publishing is supported.");
    return;
  }

  try {
    response.status(201).json(
      await publishPostNow(request.auth, {
        businessId,
        platform: "linkedin",
        contentText: request.body?.contentText?.trim() ?? "",
        assetId: request.body?.assetId?.trim(),
        title: request.body?.title?.trim(),
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "publish_post_failed",
      message: "Unable to publish to LinkedIn.",
      logMessage: "Failed to publish LinkedIn post.",
    });
  }
}

export async function patchScheduledPost(
  request: Request<
    { scheduledPostId: string },
    UpdateScheduledPostResponse | ApiError,
    Partial<UpdateScheduledPostRequest>
  >,
  response: Response<UpdateScheduledPostResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const scheduledPostId = request.params.scheduledPostId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  if (!scheduledPostId) {
    sendApiError(response, 400, "bad_request", "scheduledPostId is required.");
    return;
  }

  try {
    response.json(
      await updateScheduledPost(request.auth, scheduledPostId, {
        businessId,
        action: request.body?.action as UpdateScheduledPostRequest["action"],
        scheduledAt: request.body?.scheduledAt?.trim(),
        audienceTimezone: request.body?.audienceTimezone?.trim(),
        ignoreSafetyWarnings: request.body?.ignoreSafetyWarnings === true,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "scheduled_post_update_failed",
      message: "Unable to update scheduled post.",
      logMessage: "Failed to update scheduled post.",
    });
  }
}

export async function patchScheduledPostPerformanceController(
  request: Request<
    { scheduledPostId: string },
    UpdateScheduledPostPerformanceResponse | ApiError,
    Partial<UpdateScheduledPostPerformanceRequest>
  >,
  response: Response<UpdateScheduledPostPerformanceResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const scheduledPostId = request.params.scheduledPostId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  if (!scheduledPostId) {
    sendApiError(response, 400, "bad_request", "scheduledPostId is required.");
    return;
  }

  try {
    response.json(
      await updateScheduledPostPerformance(request.auth, scheduledPostId, {
        businessId,
        performanceLabel:
          request.body?.performanceLabel as UpdateScheduledPostPerformanceRequest["performanceLabel"],
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "scheduled_post_performance_update_failed",
      message: "Unable to save post performance.",
      logMessage: "Failed to save scheduled post performance.",
    });
  }
}
