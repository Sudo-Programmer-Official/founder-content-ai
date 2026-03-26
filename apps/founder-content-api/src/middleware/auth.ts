import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ApiError, AuthIdentityProvider } from "../../../../packages/shared-types/index.ts";
import type { DecodedIdToken } from "firebase-admin/auth";
import { verifyFirebaseIdToken } from "../services/firebaseAdmin.ts";
import { HttpError, isHttpError, sendApiError, toErrorContext } from "../utils/http.ts";
import { logError, logWarn } from "../utils/logger.ts";

export type AuthMode = "stub" | "firebase";

export interface AuthenticatedPrincipal {
  subject: string;
  email: string;
  fullName: string;
  avatarUrl?: string;
  emailVerified: boolean;
  provider: AuthIdentityProvider;
  userId?: string;
  isSuperAdmin: boolean;
}

let hasWarnedAboutStubModeInProduction = false;

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedPrincipal;
    }
  }
}

function readHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return typeof value === "string" ? value : undefined;
}

function parseBooleanHeader(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value ?? "");
}

function resolveSuperAdminEmails(): Set<string> {
  return new Set(
    (process.env.SUPER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isConfiguredSuperAdmin(email: string): boolean {
  return resolveSuperAdminEmails().has(email.trim().toLowerCase());
}

function resolveAuthMode(): AuthMode {
  if (process.env.AUTH_MODE === "stub" && process.env.NODE_ENV !== "production") {
    return "stub";
  }

  if (process.env.AUTH_MODE === "stub" && process.env.NODE_ENV === "production") {
    if (!hasWarnedAboutStubModeInProduction) {
      logWarn("AUTH_MODE=stub was ignored because NODE_ENV=production.");
      hasWarnedAboutStubModeInProduction = true;
    }
  }

  return "firebase";
}

function sendAuthError(
  response: Response<ApiError>,
  status: number,
  code: string,
  message: string,
): void {
  sendApiError(response, status, code, message);
}

function resolveStubPrincipal(request: Request): AuthenticatedPrincipal | null {
  const subject = readHeader(request.headers["x-dev-user-id"]);
  const email = readHeader(request.headers["x-dev-user-email"]);

  if (!subject || !email) {
    return null;
  }

  return {
    subject,
    email,
    fullName: readHeader(request.headers["x-dev-user-name"]) ?? "Development User",
    avatarUrl: readHeader(request.headers["x-dev-user-avatar"]),
    emailVerified: true,
    provider: "stub",
    isSuperAdmin:
      parseBooleanHeader(readHeader(request.headers["x-dev-super-admin"])) ||
      isConfiguredSuperAdmin(email),
  };
}

function hasAnyStubAuthHeaders(request: Request): boolean {
  return [
    request.headers["x-dev-user-id"],
    request.headers["x-dev-user-email"],
    request.headers["x-dev-user-name"],
    request.headers["x-dev-user-avatar"],
    request.headers["x-dev-super-admin"],
  ].some((value) => value !== undefined);
}

function readBearerToken(request: Request): string | null {
  const authorization = readHeader(request.headers.authorization);

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.trim().split(/\s+/, 2);

  if (!/^Bearer$/i.test(scheme) || !token) {
    return null;
  }

  return token;
}

function resolveFirebaseProvider(decodedToken: DecodedIdToken): AuthIdentityProvider {
  const provider = decodedToken.firebase?.sign_in_provider;

  if (provider === "google.com") {
    return "google";
  }

  if (provider === "password") {
    return "firebase_password";
  }

  if (provider === "emailLink") {
    return "otp_email";
  }

  return "firebase";
}

function resolveFirebasePrincipal(decodedToken: DecodedIdToken): AuthenticatedPrincipal {
  const email = decodedToken.email?.trim();

  if (!email) {
    throw new HttpError(
      401,
      "email_required",
      "Authenticated token does not include a usable email address.",
    );
  }

  return {
    subject: decodedToken.uid,
    email,
    fullName: decodedToken.name?.trim() || email.split("@")[0] || "FounderContent User",
    avatarUrl: typeof decodedToken.picture === "string" ? decodedToken.picture : undefined,
    emailVerified: Boolean(decodedToken.email_verified),
    provider: resolveFirebaseProvider(decodedToken),
    isSuperAdmin: isConfiguredSuperAdmin(email),
  };
}

async function resolvePrincipal(
  request: Request,
  authRequired: boolean,
): Promise<AuthenticatedPrincipal | null> {
  const authMode = resolveAuthMode();

  if (authMode === "stub") {
    const principal = resolveStubPrincipal(request);

    if (principal) {
      return principal;
    }

    if (authRequired || hasAnyStubAuthHeaders(request)) {
      throw new HttpError(
        401,
        "auth_required",
        "Stub auth requires x-dev-user-id and x-dev-user-email headers.",
      );
    }

    return null;
  }

  const bearerToken = readBearerToken(request);

  if (!bearerToken) {
    if (authRequired) {
      throw new HttpError(
        401,
        "auth_required",
        "Authorization: Bearer <token> is required.",
      );
    }

    return null;
  }

  const decodedToken = await verifyFirebaseIdToken(bearerToken);
  return resolveFirebasePrincipal(decodedToken);
}

export function requireAuth(): RequestHandler {
  return async (request, response, next: NextFunction) => {
    try {
      request.auth = (await resolvePrincipal(request, true)) ?? undefined;
      next();
    } catch (error) {
      if (isHttpError(error)) {
        if (error.statusCode >= 500) {
          logError("Authentication middleware failed.", toErrorContext(error));
        }

        sendAuthError(response, error.statusCode, error.code, error.message);
        return;
      }

      logWarn("Rejected invalid authentication token.", toErrorContext(error));
      sendAuthError(response, 401, "invalid_token", "Authentication token is invalid or expired.");
    }
  };
}

export function attachOptionalAuth(): RequestHandler {
  return async (request, response, next: NextFunction) => {
    try {
      request.auth = (await resolvePrincipal(request, false)) ?? undefined;
      next();
    } catch (error) {
      if (isHttpError(error)) {
        if (error.statusCode >= 500) {
          logError("Optional authentication middleware failed.", toErrorContext(error));
        }

        sendAuthError(response, error.statusCode, error.code, error.message);
        return;
      }

      logWarn("Rejected invalid optional authentication token.", toErrorContext(error));
      sendAuthError(response, 401, "invalid_token", "Authentication token is invalid or expired.");
    }
  };
}
