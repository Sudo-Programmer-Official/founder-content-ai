import type {
  CreateWorkspaceAssetRequest,
  CreateWorkspaceAssetResponse,
  CreateWorkspaceAssetUploadUrlRequest,
  CreateWorkspaceAssetUploadUrlResponse,
  DeleteWorkspaceAssetResponse,
  DownloadWorkspaceAssetResponse,
  GetWorkspaceAssetResponse,
  RecordWorkspaceAssetUsageRequest,
  RecordWorkspaceAssetUsageResponse,
  WorkspaceAssetsQuery,
  WorkspaceAssetsResponse,
} from "../../../packages/shared-types";
import { apiDelete, apiGet, apiPost } from "./api-client";
import { toFriendlyMediaStorageError } from "./media-storage-errors";

const API_ENDPOINTS = {
  workspaceAssets: "/workspace-assets",
  workspaceAssetUploadUrl: "/workspace-assets/upload-url",
} as const;

export async function requestWorkspaceAssets(
  query: WorkspaceAssetsQuery,
): Promise<WorkspaceAssetsResponse> {
  const params = new URLSearchParams({
    businessId: query.businessId,
  });

  if (query.search?.trim()) {
    params.set("search", query.search.trim());
  }

  if (query.assetType && query.assetType !== "all") {
    params.set("assetType", query.assetType);
  }

  if (query.sourceType && query.sourceType !== "all") {
    params.set("sourceType", query.sourceType);
  }

  if (query.includeInactive) {
    params.set("includeInactive", "true");
  }

  return apiGet<WorkspaceAssetsResponse>(`${API_ENDPOINTS.workspaceAssets}?${params.toString()}`);
}

export async function requestWorkspaceAsset(
  businessId: string,
  assetId: string,
): Promise<GetWorkspaceAssetResponse> {
  return apiGet<GetWorkspaceAssetResponse>(
    `${API_ENDPOINTS.workspaceAssets}/${encodeURIComponent(assetId)}?businessId=${encodeURIComponent(businessId)}`,
  );
}

export async function requestWorkspaceAssetDownload(
  businessId: string,
  assetId: string,
): Promise<DownloadWorkspaceAssetResponse> {
  return apiGet<DownloadWorkspaceAssetResponse>(
    `${API_ENDPOINTS.workspaceAssets}/${encodeURIComponent(assetId)}/download?businessId=${encodeURIComponent(businessId)}`,
  );
}

export async function requestWorkspaceAssetUploadUrl(
  input: CreateWorkspaceAssetUploadUrlRequest,
): Promise<CreateWorkspaceAssetUploadUrlResponse> {
  try {
    return await apiPost<CreateWorkspaceAssetUploadUrlRequest, CreateWorkspaceAssetUploadUrlResponse>(
      API_ENDPOINTS.workspaceAssetUploadUrl,
      input,
    );
  } catch (error) {
    throw toFriendlyMediaStorageError(error, "Unable to start workspace asset upload right now.");
  }
}

export async function requestCreateWorkspaceAsset(
  input: CreateWorkspaceAssetRequest,
): Promise<CreateWorkspaceAssetResponse> {
  try {
    return await apiPost<CreateWorkspaceAssetRequest, CreateWorkspaceAssetResponse>(
      API_ENDPOINTS.workspaceAssets,
      input,
    );
  } catch (error) {
    throw toFriendlyMediaStorageError(error, "Unable to save this workspace asset right now.");
  }
}

export async function requestDeleteWorkspaceAsset(
  businessId: string,
  assetId: string,
): Promise<DeleteWorkspaceAssetResponse> {
  return apiDelete<DeleteWorkspaceAssetResponse>(
    `${API_ENDPOINTS.workspaceAssets}/${encodeURIComponent(assetId)}?businessId=${encodeURIComponent(businessId)}`,
  );
}

export async function requestRecordWorkspaceAssetUsage(
  assetId: string,
  input: RecordWorkspaceAssetUsageRequest,
): Promise<RecordWorkspaceAssetUsageResponse> {
  return apiPost<RecordWorkspaceAssetUsageRequest, RecordWorkspaceAssetUsageResponse>(
    `${API_ENDPOINTS.workspaceAssets}/${encodeURIComponent(assetId)}/usage`,
    input,
  );
}
