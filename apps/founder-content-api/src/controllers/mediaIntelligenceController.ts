import type {
  ApiError,
  MediaRecommendationsRequest,
  MediaRecommendationsResponse,
  RecordMediaPerformanceStatRequest,
  RecordMediaPerformanceStatResponse,
  UpdateBusinessMediaProfileRequest,
  UpdateBusinessMediaProfileResponse,
  UpdateWorkspaceMediaOverrideRequest,
  UpdateWorkspaceMediaOverrideResponse,
  WorkspaceMediaResolutionRequest,
  WorkspaceMediaResolutionResponse,
  WorkspaceMediaIntelligenceResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  getMediaRecommendations,
  getWorkspaceMediaIntelligence,
  recordMediaPerformanceStat,
  resolveWorkspaceMediaConfiguration,
  updateBusinessMediaProfile,
  updateWorkspaceMediaOverride,
} from "../services/mediaIntelligenceService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getWorkspaceMediaIntelligenceController(
  request: Request<unknown, WorkspaceMediaIntelligenceResponse | ApiError, unknown, { businessId?: string }>,
  response: Response<WorkspaceMediaIntelligenceResponse | ApiError>,
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
    response.json(await getWorkspaceMediaIntelligence(request.auth, businessId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_media_intelligence_lookup_failed",
      message: "Unable to load workspace media intelligence.",
      logMessage: "Failed to load workspace media intelligence.",
    });
  }
}

export async function patchBusinessMediaProfileController(
  request: Request<unknown, UpdateBusinessMediaProfileResponse | ApiError, Partial<UpdateBusinessMediaProfileRequest>>,
  response: Response<UpdateBusinessMediaProfileResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();

  if (
    !businessId ||
    !request.body?.businessType ||
    typeof request.body.preferExistingAssets !== "boolean" ||
    typeof request.body.preferTextVisuals !== "boolean" ||
    typeof request.body.allowGeneratedIllustrations !== "boolean" ||
    typeof request.body.avoidRealisticPeople !== "boolean" ||
    typeof request.body.allowScreenshotHighlights !== "boolean"
  ) {
    sendApiError(
      response,
      400,
      "bad_request",
      "businessId, businessType, and all profile boolean fields are required.",
    );
    return;
  }

  try {
    response.json(
      await updateBusinessMediaProfile(request.auth, {
        businessId,
        businessType: request.body.businessType,
        preferExistingAssets: request.body.preferExistingAssets,
        preferTextVisuals: request.body.preferTextVisuals,
        allowGeneratedIllustrations: request.body.allowGeneratedIllustrations,
        avoidRealisticPeople: request.body.avoidRealisticPeople,
        allowScreenshotHighlights: request.body.allowScreenshotHighlights,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_media_profile_update_failed",
      message: "Unable to update workspace media profile.",
      logMessage: "Failed to update workspace media profile.",
    });
  }
}

export async function postWorkspaceMediaOverrideController(
  request: Request<unknown, UpdateWorkspaceMediaOverrideResponse | ApiError, Partial<UpdateWorkspaceMediaOverrideRequest>>,
  response: Response<UpdateWorkspaceMediaOverrideResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const mediaPresetId = request.body?.mediaPresetId?.trim();

  if (!businessId || !mediaPresetId || typeof request.body?.isEnabled !== "boolean") {
    sendApiError(response, 400, "bad_request", "businessId, mediaPresetId, and isEnabled are required.");
    return;
  }

  try {
    response.json(
      await updateWorkspaceMediaOverride(request.auth, {
        businessId,
        mediaPresetId,
        isEnabled: request.body.isEnabled,
        customPromptTemplateId: request.body?.customPromptTemplateId?.trim() || undefined,
        customSettings:
          request.body?.customSettings && typeof request.body.customSettings === "object"
            ? request.body.customSettings
            : undefined,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_media_override_update_failed",
      message: "Unable to update workspace media preset override.",
      logMessage: "Failed to update workspace media preset override.",
    });
  }
}

export async function postMediaRecommendationsController(
  request: Request<unknown, MediaRecommendationsResponse | ApiError, Partial<MediaRecommendationsRequest>>,
  response: Response<MediaRecommendationsResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const contentText = request.body?.contentText?.trim();

  if (!businessId || !contentText || !request.body?.contentType) {
    sendApiError(response, 400, "bad_request", "businessId, contentText, and contentType are required.");
    return;
  }

  try {
    response.json(
      await getMediaRecommendations(request.auth, {
        businessId,
        contentText,
        contentType: request.body.contentType,
        goal: request.body.goal,
        sourceAssetIds: Array.isArray(request.body.sourceAssetIds)
          ? request.body.sourceAssetIds.map((value) => value.trim()).filter(Boolean)
          : undefined,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_media_recommendations_failed",
      message: "Unable to load media recommendations.",
      logMessage: "Failed to load media recommendations.",
    });
  }
}

export async function postWorkspaceMediaResolutionController(
  request: Request<unknown, WorkspaceMediaResolutionResponse | ApiError, Partial<WorkspaceMediaResolutionRequest>>,
  response: Response<WorkspaceMediaResolutionResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();

  if (!businessId || !request.body?.contentType) {
    sendApiError(response, 400, "bad_request", "businessId and contentType are required.");
    return;
  }

  try {
    response.json(
      await resolveWorkspaceMediaConfiguration(request.auth, {
        businessId,
        contentType: request.body.contentType,
        goal: request.body.goal,
        hasUploadedAssets:
          typeof request.body.hasUploadedAssets === "boolean" ? request.body.hasUploadedAssets : undefined,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_media_resolution_failed",
      message: "Unable to resolve workspace media configuration.",
      logMessage: "Failed to resolve workspace media configuration.",
    });
  }
}

export async function postMediaPerformanceStatController(
  request: Request<unknown, RecordMediaPerformanceStatResponse | ApiError, Partial<RecordMediaPerformanceStatRequest>>,
  response: Response<RecordMediaPerformanceStatResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();

  if (!businessId || !request.body?.mediaType || !request.body?.surface) {
    sendApiError(response, 400, "bad_request", "businessId, mediaType, and surface are required.");
    return;
  }

  try {
    response.json(
      await recordMediaPerformanceStat(request.auth, {
        businessId,
        mediaPresetId: request.body.mediaPresetId?.trim() || undefined,
        mediaType: request.body.mediaType,
        surface: request.body.surface,
        impressions: request.body.impressions,
        clicks: request.body.clicks,
        engagements: request.body.engagements,
        conversions: request.body.conversions,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_media_performance_record_failed",
      message: "Unable to record media performance.",
      logMessage: "Failed to record media performance.",
    });
  }
}
