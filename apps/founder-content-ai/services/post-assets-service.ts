import type {
  CreateMediaUploadUrlRequest,
  CreateMediaUploadUrlResponse,
  CreatePromoVisualPostAssetRequest,
  CreatePromoVisualPostAssetResponse,
  GenerateMotionPostAssetRequest,
  GenerateMotionPostAssetResponse,
  CreatePostAssetRequest,
  CreatePostAssetResponse,
  DeletePostAssetResponse,
  DownloadPostAssetResponse,
  GetPostAssetResponse,
  ListPostAssetsResponse,
  ReorderPostAssetsRequest,
  ReorderPostAssetsResponse,
} from "../../../packages/shared-types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api-client";
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

export async function requestGenerateMotionPostAsset(
  input: GenerateMotionPostAssetRequest,
): Promise<GenerateMotionPostAssetResponse> {
  try {
    return await apiPost<GenerateMotionPostAssetRequest, GenerateMotionPostAssetResponse>(
      "/post-assets/motion-lite",
      input,
      {
        timeoutMs: 45000,
      },
    );
  } catch (error) {
    throw toFriendlyMediaStorageError(error, "Unable to animate this visual right now.");
  }
}

export async function requestCreatePromoVisualPostAsset(
  input: CreatePromoVisualPostAssetRequest,
): Promise<CreatePromoVisualPostAssetResponse> {
  try {
    return await apiPost<CreatePromoVisualPostAssetRequest, CreatePromoVisualPostAssetResponse>(
      "/post-assets/promo-visual",
      input,
      {
        timeoutMs: 30000,
      },
    );
  } catch (error) {
    throw toFriendlyMediaStorageError(error, "Unable to create a promo visual right now.");
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

export async function requestReorderPostAssets(
  input: ReorderPostAssetsRequest,
): Promise<ReorderPostAssetsResponse> {
  return apiPatch<ReorderPostAssetsRequest, ReorderPostAssetsResponse>(
    "/post-assets/order",
    input,
  );
}
