import type {
  ApiError,
  GetUserPreferencesResponse,
  UpdateUserPreferencesRequest,
  UpdateUserPreferencesResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  getUserPreferences,
  updateUserPreferences,
} from "../services/userPreferencesService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getPreferences(
  request: Request,
  response: Response<GetUserPreferencesResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    response.json(await getUserPreferences(request.auth));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "preferences_lookup_failed",
      message: "Unable to load user preferences.",
      logMessage: "Failed to load user preferences.",
    });
  }
}

export async function savePreferences(
  request: Request<unknown, UpdateUserPreferencesResponse | ApiError, UpdateUserPreferencesRequest>,
  response: Response<UpdateUserPreferencesResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    response.json(await updateUserPreferences(request.auth, request.body ?? {}));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "preferences_update_failed",
      message: "Unable to save user preferences.",
      logMessage: "Failed to update user preferences.",
    });
  }
}
