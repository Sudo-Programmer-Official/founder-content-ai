import type {
  ApiError,
  GoogleCalendarDisconnectResponse,
  StartSocialAuthResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  createGoogleCalendarAuthorizationUrl,
  disconnectGoogleCalendarConnection,
  handleGoogleCalendarOAuthCallback,
} from "../services/revenueAgent/googleCalendarService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function startGoogleCalendarAuthController(
  request: Request<unknown, StartSocialAuthResponse | ApiError, { businessId?: string; returnPath?: string }>,
  response: Response<StartSocialAuthResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  try {
    response.json(
      await createGoogleCalendarAuthorizationUrl(request.auth, {
        businessId,
        returnPath: request.body?.returnPath?.trim(),
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "google_calendar_auth_start_failed",
      message: "Unable to start Google Calendar authentication.",
      logMessage: "Failed to start Google Calendar authentication.",
    });
  }
}

export async function googleCalendarOAuthCallback(
  request: Request,
  response: Response,
): Promise<void> {
  const redirectUrl = await handleGoogleCalendarOAuthCallback({
    code: typeof request.query.code === "string" ? request.query.code : undefined,
    state: typeof request.query.state === "string" ? request.query.state : undefined,
    error: typeof request.query.error === "string" ? request.query.error : undefined,
    errorDescription:
      typeof request.query.error_description === "string"
        ? request.query.error_description
        : undefined,
  });

  response.redirect(302, redirectUrl);
}

export async function disconnectGoogleCalendarController(
  request: Request<unknown, GoogleCalendarDisconnectResponse | ApiError, { businessId?: string }>,
  response: Response<GoogleCalendarDisconnectResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  try {
    response.json(await disconnectGoogleCalendarConnection(request.auth, { businessId }));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "google_calendar_disconnect_failed",
      message: "Unable to disconnect Google Calendar.",
      logMessage: "Failed to disconnect Google Calendar.",
    });
  }
}
