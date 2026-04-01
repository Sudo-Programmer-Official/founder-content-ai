import type {
  BrandKitResponse,
  UpdateBrandKitRequest,
  UpdateBrandKitResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPost } from "./api-client";

const API_ENDPOINTS = {
  brandKit: "/brand-kit",
  updateBrandKit: "/brand-kit/update",
} as const;

export async function requestBrandKit(
  businessId: string,
): Promise<BrandKitResponse> {
  const query = new URLSearchParams({
    businessId,
  });

  return apiGet<BrandKitResponse>(`${API_ENDPOINTS.brandKit}?${query.toString()}`);
}

export async function requestUpdateBrandKit(
  input: UpdateBrandKitRequest,
): Promise<UpdateBrandKitResponse> {
  return apiPost<UpdateBrandKitRequest, UpdateBrandKitResponse>(
    API_ENDPOINTS.updateBrandKit,
    input,
  );
}
