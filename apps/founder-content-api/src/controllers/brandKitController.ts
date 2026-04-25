import type {
  ApiError,
  BrandKitQuery,
  BrandKitResponse,
  UpdateBrandKitRequest,
  UpdateBrandKitResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  getBrandKitForBusiness,
  updateBrandKitForBusiness,
} from "../services/brandIntelligence/brandKitService.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "../services/governanceService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function getBrandKitController(
  request: Request<unknown, BrandKitResponse | ApiError, unknown, Partial<BrandKitQuery>>,
  response: Response<BrandKitResponse | ApiError>,
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
    response.json({
      brandKit: await getBrandKitForBusiness({
        principal: request.auth,
        businessId,
      }),
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "brand_kit_lookup_failed",
      message: "Unable to load brand theme.",
      logMessage: "Failed to load brand theme.",
    });
  }
}

export async function updateBrandKitController(
  request: Request<unknown, UpdateBrandKitResponse | ApiError, Partial<UpdateBrandKitRequest>>,
  response: Response<UpdateBrandKitResponse | ApiError>,
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
    response.json({
      brandKit: await updateBrandKitForBusiness({
        principal: request.auth,
        businessId,
        brandKit: {
          brandName: request.body?.brandKit?.brandName?.trim(),
          industry: request.body?.brandKit?.industry?.trim(),
          style: request.body?.brandKit?.style?.trim(),
          primaryColor: request.body?.brandKit?.primaryColor?.trim(),
          secondaryColor: request.body?.brandKit?.secondaryColor?.trim(),
          fontFamily: request.body?.brandKit?.fontFamily?.trim(),
          iconStyle: request.body?.brandKit?.iconStyle?.trim(),
          backgroundStyle: request.body?.brandKit?.backgroundStyle,
          fontStyle: request.body?.brandKit?.fontStyle,
          visualStyle: request.body?.brandKit?.visualStyle,
          tone: request.body?.brandKit?.tone,
          toneKeywords: normalizeStringArray(request.body?.brandKit?.toneKeywords),
          imageGuidelines: request.body?.brandKit?.imageGuidelines?.trim(),
          businessDescription: request.body?.brandKit?.businessDescription?.trim(),
          websiteUrl: request.body?.brandKit?.websiteUrl?.trim(),
          accentStyle: request.body?.brandKit?.accentStyle,
          brandPlacement: request.body?.brandKit?.brandPlacement,
          logoUrl: request.body?.brandKit?.logoUrl?.trim(),
        },
      }),
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "brand_kit_update_failed",
      message: "Unable to save brand theme.",
      logMessage: "Failed to save brand theme.",
    });
  }
}
