import type {
  ApiError,
  DisconnectSocialAccountRequest,
  DisconnectSocialAccountResponse,
  SelectSocialAccountIdentityRequest,
  SelectSocialAccountIdentityResponse,
  SocialAccountsQuery,
  SocialAccountsResponse,
  StartSocialAuthRequest,
  StartSocialAuthResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  createLinkedInAuthorizationUrl,
  disconnectSocialAccount,
  handleLinkedInOAuthCallback,
  listSocialAccounts,
  selectSocialAccountIdentity,
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

export async function disconnectSocialAccountController(
  request: Request<
    { accountId: string },
    DisconnectSocialAccountResponse | ApiError,
    Partial<DisconnectSocialAccountRequest>
  >,
  response: Response<DisconnectSocialAccountResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const accountId = request.params.accountId?.trim();

  if (!businessId || !accountId) {
    sendApiError(response, 400, "bad_request", "businessId and accountId are required.");
    return;
  }

  try {
    response.json(
      await disconnectSocialAccount(request.auth, {
        businessId,
        accountId,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "social_account_disconnect_failed",
      message: "Unable to disconnect the social account.",
      logMessage: "Failed to disconnect social account.",
    });
  }
}

export async function selectSocialAccountIdentityController(
  request: Request<
    { accountId: string },
    SelectSocialAccountIdentityResponse | ApiError,
    Partial<SelectSocialAccountIdentityRequest>
  >,
  response: Response<SelectSocialAccountIdentityResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const identityId = request.body?.identityId?.trim();
  const accountId = request.params.accountId?.trim();

  if (!businessId || !identityId || !accountId) {
    sendApiError(response, 400, "bad_request", "businessId, accountId, and identityId are required.");
    return;
  }

  try {
    response.json(
      await selectSocialAccountIdentity(request.auth, {
        businessId,
        accountId,
        identityId,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "social_account_identity_select_failed",
      message: "Unable to update the LinkedIn publishing identity.",
      logMessage: "Failed to update LinkedIn publishing identity.",
    });
  }
}
