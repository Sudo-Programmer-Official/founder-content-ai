import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import type {
  CreateWorkspaceAssetRequest,
  CreateWorkspaceAssetResponse,
  CreateWorkspaceAssetUploadUrlRequest,
  CreateWorkspaceAssetUploadUrlResponse,
  DeleteWorkspaceAssetResponse,
  DownloadWorkspaceAssetResponse,
  GetWorkspaceAssetResponse,
  RecordWorkspaceAssetUsageRequest,
  RecordWorkspaceAssetUsageResponse,
  WorkspaceAsset,
  WorkspaceAssetSourceType,
  WorkspaceAssetType,
  WorkspaceAssetUsage,
  WorkspaceAssetsQuery,
  WorkspaceAssetsResponse,
  WorkspaceBrandKitSummary,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireBusinessMembership } from "./authBusinessService.ts";
import { queryDb, withDbTransaction } from "./db/client.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "./governanceService.ts";
import { HttpError } from "../utils/http.ts";
import { logInfo, logWarn } from "../utils/logger.ts";

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface WorkspaceAssetRow extends QueryResultRow {
  id: string;
  business_id: string;
  created_by_user_id: string | null;
  asset_type: WorkspaceAssetType;
  source_type: WorkspaceAssetSourceType;
  source_reference_id: string | null;
  title: string | null;
  storage_key: string | null;
  storage_url: string;
  mime_type: string;
  size_bytes: string | number;
  tags: unknown;
  metadata: unknown;
  usage_count: string | number;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WorkspaceAssetUsageRow extends QueryResultRow {
  id: string;
  business_id: string;
  asset_id: string;
  usage_surface: WorkspaceAssetUsage["usageSurface"];
  reference_id: string | null;
  metadata: unknown;
  created_at: Date | string;
}

interface BrandKitRow extends QueryResultRow {
  id: string;
  business_id: string;
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  updated_at: Date | string;
}

interface WorkspaceBrandKitRow extends QueryResultRow {
  business_id: string;
  primary_color: string;
  secondary_color: string;
  logo_asset_id: string | null;
  logo_storage_key: string | null;
  logo_url: string | null;
  metadata: unknown;
  updated_at: Date | string;
}

const DEFAULT_S3_UPLOAD_TTL_SECONDS = 900;
const DEFAULT_S3_PREVIEW_TTL_SECONDS = 3600;
const DEFAULT_MAX_ASSET_BYTES = 10 * 1024 * 1024;
const ALLOWED_WORKSPACE_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "video/mp4",
  "application/pdf",
]);
const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);
const VIDEO_MIME_TYPES = new Set(["video/mp4"]);

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function toNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMimeType(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function mapWorkspaceAsset(row: WorkspaceAssetRow, includePreviewUrl = true): WorkspaceAsset {
  return {
    id: row.id,
    businessId: row.business_id,
    createdByUserId: row.created_by_user_id ?? undefined,
    assetType: row.asset_type,
    sourceType: row.source_type,
    sourceReferenceId: row.source_reference_id ?? undefined,
    title: row.title ?? undefined,
    storageKey: row.storage_key ?? undefined,
    storageUrl: row.storage_url,
    previewUrl: includePreviewUrl ? buildWorkspaceAssetPreviewUrl(row.storage_key, row.storage_url) : undefined,
    mimeType: row.mime_type,
    sizeBytes: toNumber(row.size_bytes),
    tags: normalizeStringArray(row.tags),
    metadata: normalizeRecord(row.metadata),
    usageCount: toNumber(row.usage_count),
    isActive: row.is_active,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapWorkspaceAssetUsage(row: WorkspaceAssetUsageRow): WorkspaceAssetUsage {
  return {
    id: row.id,
    businessId: row.business_id,
    assetId: row.asset_id,
    usageSurface: row.usage_surface,
    referenceId: row.reference_id ?? undefined,
    metadata: normalizeRecord(row.metadata),
    createdAt: toIsoString(row.created_at),
  };
}

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

function resolveMaxAssetBytes(): number {
  const value = Number(process.env.S3_MAX_ASSET_BYTES ?? DEFAULT_MAX_ASSET_BYTES);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_ASSET_BYTES;
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
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function buildStorageUrl(storageKey: string): string {
  return `s3://${resolveMediaBucket()}/${storageKey}`;
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
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "video/mp4":
      return "mp4";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

function inferWorkspaceAssetType(mimeType: string, requestedType?: WorkspaceAssetType): WorkspaceAssetType {
  if (requestedType === "document") {
    if (mimeType !== "application/pdf") {
      throw new HttpError(400, "unsupported_media_type", "Documents must be uploaded as PDFs right now.");
    }

    return "document";
  }

  if (!ALLOWED_WORKSPACE_UPLOAD_TYPES.has(mimeType)) {
    throw new HttpError(
      400,
      "unsupported_media_type",
      "Only JPG, PNG, GIF, WEBP, SVG, MP4, and PDF files are supported right now.",
    );
  }

  if (mimeType === "application/pdf") {
    return "document";
  }

  if (VIDEO_MIME_TYPES.has(mimeType)) {
    if (requestedType && requestedType !== "video") {
      throw new HttpError(400, "unsupported_media_type", "Video uploads must use the video asset type.");
    }

    return "video";
  }

  if (requestedType === "video") {
    throw new HttpError(400, "unsupported_media_type", "Video assets must be uploaded as MP4 files.");
  }

  return requestedType ?? "image";
}

function validateWorkspaceAssetInput(mimeType: string, sizeBytes?: number, requestedType?: WorkspaceAssetType): WorkspaceAssetType {
  const assetType = inferWorkspaceAssetType(mimeType, requestedType);

  if (typeof sizeBytes === "number" && sizeBytes > resolveMaxAssetBytes()) {
    throw new HttpError(
      400,
      "media_too_large",
      `Assets must be ${Math.floor(resolveMaxAssetBytes() / 1024 / 1024)} MB or smaller.`,
    );
  }

  return assetType;
}

function buildWorkspaceAssetStorageKey(input: {
  businessId: string;
  mimeType: string;
  fileName?: string;
  assetType: WorkspaceAssetType;
}): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const randomId = crypto.randomBytes(4).toString("hex");
  const extension = resolveFileExtension(input.mimeType, input.fileName);

  return [
    resolveMediaPrefix(),
    input.businessId,
    "assets",
    input.assetType,
    `${timestamp}_${randomId}.${extension}`,
  ].join("/");
}

function buildWorkspaceAssetPreviewUrl(storageKey: string | null, storageUrl: string): string | undefined {
  if (!storageKey) {
    return storageUrl;
  }

  try {
    return createS3PresignedUrl({
      method: "GET",
      key: storageKey,
      expiresInSeconds: resolvePreviewTtlSeconds(),
    });
  } catch (error) {
    logWarn("Unable to build workspace asset preview URL.", {
      storageKey,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return storageUrl;
  }
}

export function resolveWorkspaceAssetPreviewUrl(
  storageKey: string | null,
  storageUrl: string,
): string | undefined {
  return buildWorkspaceAssetPreviewUrl(storageKey, storageUrl);
}

function buildWorkspaceAssetDownloadUrl(storageKey: string | null, storageUrl: string): string {
  if (!storageKey) {
    return storageUrl;
  }

  try {
    return createS3PresignedUrl({
      method: "GET",
      key: storageKey,
      expiresInSeconds: resolvePreviewTtlSeconds(),
    });
  } catch (error) {
    logWarn("Unable to build workspace asset download URL.", {
      storageKey,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return storageUrl;
  }
}

function inferMimeTypeFromUrl(url: string): string {
  const normalized = url.toLowerCase();

  if (normalized.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (normalized.endsWith(".png")) {
    return "image/png";
  }

  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (normalized.endsWith(".gif")) {
    return "image/gif";
  }

  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }

  if (normalized.endsWith(".pdf")) {
    return "application/pdf";
  }

  if (normalized.endsWith(".mp4")) {
    return "video/mp4";
  }

  return "image/png";
}

function extractStorageKey(storageUrl: string): string | null {
  if (storageUrl.startsWith("s3://")) {
    const parts = storageUrl.replace(/^s3:\/\//, "").split("/");
    parts.shift();
    return parts.join("/") || null;
  }

  const mediaBucket = process.env.S3_MEDIA_BUCKET?.trim();

  if (!mediaBucket) {
    return null;
  }

  try {
    const parsed = new URL(storageUrl);

    if (parsed.hostname.startsWith(`${mediaBucket}.s3.`)) {
      return parsed.pathname.replace(/^\/+/, "") || null;
    }
  } catch {
    return null;
  }

  return null;
}

function resolveWorkspaceAssetFileName(asset: Pick<WorkspaceAsset, "id" | "assetType" | "mimeType" | "title">): string {
  const extension = inferMimeTypeFromUrl(`file.${asset.mimeType.split("/").pop() ?? "bin"}`) === asset.mimeType
    ? asset.mimeType.split("/").pop() ?? "bin"
    : asset.mimeType === "image/jpeg"
      ? "jpg"
      : asset.mimeType === "image/png"
        ? "png"
        : asset.mimeType === "image/gif"
          ? "gif"
          : asset.mimeType === "image/webp"
            ? "webp"
            : asset.mimeType === "image/svg+xml"
              ? "svg"
              : asset.mimeType === "application/pdf"
                ? "pdf"
                : asset.mimeType === "video/mp4"
                  ? "mp4"
                  : "bin";
  const safeTitle = asset.title?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safeTitle || `${asset.assetType}-${asset.id}`}.${extension}`;
}

async function loadWorkspaceAssetRowById(assetId: string, businessId: string): Promise<WorkspaceAssetRow | null> {
  const result = await queryDb<WorkspaceAssetRow>(
    `
      select
        id,
        business_id,
        created_by_user_id,
        asset_type,
        source_type,
        source_reference_id,
        title,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        tags,
        metadata,
        usage_count,
        is_active,
        created_at,
        updated_at
      from workspace_assets
      where id = $1
        and business_id = $2
      limit 1
    `,
    [assetId, businessId],
  );

  return result.rows[0] ?? null;
}

async function loadWorkspaceAssetRowByStorageKey(
  businessId: string,
  storageKey: string,
): Promise<WorkspaceAssetRow | null> {
  const result = await queryDb<WorkspaceAssetRow>(
    `
      select
        id,
        business_id,
        created_by_user_id,
        asset_type,
        source_type,
        source_reference_id,
        title,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        tags,
        metadata,
        usage_count,
        is_active,
        created_at,
        updated_at
      from workspace_assets
      where business_id = $1
        and storage_key = $2
      limit 1
    `,
    [businessId, storageKey],
  );

  return result.rows[0] ?? null;
}

async function loadWorkspaceAssetRowBySourceReference(
  businessId: string,
  sourceType: WorkspaceAssetSourceType,
  sourceReferenceId: string,
): Promise<WorkspaceAssetRow | null> {
  const result = await queryDb<WorkspaceAssetRow>(
    `
      select
        id,
        business_id,
        created_by_user_id,
        asset_type,
        source_type,
        source_reference_id,
        title,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        tags,
        metadata,
        usage_count,
        is_active,
        created_at,
        updated_at
      from workspace_assets
      where business_id = $1
        and source_type = $2
        and source_reference_id = $3
      limit 1
    `,
    [businessId, sourceType, sourceReferenceId],
  );

  return result.rows[0] ?? null;
}

async function refreshWorkspaceAssetUsageCount(assetId: string): Promise<void> {
  await queryDb(
    `
      update workspace_assets
      set
        usage_count = (
          select count(*)::int
          from workspace_asset_usages
          where asset_id = $1
        ),
        updated_at = now()
      where id = $1
    `,
    [assetId],
  );
}

async function insertWorkspaceAssetUsage(input: {
  businessId: string;
  assetId: string;
  usageSurface: WorkspaceAssetUsage["usageSurface"];
  referenceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<WorkspaceAssetUsageRow> {
  const result = await queryDb<WorkspaceAssetUsageRow>(
    `
      insert into workspace_asset_usages (
        business_id,
        asset_id,
        usage_surface,
        reference_id,
        metadata
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb
      )
      on conflict (asset_id, usage_surface, reference_id)
      do update set
        metadata = excluded.metadata
      returning
        id,
        business_id,
        asset_id,
        usage_surface,
        reference_id,
        metadata,
        created_at
    `,
    [
      input.businessId,
      input.assetId,
      input.usageSurface,
      input.referenceId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  await refreshWorkspaceAssetUsageCount(input.assetId);
  return result.rows[0];
}

async function deleteWorkspaceAssetUsageByReference(input: {
  assetId: string;
  usageSurface: WorkspaceAssetUsage["usageSurface"];
  referenceId: string;
}): Promise<void> {
  await queryDb(
    `
      delete from workspace_asset_usages
      where asset_id = $1
        and usage_surface = $2
        and reference_id = $3
    `,
    [input.assetId, input.usageSurface, input.referenceId],
  );

  await refreshWorkspaceAssetUsageCount(input.assetId);
}

async function createWorkspaceAssetRecord(input: {
  businessId: string;
  createdByUserId?: string;
  assetType: WorkspaceAssetType;
  sourceType: WorkspaceAssetSourceType;
  sourceReferenceId?: string;
  title?: string;
  storageKey?: string | null;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  isActive?: boolean;
}): Promise<WorkspaceAssetRow> {
  const result = await queryDb<WorkspaceAssetRow>(
    `
      insert into workspace_assets (
        business_id,
        created_by_user_id,
        asset_type,
        source_type,
        source_reference_id,
        title,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        tags,
        metadata,
        is_active
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
        $10,
        $11::jsonb,
        $12::jsonb,
        $13
      )
      returning
        id,
        business_id,
        created_by_user_id,
        asset_type,
        source_type,
        source_reference_id,
        title,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        tags,
        metadata,
        usage_count,
        is_active,
        created_at,
        updated_at
    `,
    [
      input.businessId,
      input.createdByUserId ?? null,
      input.assetType,
      input.sourceType,
      input.sourceReferenceId ?? null,
      input.title ?? null,
      input.storageKey ?? null,
      input.storageUrl,
      input.mimeType,
      input.sizeBytes,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.metadata ?? {}),
      input.isActive ?? true,
    ],
  );

  return result.rows[0];
}

async function updateWorkspaceAssetRecord(
  assetId: string,
  input: {
    assetType: WorkspaceAssetType;
    sourceType: WorkspaceAssetSourceType;
    sourceReferenceId?: string;
    title?: string;
    storageKey?: string | null;
    storageUrl: string;
    mimeType: string;
    sizeBytes: number;
    tags?: string[];
    metadata?: Record<string, unknown>;
    isActive?: boolean;
  },
): Promise<WorkspaceAssetRow> {
  const result = await queryDb<WorkspaceAssetRow>(
    `
      update workspace_assets
      set
        asset_type = $2,
        source_type = $3,
        source_reference_id = $4,
        title = $5,
        storage_key = $6,
        storage_url = $7,
        mime_type = $8,
        size_bytes = $9,
        tags = $10::jsonb,
        metadata = $11::jsonb,
        is_active = $12,
        updated_at = now()
      where id = $1
      returning
        id,
        business_id,
        created_by_user_id,
        asset_type,
        source_type,
        source_reference_id,
        title,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        tags,
        metadata,
        usage_count,
        is_active,
        created_at,
        updated_at
    `,
    [
      assetId,
      input.assetType,
      input.sourceType,
      input.sourceReferenceId ?? null,
      input.title ?? null,
      input.storageKey ?? null,
      input.storageUrl,
      input.mimeType,
      input.sizeBytes,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.metadata ?? {}),
      input.isActive ?? true,
    ],
  );

  return result.rows[0];
}

async function upsertWorkspaceAssetByStorage(input: {
  businessId: string;
  createdByUserId?: string;
  assetType: WorkspaceAssetType;
  sourceType: WorkspaceAssetSourceType;
  sourceReferenceId?: string;
  title?: string;
  storageKey?: string | null;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  isActive?: boolean;
}): Promise<WorkspaceAssetRow> {
  if (input.storageKey) {
    const existing = await loadWorkspaceAssetRowByStorageKey(input.businessId, input.storageKey);

    if (existing) {
      return updateWorkspaceAssetRecord(existing.id, {
        assetType: existing.asset_type === "image" ? input.assetType : existing.asset_type,
        sourceType: existing.source_type === "post_asset" ? input.sourceType : existing.source_type,
        sourceReferenceId: existing.source_reference_id ?? input.sourceReferenceId,
        title: existing.title ?? input.title,
        storageKey: input.storageKey,
        storageUrl: input.storageUrl,
        mimeType: input.mimeType,
        sizeBytes: Math.max(toNumber(existing.size_bytes), input.sizeBytes),
        tags: normalizeStringArray(existing.tags),
        metadata: {
          ...normalizeRecord(existing.metadata),
          ...normalizeRecord(input.metadata),
        },
        isActive: input.isActive ?? existing.is_active,
      });
    }
  }

  if (input.sourceReferenceId) {
    const existing = await loadWorkspaceAssetRowBySourceReference(
      input.businessId,
      input.sourceType,
      input.sourceReferenceId,
    );

    if (existing) {
      return updateWorkspaceAssetRecord(existing.id, input);
    }
  }

  try {
    return await createWorkspaceAssetRecord(input);
  } catch (error) {
    const candidate = error as { code?: string };

    if (candidate.code === "23505" && input.storageKey) {
      const concurrent = await loadWorkspaceAssetRowByStorageKey(input.businessId, input.storageKey);

      if (concurrent) {
        return updateWorkspaceAssetRecord(concurrent.id, input);
      }
    }

    throw error;
  }
}

async function ensureWorkspaceBrandKitProjection(businessId: string): Promise<void> {
  const brandKitResult = await queryDb<BrandKitRow>(
    `
      select
        id,
        business_id,
        primary_color,
        secondary_color,
        logo_url,
        updated_at
      from brand_kits
      where business_id = $1
      limit 1
    `,
    [businessId],
  );

  const brandKit = brandKitResult.rows[0];

  if (!brandKit) {
    return;
  }

  let logoAssetId: string | null = null;

  if (brandKit.logo_url) {
    const logoAsset = await upsertWorkspaceAssetByStorage({
      businessId,
      assetType: "logo",
      sourceType: "brand_kit",
      sourceReferenceId: brandKit.id,
      title: "Workspace logo",
      storageKey: extractStorageKey(brandKit.logo_url),
      storageUrl: brandKit.logo_url,
      mimeType: inferMimeTypeFromUrl(brandKit.logo_url),
      sizeBytes: 0,
      metadata: {
        source: "brand_kit",
      },
      isActive: true,
    });

    logoAssetId = logoAsset.id;

    await insertWorkspaceAssetUsage({
      businessId,
      assetId: logoAsset.id,
      usageSurface: "brand_kit",
      referenceId: brandKit.id,
      metadata: {
        slot: "logo",
      },
    });
  }

  await queryDb(
    `
      insert into workspace_brand_kits (
        business_id,
        source_brand_kit_id,
        primary_color,
        secondary_color,
        logo_asset_id,
        metadata
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb
      )
      on conflict (business_id)
      do update set
        source_brand_kit_id = excluded.source_brand_kit_id,
        primary_color = excluded.primary_color,
        secondary_color = excluded.secondary_color,
        logo_asset_id = excluded.logo_asset_id,
        metadata = excluded.metadata,
        updated_at = now()
    `,
    [
      businessId,
      brandKit.id,
      brandKit.primary_color,
      brandKit.secondary_color,
      logoAssetId,
      JSON.stringify({
        sourceUpdatedAt: toIsoString(brandKit.updated_at),
      }),
    ],
  );
}

async function loadWorkspaceBrandKitSummary(
  businessId: string,
): Promise<WorkspaceBrandKitSummary | undefined> {
  const result = await queryDb<WorkspaceBrandKitRow>(
    `
      select
        workspace_brand_kits.business_id,
        workspace_brand_kits.primary_color,
        workspace_brand_kits.secondary_color,
        workspace_brand_kits.logo_asset_id,
        workspace_assets.storage_key as logo_storage_key,
        workspace_assets.storage_url as logo_url,
        workspace_brand_kits.metadata,
        workspace_brand_kits.updated_at
      from workspace_brand_kits
      left join workspace_assets
        on workspace_assets.id = workspace_brand_kits.logo_asset_id
      where workspace_brand_kits.business_id = $1
      limit 1
    `,
    [businessId],
  );

  const row = result.rows[0];

  if (!row) {
    return undefined;
  }

  return {
    businessId: row.business_id,
    primaryColor: row.primary_color,
    secondaryColor: row.secondary_color,
    logoAssetId: row.logo_asset_id ?? undefined,
    logoUrl:
      row.logo_url && row.logo_storage_key !== undefined
        ? resolveWorkspaceAssetPreviewUrl(row.logo_storage_key, row.logo_url) ?? undefined
        : row.logo_url ?? undefined,
    metadata: normalizeRecord(row.metadata),
    updatedAt: toIsoString(row.updated_at),
  };
}

export async function createWorkspaceAssetUploadUrl(
  principal: AuthenticatedPrincipal,
  input: CreateWorkspaceAssetUploadUrlRequest,
): Promise<CreateWorkspaceAssetUploadUrlResponse> {
  const businessId = input.businessId.trim();
  const mimeType = normalizeMimeType(input.fileType);
  const assetType = validateWorkspaceAssetInput(mimeType, input.sizeBytes, input.assetType);

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  const storageKey = buildWorkspaceAssetStorageKey({
    businessId,
    mimeType,
    fileName: input.fileName,
    assetType,
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

export async function createWorkspaceAsset(
  principal: AuthenticatedPrincipal,
  input: CreateWorkspaceAssetRequest,
): Promise<CreateWorkspaceAssetResponse> {
  const businessId = input.businessId.trim();
  const mimeType = normalizeMimeType(input.mimeType);
  const assetType = validateWorkspaceAssetInput(mimeType, input.sizeBytes, input.assetType);

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  const asset = await upsertWorkspaceAssetByStorage({
    businessId,
    createdByUserId: principal.userId,
    assetType,
    sourceType: input.sourceType ?? "upload",
    sourceReferenceId: input.sourceReferenceId?.trim() || undefined,
    title: input.title?.trim() || undefined,
    storageKey: input.storageKey?.trim() || extractStorageKey(input.storageUrl.trim()),
    storageUrl: input.storageUrl.trim(),
    mimeType,
    sizeBytes: input.sizeBytes,
    tags: normalizeStringArray(input.tags),
    metadata: normalizeRecord(input.metadata),
    isActive: true,
  });

  await insertWorkspaceAssetUsage({
    businessId,
    assetId: asset.id,
    usageSurface: "asset_hub",
    referenceId: `asset:${asset.id}`,
    metadata: {
      sourceType: input.sourceType ?? "upload",
    },
  });

  logInfo("Created workspace asset.", {
    assetId: asset.id,
    businessId,
    assetType,
    sourceType: input.sourceType ?? "upload",
  });

  return {
    asset: mapWorkspaceAsset(asset),
  };
}

export async function listWorkspaceAssets(
  principal: AuthenticatedPrincipal,
  input: WorkspaceAssetsQuery,
): Promise<WorkspaceAssetsResponse> {
  const businessId = input.businessId.trim();

  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);
  await ensureWorkspaceBrandKitProjection(businessId);

  const search = input.search?.trim();
  const whereClauses = ["business_id = $1"];
  const values: unknown[] = [businessId];

  if (!input.includeInactive) {
    whereClauses.push("is_active = true");
  }

  if (input.assetType && input.assetType !== "all") {
    values.push(input.assetType);
    whereClauses.push(`asset_type = $${values.length}`);
  }

  if (input.sourceType && input.sourceType !== "all") {
    values.push(input.sourceType);
    whereClauses.push(`source_type = $${values.length}`);
  }

  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    whereClauses.push(
      `(lower(coalesce(title, '')) like $${values.length}
        or lower(storage_url) like $${values.length}
        or exists (
          select 1
          from jsonb_array_elements_text(tags) as tag
          where lower(tag) like $${values.length}
        ))`,
    );
  }

  const result = await queryDb<WorkspaceAssetRow>(
    `
      select
        id,
        business_id,
        created_by_user_id,
        asset_type,
        source_type,
        source_reference_id,
        title,
        storage_key,
        storage_url,
        mime_type,
        size_bytes,
        tags,
        metadata,
        usage_count,
        is_active,
        created_at,
        updated_at
      from workspace_assets
      where ${whereClauses.join("\n        and ")}
      order by
        case when asset_type = 'logo' then 0 else 1 end asc,
        usage_count desc,
        created_at desc
    `,
    values,
  );

  return {
    assets: result.rows.map((row) => mapWorkspaceAsset(row)),
    brandKit: await loadWorkspaceBrandKitSummary(businessId),
  };
}

export async function getWorkspaceAsset(
  principal: AuthenticatedPrincipal,
  businessId: string,
  assetId: string,
): Promise<GetWorkspaceAssetResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);

  const asset = await loadWorkspaceAssetRowById(assetId, businessId);

  if (!asset) {
    throw new HttpError(404, "workspace_asset_not_found", "Workspace asset not found.");
  }

  return {
    asset: mapWorkspaceAsset(asset),
  };
}

export async function getWorkspaceAssetDownload(
  principal: AuthenticatedPrincipal,
  businessId: string,
  assetId: string,
): Promise<DownloadWorkspaceAssetResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);

  const asset = await loadWorkspaceAssetRowById(assetId, businessId);

  if (!asset) {
    throw new HttpError(404, "workspace_asset_not_found", "Workspace asset not found.");
  }

  const mappedAsset = mapWorkspaceAsset(asset);

  return {
    asset: mappedAsset,
    downloadUrl: buildWorkspaceAssetDownloadUrl(asset.storage_key, asset.storage_url),
    fileName: resolveWorkspaceAssetFileName(mappedAsset),
  };
}

export async function deleteWorkspaceAsset(
  principal: AuthenticatedPrincipal,
  businessId: string,
  assetId: string,
): Promise<DeleteWorkspaceAssetResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  const asset = await loadWorkspaceAssetRowById(assetId, businessId);

  if (!asset) {
    throw new HttpError(404, "workspace_asset_not_found", "Workspace asset not found.");
  }

  await queryDb(
    `
      update workspace_assets
      set
        is_active = false,
        updated_at = now()
      where id = $1
    `,
    [assetId],
  );

  logInfo("Archived workspace asset.", {
    assetId,
    businessId,
  });

  return {
    deletedAssetId: assetId,
  };
}

export async function recordWorkspaceAssetUsage(
  principal: AuthenticatedPrincipal,
  assetId: string,
  input: RecordWorkspaceAssetUsageRequest,
): Promise<RecordWorkspaceAssetUsageResponse> {
  const businessId = input.businessId.trim();

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  const asset = await loadWorkspaceAssetRowById(assetId.trim(), businessId);

  if (!asset) {
    throw new HttpError(404, "workspace_asset_not_found", "Workspace asset not found.");
  }

  const usage = await insertWorkspaceAssetUsage({
    businessId,
    assetId: asset.id,
    usageSurface: input.usageSurface,
    referenceId: input.referenceId?.trim() || undefined,
    metadata: normalizeRecord(input.metadata),
  });
  const refreshed = await loadWorkspaceAssetRowById(asset.id, businessId);

  if (!refreshed) {
    throw new HttpError(404, "workspace_asset_not_found", "Workspace asset not found.");
  }

  return {
    asset: mapWorkspaceAsset(refreshed),
    usage: mapWorkspaceAssetUsage(usage),
  };
}

export async function syncWorkspaceAssetFromPostAsset(input: {
  businessId: string;
  postId: string;
  postAssetId: string;
  storageKey: string;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  title?: string;
  sourceType?: WorkspaceAssetSourceType;
}): Promise<void> {
  try {
    const assetType = inferWorkspaceAssetType(normalizeMimeType(input.mimeType));
    const asset = await upsertWorkspaceAssetByStorage({
      businessId: input.businessId,
      assetType,
      sourceType: input.sourceType ?? "post_asset",
      sourceReferenceId: input.postAssetId,
      title: input.title,
      storageKey: input.storageKey,
      storageUrl: input.storageUrl,
      mimeType: normalizeMimeType(input.mimeType),
      sizeBytes: input.sizeBytes,
      metadata: {
        sourcePostId: input.postId,
      },
      isActive: true,
    });

    await insertWorkspaceAssetUsage({
      businessId: input.businessId,
      assetId: asset.id,
      usageSurface: "post",
      referenceId: input.postId,
      metadata: {
        postAssetId: input.postAssetId,
      },
    });
  } catch (error) {
    logWarn("Failed to sync workspace asset from post asset.", {
      businessId: input.businessId,
      postId: input.postId,
      postAssetId: input.postAssetId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function releaseWorkspacePostAssetUsage(input: {
  businessId: string;
  postId: string;
  storageKey?: string | null;
  postAssetId?: string;
}): Promise<void> {
  try {
    let asset: WorkspaceAssetRow | null = null;

    if (input.storageKey) {
      asset = await loadWorkspaceAssetRowByStorageKey(input.businessId, input.storageKey);
    }

    if (!asset && input.postAssetId) {
      asset = await loadWorkspaceAssetRowBySourceReference(
        input.businessId,
        "post_asset",
        input.postAssetId,
      );
    }

    if (!asset) {
      return;
    }

    await deleteWorkspaceAssetUsageByReference({
      assetId: asset.id,
      usageSurface: "post",
      referenceId: input.postId,
    });
  } catch (error) {
    logWarn("Failed to release workspace asset post usage.", {
      businessId: input.businessId,
      postId: input.postId,
      postAssetId: input.postAssetId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export async function syncWorkspaceBrandKitForBusiness(businessId: string): Promise<void> {
  try {
    await ensureWorkspaceBrandKitProjection(businessId);
  } catch (error) {
    logWarn("Failed to sync workspace brand kit projection.", {
      businessId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
