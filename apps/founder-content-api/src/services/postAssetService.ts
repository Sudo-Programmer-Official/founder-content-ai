import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import type {
  CreateMediaUploadUrlRequest,
  CreateMediaUploadUrlResponse,
  CreatePostAssetRequest,
  CreatePostAssetResponse,
  DeletePostAssetResponse,
  ListPostAssetsResponse,
  PostAsset,
  PostAssetSource,
  PostAssetStatus,
  PostAssetType,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireBusinessMembership } from "./authBusinessService.ts";
import { queryDb } from "./db/client.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "./governanceService.ts";
import { HttpError } from "../utils/http.ts";
import { logInfo, logWarn } from "../utils/logger.ts";
import {
  releaseWorkspacePostAssetUsage,
  syncWorkspaceAssetFromPostAsset,
} from "./workspaceAssetService.ts";

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface PostAssetRow extends QueryResultRow {
  id: string;
  post_id: string;
  business_id: string;
  type: PostAssetType;
  source: PostAssetSource;
  storage_key: string;
  storage_url: string;
  mime_type: string;
  size_bytes: string | number;
  order_index: number;
  status: PostAssetStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ContentPostRow extends QueryResultRow {
  id: string;
  business_id: string | null;
  content_type: string;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);
const DEFAULT_S3_UPLOAD_TTL_SECONDS = 900;
const DEFAULT_S3_PREVIEW_TTL_SECONDS = 3600;
const MAX_IMAGE_COUNT = 10;

function resolveAwsRegion(): string {
  return process.env.AWS_REGION?.trim() || "us-east-1";
}

function resolveAwsCredentials(): AwsCredentials | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.AWS_SESSION_TOKEN?.trim() || undefined,
  };
}

function resolveMediaBucket(): string {
  const bucket = process.env.S3_MEDIA_BUCKET?.trim();

  if (!bucket) {
    throw new HttpError(500, "media_storage_not_configured", "S3_MEDIA_BUCKET is not configured.");
  }

  return bucket;
}

function resolveMediaPrefix(): string {
  return process.env.S3_MEDIA_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "workspaces";
}

function resolveUploadTtlSeconds(): number {
  const value = Number(process.env.S3_PRESIGNED_UPLOAD_TTL_SECONDS ?? DEFAULT_S3_UPLOAD_TTL_SECONDS);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 604800) : DEFAULT_S3_UPLOAD_TTL_SECONDS;
}

function resolvePreviewTtlSeconds(): number {
  return DEFAULT_S3_PREVIEW_TTL_SECONDS;
}

function resolveMaxImageBytes(): number {
  const value = Number(process.env.S3_MAX_IMAGE_BYTES ?? 5242880);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5242880;
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function toNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function toDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeS3Path(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeRfc3986(segment))
    .join("/");
}

function serializeCanonicalQuery(parameters: Record<string, string>): string {
  return Object.entries(parameters)
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort((left, right) => {
      if (left[0] === right[0]) {
        return left[1].localeCompare(right[1]);
      }

      return left[0].localeCompare(right[0]);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function createS3PresignedUrl(input: {
  method: "GET" | "PUT";
  key: string;
  expiresInSeconds: number;
  contentType?: string;
}): string {
  const credentials = resolveAwsCredentials();

  if (!credentials) {
    throw new HttpError(
      500,
      "media_storage_not_configured",
      "AWS access key and secret are required for S3 media uploads.",
    );
  }

  const region = resolveAwsRegion();
  const bucket = resolveMediaBucket();
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const path = `/${encodeS3Path(input.key)}`;
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = toDateStamp(now);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const signedHeaders = input.contentType ? "content-type;host" : "host";
  const queryParameters: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${credentials.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };

  if (credentials.sessionToken) {
    queryParameters["X-Amz-Security-Token"] = credentials.sessionToken;
  }

  const canonicalQuery = serializeCanonicalQuery(queryParameters);
  const canonicalHeaders = input.contentType
    ? `content-type:${input.contentType}\nhost:${host}\n`
    : `host:${host}\n`;
  const canonicalRequest = [
    input.method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, dateStamp), region), "s3"),
    "aws4_request",
  );
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function normalizeMimeType(value: string): string {
  return value.trim().toLowerCase();
}

function inferAssetType(mimeType: string): PostAssetType {
  if (ALLOWED_IMAGE_TYPES.has(mimeType)) {
    return "image";
  }

  throw new HttpError(400, "unsupported_media_type", "Only JPG, PNG, and GIF images are supported right now.");
}

function resolveFileExtension(mimeType: string, fileName?: string): string {
  const fromName = fileName?.trim().split(".").pop()?.toLowerCase();

  if (fromName && /^[a-z0-9]+$/i.test(fromName)) {
    return fromName;
  }

  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

function validateImageInput(mimeType: string, sizeBytes?: number): void {
  inferAssetType(mimeType);

  if (typeof sizeBytes === "number" && sizeBytes > resolveMaxImageBytes()) {
    throw new HttpError(
      400,
      "media_too_large",
      `Images must be ${Math.floor(resolveMaxImageBytes() / 1024 / 1024)} MB or smaller.`,
    );
  }
}

function buildStorageKey(input: {
  businessId: string;
  postId: string;
  mimeType: string;
  fileName?: string;
}): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const randomId = crypto.randomBytes(4).toString("hex");
  const extension = resolveFileExtension(input.mimeType, input.fileName);

  return [
    resolveMediaPrefix(),
    input.businessId,
    "posts",
    input.postId,
    "original",
    `${timestamp}_${randomId}.${extension}`,
  ].join("/");
}

function buildStorageUrl(storageKey: string): string {
  return `s3://${resolveMediaBucket()}/${storageKey}`;
}

function buildPreviewUrl(storageKey: string): string | undefined {
  try {
    return createS3PresignedUrl({
      method: "GET",
      key: storageKey,
      expiresInSeconds: resolvePreviewTtlSeconds(),
    });
  } catch (error) {
    logWarn("Unable to build post asset preview URL.", {
      storageKey,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return undefined;
  }
}

function mapPostAsset(row: PostAssetRow, includePreviewUrl = false): PostAsset {
  return {
    id: row.id,
    businessId: row.business_id,
    postId: row.post_id,
    type: row.type,
    source: row.source,
    storageKey: row.storage_key,
    storageUrl: row.storage_url,
    mimeType: row.mime_type,
    sizeBytes: toNumber(row.size_bytes),
    orderIndex: row.order_index,
    status: row.status,
    previewUrl: includePreviewUrl ? buildPreviewUrl(row.storage_key) : undefined,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

async function ensureContentPostOwnership(businessId: string, postId: string): Promise<void> {
  const result = await queryDb<ContentPostRow>(
    `
      select id, business_id, content_type
      from content_assets
      where id = $1
        and business_id = $2
      limit 1
    `,
    [postId, businessId],
  );

  const row = result.rows[0];

  if (!row || row.content_type !== "post") {
    throw new HttpError(404, "post_not_found", "Post draft not found for this workspace.");
  }
}

async function countPostAssets(postId: string): Promise<number> {
  const result = await queryDb<{ total: string | number }>(
    `
      select count(*)::int as total
      from post_assets
      where post_id = $1
        and status <> 'failed'
    `,
    [postId],
  );

  return toNumber(result.rows[0]?.total ?? 0);
}

async function resolveNextOrderIndex(postId: string): Promise<number> {
  const result = await queryDb<{ next_order_index: string | number | null }>(
    `
      select coalesce(max(order_index) + 1, 0) as next_order_index
      from post_assets
      where post_id = $1
    `,
    [postId],
  );

  return toNumber(result.rows[0]?.next_order_index ?? 0);
}

async function loadPostAssetRow(
  assetId: string,
  businessId: string,
): Promise<PostAssetRow | null> {
  const result = await queryDb<PostAssetRow>(
    `
      select
        id,
        post_id,
        business_id,
        type,
        source,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        order_index,
        status,
        created_at,
        updated_at
      from post_assets
      where id = $1
        and business_id = $2
      limit 1
    `,
    [assetId, businessId],
  );

  return result.rows[0] ?? null;
}

export async function createMediaUploadUrl(
  principal: AuthenticatedPrincipal,
  input: CreateMediaUploadUrlRequest,
): Promise<CreateMediaUploadUrlResponse> {
  const businessId = input.businessId.trim();
  const postId = input.postId.trim();
  const mimeType = normalizeMimeType(input.fileType);

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);
  await ensureContentPostOwnership(businessId, postId);
  validateImageInput(mimeType, input.sizeBytes);

  if ((await countPostAssets(postId)) >= MAX_IMAGE_COUNT) {
    throw new HttpError(
      400,
      "post_asset_limit_reached",
      `A post can have up to ${MAX_IMAGE_COUNT} images right now.`,
    );
  }

  const storageKey = buildStorageKey({
    businessId,
    postId,
    mimeType,
    fileName: input.fileName,
  });
  const expiresAt = new Date(Date.now() + resolveUploadTtlSeconds() * 1000).toISOString();

  return {
    uploadUrl: createS3PresignedUrl({
      method: "PUT",
      key: storageKey,
      expiresInSeconds: resolveUploadTtlSeconds(),
      contentType: mimeType,
    }),
    storageKey,
    storageUrl: buildStorageUrl(storageKey),
    expiresAt,
  };
}

export async function createPostAsset(
  principal: AuthenticatedPrincipal,
  input: CreatePostAssetRequest,
): Promise<CreatePostAssetResponse> {
  const businessId = input.businessId.trim();
  const postId = input.postId.trim();
  const mimeType = normalizeMimeType(input.mimeType);
  const type = input.type ?? inferAssetType(mimeType);
  const source = input.source ?? "upload";

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);
  await ensureContentPostOwnership(businessId, postId);
  validateImageInput(mimeType, input.sizeBytes);

  if ((await countPostAssets(postId)) >= MAX_IMAGE_COUNT) {
    throw new HttpError(
      400,
      "post_asset_limit_reached",
      `A post can have up to ${MAX_IMAGE_COUNT} images right now.`,
    );
  }

  const result = await queryDb<PostAssetRow>(
    `
      insert into post_assets (
        post_id,
        business_id,
        type,
        source,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        order_index,
        status
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        'ready'
      )
      on conflict (post_id, storage_key)
      do update set
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        updated_at = now()
      returning
        id,
        post_id,
        business_id,
        type,
        source,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        order_index,
        status,
        created_at,
        updated_at
    `,
    [
      postId,
      businessId,
      type,
      source,
      input.storageKey.trim(),
      input.storageUrl.trim(),
      mimeType,
      input.sizeBytes,
      typeof input.orderIndex === "number" ? input.orderIndex : await resolveNextOrderIndex(postId),
    ],
  );

  const asset = mapPostAsset(result.rows[0], true);
  void syncWorkspaceAssetFromPostAsset({
    businessId,
    postId,
    postAssetId: asset.id,
    storageKey: asset.storageKey,
    storageUrl: asset.storageUrl,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
  });
  logInfo("Created post asset metadata row.", {
    assetId: asset.id,
    postId,
    businessId,
    mimeType,
  });

  return { asset };
}

export async function listPostAssets(
  principal: AuthenticatedPrincipal,
  businessId: string,
  postId: string,
): Promise<ListPostAssetsResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);
  await ensureContentPostOwnership(businessId, postId);

  const result = await queryDb<PostAssetRow>(
    `
      select
        id,
        post_id,
        business_id,
        type,
        source,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        order_index,
        status,
        created_at,
        updated_at
      from post_assets
      where business_id = $1
        and post_id = $2
      order by order_index asc, created_at asc
    `,
    [businessId, postId],
  );

  return {
    assets: result.rows.map((row) => mapPostAsset(row, true)),
  };
}

export async function deletePostAsset(
  principal: AuthenticatedPrincipal,
  businessId: string,
  assetId: string,
): Promise<DeletePostAssetResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  const asset = await loadPostAssetRow(assetId, businessId);

  if (!asset) {
    throw new HttpError(404, "post_asset_not_found", "Post asset not found.");
  }

  await queryDb(
    `
      delete from post_assets
      where id = $1
    `,
    [assetId],
  );

  logInfo("Deleted post asset metadata row.", {
    assetId,
    postId: asset.post_id,
    businessId,
  });
  void releaseWorkspacePostAssetUsage({
    businessId,
    postId: asset.post_id,
    storageKey: asset.storage_key,
    postAssetId: assetId,
  });

  return {
    deletedAssetId: assetId,
  };
}

export async function loadPostAssetsByPostIds(
  postIds: string[],
  options?: { includePreviewUrls?: boolean },
): Promise<Map<string, PostAsset[]>> {
  if (postIds.length === 0) {
    return new Map();
  }

  const result = await queryDb<PostAssetRow>(
    `
      select
        id,
        post_id,
        business_id,
        type,
        source,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        order_index,
        status,
        created_at,
        updated_at
      from post_assets
      where post_id::text = any($1::text[])
      order by post_id asc, order_index asc, created_at asc
    `,
    [postIds],
  );

  const grouped = new Map<string, PostAsset[]>();

  for (const row of result.rows) {
    const bucket = grouped.get(row.post_id) ?? [];
    bucket.push(mapPostAsset(row, Boolean(options?.includePreviewUrls)));
    grouped.set(row.post_id, bucket);
  }

  return grouped;
}

export async function loadReadyPostImageAssets(
  businessId: string,
  postId: string,
): Promise<PostAsset[]> {
  const result = await queryDb<PostAssetRow>(
    `
      select
        id,
        post_id,
        business_id,
        type,
        source,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        order_index,
        status,
        created_at,
        updated_at
      from post_assets
      where business_id = $1
        and post_id = $2
        and status = 'ready'
        and type = 'image'
      order by order_index asc, created_at asc
    `,
    [businessId, postId],
  );

  return result.rows.map((row) => mapPostAsset(row, false));
}

export async function downloadPostAssetBytes(asset: Pick<PostAsset, "storageKey" | "mimeType">): Promise<Buffer> {
  const downloadUrl = createS3PresignedUrl({
    method: "GET",
    key: asset.storageKey,
    expiresInSeconds: 300,
  });
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new HttpError(
      502,
      "post_asset_download_failed",
      "Unable to load the uploaded media asset from storage.",
    );
  }

  const contentType = response.headers.get("content-type")?.trim().toLowerCase() || asset.mimeType;

  if (contentType !== asset.mimeType) {
    logWarn("Downloaded post asset content type differed from metadata.", {
      storageKey: asset.storageKey,
      expectedMimeType: asset.mimeType,
      receivedMimeType: contentType,
    });
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
