import type {
  BrandStudioHistoryResponse,
  GenerateBrandAssetRequest,
  GenerateBrandAssetResponse,
} from "../../../packages/shared-types";
import { ApiRequestError, apiGet, apiPost } from "./api-client";

const API_ENDPOINTS = {
  history: "/brand/history",
  legacyHistory: "/brand-studio/history",
  generate: "/brand/generate-asset",
  legacyGenerate: "/brand-studio/generate",
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

  const query = params.toString();

  try {
    return await apiGet<BrandStudioHistoryResponse>(`${API_ENDPOINTS.history}?${query}`);
  } catch (error) {
    if (error instanceof ApiRequestError && error.statusCode === 404) {
      return apiGet<BrandStudioHistoryResponse>(`${API_ENDPOINTS.legacyHistory}?${query}`);
    }

    throw error;
  }
}

export async function requestGenerateBrandStudioAsset(
  input: GenerateBrandAssetRequest,
): Promise<GenerateBrandAssetResponse> {
  try {
    return await apiPost<GenerateBrandAssetRequest, GenerateBrandAssetResponse>(
      API_ENDPOINTS.generate,
      input,
    );
  } catch (error) {
    if (error instanceof ApiRequestError && error.statusCode === 404) {
      return apiPost<GenerateBrandAssetRequest, GenerateBrandAssetResponse>(
        API_ENDPOINTS.legacyGenerate,
        input,
      );
    }

    throw error;
  }
}
