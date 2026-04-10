import type {
  ApiError,
  CreatePublicMarketingInquiryRequest,
  CreatePublicMarketingInquiryResponse,
  PublicSocialProofQuery,
  PublicSocialProofResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { listPublicSocialProof } from "../services/publicMarketingFeedService.ts";
import { createPublicMarketingInquiry } from "../services/publicMarketingInquiryService.ts";
import { handleApiError } from "../utils/http.ts";

function parseLimit(rawValue?: string): number | undefined {
  if (!rawValue) {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function getPublicSocialProof(
  request: Request<unknown, PublicSocialProofResponse | ApiError, unknown, Partial<PublicSocialProofQuery>>,
  response: Response<PublicSocialProofResponse | ApiError>,
): Promise<void> {
  try {
    response.json(await listPublicSocialProof(parseLimit(request.query.limit)));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "public_social_proof_failed",
      message: "Unable to load public social proof right now.",
      logMessage: "Failed to load public social proof.",
    });
  }
}

function resolveClientIp(request: Pick<Request, "headers" | "ip">): string | undefined {
  const forwardedFor = request.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0]?.trim() || undefined;
  }

  if (Array.isArray(forwardedFor) && forwardedFor[0]?.trim()) {
    return forwardedFor[0].split(",")[0]?.trim() || undefined;
  }

  return request.ip?.trim() || undefined;
}

export async function postPublicMarketingInquiry(
  request: Request<unknown, CreatePublicMarketingInquiryResponse | ApiError, CreatePublicMarketingInquiryRequest>,
  response: Response<CreatePublicMarketingInquiryResponse | ApiError>,
): Promise<void> {
  try {
    response.status(201).json(
      await createPublicMarketingInquiry({
        ...request.body,
        clientIp: resolveClientIp(request),
        userAgent: request.get("user-agent") || undefined,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "public_marketing_inquiry_failed",
      message: "Unable to submit your question right now.",
      logMessage: "Failed to capture public marketing inquiry.",
    });
  }
}
