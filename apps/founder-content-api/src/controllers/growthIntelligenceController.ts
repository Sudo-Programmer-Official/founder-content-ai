import type {
  ApiError,
  GenerateHashtagsRequest,
  GenerateHashtagsResponse,
  RecommendPostTimeQuery,
  RecommendPostTimeResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  generateHashtags,
  recommendPostTimes,
} from "../services/growthIntelligenceService.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "../services/governanceService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getRecommendedPostTimes(
  request: Request<
    unknown,
    RecommendPostTimeResponse | ApiError,
    unknown,
    Partial<RecommendPostTimeQuery>
  >,
  response: Response<RecommendPostTimeResponse | ApiError>,
): Promise<void> {
  if (!request.auth?.userId) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.query.businessId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "control_dashboard");
    response.json(
      await recommendPostTimes({
        businessId,
        userId: request.auth.userId,
        contentType: request.query.contentType,
        audienceTimezone: request.query.audienceTimezone?.trim(),
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "recommend_post_time_failed",
      message: "Unable to recommend posting times.",
      logMessage: "Failed to recommend posting times.",
    });
  }
}

export async function postGenerateHashtags(
  request: Request<unknown, GenerateHashtagsResponse | ApiError, Partial<GenerateHashtagsRequest>>,
  response: Response<GenerateHashtagsResponse | ApiError>,
): Promise<void> {
  const businessId = request.body?.businessId?.trim();

  if (businessId) {
    if (!request.auth) {
      sendApiError(
        response,
        401,
        "auth_required",
        "Authentication is required when generating hashtags for a workspace.",
      );
      return;
    }

    try {
      await enforceWorkspaceWriteAccess({
        principal: request.auth,
        businessId,
        featureKey: "content_generation",
      });
    } catch (error) {
      handleApiError(response, error, {
        statusCode: 500,
        code: "generate_hashtags_failed",
        message: "Unable to generate hashtags.",
        logMessage: "Failed to validate hashtag generation access.",
      });
      return;
    }
  }

  const contentText = request.body?.contentText?.trim();

  if (!contentText) {
    sendApiError(response, 400, "bad_request", "contentText is required.");
    return;
  }

  try {
    response.json(
      await generateHashtags({
        businessId,
        contentText,
        contentType: request.body?.contentType,
        targetCount: request.body?.targetCount,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "generate_hashtags_failed",
      message: "Unable to generate hashtags.",
      logMessage: "Failed to generate hashtags.",
    });
  }
}
