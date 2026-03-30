import type {
  ApiError,
  BrandProfileQuery,
  BrandProfileResponse,
  UpdateBrandProfileRequest,
  UpdateBrandProfileResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  getBrandProfile,
  updateBrandProfile,
} from "../services/brandIntelligence/brandProfileService.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "../services/governanceService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getBrandProfileController(
  request: Request<unknown, BrandProfileResponse | ApiError, unknown, Partial<BrandProfileQuery>>,
  response: Response<BrandProfileResponse | ApiError>,
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
    response.json(
      await getBrandProfile(request.auth, {
        businessId,
        refreshFromSignals: request.query.refreshFromSignals,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "brand_profile_lookup_failed",
      message: "Unable to load brand profile.",
      logMessage: "Failed to load brand profile.",
    });
  }
}

export async function updateBrandProfileController(
  request: Request<unknown, UpdateBrandProfileResponse | ApiError, Partial<UpdateBrandProfileRequest>>,
  response: Response<UpdateBrandProfileResponse | ApiError>,
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
    response.json(
      await updateBrandProfile(request.auth, {
        businessId,
        linkedinUrl: request.body?.linkedinUrl?.trim(),
        instagramUrl: request.body?.instagramUrl?.trim(),
        facebookUrl: request.body?.facebookUrl?.trim(),
        websiteUrl: request.body?.websiteUrl?.trim(),
        tone: request.body?.tone?.trim(),
        writingStyle: request.body?.writingStyle?.trim(),
        visualStyle: request.body?.visualStyle?.trim(),
        topics: request.body?.topics,
        patterns: request.body?.patterns,
        refreshFromSignals: request.body?.refreshFromSignals,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "brand_profile_update_failed",
      message: "Unable to update brand profile.",
      logMessage: "Failed to update brand profile.",
    });
  }
}
