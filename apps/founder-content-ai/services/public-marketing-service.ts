import type { PublicSocialProofResponse } from "../../../packages/shared-types";
import { apiGet } from "./api-client";

export async function requestPublicSocialProof(limit = 12): Promise<PublicSocialProofResponse> {
  return apiGet<PublicSocialProofResponse>(`/public/social-proof?limit=${encodeURIComponent(String(limit))}`);
}
