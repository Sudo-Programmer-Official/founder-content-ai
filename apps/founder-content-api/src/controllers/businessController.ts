import type {
  ApiError,
  CreateBusinessRequest,
  CreateBusinessResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { createBusinessForUser } from "../services/authBusinessService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function createBusiness(
  request: Request<unknown, CreateBusinessResponse | ApiError, Partial<CreateBusinessRequest>>,
  response: Response<CreateBusinessResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const name = request.body?.name?.trim();

  if (!name) {
    sendApiError(response, 400, "bad_request", "name is required.");
    return;
  }

  try {
    const createdBusiness = await createBusinessForUser(request.auth, {
      name,
      slug: request.body?.slug?.trim(),
      brandName: request.body?.brandName?.trim(),
      websiteUrl: request.body?.websiteUrl?.trim(),
      niche: request.body?.niche?.trim(),
      timezone: request.body?.timezone?.trim(),
    });

    response.status(201).json(createdBusiness);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "business_creation_failed",
      message: "Unable to create business.",
      logMessage: "Failed to create business.",
    });
  }
}
