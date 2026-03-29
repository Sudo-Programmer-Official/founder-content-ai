import { createHmac } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type {
  DisconnectSocialAccountResponse,
  SelectSocialAccountIdentityResponse,
  SocialAccount,
  SocialAccountIdentity,
  SocialAccountsResponse,
  SocialPlatform,
  StartSocialAuthResponse,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireBusinessMembership } from "./authBusinessService.ts";
import { queryDb, withDbTransaction } from "./db/client.ts";
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
const LINKEDIN_ORGANIZATION_AUTHORIZATIONS_URL =
  "https://api.linkedin.com/rest/organizationAuthorizations";
const LINKEDIN_ORGANIZATIONS_URL = "https://api.linkedin.com/rest/organizations";
const SOCIAL_ACCOUNT_ENCRYPTION_SECRET_NAME = "SOCIAL_ACCOUNT_ENCRYPTION_SECRET";
const SOCIAL_AUTH_STATE_SECRET_NAME = "SOCIAL_AUTH_STATE_SECRET";

interface SocialAccountRow extends QueryResultRow {
  id: string;
  business_id: string | null;
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

interface SocialAccountIdentityRow extends QueryResultRow {
  id: string;
  social_account_id: string;
  platform: SocialPlatform;
  identity_type: SocialAccountIdentity["type"];
  platform_identity_id: string;
  platform_identity_urn: string;
  display_name: string;
  avatar_url: string | null;
  metadata_json: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface BusinessSocialChannelRow extends QueryResultRow {
  id: string;
  business_id: string;
  platform: SocialPlatform;
  social_account_id: string;
  selected_identity_id: string | null;
  status: SocialAccount["status"];
  metadata_json: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WorkspaceSocialAccountChannelRow extends QueryResultRow {
  channel_id: string;
  channel_business_id: string;
  social_account_id: string;
  selected_identity_id: string | null;
  channel_status: SocialAccount["status"];
  channel_metadata_json: Record<string, unknown> | null;
  id: string;
  business_id: string | null;
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
  account_status: SocialAccount["status"];
  account_metadata_json: Record<string, unknown> | null;
  account_created_at: Date | string;
  account_updated_at: Date | string;
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

interface LinkedInOrganizationAuthorizationRecord {
  organization?: string;
  status?: Record<string, unknown>;
}

interface LinkedInOrganizationAuthorizationsResponse {
  elements?: Array<{
    elements?: LinkedInOrganizationAuthorizationRecord[];
  }>;
}

interface LinkedInOrganizationLookupResponse {
  results?: Record<string, unknown>;
}

interface LinkedInIdentityCandidate {
  type: SocialAccountIdentity["type"];
  platformIdentityId: string;
  platformIdentityUrn: string;
  displayName: string;
  avatarUrl?: string;
  metadata: Record<string, unknown>;
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
  accessToken: string;
  selectedIdentityId: string;
  selectedIdentityUrn: string;
  selectedIdentityType: SocialAccountIdentity["type"];
  selectedIdentityName: string;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toDate(value: Date | string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function toJsonRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return value ?? {};
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

function resolveLinkedInApiVersion(): string {
  return process.env.LINKEDIN_API_VERSION?.trim() || "202602";
}

function resolveLinkedInScopes(): string[] {
  return (process.env.LINKEDIN_SCOPE ?? "openid profile email w_member_social")
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function resolveFrontendAppUrl(): string {
  const firstConfiguredOrigin = (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .find(Boolean);

  return firstConfiguredOrigin ?? "http://localhost:5173";
}

function resolveReturnLocation(value: string | undefined): {
  pathname: string;
  search: string;
  hash: string;
} {
  const normalized = value?.trim();

  if (!normalized || !normalized.startsWith("/") || normalized.startsWith("//")) {
    return {
      pathname: "/app/create",
      search: "",
      hash: "",
    };
  }

  const parsed = new URL(normalized, "https://foundercontent.ai");

  return {
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
  };
}

function sanitizeReturnPath(value: string | undefined): string {
  const location = resolveReturnLocation(value);
  return `${location.pathname}${location.search}${location.hash}`;
}

function buildRedirectUrl(
  returnPath: string,
  status: "connected" | "error",
  message?: string,
): string {
  const url = new URL(resolveFrontendAppUrl());
  const location = resolveReturnLocation(returnPath);
  url.pathname = location.pathname;
  url.search = location.search;
  url.hash = location.hash;
  url.searchParams.set("linkedin", status);

  if (message) {
    url.searchParams.set("message", message);
  }

  return url.toString();
}

function mapSocialAccountIdentity(row: SocialAccountIdentityRow): SocialAccountIdentity {
  return {
    id: row.id,
    platform: row.platform,
    type: row.identity_type,
    platformIdentityId: row.platform_identity_id,
    platformIdentityUrn: row.platform_identity_urn,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? undefined,
    metadata: toJsonRecord(row.metadata_json),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapWorkspaceSocialAccount(
  row: WorkspaceSocialAccountChannelRow,
  identities: SocialAccountIdentityRow[],
): SocialAccount {
  const availableIdentities = identities.map(mapSocialAccountIdentity);
  const selectedIdentity =
    availableIdentities.find((identity) => identity.id === row.selected_identity_id) ??
    availableIdentities.find((identity) => identity.type === "person") ??
    availableIdentities[0];

  return {
    id: row.id,
    businessId: row.channel_business_id,
    userId: row.user_id,
    platform: row.platform,
    platformUserId: row.platform_user_id,
    platformUserUrn: row.platform_user_urn,
    accountEmail: row.account_email ?? undefined,
    tokenExpiresAt: toIsoString(row.token_expires_at),
    refreshTokenExpiresAt: toIsoString(row.refresh_token_expires_at),
    scopes: row.scope ?? [],
    status: row.channel_status,
    metadata: {
      ...toJsonRecord(row.account_metadata_json),
      channel: toJsonRecord(row.channel_metadata_json),
    },
    availableIdentities,
    selectedIdentity,
    createdAt: new Date(row.account_created_at).toISOString(),
    updatedAt: new Date(row.account_updated_at).toISOString(),
  };
}

function resolveLinkedInAccountLabel(account: SocialAccount): string | undefined {
  if (account.selectedIdentity?.displayName) {
    return account.selectedIdentity.displayName;
  }

  const linkedInName =
    typeof account.metadata?.linkedInName === "string" ? account.metadata.linkedInName.trim() : "";

  if (linkedInName) {
    return linkedInName;
  }

  if (account.accountEmail?.trim()) {
    return account.accountEmail.trim();
  }

  return account.platformUserId;
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

function buildLinkedInRestHeaders(
  accessToken: string,
  hasJsonBody = false,
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Linkedin-Version": resolveLinkedInApiVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
    ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
  };
}

function hasOrganizationPublishingScope(scopes: string[]): boolean {
  return scopes.includes("w_organization_social") || scopes.includes("rw_organization_admin");
}

function pickLocalizedText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const localized = (value as { localized?: Record<string, string> }).localized;

  if (!localized || typeof localized !== "object") {
    return undefined;
  }

  return Object.values(localized).find(
    (candidate) => typeof candidate === "string" && candidate.trim() !== "",
  )?.trim();
}

function extractOrganizationIdFromUrn(urn: string): string | undefined {
  const match = /^urn:li:organization:(.+)$/i.exec(urn.trim());
  return match?.[1];
}

function isApprovedOrganizationAuthorization(status: unknown): boolean {
  return Boolean(
    status &&
      typeof status === "object" &&
      Object.keys(status as Record<string, unknown>).some((key) => key.includes("Approved")),
  );
}

function flattenOrganizationAuthorizations(
  payload: LinkedInOrganizationAuthorizationsResponse,
): string[] {
  return (payload.elements ?? [])
    .flatMap((group) => group.elements ?? [])
    .flatMap((element) =>
      typeof element.organization === "string" && isApprovedOrganizationAuthorization(element.status)
        ? [element.organization]
        : [],
    );
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
    await queryDb(
      `
        update business_social_channels
        set
          status = 'expired',
          updated_at = now()
        where social_account_id = $1
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

  await queryDb(
    `
      update business_social_channels
      set
        status = 'connected',
        updated_at = now()
      where social_account_id = $1
    `,
    [accountRow.id],
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

async function fetchLinkedInOrganizationIdentities(
  accessToken: string,
  scopes: string[],
): Promise<LinkedInIdentityCandidate[]> {
  if (!hasOrganizationPublishingScope(scopes)) {
    return [];
  }

  const authorizationActions = encodeURIComponent(
    "List((authorizationAction:(organizationContentAuthorizationAction:(actionType:ORGANIC_SHARE_CREATE))))",
  );
  const response = await fetch(
    `${LINKEDIN_ORGANIZATION_AUTHORIZATIONS_URL}?bq=authorizationActionsAndImpersonator&authorizationActions=${authorizationActions}`,
    {
      headers: buildLinkedInRestHeaders(accessToken),
    },
  );

  if (!response.ok) {
    logWarn("LinkedIn organization authorizations lookup failed.", {
      statusCode: response.status,
    });
    return [];
  }

  const payload =
    (await response.json().catch(() => ({}))) as LinkedInOrganizationAuthorizationsResponse;
  const organizationUrns = [...new Set(flattenOrganizationAuthorizations(payload))];

  if (organizationUrns.length === 0) {
    return [];
  }

  const organizationIds = organizationUrns.flatMap((organizationUrn) => {
    const organizationId = extractOrganizationIdFromUrn(organizationUrn);
    return organizationId ? [organizationId] : [];
  });

  let organizationDetails = new Map<string, Record<string, unknown>>();

  if (organizationIds.length > 0) {
    const detailsResponse = await fetch(
      `${LINKEDIN_ORGANIZATIONS_URL}?ids=List(${organizationIds.join(",")})`,
      {
        headers: buildLinkedInRestHeaders(accessToken),
      },
    );

    if (detailsResponse.ok) {
      const detailsPayload =
        (await detailsResponse.json().catch(() => ({}))) as LinkedInOrganizationLookupResponse;
      organizationDetails = new Map<string, Record<string, unknown>>(
        Object.entries(detailsPayload.results ?? {}).filter((entry): entry is [string, Record<string, unknown>] =>
          Boolean(entry[0]) && Boolean(entry[1]) && typeof entry[1] === "object",
        ),
      );
    } else {
      logWarn("LinkedIn organization details lookup failed.", {
        statusCode: detailsResponse.status,
      });
    }
  }

  return organizationUrns.map((organizationUrn) => {
    const organizationId = extractOrganizationIdFromUrn(organizationUrn) ?? organizationUrn;
    const details = organizationDetails.get(organizationId) ?? {};
    const displayName =
      pickLocalizedText(details["localizedName"]) ||
      pickLocalizedText(details["name"]) ||
      `Organization ${organizationId}`;

    return {
      type: "organization",
      platformIdentityId: organizationId,
      platformIdentityUrn: organizationUrn,
      displayName,
      metadata: details,
    };
  });
}

async function upsertSocialAccount(
  client: PoolClient,
  options: {
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
  },
): Promise<SocialAccountRow> {
  const result = await client.query<SocialAccountRow>(
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
      on conflict (platform, platform_user_id)
      do update set
        business_id = coalesce(social_accounts.business_id, excluded.business_id),
        user_id = excluded.user_id,
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

  return result.rows[0];
}

async function upsertSocialAccountIdentity(
  client: PoolClient,
  options: {
    socialAccountId: string;
    platform: SocialPlatform;
    identityType: SocialAccountIdentity["type"];
    platformIdentityId: string;
    platformIdentityUrn: string;
    displayName: string;
    avatarUrl?: string;
    metadata: Record<string, unknown>;
  },
): Promise<SocialAccountIdentityRow> {
  const result = await client.query<SocialAccountIdentityRow>(
    `
      insert into social_account_identities (
        social_account_id,
        platform,
        identity_type,
        platform_identity_id,
        platform_identity_urn,
        display_name,
        avatar_url,
        metadata_json
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::jsonb
      )
      on conflict (social_account_id, platform_identity_urn)
      do update set
        identity_type = excluded.identity_type,
        platform_identity_id = excluded.platform_identity_id,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        metadata_json = excluded.metadata_json,
        updated_at = now()
      returning
        id,
        social_account_id,
        platform,
        identity_type,
        platform_identity_id,
        platform_identity_urn,
        display_name,
        avatar_url,
        metadata_json,
        created_at,
        updated_at
    `,
    [
      options.socialAccountId,
      options.platform,
      options.identityType,
      options.platformIdentityId,
      options.platformIdentityUrn,
      options.displayName,
      options.avatarUrl ?? null,
      JSON.stringify(options.metadata),
    ],
  );

  return result.rows[0];
}

async function upsertBusinessSocialChannel(
  client: PoolClient,
  options: {
    businessId: string;
    socialAccountId: string;
    selectedIdentityId: string;
    status: SocialAccount["status"];
    metadata: Record<string, unknown>;
  },
): Promise<BusinessSocialChannelRow> {
  const result = await client.query<BusinessSocialChannelRow>(
    `
      insert into business_social_channels (
        business_id,
        platform,
        social_account_id,
        selected_identity_id,
        status,
        metadata_json
      ) values (
        $1,
        'linkedin',
        $2,
        $3,
        $4,
        $5::jsonb
      )
      on conflict (business_id, platform)
      do update set
        social_account_id = excluded.social_account_id,
        selected_identity_id = case
          when business_social_channels.social_account_id = excluded.social_account_id
            and business_social_channels.selected_identity_id is not null
            then business_social_channels.selected_identity_id
          else excluded.selected_identity_id
        end,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = now()
      returning
        id,
        business_id,
        platform,
        social_account_id,
        selected_identity_id,
        status,
        metadata_json,
        created_at,
        updated_at
    `,
    [
      options.businessId,
      options.socialAccountId,
      options.selectedIdentityId,
      options.status,
      JSON.stringify(options.metadata),
    ],
  );

  return result.rows[0];
}

async function loadSocialAccountById(accountId: string): Promise<SocialAccountRow | null> {
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
      where id = $1
      limit 1
    `,
    [accountId],
  );

  return result.rows[0] ?? null;
}

async function loadSocialAccountIdentityById(identityId: string): Promise<SocialAccountIdentityRow | null> {
  const result = await queryDb<SocialAccountIdentityRow>(
    `
      select
        id,
        social_account_id,
        platform,
        identity_type,
        platform_identity_id,
        platform_identity_urn,
        display_name,
        avatar_url,
        metadata_json,
        created_at,
        updated_at
      from social_account_identities
      where id = $1
      limit 1
    `,
    [identityId],
  );

  return result.rows[0] ?? null;
}

async function loadSocialAccountIdentitiesByAccountIds(
  accountIds: string[],
): Promise<Map<string, SocialAccountIdentityRow[]>> {
  if (accountIds.length === 0) {
    return new Map();
  }

  const result = await queryDb<SocialAccountIdentityRow>(
    `
      select
        id,
        social_account_id,
        platform,
        identity_type,
        platform_identity_id,
        platform_identity_urn,
        display_name,
        avatar_url,
        metadata_json,
        created_at,
        updated_at
      from social_account_identities
      where social_account_id = any($1::uuid[])
      order by
        case when identity_type = 'person' then 0 else 1 end asc,
        display_name asc
    `,
    [accountIds],
  );

  const identitiesByAccountId = new Map<string, SocialAccountIdentityRow[]>();

  for (const row of result.rows) {
    const bucket = identitiesByAccountId.get(row.social_account_id) ?? [];
    bucket.push(row);
    identitiesByAccountId.set(row.social_account_id, bucket);
  }

  return identitiesByAccountId;
}

async function loadWorkspaceSocialAccountChannels(
  businessId: string,
  platform?: SocialPlatform,
): Promise<WorkspaceSocialAccountChannelRow[]> {
  const result = await queryDb<WorkspaceSocialAccountChannelRow>(
    `
      select
        bsc.id as channel_id,
        bsc.business_id as channel_business_id,
        bsc.social_account_id,
        bsc.selected_identity_id,
        bsc.status as channel_status,
        bsc.metadata_json as channel_metadata_json,
        sa.id,
        sa.business_id,
        sa.user_id,
        sa.platform,
        sa.platform_user_id,
        sa.platform_user_urn,
        sa.account_email,
        sa.access_token,
        sa.refresh_token,
        sa.token_expires_at,
        sa.refresh_token_expires_at,
        sa.scope,
        sa.status as account_status,
        sa.metadata_json as account_metadata_json,
        sa.created_at as account_created_at,
        sa.updated_at as account_updated_at
      from business_social_channels bsc
      join social_accounts sa on sa.id = bsc.social_account_id
      where bsc.business_id = $1
        and ($2::text is null or bsc.platform = $2)
      order by sa.created_at desc
    `,
    [businessId, platform ?? null],
  );

  return result.rows;
}

async function loadWorkspaceSocialChannelByAccountId(
  businessId: string,
  accountId: string,
): Promise<BusinessSocialChannelRow | null> {
  const result = await queryDb<BusinessSocialChannelRow>(
    `
      select
        id,
        business_id,
        platform,
        social_account_id,
        selected_identity_id,
        status,
        metadata_json,
        created_at,
        updated_at
      from business_social_channels
      where business_id = $1
        and social_account_id = $2
      limit 1
    `,
    [businessId, accountId],
  );

  return result.rows[0] ?? null;
}

function pickDefaultIdentity(identities: SocialAccountIdentityRow[]): SocialAccountIdentityRow | null {
  return (
    identities.find((identity) => identity.identity_type === "person") ??
    identities[0] ??
    null
  );
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
  let state: SocialAuthStatePayload | undefined;

  if (input.state) {
    try {
      state = decodeState(input.state);
    } catch {
      state = undefined;
    }
  }

  const fallbackRedirectUrl = buildRedirectUrl(
    state?.returnPath ?? "/app/create",
    "error",
    "connect_failed",
  );

  if (input.error) {
    return buildRedirectUrl(
      state?.returnPath ?? "/app/create",
      "error",
      input.errorDescription ?? input.error,
    );
  }

  if (!input.code || !input.state) {
    return fallbackRedirectUrl;
  }

  try {
    const callbackState = state ?? decodeState(input.state);
    state = callbackState;
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

    const scopes = tokenPayload.scope?.split(/\s+/).filter(Boolean) ?? resolveLinkedInScopes();
    const linkedInName =
      userInfo.name ||
      [userInfo.given_name, userInfo.family_name].filter(Boolean).join(" ").trim() ||
      platformUserId;
    const organizationIdentities = await fetchLinkedInOrganizationIdentities(accessToken, scopes);

    await withDbTransaction(async (client) => {
      const socialAccount = await upsertSocialAccount(client, {
        businessId: callbackState.businessId,
        userId: callbackState.userId,
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
        scopes,
        metadata: {
          connectedVia: "oauth_callback",
          linkedInName,
          pictureUrl: userInfo.picture ?? null,
        },
      });

      const memberIdentity = await upsertSocialAccountIdentity(client, {
        socialAccountId: socialAccount.id,
        platform: "linkedin",
        identityType: "person",
        platformIdentityId: platformUserId,
        platformIdentityUrn: `urn:li:person:${platformUserId}`,
        displayName: linkedInName,
        avatarUrl: userInfo.picture ?? undefined,
        metadata: {
          accountEmail:
            userInfo.email ||
            (typeof idTokenPayload?.email === "string" ? idTokenPayload.email : undefined) ||
            null,
          pictureUrl: userInfo.picture ?? null,
        },
      });

      for (const identity of organizationIdentities) {
        await upsertSocialAccountIdentity(client, {
          socialAccountId: socialAccount.id,
          platform: "linkedin",
          identityType: identity.type,
          platformIdentityId: identity.platformIdentityId,
          platformIdentityUrn: identity.platformIdentityUrn,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          metadata: identity.metadata,
        });
      }

      await upsertBusinessSocialChannel(client, {
        businessId: callbackState.businessId,
        socialAccountId: socialAccount.id,
        selectedIdentityId: memberIdentity.id,
        status: "connected",
        metadata: {
          connectedAt: new Date().toISOString(),
          connectedAccountLabel: linkedInName,
          availableIdentityCount: 1 + organizationIdentities.length,
        },
      });
    });

    logInfo("Connected LinkedIn social account.", {
      businessId: state.businessId,
      userId: state.userId,
      platformUserId,
      organizationIdentityCount: organizationIdentities.length,
    });

    return buildRedirectUrl(callbackState.returnPath ?? "/app/create", "connected");
  } catch (error) {
    logWarn("LinkedIn OAuth callback failed.", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return buildRedirectUrl(state?.returnPath ?? "/app/create", "error", "connect_failed");
  }
}

export async function listSocialAccounts(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<SocialAccountsResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "scheduler");
  await requireBusinessMembership(principal, businessId);
  const channels = await loadWorkspaceSocialAccountChannels(businessId);
  const identitiesByAccountId = await loadSocialAccountIdentitiesByAccountIds(
    channels.map((channel) => channel.id),
  );

  return {
    accounts: channels.map((channel) =>
      mapWorkspaceSocialAccount(channel, identitiesByAccountId.get(channel.id) ?? []),
    ),
  };
}

export async function selectSocialAccountIdentity(
  principal: AuthenticatedPrincipal,
  input: {
    businessId: string;
    accountId: string;
    identityId: string;
  },
): Promise<SelectSocialAccountIdentityResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId: input.businessId,
    featureKey: "scheduler",
  });
  await requireBusinessMembership(principal, input.businessId);

  const channel = await loadWorkspaceSocialChannelByAccountId(input.businessId, input.accountId);

  if (!channel) {
    throw new HttpError(404, "social_account_not_found", "Social account was not found.");
  }

  const identity = await loadSocialAccountIdentityById(input.identityId);

  if (!identity || identity.social_account_id !== input.accountId) {
    throw new HttpError(
      404,
      "social_identity_not_found",
      "LinkedIn publishing identity was not found for this account.",
    );
  }

  await queryDb(
    `
      update business_social_channels
      set
        selected_identity_id = $3,
        updated_at = now()
      where business_id = $1
        and social_account_id = $2
    `,
    [input.businessId, input.accountId, input.identityId],
  );

  const channels = await loadWorkspaceSocialAccountChannels(input.businessId, "linkedin");
  const updatedChannel = channels.find((candidate) => candidate.id === input.accountId);

  if (!updatedChannel) {
    throw new HttpError(404, "social_account_not_found", "Social account was not found.");
  }

  const identitiesByAccountId = await loadSocialAccountIdentitiesByAccountIds([input.accountId]);

  return {
    account: mapWorkspaceSocialAccount(
      updatedChannel,
      identitiesByAccountId.get(input.accountId) ?? [],
    ),
  };
}

export async function getLinkedInGenerationContextForBusiness(
  businessId: string | undefined,
): Promise<string | undefined> {
  const normalizedBusinessId = businessId?.trim();

  if (!normalizedBusinessId) {
    return undefined;
  }

  const channels = await loadWorkspaceSocialAccountChannels(normalizedBusinessId, "linkedin");
  const channel = channels[0];

  if (!channel) {
    return undefined;
  }

  const identitiesByAccountId = await loadSocialAccountIdentitiesByAccountIds([channel.id]);
  const account = mapWorkspaceSocialAccount(channel, identitiesByAccountId.get(channel.id) ?? []);
  const accountLabel = resolveLinkedInAccountLabel(account);
  const hasPublishingScope = (account.scopes ?? []).includes("w_member_social");

  return [
    accountLabel
      ? `LinkedIn channel is connected for this workspace via ${accountLabel}.`
      : "LinkedIn channel is connected for this workspace.",
    "Optimize for direct LinkedIn publishing, not a generic cross-platform post.",
    "Lead with a strong first line, use short paragraphs, leave breathing room between ideas, and close with one clear founder-relevant takeaway or CTA.",
    "Avoid markdown-style headings, hashtag stuffing, or formatting that looks copied from another platform.",
    hasPublishingScope ? "Keep the final post clean enough to publish as-is." : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export async function disconnectSocialAccount(
  principal: AuthenticatedPrincipal,
  input: {
    businessId: string;
    accountId: string;
  },
): Promise<DisconnectSocialAccountResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId: input.businessId,
    featureKey: "scheduler",
  });
  await requireBusinessMembership(principal, input.businessId);

  const account = await loadSocialAccountById(input.accountId);
  const channel = await loadWorkspaceSocialChannelByAccountId(input.businessId, input.accountId);

  if (!account || !channel) {
    throw new HttpError(404, "social_account_not_found", "Social account was not found.");
  }

  await withDbTransaction(async (client) => {
    await client.query(
      `
        delete from business_social_channels
        where business_id = $1
          and social_account_id = $2
      `,
      [input.businessId, input.accountId],
    );

    const remainingChannels = await client.query<{ total: string }>(
      `
        select count(*)::text as total
        from business_social_channels
        where social_account_id = $1
      `,
      [input.accountId],
    );

    if (Number(remainingChannels.rows[0]?.total ?? 0) === 0) {
      await client.query(
        `
          delete from social_accounts
          where id = $1
        `,
        [input.accountId],
      );
    }
  });

  logInfo("Disconnected social account from workspace.", {
    businessId: input.businessId,
    userId: principal.userId,
    accountId: input.accountId,
    platform: account.platform,
  });

  return {
    disconnectedAccountId: input.accountId,
  };
}

export async function getLinkedInPublishingCredentialsForBusiness(input: {
  businessId: string;
  socialAccountId?: string | null;
  socialAccountIdentityId?: string | null;
}): Promise<LinkedInPublishingCredentials> {
  let account = input.socialAccountId ? await loadSocialAccountById(input.socialAccountId) : null;
  let selectedIdentity = input.socialAccountIdentityId
    ? await loadSocialAccountIdentityById(input.socialAccountIdentityId)
    : null;

  if (!account || !selectedIdentity || selectedIdentity.social_account_id !== account.id) {
    const channels = await loadWorkspaceSocialAccountChannels(input.businessId, "linkedin");
    const channel = channels[0];

    if (!channel) {
      throw new HttpError(
        409,
        "linkedin_not_connected",
        "Connect a LinkedIn account before publishing.",
      );
    }

    account = account ?? {
      id: channel.id,
      business_id: channel.business_id,
      user_id: channel.user_id,
      platform: channel.platform,
      platform_user_id: channel.platform_user_id,
      platform_user_urn: channel.platform_user_urn,
      account_email: channel.account_email,
      access_token: channel.access_token,
      refresh_token: channel.refresh_token,
      token_expires_at: channel.token_expires_at,
      refresh_token_expires_at: channel.refresh_token_expires_at,
      scope: channel.scope,
      status: channel.account_status,
      metadata_json: channel.account_metadata_json,
      created_at: channel.account_created_at,
      updated_at: channel.account_updated_at,
    };

    if (!selectedIdentity || selectedIdentity.social_account_id !== account.id) {
      const identitiesByAccountId = await loadSocialAccountIdentitiesByAccountIds([account.id]);
      const availableIdentities = identitiesByAccountId.get(account.id) ?? [];
      selectedIdentity =
        availableIdentities.find((identity) => identity.id === channel.selected_identity_id) ??
        pickDefaultIdentity(availableIdentities);
    }
  }

  if (!account) {
    throw new HttpError(
      409,
      "linkedin_not_connected",
      "Connect a LinkedIn account before publishing.",
    );
  }

  const activeAccount =
    account.token_expires_at &&
    new Date(account.token_expires_at).getTime() <= Date.now() + 5 * 60 * 1000
      ? await refreshAccessToken(account)
      : account;

  let resolvedIdentity = selectedIdentity;

  if (!resolvedIdentity || resolvedIdentity.social_account_id !== activeAccount.id) {
    const identitiesByAccountId = await loadSocialAccountIdentitiesByAccountIds([activeAccount.id]);
    const availableIdentities = identitiesByAccountId.get(activeAccount.id) ?? [];
    resolvedIdentity = pickDefaultIdentity(availableIdentities);
  }

  if (!resolvedIdentity) {
    throw new HttpError(
      409,
      "linkedin_not_connected",
      "LinkedIn publishing identity is not configured for this workspace.",
    );
  }

  return {
    accountId: activeAccount.id,
    businessId: input.businessId,
    userId: activeAccount.user_id,
    platformUserId: activeAccount.platform_user_id,
    accessToken: decryptSecret(activeAccount.access_token, SOCIAL_ACCOUNT_ENCRYPTION_SECRET_NAME),
    selectedIdentityId: resolvedIdentity.id,
    selectedIdentityUrn: resolvedIdentity.platform_identity_urn,
    selectedIdentityType: resolvedIdentity.identity_type,
    selectedIdentityName: resolvedIdentity.display_name,
  };
}
