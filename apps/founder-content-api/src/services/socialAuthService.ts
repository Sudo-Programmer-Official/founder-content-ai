import { createHmac } from "node:crypto";
import type { QueryResultRow } from "pg";
import type {
  SocialAccount,
  SocialAccountsResponse,
  SocialPlatform,
  StartSocialAuthResponse,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireBusinessMembership } from "./authBusinessService.ts";
import { queryDb } from "./db/client.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "./governanceService.ts";
import { HttpError } from "../utils/http.ts";
import { decryptSecret, encryptSecret } from "../utils/secretCrypto.ts";
import { logInfo, logWarn } from "../utils/logger.ts";

const LINKEDIN_AUTHORIZATION_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_ACCESS_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const SOCIAL_ACCOUNT_ENCRYPTION_SECRET_NAME = "SOCIAL_ACCOUNT_ENCRYPTION_SECRET";
const SOCIAL_AUTH_STATE_SECRET_NAME = "SOCIAL_AUTH_STATE_SECRET";

interface SocialAccountRow extends QueryResultRow {
  id: string;
  business_id: string;
  user_id: string;
  platform: SocialPlatform;
  platform_user_id: string;
  platform_user_urn: string;
  account_email: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: Date | string | null;
  refresh_token_expires_at: Date | string | null;
  scope: string[] | null;
  status: SocialAccount["status"];
  metadata_json: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface LinkedInTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface LinkedInUserInfo {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
}

interface SocialAuthStatePayload {
  businessId: string;
  userId: string;
  issuedAt: number;
  returnPath?: string;
}

export interface LinkedInPublishingCredentials {
  accountId: string;
  businessId: string;
  userId: string;
  platformUserId: string;
  platformUserUrn: string;
  accessToken: string;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function resolveLinkedInClientId(): string {
  const clientId = process.env.LINKEDIN_CLIENT_ID?.trim();

  if (!clientId) {
    throw new HttpError(500, "linkedin_not_configured", "LINKEDIN_CLIENT_ID is not configured.");
  }

  return clientId;
}

function resolveLinkedInClientSecret(): string {
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim();

  if (!clientSecret) {
    throw new HttpError(
      500,
      "linkedin_not_configured",
      "LINKEDIN_CLIENT_SECRET is not configured.",
    );
  }

  return clientSecret;
}

function resolveLinkedInRedirectUri(): string {
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI?.trim();

  if (!redirectUri) {
    throw new HttpError(
      500,
      "linkedin_not_configured",
      "LINKEDIN_REDIRECT_URI is not configured.",
    );
  }

  return redirectUri;
}

function resolveLinkedInScopes(): string[] {
  const configuredScopes = (process.env.LINKEDIN_SCOPE ?? "openid profile email w_member_social")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return [...new Set(configuredScopes)];
}

function resolveFrontendAppUrl(): string {
  const firstConfiguredOrigin = (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .find(Boolean);

  return firstConfiguredOrigin ?? "http://localhost:5173";
}

function sanitizeReturnPath(value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized || !normalized.startsWith("/") || normalized.startsWith("//")) {
    return "/linkedin-post-generator";
  }

  return normalized;
}

function buildRedirectUrl(
  returnPath: string,
  status: "connected" | "error",
  message?: string,
): string {
  const url = new URL(resolveFrontendAppUrl());
  url.pathname = sanitizeReturnPath(returnPath);
  url.searchParams.set("linkedin", status);

  if (message) {
    url.searchParams.set("message", message);
  }

  return url.toString();
}

function mapSocialAccount(row: SocialAccountRow): SocialAccount {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    platform: row.platform,
    platformUserId: row.platform_user_id,
    platformUserUrn: row.platform_user_urn,
    accountEmail: row.account_email ?? undefined,
    tokenExpiresAt: toIsoString(row.token_expires_at),
    refreshTokenExpiresAt: toIsoString(row.refresh_token_expires_at),
    scopes: row.scope ?? [],
    status: row.status,
    metadata: row.metadata_json ?? {},
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function resolveStateSecret(): string {
  return (
    process.env[SOCIAL_AUTH_STATE_SECRET_NAME]?.trim() ||
    (process.env.NODE_ENV !== "production"
      ? `${SOCIAL_AUTH_STATE_SECRET_NAME.toLowerCase()}-development-secret`
      : "")
  );
}

function signState(payload: string): string {
  const secret = resolveStateSecret();

  if (!secret) {
    throw new HttpError(
      500,
      "linkedin_not_configured",
      `${SOCIAL_AUTH_STATE_SECRET_NAME} is not configured.`,
    );
  }

  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encodeState(payload: SocialAuthStatePayload): string {
  const serializedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signState(serializedPayload);
  return `${serializedPayload}.${signature}`;
}

function decodeState(state: string): SocialAuthStatePayload {
  const [payloadPart, signaturePart] = state.split(".", 2);

  if (!payloadPart || !signaturePart) {
    throw new HttpError(400, "invalid_state", "LinkedIn auth state is invalid.");
  }

  if (signState(payloadPart) !== signaturePart) {
    throw new HttpError(400, "invalid_state", "LinkedIn auth state signature is invalid.");
  }

  const payload = JSON.parse(
    Buffer.from(payloadPart, "base64url").toString("utf8"),
  ) as SocialAuthStatePayload;

  if (!payload.businessId || !payload.userId || !payload.issuedAt) {
    throw new HttpError(400, "invalid_state", "LinkedIn auth state is incomplete.");
  }

  if (Date.now() - payload.issuedAt > 15 * 60 * 1000) {
    throw new HttpError(400, "expired_state", "LinkedIn auth state has expired.");
  }

  return payload;
}

function parseJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");

  if (parts.length < 2) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

async function exchangeAuthorizationCode(code: string): Promise<LinkedInTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: resolveLinkedInClientId(),
    client_secret: resolveLinkedInClientSecret(),
    redirect_uri: resolveLinkedInRedirectUri(),
  });

  const response = await fetch(LINKEDIN_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const payload = (await response.json()) as LinkedInTokenResponse;

  if (!response.ok || !payload.access_token) {
    throw new HttpError(
      502,
      "linkedin_token_exchange_failed",
      payload.error_description ?? "LinkedIn token exchange failed.",
    );
  }

  return payload;
}

async function refreshAccessToken(accountRow: SocialAccountRow): Promise<SocialAccountRow> {
  if (!accountRow.refresh_token) {
    throw new HttpError(
      409,
      "linkedin_reauth_required",
      "LinkedIn account needs to be reconnected before publishing.",
    );
  }

  const refreshToken = decryptSecret(accountRow.refresh_token, SOCIAL_ACCOUNT_ENCRYPTION_SECRET_NAME);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: resolveLinkedInClientId(),
    client_secret: resolveLinkedInClientSecret(),
  });

  const response = await fetch(LINKEDIN_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const payload = (await response.json()) as LinkedInTokenResponse;

  if (!response.ok || !payload.access_token) {
    await queryDb(
      `
        update social_accounts
        set
          status = 'expired',
          updated_at = now()
        where id = $1
      `,
      [accountRow.id],
    );

    throw new HttpError(
      409,
      "linkedin_reauth_required",
      payload.error_description ?? "LinkedIn account needs to be reconnected before publishing.",
    );
  }

  const refreshedResult = await queryDb<SocialAccountRow>(
    `
      update social_accounts
      set
        access_token = $2,
        refresh_token = $3,
        token_expires_at = $4,
        refresh_token_expires_at = $5,
        scope = $6,
        status = 'connected',
        updated_at = now()
      where id = $1
      returning
        id,
        business_id,
        user_id,
        platform,
        platform_user_id,
        platform_user_urn,
        account_email,
        access_token,
        refresh_token,
        token_expires_at,
        refresh_token_expires_at,
        scope,
        status,
        metadata_json,
        created_at,
        updated_at
    `,
    [
      accountRow.id,
      encryptSecret(payload.access_token, SOCIAL_ACCOUNT_ENCRYPTION_SECRET_NAME),
      payload.refresh_token
        ? encryptSecret(payload.refresh_token, SOCIAL_ACCOUNT_ENCRYPTION_SECRET_NAME)
        : accountRow.refresh_token,
      payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null,
      payload.refresh_token_expires_in
        ? new Date(Date.now() + payload.refresh_token_expires_in * 1000)
        : accountRow.refresh_token_expires_at,
      payload.scope?.split(/\s+/).filter(Boolean) ?? accountRow.scope ?? [],
    ],
  );

  return refreshedResult.rows[0];
}

async function fetchLinkedInUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
  const response = await fetch(LINKEDIN_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new HttpError(
      502,
      "linkedin_userinfo_failed",
      payload.message ?? "Unable to fetch LinkedIn user info.",
    );
  }

  return (await response.json()) as LinkedInUserInfo;
}

async function upsertSocialAccount(options: {
  businessId: string;
  userId: string;
  platformUserId: string;
  platformUserUrn: string;
  accountEmail?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  scopes: string[];
  metadata: Record<string, unknown>;
}): Promise<void> {
  await queryDb(
    `
      insert into social_accounts (
        business_id,
        user_id,
        platform,
        platform_user_id,
        platform_user_urn,
        account_email,
        access_token,
        refresh_token,
        token_expires_at,
        refresh_token_expires_at,
        scope,
        status,
        metadata_json
      ) values (
        $1,
        $2,
        'linkedin',
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        'connected',
        $11::jsonb
      )
      on conflict (business_id, platform)
      do update set
        user_id = excluded.user_id,
        platform_user_id = excluded.platform_user_id,
        platform_user_urn = excluded.platform_user_urn,
        account_email = excluded.account_email,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expires_at = excluded.token_expires_at,
        refresh_token_expires_at = excluded.refresh_token_expires_at,
        scope = excluded.scope,
        status = 'connected',
        metadata_json = excluded.metadata_json,
        updated_at = now()
    `,
    [
      options.businessId,
      options.userId,
      options.platformUserId,
      options.platformUserUrn,
      options.accountEmail ?? null,
      encryptSecret(options.accessToken, SOCIAL_ACCOUNT_ENCRYPTION_SECRET_NAME),
      options.refreshToken
        ? encryptSecret(options.refreshToken, SOCIAL_ACCOUNT_ENCRYPTION_SECRET_NAME)
        : null,
      options.tokenExpiresAt ?? null,
      options.refreshTokenExpiresAt ?? null,
      options.scopes,
      JSON.stringify(options.metadata),
    ],
  );
}

async function loadSocialAccountsByBusiness(
  businessId: string,
  platform?: SocialPlatform,
): Promise<SocialAccountRow[]> {
  const result = await queryDb<SocialAccountRow>(
    `
      select
        id,
        business_id,
        user_id,
        platform,
        platform_user_id,
        platform_user_urn,
        account_email,
        access_token,
        refresh_token,
        token_expires_at,
        refresh_token_expires_at,
        scope,
        status,
        metadata_json,
        created_at,
        updated_at
      from social_accounts
      where business_id = $1
        and ($2::text is null or platform = $2)
      order by created_at desc
    `,
    [businessId, platform ?? null],
  );

  return result.rows;
}

async function loadLinkedInAccountByBusiness(businessId: string): Promise<SocialAccountRow | null> {
  const rows = await loadSocialAccountsByBusiness(businessId, "linkedin");
  return rows[0] ?? null;
}

export async function createLinkedInAuthorizationUrl(
  principal: AuthenticatedPrincipal,
  input: {
    businessId: string;
    returnPath?: string;
  },
): Promise<StartSocialAuthResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId: input.businessId,
    featureKey: "scheduler",
  });
  await requireBusinessMembership(principal, input.businessId);

  if (!principal.userId) {
    throw new HttpError(401, "auth_required", "Authenticated user context is incomplete.");
  }

  const state = encodeState({
    businessId: input.businessId,
    userId: principal.userId,
    issuedAt: Date.now(),
    returnPath: sanitizeReturnPath(input.returnPath),
  });
  const url = new URL(LINKEDIN_AUTHORIZATION_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", resolveLinkedInClientId());
  url.searchParams.set("redirect_uri", resolveLinkedInRedirectUri());
  url.searchParams.set("state", state);
  url.searchParams.set("scope", resolveLinkedInScopes().join(" "));

  return {
    authorizationUrl: url.toString(),
  };
}

export async function handleLinkedInOAuthCallback(input: {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): Promise<string> {
  const fallbackRedirectUrl = buildRedirectUrl(
    "/linkedin-post-generator",
    "error",
    "connect_failed",
  );

  if (input.error) {
    return buildRedirectUrl(
      "/linkedin-post-generator",
      "error",
      input.errorDescription ?? input.error,
    );
  }

  if (!input.code || !input.state) {
    return fallbackRedirectUrl;
  }

  try {
    const state = decodeState(input.state);
    const tokenPayload = await exchangeAuthorizationCode(input.code);
    const accessToken = tokenPayload.access_token;

    if (!accessToken) {
      throw new HttpError(
        502,
        "linkedin_token_exchange_failed",
        "LinkedIn did not return a usable access token.",
      );
    }

    const idTokenPayload = parseJwtPayload(tokenPayload.id_token);
    const userInfo = await fetchLinkedInUserInfo(accessToken);
    const platformUserId =
      (typeof userInfo.sub === "string" && userInfo.sub) ||
      (typeof idTokenPayload?.sub === "string" ? idTokenPayload.sub : "");

    if (!platformUserId) {
      throw new HttpError(
        502,
        "linkedin_profile_incomplete",
        "LinkedIn did not return a usable member identifier.",
      );
    }

    await upsertSocialAccount({
      businessId: state.businessId,
      userId: state.userId,
      platformUserId,
      platformUserUrn: `urn:li:person:${platformUserId}`,
      accountEmail:
        userInfo.email ||
        (typeof idTokenPayload?.email === "string" ? idTokenPayload.email : undefined),
      accessToken,
      refreshToken: tokenPayload.refresh_token,
      tokenExpiresAt: tokenPayload.expires_in
        ? new Date(Date.now() + tokenPayload.expires_in * 1000)
        : undefined,
      refreshTokenExpiresAt: tokenPayload.refresh_token_expires_in
        ? new Date(Date.now() + tokenPayload.refresh_token_expires_in * 1000)
        : undefined,
      scopes: tokenPayload.scope?.split(/\s+/).filter(Boolean) ?? resolveLinkedInScopes(),
      metadata: {
        connectedVia: "oauth_callback",
        linkedInName:
          userInfo.name ||
          [userInfo.given_name, userInfo.family_name].filter(Boolean).join(" ").trim() ||
          null,
        pictureUrl: userInfo.picture ?? null,
      },
    });

    logInfo("Connected LinkedIn social account.", {
      businessId: state.businessId,
      userId: state.userId,
      platformUserId,
    });

    return buildRedirectUrl(state.returnPath ?? "/linkedin-post-generator", "connected");
  } catch (error) {
    logWarn("LinkedIn OAuth callback failed.", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return buildRedirectUrl("/linkedin-post-generator", "error", "connect_failed");
  }
}

export async function listSocialAccounts(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<SocialAccountsResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "scheduler");
  await requireBusinessMembership(principal, businessId);
  const accounts = await loadSocialAccountsByBusiness(businessId);

  return {
    accounts: accounts.map(mapSocialAccount),
  };
}

export async function getLinkedInPublishingCredentialsForBusiness(
  businessId: string,
): Promise<LinkedInPublishingCredentials> {
  const linkedInAccount = await loadLinkedInAccountByBusiness(businessId);

  if (!linkedInAccount) {
    throw new HttpError(
      409,
      "linkedin_not_connected",
      "Connect a LinkedIn account before scheduling posts.",
    );
  }

  const activeAccount =
    linkedInAccount.token_expires_at &&
    new Date(linkedInAccount.token_expires_at).getTime() <= Date.now() + 5 * 60 * 1000
      ? await refreshAccessToken(linkedInAccount)
      : linkedInAccount;

  return {
    accountId: activeAccount.id,
    businessId: activeAccount.business_id,
    userId: activeAccount.user_id,
    platformUserId: activeAccount.platform_user_id,
    platformUserUrn: activeAccount.platform_user_urn,
    accessToken: decryptSecret(activeAccount.access_token, SOCIAL_ACCOUNT_ENCRYPTION_SECRET_NAME),
  };
}
