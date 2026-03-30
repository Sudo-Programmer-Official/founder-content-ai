import type {
  BrandProfileResponse,
  UpdateBrandProfileRequest,
  UpdateBrandProfileResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPost } from "./api-client";

const API_ENDPOINTS = {
  brandProfile: "/brand-profile",
  updateBrandProfile: "/brand-profile/update",
} as const;

export async function requestBrandProfile(
  businessId: string,
  options?: {
    refreshFromSignals?: boolean;
  },
): Promise<BrandProfileResponse> {
  const query = new URLSearchParams({
    businessId,
  });

  if (options?.refreshFromSignals) {
    query.set("refreshFromSignals", "true");
  }

  return apiGet<BrandProfileResponse>(`${API_ENDPOINTS.brandProfile}?${query.toString()}`);
}

export async function requestUpdateBrandProfile(
  input: UpdateBrandProfileRequest,
): Promise<UpdateBrandProfileResponse> {
  return apiPost<UpdateBrandProfileRequest, UpdateBrandProfileResponse>(
    API_ENDPOINTS.updateBrandProfile,
    input,
  );
}
