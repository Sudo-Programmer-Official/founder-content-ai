import type {
  ApiError,
  SocialAccountsQuery,
  SocialAccountsResponse,
  StartSocialAuthRequest,
  StartSocialAuthResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  createLinkedInAuthorizationUrl,
  handleLinkedInOAuthCallback,
  listSocialAccounts,
} from "../services/socialAuthService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function startLinkedInSocialAuth(
  request: Request<unknown, StartSocialAuthResponse | ApiError, Partial<StartSocialAuthRequest>>,
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

  if (request.body?.platform !== "linkedin") {
    sendApiError(response, 400, "bad_request", "Only LinkedIn social auth is supported.");
    return;
  }

  try {
    response.json(
      await createLinkedInAuthorizationUrl(request.auth, {
        businessId,
        returnPath: request.body?.returnPath?.trim(),
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "linkedin_auth_start_failed",
      message: "Unable to start LinkedIn authentication.",
      logMessage: "Failed to start LinkedIn authentication.",
    });
  }
}

export async function linkedInOAuthCallback(
  request: Request,
  response: Response,
): Promise<void> {
  const redirectUrl = await handleLinkedInOAuthCallback({
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

export async function getSocialAccounts(
  request: Request<
    unknown,
    SocialAccountsResponse | ApiError,
    unknown,
    Partial<SocialAccountsQuery>
  >,
  response: Response<SocialAccountsResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.query.businessId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  try {
    response.json(await listSocialAccounts(request.auth, businessId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "social_accounts_lookup_failed",
      message: "Unable to load social account status.",
      logMessage: "Failed to load social account status.",
    });
  }
}
