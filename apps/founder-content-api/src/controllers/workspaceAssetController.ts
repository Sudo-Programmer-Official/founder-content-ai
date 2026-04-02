import type {
  ApiError,
  CreateWorkspaceAssetRequest,
  CreateWorkspaceAssetResponse,
  CreateWorkspaceAssetUploadUrlRequest,
  CreateWorkspaceAssetUploadUrlResponse,
  DeleteWorkspaceAssetResponse,
  DownloadWorkspaceAssetQuery,
  DownloadWorkspaceAssetResponse,
  GetWorkspaceAssetQuery,
  GetWorkspaceAssetResponse,
  RecordWorkspaceAssetUsageRequest,
  RecordWorkspaceAssetUsageResponse,
  WorkspaceAssetsQuery,
  WorkspaceAssetsResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  createWorkspaceAsset,
  createWorkspaceAssetUploadUrl,
  deleteWorkspaceAsset,
  getWorkspaceAsset,
  getWorkspaceAssetDownload,
  listWorkspaceAssets,
  recordWorkspaceAssetUsage,
} from "../services/workspaceAssetService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getWorkspaceAssetsController(
  request: Request<unknown, WorkspaceAssetsResponse | ApiError, unknown, Partial<WorkspaceAssetsQuery>>,
  response: Response<WorkspaceAssetsResponse | ApiError>,
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
    const includeInactive = String(request.query.includeInactive ?? "") === "true";
    response.json(
      await listWorkspaceAssets(request.auth, {
        businessId,
        search: request.query.search?.trim(),
        assetType: request.query.assetType,
        sourceType: request.query.sourceType,
        includeInactive,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_assets_lookup_failed",
      message: "Unable to load workspace assets.",
      logMessage: "Failed to load workspace assets.",
    });
  }
}

export async function postWorkspaceAssetUploadUrlController(
  request: Request<
    unknown,
    CreateWorkspaceAssetUploadUrlResponse | ApiError,
    Partial<CreateWorkspaceAssetUploadUrlRequest>
  >,
  response: Response<CreateWorkspaceAssetUploadUrlResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const fileType = request.body?.fileType?.trim();

  if (!businessId || !fileType) {
    sendApiError(response, 400, "bad_request", "businessId and fileType are required.");
    return;
  }

  try {
    response.status(201).json(
      await createWorkspaceAssetUploadUrl(request.auth, {
        businessId,
        fileType,
        fileName: request.body?.fileName?.trim(),
        sizeBytes: typeof request.body?.sizeBytes === "number" ? request.body.sizeBytes : undefined,
        assetType: request.body?.assetType,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_asset_upload_url_failed",
      message: "Unable to initialize workspace asset upload.",
      logMessage: "Failed to initialize workspace asset upload.",
    });
  }
}

export async function postWorkspaceAssetController(
  request: Request<unknown, CreateWorkspaceAssetResponse | ApiError, Partial<CreateWorkspaceAssetRequest>>,
  response: Response<CreateWorkspaceAssetResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const storageUrl = request.body?.storageUrl?.trim();
  const mimeType = request.body?.mimeType?.trim();

  if (!businessId || !storageUrl || !mimeType) {
    sendApiError(response, 400, "bad_request", "businessId, storageUrl, and mimeType are required.");
    return;
  }

  if (typeof request.body?.sizeBytes !== "number" || request.body.sizeBytes < 0) {
    sendApiError(response, 400, "bad_request", "sizeBytes must be a non-negative number.");
    return;
  }

  try {
    response.status(201).json(
      await createWorkspaceAsset(request.auth, {
        businessId,
        storageKey: request.body?.storageKey?.trim(),
        storageUrl,
        mimeType,
        sizeBytes: request.body.sizeBytes,
        title: request.body?.title?.trim(),
        assetType: request.body?.assetType,
        sourceType: request.body?.sourceType,
        sourceReferenceId: request.body?.sourceReferenceId?.trim(),
        tags: Array.isArray(request.body?.tags) ? request.body.tags : undefined,
        metadata:
          request.body?.metadata && typeof request.body.metadata === "object"
            ? request.body.metadata
            : undefined,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_asset_create_failed",
      message: "Unable to save workspace asset.",
      logMessage: "Failed to save workspace asset.",
    });
  }
}

export async function deleteWorkspaceAssetController(
  request: Request<{ assetId: string }, DeleteWorkspaceAssetResponse | ApiError, unknown, { businessId?: string }>,
  response: Response<DeleteWorkspaceAssetResponse | ApiError>,
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
    response.json(await deleteWorkspaceAsset(request.auth, businessId, assetId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_asset_delete_failed",
      message: "Unable to remove workspace asset.",
      logMessage: "Failed to remove workspace asset.",
    });
  }
}

export async function getWorkspaceAssetController(
  request: Request<{ assetId: string }, GetWorkspaceAssetResponse | ApiError, unknown, Partial<GetWorkspaceAssetQuery>>,
  response: Response<GetWorkspaceAssetResponse | ApiError>,
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
    response.json(await getWorkspaceAsset(request.auth, businessId, assetId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_asset_lookup_failed",
      message: "Unable to load workspace asset.",
      logMessage: "Failed to load workspace asset by id.",
    });
  }
}

export async function getWorkspaceAssetDownloadController(
  request: Request<{ assetId: string }, DownloadWorkspaceAssetResponse | ApiError, unknown, Partial<DownloadWorkspaceAssetQuery>>,
  response: Response<DownloadWorkspaceAssetResponse | ApiError>,
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
    response.json(await getWorkspaceAssetDownload(request.auth, businessId, assetId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_asset_download_failed",
      message: "Unable to prepare workspace asset download.",
      logMessage: "Failed to prepare workspace asset download.",
    });
  }
}

export async function postWorkspaceAssetUsageController(
  request: Request<{ assetId: string }, RecordWorkspaceAssetUsageResponse | ApiError, Partial<RecordWorkspaceAssetUsageRequest>>,
  response: Response<RecordWorkspaceAssetUsageResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const assetId = request.params.assetId?.trim();
  const businessId = request.body?.businessId?.trim();

  if (!assetId || !businessId || !request.body?.usageSurface) {
    sendApiError(response, 400, "bad_request", "assetId, businessId, and usageSurface are required.");
    return;
  }

  try {
    response.status(201).json(
      await recordWorkspaceAssetUsage(request.auth, assetId, {
        businessId,
        usageSurface: request.body.usageSurface,
        referenceId: request.body?.referenceId?.trim(),
        metadata:
          request.body?.metadata && typeof request.body.metadata === "object"
            ? request.body.metadata
            : undefined,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_asset_usage_record_failed",
      message: "Unable to record workspace asset usage.",
      logMessage: "Failed to record workspace asset usage.",
    });
  }
}
