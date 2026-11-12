import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPostAssetDownloadUrl, uploadPostAssetBytesToStorage } from "../postAssetService.ts";
import { HttpError } from "../../utils/http.ts";
import { logWarn } from "../../utils/logger.ts";

/**
 * Rendered reels go to the shared S3 media bucket when it is configured.
 * Without S3 (local development) they are written under the API's .data dir and
 * served by a signed, expiring URL, because <video> tags cannot send auth headers.
 * The local fallback only works when the worker and API share a disk.
 */

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MEDIA_URL_TTL_SECONDS = 6 * 60 * 60;
let hasWarnedAboutSigningSecret = false;

export function isReelS3StorageConfigured(): boolean {
  return Boolean(
    process.env.S3_MEDIA_BUCKET?.trim() && process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim(),
  );
}

function isProductionMediaRuntime(): boolean {
  const serviceName = process.env.RENDER_SERVICE_NAME?.trim();
  return process.env.NODE_ENV === "production"
    || serviceName === "foundercontent-api"
    || serviceName === "foundercontent-reel-worker"
    || serviceName === "foundercontent-worker"
    || serviceName === "founder-content-worker";
}

/** Render services must share S3; their local filesystems are isolated. */
export function assertReelMediaStorageConfiguredForRuntime(): void {
  if (isProductionMediaRuntime() && !isReelS3StorageConfigured()) {
    throw new HttpError(
      500,
      "reel_media_storage_not_configured",
      "Production Reel Studio requires S3_MEDIA_BUCKET, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY on the API and Reel Worker services.",
    );
  }
}

function resolveLocalMediaDir(): string {
  return process.env.REEL_LOCAL_MEDIA_DIR?.trim() || path.join(API_ROOT, ".data", "reel-media");
}

/** Local media lives on this machine's disk, so links default to this API process rather than the public host. */
function resolveLocalMediaBaseUrl(): string {
  return (process.env.API_PUBLIC_BASE_URL?.trim() || `http://localhost:${process.env.PORT?.trim() || "3001"}/api`).replace(/\/$/, "");
}

function resolveMediaPrefix(): string {
  return process.env.S3_MEDIA_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "workspaces";
}

function resolveSigningSecret(): string {
  const secret = process.env.REEL_MEDIA_SIGNING_SECRET?.trim() || process.env.SOCIAL_AUTH_STATE_SECRET?.trim();

  if (secret) {
    return secret;
  }

  if (!hasWarnedAboutSigningSecret) {
    hasWarnedAboutSigningSecret = true;
    logWarn("REEL_MEDIA_SIGNING_SECRET is not set; using an insecure development secret for local reel media URLs.");
  }

  return "reel-studio-local-dev-secret";
}

export function buildReelStorageKey(businessId: string, projectId: string, fileName: string): string {
  return `${resolveMediaPrefix()}/${businessId}/reels/${projectId}/${fileName}`;
}

function resolveLocalPath(storageKey: string): string {
  const root = resolveLocalMediaDir();
  const fullPath = path.resolve(root, storageKey);

  if (!fullPath.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new HttpError(400, "invalid_media_key", "Invalid media key.");
  }

  return fullPath;
}

export async function storeReelMedia(input: { storageKey: string; bytes: Buffer; mimeType: string }): Promise<void> {
  assertReelMediaStorageConfiguredForRuntime();

  if (isReelS3StorageConfigured()) {
    await uploadPostAssetBytesToStorage(input);
    return;
  }

  const fullPath = resolveLocalPath(input.storageKey);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, input.bytes);
}

export async function readReelMedia(storageKey: string): Promise<Buffer> {
  if (!isReelS3StorageConfigured()) {
    return fs.readFile(resolveLocalPath(storageKey));
  }

  const url = createReelMediaUrl(storageKey);
  if (!url) {
    throw new HttpError(404, "reel_media_not_found", "Reel media is not available.");
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new HttpError(502, "reel_media_read_failed", "Unable to read the rendered reel from storage.");
  }
  return Buffer.from(await response.arrayBuffer());
}

function signLocalKey(storageKey: string, expiresAt: number): string {
  return crypto.createHmac("sha256", resolveSigningSecret()).update(`${storageKey}:${expiresAt}`).digest("hex");
}

export function createReelMediaUrl(storageKey: string | null | undefined): string | undefined {
  if (!storageKey) {
    return undefined;
  }

  if (isReelS3StorageConfigured()) {
    return createPostAssetDownloadUrl({ storageKey }, MEDIA_URL_TTL_SECONDS);
  }

  const expiresAt = Math.floor(Date.now() / 1000) + MEDIA_URL_TTL_SECONDS;
  const query = new URLSearchParams({
    key: storageKey,
    exp: String(expiresAt),
    sig: signLocalKey(storageKey, expiresAt),
  });
  return `${resolveLocalMediaBaseUrl()}/reel-studio/media?${query.toString()}`;
}

/** Validates a signed local media URL and returns the file path to stream. */
export function resolveSignedLocalReelMedia(query: { key?: unknown; exp?: unknown; sig?: unknown }): string {
  const storageKey = typeof query.key === "string" ? query.key : "";
  const expiresAt = Number(query.exp);
  const signature = typeof query.sig === "string" ? query.sig : "";

  if (!storageKey || !Number.isFinite(expiresAt) || !signature) {
    throw new HttpError(400, "invalid_media_url", "Media URL is incomplete.");
  }

  if (expiresAt < Date.now() / 1000) {
    throw new HttpError(410, "media_url_expired", "This media link has expired. Reload the page to get a fresh one.");
  }

  const expected = Buffer.from(signLocalKey(storageKey, expiresAt));
  const received = Buffer.from(signature);

  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw new HttpError(403, "invalid_media_signature", "Media URL signature is invalid.");
  }

  return resolveLocalPath(storageKey);
}
