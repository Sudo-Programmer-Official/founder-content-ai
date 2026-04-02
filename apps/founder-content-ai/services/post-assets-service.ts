import type {
  CreateMediaUploadUrlRequest,
  CreateMediaUploadUrlResponse,
  CreatePostAssetRequest,
  CreatePostAssetResponse,
  DeletePostAssetResponse,
  DownloadPostAssetResponse,
  GetPostAssetResponse,
  ListPostAssetsResponse,
} from "../../../packages/shared-types";
import { apiDelete, apiGet, apiPost } from "./api-client";
import { toFriendlyMediaStorageError } from "./media-storage-errors";

export async function requestMediaUploadUrl(
  input: CreateMediaUploadUrlRequest,
): Promise<CreateMediaUploadUrlResponse> {
  try {
    return await apiPost<CreateMediaUploadUrlRequest, CreateMediaUploadUrlResponse>(
      "/media/upload-url",
      input,
    );
  } catch (error) {
    throw toFriendlyMediaStorageError(error, "Unable to start media upload right now.");
  }
}

export async function requestCreatePostAsset(
  input: CreatePostAssetRequest,
): Promise<CreatePostAssetResponse> {
  try {
    return await apiPost<CreatePostAssetRequest, CreatePostAssetResponse>("/post-assets", input);
  } catch (error) {
    throw toFriendlyMediaStorageError(error, "Unable to attach media right now.");
  }
}

export async function requestPostAssets(
  businessId: string,
  postId: string,
): Promise<ListPostAssetsResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedPostId = encodeURIComponent(postId);

  return apiGet<ListPostAssetsResponse>(
    `/post-assets?businessId=${encodedBusinessId}&postId=${encodedPostId}`,
  );
}

export async function requestPostAsset(
  businessId: string,
  assetId: string,
): Promise<GetPostAssetResponse> {
  return apiGet<GetPostAssetResponse>(
    `/post-assets/${encodeURIComponent(assetId)}?businessId=${encodeURIComponent(businessId)}`,
  );
}

export async function requestPostAssetDownload(
  businessId: string,
  assetId: string,
): Promise<DownloadPostAssetResponse> {
  return apiGet<DownloadPostAssetResponse>(
    `/post-assets/${encodeURIComponent(assetId)}/download?businessId=${encodeURIComponent(businessId)}`,
  );
}

export async function requestDeletePostAsset(
  businessId: string,
  assetId: string,
): Promise<DeletePostAssetResponse> {
  return apiDelete<DeletePostAssetResponse>(
    `/post-assets/${encodeURIComponent(assetId)}?businessId=${encodeURIComponent(businessId)}`,
  );
}
