import type {
  CreateMediaUploadUrlRequest,
  CreateMediaUploadUrlResponse,
  CreatePostAssetRequest,
  CreatePostAssetResponse,
  DeletePostAssetResponse,
  ListPostAssetsResponse,
} from "../../../packages/shared-types";
import { apiDelete, apiGet, apiPost } from "./api-client";

export async function requestMediaUploadUrl(
  input: CreateMediaUploadUrlRequest,
): Promise<CreateMediaUploadUrlResponse> {
  return apiPost<CreateMediaUploadUrlRequest, CreateMediaUploadUrlResponse>(
    "/media/upload-url",
    input,
  );
}

export async function requestCreatePostAsset(
  input: CreatePostAssetRequest,
): Promise<CreatePostAssetResponse> {
  return apiPost<CreatePostAssetRequest, CreatePostAssetResponse>("/post-assets", input);
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

export async function requestDeletePostAsset(
  businessId: string,
  assetId: string,
): Promise<DeletePostAssetResponse> {
  return apiDelete<DeletePostAssetResponse>(
    `/post-assets/${encodeURIComponent(assetId)}?businessId=${encodeURIComponent(businessId)}`,
  );
}
