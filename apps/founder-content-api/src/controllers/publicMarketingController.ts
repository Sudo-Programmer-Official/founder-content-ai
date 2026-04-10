import type {
  ApiError,
  PublicSocialProofQuery,
  PublicSocialProofResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { listPublicSocialProof } from "../services/publicMarketingFeedService.ts";
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
