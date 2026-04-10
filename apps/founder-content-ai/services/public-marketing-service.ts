import type {
  CreatePublicMarketingInquiryRequest,
  CreatePublicMarketingInquiryResponse,
  PublicSocialProofResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPost } from "./api-client";

export async function requestPublicSocialProof(limit = 12): Promise<PublicSocialProofResponse> {
  return apiGet<PublicSocialProofResponse>(`/public/social-proof?limit=${encodeURIComponent(String(limit))}`);
}

export async function requestCreatePublicMarketingInquiry(
  payload: CreatePublicMarketingInquiryRequest,
): Promise<CreatePublicMarketingInquiryResponse> {
  return apiPost<CreatePublicMarketingInquiryRequest, CreatePublicMarketingInquiryResponse>(
    "/public/assistant-inquiries",
    payload,
    { timeoutMs: 15_000 },
  );
}
