import { createHmac } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import type {
  RevenueAgentCalendarSuggestion,
  RevenueAgentGoogleCalendarConnection,
  RevenueAgentMeetingBrief,
  RevenueAgentProspect,
  RevenueAgentWorkflow,
} from "../../../../../packages/shared-types/index.ts";
import { queryDb, withDbTransaction } from "../db/client.ts";
import { enforceWorkspaceWriteAccess } from "../governanceService.ts";
import { HttpError } from "../../utils/http.ts";
import { decryptSecret, encryptSecret } from "../../utils/secretCrypto.ts";
import { requireBusinessMembership } from "../authBusinessService.ts";
import type { AuthenticatedPrincipal } from "../../middleware/auth.ts";
import { logInfo, logWarn } from "../../utils/logger.ts";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALENDAR_API_BASE_URL = "https://www.googleapis.com/calendar/v3";
const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];
const GOOGLE_CALENDAR_STATE_SECRET_NAME = "SOCIAL_AUTH_STATE_SECRET";
const GOOGLE_CALENDAR_ENCRYPTION_SECRET_NAME = "SOCIAL_ACCOUNT_ENCRYPTION_SECRET";

interface GoogleCalendarConnectionRow extends QueryResultRow {
  id: string;
  business_id: string;
  user_id: string;
  google_account_id: string;
  account_email: string | null;
  calendar_id: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: Date | string | null;
  refresh_token_expires_at: Date | string | null;
  scope: string[] | null;
  status: RevenueAgentGoogleCalendarConnection["status"];
  metadata_json: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface GoogleCalendarAuthStatePayload {
  businessId: string;
  userId: string;
  issuedAt: number;
  returnPath?: string;
}

interface GoogleCalendarTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface GoogleCalendarUserInfo {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
}

interface GoogleCalendarEventInsertResponse {
  id?: string;
  htmlLink?: string;
  status?: string;
  calendarId?: string;
}

interface GoogleCalendarMeetingEventInput {
  businessId: string;
  businessName: string;
  businessBrandName?: string;
  prospect: Pick<RevenueAgentProspect, "businessName" | "email" | "city" | "state" | "source" | "sourceUrl">;
  workflow: RevenueAgentWorkflow;
  calendarSuggestion: NonNullable<RevenueAgentWorkflow["calendarSuggestion"]>;
  meetingBrief?: RevenueAgentMeetingBrief;
}

interface GoogleCalendarMeetingEventResult {
  created: boolean;
  eventId?: string;
  htmlLink?: string;
  calendarId?: string;
  status?: string;
  reason?: string;
}

async function executeQuery<TRow extends QueryResultRow>(
  text: string,
  values: unknown[],
  client?: PoolClient,
): Promise<{ rows: TRow[] }> {
  if (client) {
    return client.query<TRow>(text, values);
  }

  return queryDb<TRow>(text, values);
}

function resolveSecret(name: string): string {
  const configured = process.env[name]?.trim();

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV !== "production") {
    return `${name.toLowerCase()}-development-secret`;
  }

  throw new HttpError(500, "google_calendar_not_configured", `${name} is not configured.`);
}

function resolveStateSecret(): string {
  return resolveSecret(GOOGLE_CALENDAR_STATE_SECRET_NAME);
}

function resolveClientId(): string {
  return process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || "";
}

function resolveClientSecret(): string {
  return process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
}

function resolveRedirectUri(): string {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim() || process.env.GOOGLE_REDIRECT_URI?.trim() || "";
}

function sanitizeReturnPath(returnPath?: string): string | undefined {
  const trimmed = returnPath?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (!trimmed.startsWith("/")) {
    return undefined;
  }

  return trimmed;
}

function signState(payload: string): string {
  return createHmac("sha256", resolveStateSecret()).update(payload).digest("base64url");
}

function encodeState(payload: GoogleCalendarAuthStatePayload): string {
  const serializedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signState(serializedPayload);
  return `${serializedPayload}.${signature}`;
}

function decodeState(state: string): GoogleCalendarAuthStatePayload {
  const [payloadPart, signaturePart] = state.split(".", 2);

  if (!payloadPart || !signaturePart) {
    throw new HttpError(400, "invalid_state", "Google Calendar auth state is invalid.");
  }

  if (signState(payloadPart) !== signaturePart) {
    throw new HttpError(400, "invalid_state", "Google Calendar auth state signature is invalid.");
  }

  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as GoogleCalendarAuthStatePayload;

  if (!payload.businessId || !payload.userId || !payload.issuedAt) {
    throw new HttpError(400, "invalid_state", "Google Calendar auth state is incomplete.");
  }

  if (Date.now() - payload.issuedAt > 15 * 60 * 1000) {
    throw new HttpError(400, "expired_state", "Google Calendar auth state has expired.");
  }

  return payload;
}

function encodeConnectionToken(token: string): string {
  return encryptSecret(token, GOOGLE_CALENDAR_ENCRYPTION_SECRET_NAME);
}

function decodeConnectionToken(token: string): string {
  return decryptSecret(token, GOOGLE_CALENDAR_ENCRYPTION_SECRET_NAME);
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
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function buildRedirectUrl(
  basePath: string,
  status: "connected" | "error" | "disconnected",
  details?: Record<string, string | undefined>,
): string {
  const url = new URL(basePath, "https://foundercontent.ai");
  url.searchParams.set("google_calendar", status);

  for (const [key, value] of Object.entries(details ?? {})) {
    if (value?.trim()) {
      url.searchParams.set(key, value.trim());
    }
  }

  return `${url.pathname}${url.search}`;
}

function buildGoogleCalendarDescription(input: GoogleCalendarMeetingEventInput): string {
  const lines = [
    `${input.businessBrandName || input.businessName} meeting with ${input.prospect.businessName}`,
    "",
    input.calendarSuggestion.inviteDraft,
    "",
    input.meetingBrief?.objective ? `Objective: ${input.meetingBrief.objective}` : "",
    input.meetingBrief?.agenda?.length ? `Agenda: ${input.meetingBrief.agenda.join(" | ")}` : "",
    input.meetingBrief?.prepNotes?.length ? `Prep notes: ${input.meetingBrief.prepNotes.join(" | ")}` : "",
    input.prospect.email ? `Lead email: ${input.prospect.email}` : "",
    input.prospect.source ? `Lead source: ${input.prospect.source}` : "",
    input.prospect.sourceUrl ? `Source URL: ${input.prospect.sourceUrl}` : "",
    input.prospect.city || input.prospect.state
      ? `Location: ${[input.prospect.city, input.prospect.state].filter(Boolean).join(", ")}`
      : "",
  ].filter((line) => line.trim().length > 0);

  return lines.join("\n");
}

async function fetchJson<TPayload>(
  url: string,
  init?: RequestInit,
): Promise<TPayload> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  } & TPayload;

  if (!response.ok || payload.error?.message) {
    throw new HttpError(
      502,
      "google_calendar_request_failed",
      payload.error?.message ?? "Google Calendar request failed.",
    );
  }

  return payload;
}

async function exchangeAuthorizationCode(code: string): Promise<GoogleCalendarTokenResponse> {
  const clientId = resolveClientId();
  const clientSecret = resolveClientSecret();
  const redirectUri = resolveRedirectUri();

  if (!clientId || !clientSecret || !redirectUri) {
    throw new HttpError(
      500,
      "google_calendar_not_configured",
      "Google Calendar OAuth credentials are not configured.",
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  return fetchJson<GoogleCalendarTokenResponse>(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleCalendarTokenResponse> {
  const clientId = resolveClientId();
  const clientSecret = resolveClientSecret();

  if (!clientId || !clientSecret) {
    throw new HttpError(
      500,
      "google_calendar_not_configured",
      "Google Calendar OAuth credentials are not configured.",
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  return fetchJson<GoogleCalendarTokenResponse>(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
}

async function fetchUserInfo(accessToken: string): Promise<GoogleCalendarUserInfo> {
  return fetchJson<GoogleCalendarUserInfo>(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

async function loadGoogleCalendarConnectionRow(
  businessId: string,
  client?: PoolClient,
): Promise<GoogleCalendarConnectionRow | null> {
  const result = await executeQuery<GoogleCalendarConnectionRow>(
    `
      select
        id,
        business_id,
        user_id,
        google_account_id,
        account_email,
        calendar_id,
        access_token,
        refresh_token,
        token_expires_at,
        refresh_token_expires_at,
        scope,
        status,
        metadata_json,
        created_at,
        updated_at
      from google_calendar_connections
      where business_id = $1::uuid
      limit 1
    `,
    [businessId],
    client,
  );

  return result.rows[0] ?? null;
}

function mapGoogleCalendarConnection(row: GoogleCalendarConnectionRow): RevenueAgentGoogleCalendarConnection {
  return {
    connected: row.status === "connected",
    status: row.status,
    accountEmail: row.account_email ?? undefined,
    calendarId: row.calendar_id,
    googleAccountId: row.google_account_id,
    scopes: row.scope ?? [],
    connectedAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function upsertGoogleCalendarConnection(
  client: PoolClient | undefined,
  input: {
    businessId: string;
    userId: string;
    googleAccountId: string;
    accountEmail?: string;
    accessToken: string;
    refreshToken?: string;
    tokenExpiresAt?: Date;
    scopes: string[];
    metadata: Record<string, unknown>;
  },
): Promise<GoogleCalendarConnectionRow> {
  const result = client
    ? await client.query<GoogleCalendarConnectionRow>(
        `
      insert into google_calendar_connections (
        business_id,
        user_id,
        google_account_id,
        account_email,
        calendar_id,
        access_token,
        refresh_token,
        token_expires_at,
        scope,
        status,
        metadata_json
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        'primary',
        $5,
        $6,
        $7::timestamptz,
        $8::text[],
        'connected',
        $9::jsonb
      )
      on conflict (business_id) do update set
        user_id = excluded.user_id,
        google_account_id = excluded.google_account_id,
        account_email = excluded.account_email,
        calendar_id = excluded.calendar_id,
        access_token = excluded.access_token,
        refresh_token = coalesce(excluded.refresh_token, google_calendar_connections.refresh_token),
        token_expires_at = excluded.token_expires_at,
        scope = excluded.scope,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = now()
      returning
        id,
        business_id,
        user_id,
        google_account_id,
        account_email,
        calendar_id,
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
          input.businessId,
          input.userId,
          input.googleAccountId,
          input.accountEmail ?? null,
          encodeConnectionToken(input.accessToken),
          input.refreshToken ? encodeConnectionToken(input.refreshToken) : null,
          input.tokenExpiresAt ?? null,
          input.scopes,
          JSON.stringify(input.metadata),
        ],
      )
    : await queryDb<GoogleCalendarConnectionRow>(
        `
      insert into google_calendar_connections (
        business_id,
        user_id,
        google_account_id,
        account_email,
        calendar_id,
        access_token,
        refresh_token,
        token_expires_at,
        scope,
        status,
        metadata_json
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        'primary',
        $5,
        $6,
        $7::timestamptz,
        $8::text[],
        'connected',
        $9::jsonb
      )
      on conflict (business_id) do update set
        user_id = excluded.user_id,
        google_account_id = excluded.google_account_id,
        account_email = excluded.account_email,
        calendar_id = excluded.calendar_id,
        access_token = excluded.access_token,
        refresh_token = coalesce(excluded.refresh_token, google_calendar_connections.refresh_token),
        token_expires_at = excluded.token_expires_at,
        scope = excluded.scope,
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        updated_at = now()
      returning
        id,
        business_id,
        user_id,
        google_account_id,
        account_email,
        calendar_id,
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
          input.businessId,
          input.userId,
          input.googleAccountId,
          input.accountEmail ?? null,
          encodeConnectionToken(input.accessToken),
          input.refreshToken ? encodeConnectionToken(input.refreshToken) : null,
          input.tokenExpiresAt ?? null,
          input.scopes,
          JSON.stringify(input.metadata),
        ],
      );

  return result.rows[0];
}

async function updateGoogleCalendarConnectionStatus(
  businessId: string,
  status: GoogleCalendarConnectionRow["status"],
  metadata?: Record<string, unknown>,
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      update google_calendar_connections
      set status = $2,
          metadata_json = coalesce(metadata_json, '{}'::jsonb) || $3::jsonb,
          updated_at = now()
      where business_id = $1::uuid
    `,
    [businessId, status, JSON.stringify(metadata ?? {})],
    client,
  );
}

async function loadGoogleCalendarAccessToken(
  businessId: string,
  client?: PoolClient,
): Promise<{ connection: GoogleCalendarConnectionRow; accessToken: string } | null> {
  const connection = await loadGoogleCalendarConnectionRow(businessId, client);

  if (!connection || connection.status !== "connected") {
    return null;
  }

  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  const needsRefresh = !expiresAt || expiresAt <= Date.now() + 60_000;

  if (!needsRefresh) {
    return {
      connection,
      accessToken: decodeConnectionToken(connection.access_token),
    };
  }

  if (!connection.refresh_token) {
    await updateGoogleCalendarConnectionStatus(businessId, "expired", {
      lastError: "Missing refresh token.",
    }, client);
    return null;
  }

  try {
    const refreshed = await refreshAccessToken(decodeConnectionToken(connection.refresh_token));

    if (!refreshed.access_token) {
      throw new HttpError(502, "google_calendar_refresh_failed", "Google Calendar did not return a usable access token.");
    }

    const updatedConnection = await upsertGoogleCalendarConnection(client, {
      businessId: connection.business_id,
      userId: connection.user_id,
      googleAccountId: connection.google_account_id,
      accountEmail: connection.account_email ?? undefined,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ? refreshed.refresh_token : connection.refresh_token ? decodeConnectionToken(connection.refresh_token) : undefined,
      tokenExpiresAt: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : undefined,
      scopes: refreshed.scope?.split(/\s+/).filter(Boolean) ?? connection.scope ?? GOOGLE_CALENDAR_SCOPES,
      metadata: connection.metadata_json ?? {},
    });

    return {
      connection: updatedConnection,
      accessToken: decodeConnectionToken(updatedConnection.access_token),
    };
  } catch (error) {
    await updateGoogleCalendarConnectionStatus(businessId, "error", {
      lastError: error instanceof Error ? error.message : "Failed to refresh the Google Calendar access token.",
    }, client);
    logWarn("Google Calendar access token refresh failed.", {
      businessId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

export async function createGoogleCalendarAuthorizationUrl(
  principal: AuthenticatedPrincipal,
  input: {
    businessId: string;
    returnPath?: string;
  },
): Promise<{ authorizationUrl: string }> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId: input.businessId,
    featureKey: "scheduler",
  });
  await requireBusinessMembership(principal, input.businessId);

  if (!principal.userId) {
    throw new HttpError(401, "auth_required", "Authenticated user context is incomplete.");
  }

  const clientId = resolveClientId();
  const redirectUri = resolveRedirectUri();

  if (!clientId || !redirectUri) {
    throw new HttpError(
      500,
      "google_calendar_not_configured",
      "Google Calendar OAuth credentials are not configured.",
    );
  }

  const state = encodeState({
    businessId: input.businessId,
    userId: principal.userId,
    issuedAt: Date.now(),
    returnPath: sanitizeReturnPath(input.returnPath),
  });

  const url = new URL(GOOGLE_AUTHORIZATION_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  return {
    authorizationUrl: url.toString(),
  };
}

export async function handleGoogleCalendarOAuthCallback(input: {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): Promise<string> {
  let state: GoogleCalendarAuthStatePayload | undefined;

  if (input.state) {
    try {
      state = decodeState(input.state);
    } catch {
      state = undefined;
    }
  }

  if (input.error) {
    return buildRedirectUrl(
      state?.returnPath ?? "/app/revenue-agent",
      "error",
      {
        message: input.errorDescription ?? input.error,
      },
    );
  }

  if (!input.code || !input.state) {
    return buildRedirectUrl(state?.returnPath ?? "/app/revenue-agent", "error", {
      message: "connect_failed",
    });
  }

  try {
    const callbackState = state ?? decodeState(input.state);
    state = callbackState;
    const tokenPayload = await exchangeAuthorizationCode(input.code);
    const accessToken = tokenPayload.access_token;

    if (!accessToken) {
      throw new HttpError(
        502,
        "google_calendar_token_exchange_failed",
        "Google did not return a usable access token.",
      );
    }

    const userInfo = await fetchUserInfo(accessToken).catch(() => ({}) as GoogleCalendarUserInfo);
    const idTokenPayload = parseJwtPayload(tokenPayload.id_token) ?? {};
    const googleAccountId =
      (typeof userInfo.sub === "string" && userInfo.sub) ||
      (typeof idTokenPayload?.sub === "string" ? idTokenPayload.sub : "");

    if (!googleAccountId) {
      throw new HttpError(
        502,
        "google_calendar_profile_incomplete",
        "Google did not return a usable account identifier.",
      );
    }

    const scopes = tokenPayload.scope?.split(/\s+/).filter(Boolean) ?? GOOGLE_CALENDAR_SCOPES;

    await withDbTransaction(async (client) => {
      await upsertGoogleCalendarConnection(client, {
        businessId: callbackState.businessId,
        userId: callbackState.userId,
        googleAccountId,
        accountEmail: userInfo.email || (typeof idTokenPayload?.email === "string" ? idTokenPayload.email : undefined),
        accessToken,
        refreshToken: tokenPayload.refresh_token,
        tokenExpiresAt: tokenPayload.expires_in ? new Date(Date.now() + tokenPayload.expires_in * 1000) : undefined,
        scopes,
        metadata: {
          connectedVia: "oauth_callback",
          accountName: userInfo.name ?? null,
          pictureUrl: userInfo.picture ?? null,
        },
      });
    });

    logInfo("Connected Google Calendar account.", {
      businessId: callbackState.businessId,
      userId: callbackState.userId,
      googleAccountId,
    });

    return buildRedirectUrl(callbackState.returnPath ?? "/app/revenue-agent", "connected");
  } catch (error) {
    logWarn("Google Calendar OAuth callback failed.", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return buildRedirectUrl(state?.returnPath ?? "/app/revenue-agent", "error", {
      message: "connect_failed",
    });
  }
}

export async function disconnectGoogleCalendarConnection(
  principal: AuthenticatedPrincipal,
  input: {
    businessId: string;
  },
): Promise<{ disconnectedBusinessId: string }> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId: input.businessId,
    featureKey: "scheduler",
  });
  await requireBusinessMembership(principal, input.businessId);

  await executeQuery(
    `
      delete from google_calendar_connections
      where business_id = $1::uuid
    `,
    [input.businessId],
  );

  return {
    disconnectedBusinessId: input.businessId,
  };
}

export async function getGoogleCalendarConnectionSummary(
  businessId: string,
  client?: PoolClient,
): Promise<RevenueAgentGoogleCalendarConnection | undefined> {
  const row = await loadGoogleCalendarConnectionRow(businessId, client);

  if (!row) {
    return undefined;
  }

  return mapGoogleCalendarConnection(row);
}

export async function createGoogleCalendarMeetingEvent(
  input: GoogleCalendarMeetingEventInput,
  client?: PoolClient,
): Promise<GoogleCalendarMeetingEventResult> {
  const accessInfo = await loadGoogleCalendarAccessToken(input.businessId, client);

  if (!accessInfo) {
    return {
      created: false,
      reason: "not_connected",
    };
  }

  const slot = input.calendarSuggestion.suggestedSlots[0];

  if (!slot?.startAt || !slot?.endAt) {
    return {
      created: false,
      reason: "missing_slot",
    };
  }

  const summary = `${input.businessBrandName || input.businessName} meeting with ${input.prospect.businessName}`;
  const description = buildGoogleCalendarDescription(input);
  const eventBody = {
    summary,
    description,
    start: {
      dateTime: slot.startAt,
      timeZone: input.calendarSuggestion.timezone,
    },
    end: {
      dateTime: slot.endAt,
      timeZone: input.calendarSuggestion.timezone,
    },
    reminders: {
      useDefault: true,
    },
  };

  try {
    const response = await fetchJson<GoogleCalendarEventInsertResponse>(
      `${GOOGLE_CALENDAR_API_BASE_URL}/calendars/${encodeURIComponent(accessInfo.connection.calendar_id)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessInfo.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      },
    );

    return {
      created: true,
      eventId: response.id,
      htmlLink: response.htmlLink,
      calendarId: response.calendarId ?? accessInfo.connection.calendar_id,
      status: response.status,
    };
  } catch (error) {
    await updateGoogleCalendarConnectionStatus(input.businessId, "error", {
      lastError: error instanceof Error ? error.message : "Failed to create the calendar event.",
    }, client);

    logWarn("Google Calendar event creation failed.", {
      businessId: input.businessId,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      created: false,
      reason: "event_create_failed",
    };
  }
}
