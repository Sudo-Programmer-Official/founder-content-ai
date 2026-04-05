import type {
  ApiError,
  CreateMediaUploadUrlRequest,
  CreateMediaUploadUrlResponse,
  CreatePromoVisualPostAssetRequest,
  CreatePromoVisualPostAssetResponse,
  GenerateMotionPostAssetRequest,
  GenerateMotionPostAssetResponse,
  CreatePostAssetRequest,
  CreatePostAssetResponse,
  DeletePostAssetResponse,
  DownloadPostAssetQuery,
  DownloadPostAssetResponse,
  GetPostAssetQuery,
  GetPostAssetResponse,
  ListPostAssetsQuery,
  ListPostAssetsResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  createMediaUploadUrl,
  createPostAsset,
  createPromoVisualPostAsset,
  deletePostAsset,
  generateMotionPostAsset,
  getPostAsset,
  getPostAssetDownload,
  listPostAssets,
} from "../services/postAssetService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getMediaUploadUrl(
  request: Request<unknown, CreateMediaUploadUrlResponse | ApiError, Partial<CreateMediaUploadUrlRequest>>,
  response: Response<CreateMediaUploadUrlResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const postId = request.body?.postId?.trim();
  const fileType = request.body?.fileType?.trim();

  if (!businessId || !postId || !fileType) {
    sendApiError(response, 400, "bad_request", "businessId, postId, and fileType are required.");
    return;
  }

  try {
    response.status(201).json(
      await createMediaUploadUrl(request.auth, {
        businessId,
        postId,
        fileType,
        assetType: request.body?.assetType,
        fileName: request.body?.fileName?.trim(),
        sizeBytes:
          typeof request.body?.sizeBytes === "number" ? request.body.sizeBytes : undefined,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "media_upload_url_failed",
      message: "Unable to initialize media upload.",
      logMessage: "Failed to initialize media upload.",
    });
  }
}

export async function createPostAssetController(
  request: Request<unknown, CreatePostAssetResponse | ApiError, Partial<CreatePostAssetRequest>>,
  response: Response<CreatePostAssetResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const postId = request.body?.postId?.trim();
  const storageKey = request.body?.storageKey?.trim();
  const storageUrl = request.body?.storageUrl?.trim();
  const mimeType = request.body?.mimeType?.trim();

  if (!businessId || !postId || !storageKey || !storageUrl || !mimeType) {
    sendApiError(
      response,
      400,
      "bad_request",
      "businessId, postId, storageKey, storageUrl, and mimeType are required.",
    );
    return;
  }

  if (typeof request.body?.sizeBytes !== "number" || request.body.sizeBytes < 0) {
    sendApiError(response, 400, "bad_request", "sizeBytes must be a non-negative number.");
    return;
  }

  try {
    response.status(201).json(
      await createPostAsset(request.auth, {
        businessId,
        postId,
        storageKey,
        storageUrl,
        mimeType,
        sizeBytes: request.body.sizeBytes,
        type: request.body?.type,
        source: request.body?.source,
        metadata: request.body?.metadata,
        orderIndex:
          typeof request.body?.orderIndex === "number" ? request.body.orderIndex : undefined,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "post_asset_create_failed",
      message: "Unable to save media metadata.",
      logMessage: "Failed to save post asset metadata.",
    });
  }
}

export async function generateMotionPostAssetController(
  request: Request<unknown, GenerateMotionPostAssetResponse | ApiError, Partial<GenerateMotionPostAssetRequest>>,
  response: Response<GenerateMotionPostAssetResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const postId = request.body?.postId?.trim();
  const sourceAssetId = request.body?.sourceAssetId?.trim();

  if (!businessId || !postId || !sourceAssetId || !request.body?.motionTemplate) {
    sendApiError(
      response,
      400,
      "bad_request",
      "businessId, postId, sourceAssetId, and motionTemplate are required.",
    );
    return;
  }

  try {
    response.status(201).json(
      await generateMotionPostAsset(request.auth, {
        businessId,
        postId,
        sourceAssetId,
        motionTemplate: request.body.motionTemplate,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "post_asset_motion_failed",
      message: "Unable to generate a motion teaser right now.",
      logMessage: "Failed to generate motion teaser for post asset.",
    });
  }
}

export async function createPromoVisualPostAssetController(
  request: Request<unknown, CreatePromoVisualPostAssetResponse | ApiError, Partial<CreatePromoVisualPostAssetRequest>>,
  response: Response<CreatePromoVisualPostAssetResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const postId = request.body?.postId?.trim();
  const headline = request.body?.headline?.trim();

  if (!businessId || !postId || !headline || !request.body?.layout) {
    sendApiError(
      response,
      400,
      "bad_request",
      "businessId, postId, layout, and headline are required.",
    );
    return;
  }

  try {
    response.status(201).json(
      await createPromoVisualPostAsset(request.auth, {
        businessId,
        postId,
        layout: request.body.layout,
        headline,
        subheadline: request.body?.subheadline?.trim(),
        cta: request.body?.cta?.trim(),
        sourceAssetId: request.body?.sourceAssetId?.trim(),
        aspectRatio: request.body?.aspectRatio,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "post_asset_promo_visual_failed",
      message: "Unable to create a promo visual right now.",
      logMessage: "Failed to create promo visual post asset.",
    });
  }
}

export async function getPostAssets(
  request: Request<unknown, ListPostAssetsResponse | ApiError, unknown, Partial<ListPostAssetsQuery>>,
  response: Response<ListPostAssetsResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.query.businessId?.trim();
  const postId = request.query.postId?.trim();

  if (!businessId || !postId) {
    sendApiError(response, 400, "bad_request", "businessId and postId are required.");
    return;
  }

  try {
    response.json(await listPostAssets(request.auth, businessId, postId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "post_assets_lookup_failed",
      message: "Unable to load post media.",
      logMessage: "Failed to load post media.",
    });
  }
}

export async function getPostAssetController(
  request: Request<{ assetId: string }, GetPostAssetResponse | ApiError, unknown, Partial<GetPostAssetQuery>>,
  response: Response<GetPostAssetResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.query.businessId?.trim();
  const assetId = request.params.assetId?.trim();

  if (!businessId || !assetId) {
    sendApiError(response, 400, "bad_request", "businessId and assetId are required.");
    return;
  }

  try {
    response.json(await getPostAsset(request.auth, businessId, assetId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "post_asset_lookup_failed",
      message: "Unable to load post media.",
      logMessage: "Failed to load post media by id.",
    });
  }
}

export async function getPostAssetDownloadController(
  request: Request<{ assetId: string }, DownloadPostAssetResponse | ApiError, unknown, Partial<DownloadPostAssetQuery>>,
  response: Response<DownloadPostAssetResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.query.businessId?.trim();
  const assetId = request.params.assetId?.trim();

  if (!businessId || !assetId) {
    sendApiError(response, 400, "bad_request", "businessId and assetId are required.");
    return;
  }

  try {
    response.json(await getPostAssetDownload(request.auth, businessId, assetId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "post_asset_download_failed",
      message: "Unable to prepare post media download.",
      logMessage: "Failed to prepare post media download.",
    });
  }
}

export async function deletePostAssetController(
  request: Request<{ assetId: string }, DeletePostAssetResponse | ApiError, unknown, { businessId?: string }>,
  response: Response<DeletePostAssetResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.query.businessId?.trim();
  const assetId = request.params.assetId?.trim();

  if (!businessId || !assetId) {
    sendApiError(response, 400, "bad_request", "businessId and assetId are required.");
    return;
  }

  try {
    response.json(await deletePostAsset(request.auth, businessId, assetId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "post_asset_delete_failed",
      message: "Unable to remove media from this post.",
      logMessage: "Failed to delete post asset metadata.",
    });
  }
}
