import type {
  BrandStudioHistoryResponse,
  GenerateBrandAssetRequest,
  GenerateBrandAssetResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPost } from "./api-client";

const API_ENDPOINTS = {
  history: "/brand/history",
  generate: "/brand/generate-asset",
} as const;

export async function requestBrandStudioHistory(
  businessId: string,
  limit?: number,
): Promise<BrandStudioHistoryResponse> {
  const params = new URLSearchParams({
    businessId,
  });

  if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
    params.set("limit", String(Math.floor(limit)));
  }

  return apiGet<BrandStudioHistoryResponse>(`${API_ENDPOINTS.history}?${params.toString()}`);
}

export async function requestGenerateBrandStudioAsset(
  input: GenerateBrandAssetRequest,
): Promise<GenerateBrandAssetResponse> {
  return apiPost<GenerateBrandAssetRequest, GenerateBrandAssetResponse>(
    API_ENDPOINTS.generate,
    input,
  );
}
