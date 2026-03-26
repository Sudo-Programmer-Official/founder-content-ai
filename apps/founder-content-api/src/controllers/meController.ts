import type {
  ApiError,
  MeResponse,
  MyFeaturesQuery,
  MyFeaturesResponse,
  MyBusinessesResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { getAppSession, listUserBusinesses } from "../services/authBusinessService.ts";
import { getProductAccessBootstrap } from "../services/productAccessService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getMe(
  request: Request,
  response: Response<MeResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const session = await getAppSession(request.auth);
    response.json(session);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "me_lookup_failed",
      message: "Unable to load current user session.",
      logMessage: "Failed to load app session.",
    });
  }
}

export async function getMyBusinesses(
  request: Request,
  response: Response<MyBusinessesResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    const result = await listUserBusinesses(request.auth);
    response.json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "business_lookup_failed",
      message: "Unable to load businesses.",
      logMessage: "Failed to list user businesses.",
    });
  }
}

export async function getMyFeatures(
  request: Request<unknown, MyFeaturesResponse | ApiError, unknown, Partial<MyFeaturesQuery>>,
  response: Response<MyFeaturesResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    response.json(await getProductAccessBootstrap(request.auth, request.query.businessId?.trim()));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "product_access_lookup_failed",
      message: "Unable to load product access state.",
      logMessage: "Failed to load product access bootstrap.",
    });
  }
}
