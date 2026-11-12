import { createHmac } from "node:crypto";
import type { QueryResultRow } from "pg";
import type {
  ReelYouTubeConnection,
  ReelYouTubePublication,
  ReelYouTubeVisibility,
} from "../../../../../packages/shared-types/index.ts";
import { queryDb } from "../db/client.ts";
import { enforceWorkspaceWriteAccess } from "../governanceService.ts";
import type { AuthenticatedPrincipal } from "../../middleware/auth.ts";
import { HttpError } from "../../utils/http.ts";
import { decryptSecret, encryptSecret } from "../../utils/secretCrypto.ts";
import { logInfo, logWarn } from "../../utils/logger.ts";
import {
  getReelProject,
  loadReelProjectForPublish,
  markReelPublished,
} from "./reelProjectService.ts";
import { readReelMedia } from "./reelMediaStorage.ts";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status";
const YOUTUBE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
];
const STATE_SECRET_NAME = "SOCIAL_AUTH_STATE_SECRET";
const ENCRYPTION_SECRET_NAME = "SOCIAL_ACCOUNT_ENCRYPTION_SECRET";
const MAX_STATE_AGE_MS = 15 * 60 * 1000;

interface ReelYouTubeConnectionRow extends QueryResultRow {
  business_id: string;
  channel_id: string;
  channel_title: string | null;
  account_email: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: Date | string | null;
  scope: string[] | null;
  status: "connected" | "error";
}

interface YouTubeTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface YouTubeChannelResponse {
  items?: Array<{
    id?: string;
    snippet?: { title?: string };
  }>;
}

interface AuthState {
  businessId: string;
  userId: string;
  issuedAt: number;
  returnPath?: string;
}

function resolveSecret(name: string): string {
  const configured = process.env[name]?.trim();
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV !== "production") {
    return `${name.toLowerCase()}-development-secret`;
  }
  throw new HttpError(500, "youtube_not_configured", `${name} is not configured.`);
}

function resolveClientId(): string {
  return process.env.YOUTUBE_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim() || "";
}

function resolveClientSecret(): string {
  return process.env.YOUTUBE_CLIENT_SECRET?.trim() || process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
}

function resolveRedirectUri(): string {
  return process.env.YOUTUBE_REDIRECT_URI?.trim()
    || process.env.GOOGLE_YOUTUBE_REDIRECT_URI?.trim()
    || process.env.GOOGLE_REDIRECT_URI?.trim()
    || "";
}

function sanitizeReturnPath(value?: string): string {
  const path = value?.trim();
  return path?.startsWith("/") ? path : "/app/reels";
}

function encodeState(state: AuthState): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  const signature = createHmac("sha256", resolveSecret(STATE_SECRET_NAME)).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function decodeState(value: string): AuthState {
  const [payload, signature] = value.split(".", 2);
  if (!payload || !signature) {
    throw new HttpError(400, "invalid_youtube_state", "YouTube auth state is invalid.");
  }
  const expected = createHmac("sha256", resolveSecret(STATE_SECRET_NAME)).update(payload).digest("base64url");
  if (expected !== signature) {
    throw new HttpError(400, "invalid_youtube_state", "YouTube auth state signature is invalid.");
  }
  const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthState;
  if (!state.businessId || !state.userId || !state.issuedAt || Date.now() - state.issuedAt > MAX_STATE_AGE_MS) {
    throw new HttpError(400, "expired_youtube_state", "YouTube auth state has expired.");
  }
  return state;
}

function buildRedirectUrl(returnPath: string, status: "connected" | "error", message?: string): string {
  const origin = process.env.FRONTEND_ORIGIN?.trim() || "http://localhost:5173";
  const url = new URL(returnPath, origin);
  url.searchParams.set("youtube", status);
  if (message) {
    url.searchParams.set("message", message.slice(0, 160));
  }
  return url.toString();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new HttpError(502, "youtube_request_failed", payload.error?.message || "YouTube request failed.");
  }
  return payload;
}

function requireOAuthConfiguration(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = resolveClientId();
  const clientSecret = resolveClientSecret();
  const redirectUri = resolveRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new HttpError(
      500,
      "youtube_not_configured",
      "Configure YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REDIRECT_URI before connecting YouTube.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export async function createReelYouTubeAuthorizationUrl(
  principal: AuthenticatedPrincipal,
  input: { businessId: string; returnPath?: string },
): Promise<{ authorizationUrl: string }> {
  await enforceWorkspaceWriteAccess({ principal, businessId: input.businessId, featureKey: "visual_generation" });
  if (!principal.userId) {
    throw new HttpError(401, "auth_required", "Authenticated user context is incomplete.");
  }
  const { clientId, redirectUri } = requireOAuthConfiguration();
  const url = new URL(GOOGLE_AUTHORIZATION_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", encodeState({
    businessId: input.businessId,
    userId: principal.userId,
    issuedAt: Date.now(),
    returnPath: sanitizeReturnPath(input.returnPath),
  }));
  return { authorizationUrl: url.toString() };
}

export async function handleReelYouTubeOAuthCallback(input: {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}): Promise<string> {
  let state: AuthState | undefined;
  try {
    state = input.state ? decodeState(input.state) : undefined;
  } catch {
    return buildRedirectUrl("/app/reels", "error", "invalid_state");
  }

  if (input.error || !input.code || !state) {
    return buildRedirectUrl(state?.returnPath ?? "/app/reels", "error", input.errorDescription || input.error || "connect_failed");
  }

  try {
    const { clientId, clientSecret, redirectUri } = requireOAuthConfiguration();
    const tokenPayload = await fetchJson<YouTubeTokenResponse>(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: input.code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenPayload.access_token) {
      throw new HttpError(502, "youtube_token_exchange_failed", "Google did not return a usable YouTube token.");
    }

    const channelPayload = await fetchJson<YouTubeChannelResponse>(
      `${YOUTUBE_API_BASE_URL}/channels?part=snippet&mine=true`,
      { headers: { Authorization: `Bearer ${tokenPayload.access_token}` } },
    );
    const channel = channelPayload.items?.[0];
    if (!channel?.id) {
      throw new HttpError(400, "youtube_channel_not_found", "The connected Google account does not have a YouTube channel.");
    }

    await queryDb(
      `
        insert into reel_youtube_connections (
          business_id, user_id, channel_id, channel_title, access_token, refresh_token,
          token_expires_at, scope, status, metadata_json
        ) values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::timestamptz, $8::text[], 'connected', $9::jsonb)
        on conflict (business_id) do update set
          user_id = excluded.user_id,
          channel_id = excluded.channel_id,
          channel_title = excluded.channel_title,
          access_token = excluded.access_token,
          refresh_token = coalesce(excluded.refresh_token, reel_youtube_connections.refresh_token),
          token_expires_at = excluded.token_expires_at,
          scope = excluded.scope,
          status = 'connected',
          updated_at = now()
      `,
      [
        state.businessId,
        state.userId,
        channel.id,
        channel.snippet?.title ?? null,
        encryptSecret(tokenPayload.access_token, ENCRYPTION_SECRET_NAME),
        tokenPayload.refresh_token ? encryptSecret(tokenPayload.refresh_token, ENCRYPTION_SECRET_NAME) : null,
        tokenPayload.expires_in ? new Date(Date.now() + tokenPayload.expires_in * 1000) : null,
        tokenPayload.scope?.split(/\s+/).filter(Boolean) ?? YOUTUBE_SCOPES,
        JSON.stringify({ connectedVia: "oauth_callback" }),
      ],
    );
    logInfo("Connected YouTube channel.", { businessId: state.businessId, channelId: channel.id });
    return buildRedirectUrl(state.returnPath ?? "/app/reels", "connected");
  } catch (error) {
    logWarn("YouTube OAuth callback failed.", { message: error instanceof Error ? error.message : "Unknown error" });
    return buildRedirectUrl(state.returnPath ?? "/app/reels", "error", "connect_failed");
  }
}

export async function getReelYouTubeConnection(businessId: string): Promise<ReelYouTubeConnection> {
  const result = await queryDb<ReelYouTubeConnectionRow>(
    `select business_id, channel_id, channel_title, account_email, status from reel_youtube_connections where business_id = $1::uuid`,
    [businessId],
  );
  const row = result.rows[0];
  return row
    ? {
        connected: row.status === "connected",
        channelId: row.channel_id,
        channelTitle: row.channel_title ?? undefined,
        accountEmail: row.account_email ?? undefined,
        status: row.status,
      }
    : { connected: false };
}

async function loadConnection(businessId: string): Promise<ReelYouTubeConnectionRow> {
  const result = await queryDb<ReelYouTubeConnectionRow>(
    `select business_id, channel_id, channel_title, account_email, access_token, refresh_token, token_expires_at, scope, status from reel_youtube_connections where business_id = $1::uuid`,
    [businessId],
  );
  const row = result.rows[0];
  if (!row || row.status !== "connected") {
    throw new HttpError(400, "youtube_not_connected", "Connect a YouTube channel before publishing.");
  }
  return row;
}

async function accessTokenForConnection(row: ReelYouTubeConnectionRow): Promise<string> {
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60_000) {
    return decryptSecret(row.access_token, ENCRYPTION_SECRET_NAME);
  }
  if (!row.refresh_token) {
    throw new HttpError(400, "youtube_reconnect_required", "Reconnect YouTube before publishing again.");
  }
  const { clientId, clientSecret } = requireOAuthConfiguration();
  const refreshPayload = await fetchJson<YouTubeTokenResponse>(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: decryptSecret(row.refresh_token, ENCRYPTION_SECRET_NAME),
    }),
  });
  if (!refreshPayload.access_token) {
    throw new HttpError(400, "youtube_reconnect_required", "Reconnect YouTube before publishing again.");
  }
  await queryDb(
    `update reel_youtube_connections set access_token = $2, token_expires_at = $3::timestamptz, updated_at = now() where business_id = $1::uuid`,
    [row.business_id, encryptSecret(refreshPayload.access_token, ENCRYPTION_SECRET_NAME), refreshPayload.expires_in ? new Date(Date.now() + refreshPayload.expires_in * 1000) : null],
  );
  return refreshPayload.access_token;
}

function buildDescription(project: Awaited<ReturnType<typeof getReelProject>>): string {
  return [project.storyboard.caption, project.storyboard.hashtags.join(" "), "", "Created with FounderContent AI."]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 5000);
}

async function uploadVideo(input: {
  accessToken: string;
  title: string;
  description: string;
  tags: string[];
  visibility: ReelYouTubeVisibility;
  bytes: Buffer;
}): Promise<{ videoId: string }> {
  const boundary = `sudo-${Date.now().toString(36)}`;
  const metadata = JSON.stringify({
    snippet: {
      title: input.title.slice(0, 100),
      description: input.description,
      tags: input.tags.map((tag) => tag.replace(/^#/, "")).filter(Boolean).slice(0, 30),
      categoryId: "27",
    },
    status: { privacyStatus: input.visibility, selfDeclaredMadeForKids: false },
  });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`),
    input.bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const payload = await fetchJson<{ id?: string }>(YOUTUBE_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(body.byteLength),
    },
    body,
  });
  if (!payload.id) {
    throw new HttpError(502, "youtube_upload_failed", "YouTube did not return a video ID.");
  }
  return { videoId: payload.id };
}

export async function publishReelToYouTube(input: {
  businessId: string;
  projectId: string;
  visibility?: ReelYouTubeVisibility;
}): Promise<ReelYouTubePublication> {
  const visibility = input.visibility ?? "public";
  const loaded = await loadReelProjectForPublish(input.businessId, input.projectId);
  if (!loaded || loaded.project.workflowStage !== "reviewed") {
    throw new HttpError(409, "youtube_publish_requires_review", "Mark the rendered reel as reviewed before publishing.");
  }
  if (loaded.project.status !== "ready" || !loaded.videoStorageKey) {
    throw new HttpError(409, "youtube_publish_requires_video", "A completed render is required before publishing.");
  }

  const connection = await loadConnection(input.businessId);
  const accessToken = await accessTokenForConnection(connection);
  const publication = await uploadVideo({
    accessToken,
    title: loaded.project.storyboard.title,
    description: buildDescription(loaded.project),
    tags: loaded.project.storyboard.hashtags,
    visibility,
    bytes: await readReelMedia(loaded.videoStorageKey),
  });
  const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(publication.videoId)}`;
  const publishedAt = new Date().toISOString();
  await queryDb(
    `
      insert into reel_youtube_publications (project_id, business_id, video_id, visibility, title, description, video_url, published_at)
      values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz)
      on conflict (project_id) do update set
        video_id = excluded.video_id, visibility = excluded.visibility, title = excluded.title,
        description = excluded.description, video_url = excluded.video_url, published_at = excluded.published_at
    `,
    [input.projectId, input.businessId, publication.videoId, visibility, loaded.project.storyboard.title, buildDescription(loaded.project), videoUrl, publishedAt],
  );
  await markReelPublished(input.businessId, input.projectId);
  return { videoId: publication.videoId, videoUrl, visibility, publishedAt };
}
