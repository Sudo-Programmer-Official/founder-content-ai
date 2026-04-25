import type {
  ApiError,
  BrandAssetType,
  BrandStudioAssetKind,
  BrandStudioHistoryQuery,
  BrandStudioHistoryResponse,
  GenerateBrandAssetRequest,
  GenerateBrandAssetResponse,
  GenerateBrandStudioAssetRequest,
  GenerateBrandStudioAssetResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  generateBrandAsset,
  generateBrandStudioAsset,
  listBrandStudioHistory,
} from "../services/brandStudioService.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "../services/governanceService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

const VALID_ASSET_KINDS: BrandStudioAssetKind[] = [
  "homepage_hero",
  "feature_section",
  "cta_banner",
  "icon_set",
  "social_media",
  "email_header",
];

const VALID_BRAND_ASSET_TYPES: BrandAssetType[] = [
  "hero_banner",
  "feature_section",
  "cta_banner",
  "icon_set",
  "social_post",
  "email_header",
];

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function getBrandStudioHistoryController(
  request: Request<unknown, BrandStudioHistoryResponse | ApiError, unknown, Partial<BrandStudioHistoryQuery>>,
  response: Response<BrandStudioHistoryResponse | ApiError>,
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
    const limit = Number.parseInt(String(request.query.limit ?? ""), 10);

    response.json(
      await listBrandStudioHistory({
        principal: request.auth,
        query: {
          businessId,
          limit: Number.isFinite(limit) ? limit : undefined,
        },
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "brand_studio_history_failed",
      message: "Unable to load brand studio history.",
      logMessage: "Failed to load brand studio history.",
    });
  }
}

export async function postBrandStudioGenerationController(
  request: Request<unknown, GenerateBrandStudioAssetResponse | ApiError, Partial<GenerateBrandStudioAssetRequest>>,
  response: Response<GenerateBrandStudioAssetResponse | ApiError>,
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

  if (!request.body?.assetKind || !VALID_ASSET_KINDS.includes(request.body.assetKind)) {
    sendApiError(
      response,
      400,
      "bad_request",
      "assetKind must be one of: homepage_hero, feature_section, cta_banner, icon_set, social_media, email_header.",
    );
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "visual_generation",
      usageMetric: "generations",
    });

    response.status(201).json(
      await generateBrandStudioAsset({
        principal: request.auth,
        request: {
          businessId,
          assetKind: request.body.assetKind,
          goal: request.body.goal?.trim(),
          context: request.body.context?.trim(),
          layout: request.body.layout?.trim(),
          extraInstructions: request.body.extraInstructions?.trim(),
          iconLabels: normalizeStringArray(request.body.iconLabels),
          brandKit: request.body.brandKit,
          referenceGenerationId: request.body.referenceGenerationId?.trim(),
          matchPreviousStyle: request.body.matchPreviousStyle === true,
        },
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "brand_studio_generation_failed",
      message: "Unable to generate brand asset.",
      logMessage: "Failed to generate brand studio asset.",
    });
  }
}

export async function postBrandGenerateAssetController(
  request: Request<unknown, GenerateBrandAssetResponse | ApiError, Partial<GenerateBrandAssetRequest>>,
  response: Response<GenerateBrandAssetResponse | ApiError>,
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

  if (!request.body?.assetType || !VALID_BRAND_ASSET_TYPES.includes(request.body.assetType)) {
    sendApiError(
      response,
      400,
      "bad_request",
      "assetType must be one of: hero_banner, feature_section, cta_banner, icon_set, social_post, email_header.",
    );
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "visual_generation",
      usageMetric: "generations",
    });

    response.status(201).json(
      await generateBrandAsset({
        principal: request.auth,
        request: {
          businessId,
          assetType: request.body.assetType,
          goal: request.body.goal?.trim(),
          context: request.body.context?.trim(),
          layout: request.body.layout?.trim(),
          extraInstructions: request.body.extraInstructions?.trim(),
          iconLabels: normalizeStringArray(request.body.iconLabels),
          brandKit: request.body.brandKit,
          referenceGenerationId: request.body.referenceGenerationId?.trim(),
          matchPreviousStyle: request.body.matchPreviousStyle === true,
        },
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "brand_asset_generation_failed",
      message: "Unable to generate brand asset.",
      logMessage: "Failed to generate brand asset.",
    });
  }
}
