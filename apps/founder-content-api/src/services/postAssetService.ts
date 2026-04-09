import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { QueryResultRow } from "pg";
import type {
  BrandKit,
  CreateMediaUploadUrlRequest,
  CreateMediaUploadUrlResponse,
  CreatePromoVisualPostAssetRequest,
  CreatePromoVisualPostAssetResponse,
  GenerateMotionPostAssetRequest,
  GenerateMotionPostAssetResponse,
  CreatePostAssetRequest,
  CreatePostAssetResponse,
  DeletePostAssetResponse,
  DownloadPostAssetResponse,
  GetPostAssetResponse,
  ImagePostAssetMetadata,
  MotionAudioPreset,
  MotionAudioTrack,
  MotionVoiceProvider,
  MotionTemplateMetadata,
  MotionTemplateAspectRatio,
  MotionTemplateId,
  MotionTemplateAudio,
  MotionTemplateMusic,
  MotionTemplateVoice,
  MotionTemplateOverlay,
  ListPostAssetsResponse,
  PostAssetAspectRatio,
  PostAsset,
  PostAssetMetadata,
  PostAssetMetadataSource,
  PostAssetSource,
  PostAssetStatus,
  PostAssetType,
  PromoVisualLayoutId,
  ReorderPostAssetsRequest,
  ReorderPostAssetsResponse,
  VideoPostAssetMetadata,
} from "../../../../packages/shared-types/index.ts";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireBusinessMembership } from "./authBusinessService.ts";
import { queryDb, withDbTransaction } from "./db/client.ts";
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
import { buildMotionFilter } from "./motion/buildMotionFilter.ts";
import { getBrandKitForBusiness } from "./brandIntelligence/brandKitService.ts";
import { getMotionTemplateConfig } from "./motion/templates.ts";
import {
  getMotionAudioPresetConfig,
  resolveMotionAudioPresetForTemplate,
  resolveMotionAudioPresetFromTrack,
} from "./motion/audioPresets.ts";
import { composePromoVisual } from "./promoVisualComposer.ts";

const execFileAsync = promisify(execFile);

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
  metadata_json: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ContentPostRow extends QueryResultRow {
  id: string;
  business_id: string | null;
  content_type: string;
}

interface BusinessPromoContextRow extends QueryResultRow {
  name: string | null;
  brand_name: string | null;
  website_url: string | null;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4"]);
const DEFAULT_S3_UPLOAD_TTL_SECONDS = 900;
const DEFAULT_S3_PREVIEW_TTL_SECONDS = 3600;
const MAX_POST_ASSET_COUNT = 10;
const POST_ASSET_ASPECT_RATIOS = new Set<PostAssetAspectRatio>(["1:1", "9:16"]);
const POST_ASSET_METADATA_SOURCES = new Set<PostAssetMetadataSource>(["upload", "motion_template", "promo_composer"]);
const MOTION_TEMPLATE_IDS = new Set<MotionTemplateId>([
  "subtle_zoom",
  "caption_pulse",
  "story_pan",
  "founder_story",
  "offer_burst",
  "testimonial_highlight",
  "local_awareness",
]);
const MOTION_TEMPLATE_ASPECT_RATIOS = new Set<MotionTemplateAspectRatio>(["square", "portrait"]);
const MOTION_AUDIO_TRACKS = new Set<MotionAudioTrack>(["calm", "upbeat", "ambient"]);
const MOTION_AUDIO_PRESETS = new Set<MotionAudioPreset>([
  "clean_modern",
  "high_energy_promo",
  "local_trust",
  "luxury_minimal",
  "calm_wellness",
]);
const DEFAULT_MOTION_DURATION_MS = 5000;
const MIN_MOTION_DURATION_MS = 3000;
const MAX_MOTION_DURATION_MS = 8000;
const DEFAULT_MOTION_AUDIO_VOLUME = 0.3;
const DEFAULT_MOTION_AUDIO_FADE_IN_SECONDS = 0.18;
const DEFAULT_MOTION_AUDIO_FADE_OUT_SECONDS = 0.35;
const MOTION_AUDIO_ASSET_DIR = fileURLToPath(new URL("../../assets/audio/", import.meta.url));
const DEFAULT_MOTION_VOICE_PROVIDER: MotionVoiceProvider = "elevenlabs";

const MOTION_DIMENSIONS: Record<MotionTemplateAspectRatio, { width: number; height: number; assetAspectRatio: PostAssetAspectRatio }> = {
  square: {
    width: 720,
    height: 720,
    assetAspectRatio: "1:1",
  },
  portrait: {
    width: 720,
    height: 1280,
    assetAspectRatio: "9:16",
  },
};

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

function resolveMaxVideoBytes(): number {
  const value = Number(process.env.S3_MAX_VIDEO_BYTES ?? 52428800);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 52428800;
}

function extractDomainLabel(websiteUrl: string | null | undefined): string | undefined {
  const normalized = collapseWhitespace(websiteUrl ?? "");

  if (!normalized) {
    return undefined;
  }

  try {
    const url = /^https?:\/\//i.test(normalized) ? new URL(normalized) : new URL(`https://${normalized}`);
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return undefined;
  }
}

async function loadBusinessPromoLabel(businessId: string): Promise<string> {
  const result = await queryDb<BusinessPromoContextRow>(
    `
      select
        name,
        brand_name,
        website_url
      from businesses
      where id = $1
      limit 1
    `,
    [businessId],
  );
  const row = result.rows[0];

  if (!row) {
    return "Workspace";
  }

  return collapseWhitespace(
    extractDomainLabel(row.website_url)
    || row.brand_name
    || row.name
    || "Workspace",
  ) || "Workspace";
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function toNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateAtWordBoundary(value: string | undefined, maxLength: number): string | undefined {
  const normalized = collapseWhitespace(value ?? "");

  if (!normalized) {
    return undefined;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  const truncated = normalized.slice(0, maxLength).trim();
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  return (lastSpaceIndex >= Math.floor(maxLength * 0.55) ? truncated.slice(0, lastSpaceIndex) : truncated).trim();
}

function parseOptionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "invalid_post_asset_metadata", `${fieldName} must be a string.`);
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, "invalid_post_asset_metadata", `${fieldName} must be a positive number.`);
  }

  return Math.floor(parsed);
}

function parseOptionalNonNegativeNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, "invalid_post_asset_metadata", `${fieldName} must be zero or a positive number.`);
  }

  return Number(parsed);
}

function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new HttpError(400, "invalid_post_asset_metadata", `${fieldName} must be a boolean.`);
  }

  return value;
}

function parseOptionalAspectRatio(value: unknown, fieldName: string): PostAssetAspectRatio | undefined {
  const normalized = parseOptionalString(value, fieldName);

  if (!normalized) {
    return undefined;
  }

  if (!POST_ASSET_ASPECT_RATIOS.has(normalized as PostAssetAspectRatio)) {
    throw new HttpError(
      400,
      "invalid_post_asset_metadata",
      `${fieldName} must be one of ${Array.from(POST_ASSET_ASPECT_RATIOS).join(", ")}.`,
    );
  }

  return normalized as PostAssetAspectRatio;
}

function parseOptionalMetadataSource(value: unknown, fieldName: string): PostAssetMetadataSource | undefined {
  const normalized = parseOptionalString(value, fieldName);

  if (!normalized) {
    return undefined;
  }

  if (!POST_ASSET_METADATA_SOURCES.has(normalized as PostAssetMetadataSource)) {
    throw new HttpError(
      400,
      "invalid_post_asset_metadata",
      `${fieldName} must be one of ${Array.from(POST_ASSET_METADATA_SOURCES).join(", ")}.`,
    );
  }

  return normalized as PostAssetMetadataSource;
}

function parsePromoVisualLayoutId(value: unknown): PromoVisualLayoutId {
  const normalized = parseOptionalString(value, "layout");

  if (
    normalized !== "logo_headline"
    && normalized !== "screenshot_headline"
    && normalized !== "headline_only"
  ) {
    throw new HttpError(
      400,
      "bad_request",
      "layout must be one of logo_headline, screenshot_headline, or headline_only.",
    );
  }

  return normalized;
}

function parseMotionTemplateOverlay(value: unknown): MotionTemplateOverlay | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_post_asset_metadata", "motionTemplate.overlay must be an object.");
  }

  const record = normalizeRecord(value);
  const allowedKeys = new Set(["headline", "subheadline", "cta", "brandText"]);

  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new HttpError(400, "invalid_post_asset_metadata", `Unsupported motionTemplate.overlay field "${key}".`);
    }
  }

  const headline = truncateAtWordBoundary(parseOptionalString(record.headline, "motionTemplate.overlay.headline"), 90);
  const subheadline = truncateAtWordBoundary(parseOptionalString(record.subheadline, "motionTemplate.overlay.subheadline"), 120);
  const cta = truncateAtWordBoundary(parseOptionalString(record.cta, "motionTemplate.overlay.cta"), 32);
  const brandText = truncateAtWordBoundary(parseOptionalString(record.brandText, "motionTemplate.overlay.brandText"), 32);

  if (!headline && !subheadline && !cta && !brandText) {
    return undefined;
  }

  return {
    headline,
    subheadline,
    cta,
    brandText,
  };
}

function parseOptionalVolume(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, "invalid_post_asset_metadata", `${fieldName} must be a number between 0 and 1.`);
  }

  if (value < 0 || value > 1) {
    throw new HttpError(400, "invalid_post_asset_metadata", `${fieldName} must be between 0 and 1.`);
  }

  return Number(value);
}

function parseMotionTemplateMusic(value: unknown): MotionTemplateMusic | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_post_asset_metadata", "motionTemplate.audio.music must be an object.");
  }

  const record = normalizeRecord(value);
  const allowedKeys = new Set(["enabled", "preset", "track", "volume", "fadeIn", "fadeOut", "ducking"]);

  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new HttpError(400, "invalid_post_asset_metadata", `Unsupported motionTemplate.audio.music field "${key}".`);
    }
  }

  const enabled = parseOptionalBoolean(record.enabled, "motionTemplate.audio.music.enabled");
  const preset = parseOptionalString(record.preset, "motionTemplate.audio.music.preset");
  const track = parseOptionalString(record.track, "motionTemplate.audio.music.track");

  if (preset && !MOTION_AUDIO_PRESETS.has(preset as MotionAudioPreset)) {
    throw new HttpError(
      400,
      "invalid_post_asset_metadata",
      `motionTemplate.audio.music.preset must be one of ${Array.from(MOTION_AUDIO_PRESETS).join(", ")}.`,
    );
  }

  if (track && !MOTION_AUDIO_TRACKS.has(track as MotionAudioTrack)) {
    throw new HttpError(
      400,
      "invalid_post_asset_metadata",
      `motionTemplate.audio.music.track must be one of ${Array.from(MOTION_AUDIO_TRACKS).join(", ")}.`,
    );
  }

  const volume = parseOptionalVolume(record.volume, "motionTemplate.audio.music.volume");
  const fadeIn = parseOptionalNonNegativeNumber(record.fadeIn, "motionTemplate.audio.music.fadeIn");
  const fadeOut = parseOptionalNonNegativeNumber(record.fadeOut, "motionTemplate.audio.music.fadeOut");
  const ducking = parseOptionalBoolean(record.ducking, "motionTemplate.audio.music.ducking");

  if (
    enabled === undefined
    && !preset
    && !track
    && volume === undefined
    && fadeIn === undefined
    && fadeOut === undefined
    && ducking === undefined
  ) {
    return undefined;
  }

  return {
    enabled,
    preset: preset as MotionAudioPreset | undefined,
    track: track as MotionAudioTrack | undefined,
    volume,
    fadeIn,
    fadeOut,
    ducking,
  };
}

function parseMotionTemplateVoice(value: unknown): MotionTemplateVoice | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_post_asset_metadata", "motionTemplate.audio.voice must be an object.");
  }

  const record = normalizeRecord(value);
  const allowedKeys = new Set(["enabled", "script", "provider", "voiceId", "storageKey", "assetUrl", "volume"]);

  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new HttpError(400, "invalid_post_asset_metadata", `Unsupported motionTemplate.audio.voice field "${key}".`);
    }
  }

  const enabled = parseOptionalBoolean(record.enabled, "motionTemplate.audio.voice.enabled");
  const provider = parseOptionalString(record.provider, "motionTemplate.audio.voice.provider");

  if (provider && provider !== DEFAULT_MOTION_VOICE_PROVIDER) {
    throw new HttpError(
      400,
      "invalid_post_asset_metadata",
      `motionTemplate.audio.voice.provider must be ${DEFAULT_MOTION_VOICE_PROVIDER}.`,
    );
  }

  const script = record.script === null ? null : parseOptionalString(record.script, "motionTemplate.audio.voice.script");
  const voiceId = record.voiceId === null ? null : parseOptionalString(record.voiceId, "motionTemplate.audio.voice.voiceId");
  const storageKey =
    record.storageKey === null ? null : parseOptionalString(record.storageKey, "motionTemplate.audio.voice.storageKey");
  const assetUrl =
    record.assetUrl === null ? null : parseOptionalString(record.assetUrl, "motionTemplate.audio.voice.assetUrl");
  const volume = parseOptionalVolume(record.volume, "motionTemplate.audio.voice.volume");

  if (
    enabled === undefined
    && provider === undefined
    && script === undefined
    && voiceId === undefined
    && storageKey === undefined
    && assetUrl === undefined
    && volume === undefined
  ) {
    return undefined;
  }

  return {
    enabled: enabled ?? false,
    provider: (provider as MotionVoiceProvider | undefined) ?? DEFAULT_MOTION_VOICE_PROVIDER,
    script,
    voiceId,
    storageKey,
    assetUrl,
    volume,
  };
}

function parseMotionTemplateAudio(value: unknown): MotionTemplateAudio | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_post_asset_metadata", "motionTemplate.audio must be an object.");
  }

  const record = normalizeRecord(value);
  const allowedKeys = new Set([
    "enabled",
    "music",
    "voice",
    "preset",
    "track",
    "volume",
    "fadeIn",
    "fadeOut",
    "ducking",
    "voiceTrack",
  ]);

  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new HttpError(400, "invalid_post_asset_metadata", `Unsupported motionTemplate.audio field "${key}".`);
    }
  }

  const enabled = parseOptionalBoolean(record.enabled, "motionTemplate.audio.enabled");
  const music = parseMotionTemplateMusic(record.music);
  const voice = parseMotionTemplateVoice(record.voice);
  const preset = parseOptionalString(record.preset, "motionTemplate.audio.preset");
  const track = parseOptionalString(record.track, "motionTemplate.audio.track");

  if (preset && !MOTION_AUDIO_PRESETS.has(preset as MotionAudioPreset)) {
    throw new HttpError(
      400,
      "invalid_post_asset_metadata",
      `motionTemplate.audio.preset must be one of ${Array.from(MOTION_AUDIO_PRESETS).join(", ")}.`,
    );
  }

  if (track && !MOTION_AUDIO_TRACKS.has(track as MotionAudioTrack)) {
    throw new HttpError(
      400,
      "invalid_post_asset_metadata",
      `motionTemplate.audio.track must be one of ${Array.from(MOTION_AUDIO_TRACKS).join(", ")}.`,
    );
  }

  const volume = parseOptionalVolume(record.volume, "motionTemplate.audio.volume");
  const fadeIn = parseOptionalNonNegativeNumber(record.fadeIn, "motionTemplate.audio.fadeIn");
  const fadeOut = parseOptionalNonNegativeNumber(record.fadeOut, "motionTemplate.audio.fadeOut");
  const ducking = parseOptionalBoolean(record.ducking, "motionTemplate.audio.ducking");
  const voiceTrack =
    record.voiceTrack === null
      ? null
      : parseOptionalString(record.voiceTrack, "motionTemplate.audio.voiceTrack");

  if (
    enabled === undefined
    && !music
    && !voice
    && !preset
    && !track
    && volume === undefined
    && fadeIn === undefined
    && fadeOut === undefined
    && ducking === undefined
    && voiceTrack === undefined
  ) {
    return undefined;
  }

  return {
    enabled: enabled ?? true,
    music,
    voice,
    preset: preset as MotionAudioPreset | undefined,
    track: track as MotionAudioTrack | undefined,
    volume,
    fadeIn,
    fadeOut,
    ducking,
    voiceTrack,
  };
}

function parseMotionTemplateMetadata(value: unknown): MotionTemplateMetadata | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "invalid_post_asset_metadata", "motionTemplate must be an object.");
  }

  const record = normalizeRecord(value);
  const allowedKeys = new Set([
    "id",
    "aspectRatio",
    "durationMs",
    "loop",
    "sourceAssetIds",
    "sourceSlideCount",
    "overlay",
    "audio",
  ]);

  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new HttpError(400, "invalid_post_asset_metadata", `Unsupported motionTemplate field "${key}".`);
    }
  }

  const id = parseOptionalString(record.id, "motionTemplate.id");

  if (!id || !MOTION_TEMPLATE_IDS.has(id as MotionTemplateId)) {
    throw new HttpError(
      400,
      "invalid_post_asset_metadata",
      `motionTemplate.id must be one of ${Array.from(MOTION_TEMPLATE_IDS).join(", ")}.`,
    );
  }

  const aspectRatio = parseOptionalString(record.aspectRatio, "motionTemplate.aspectRatio");

  if (aspectRatio && !MOTION_TEMPLATE_ASPECT_RATIOS.has(aspectRatio as MotionTemplateAspectRatio)) {
    throw new HttpError(
      400,
      "invalid_post_asset_metadata",
      `motionTemplate.aspectRatio must be one of ${Array.from(MOTION_TEMPLATE_ASPECT_RATIOS).join(", ")}.`,
    );
  }

  const sourceAssetIdsValue = record.sourceAssetIds;
  let sourceAssetIds: string[] | undefined;

  if (sourceAssetIdsValue !== undefined) {
    if (!Array.isArray(sourceAssetIdsValue)) {
      throw new HttpError(400, "invalid_post_asset_metadata", "motionTemplate.sourceAssetIds must be an array.");
    }

    sourceAssetIds = sourceAssetIdsValue
      .map((entry) => parseOptionalString(entry, "motionTemplate.sourceAssetIds[]"))
      .filter((entry): entry is string => Boolean(entry));
  }

  return {
    id: id as MotionTemplateId,
    aspectRatio: aspectRatio as MotionTemplateAspectRatio | undefined,
    durationMs: parseOptionalPositiveInteger(record.durationMs, "motionTemplate.durationMs"),
    loop: parseOptionalBoolean(record.loop, "motionTemplate.loop"),
    sourceAssetIds,
    sourceSlideCount: parseOptionalPositiveInteger(record.sourceSlideCount, "motionTemplate.sourceSlideCount"),
    overlay: parseMotionTemplateOverlay(record.overlay),
    audio: parseMotionTemplateAudio(record.audio),
  };
}

interface ResolvedMotionAudioConfig {
  enabled: boolean;
  preset: MotionAudioPreset;
  track: MotionAudioTrack;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  ducking: boolean;
  assetPath?: string;
}

async function resolveBundledMotionAudioPath(preset: MotionAudioPreset, track: MotionAudioTrack): Promise<string | undefined> {
  const presetFilePath = path.join(MOTION_AUDIO_ASSET_DIR, getMotionAudioPresetConfig(preset).assetFileName);
  const fallbackTrackPath = path.join(MOTION_AUDIO_ASSET_DIR, `${track}.mp3`);

  for (const candidatePath of [presetFilePath, fallbackTrackPath]) {
    try {
      await fs.access(candidatePath);
      return candidatePath;
    } catch {
      // try next
    }
  }

  return undefined;
}

async function resolveMotionAudioConfig(
  template: MotionTemplateMetadata,
  aspectRatio: MotionTemplateAspectRatio,
): Promise<ResolvedMotionAudioConfig> {
  const templateAudio = getMotionTemplateConfig(template.id, aspectRatio).audio;
  const requestedMusic = template.audio?.music;
  const requestedPreset =
    requestedMusic?.preset && MOTION_AUDIO_PRESETS.has(requestedMusic.preset)
      ? requestedMusic.preset
      : template.audio?.preset && MOTION_AUDIO_PRESETS.has(template.audio.preset)
        ? template.audio.preset
        : requestedMusic?.track && MOTION_AUDIO_TRACKS.has(requestedMusic.track)
          ? resolveMotionAudioPresetFromTrack(requestedMusic.track)
          : template.audio?.track && MOTION_AUDIO_TRACKS.has(template.audio.track)
            ? resolveMotionAudioPresetFromTrack(template.audio.track)
            : undefined;
  const preset = requestedPreset ?? templateAudio.preset ?? resolveMotionAudioPresetForTemplate(template.id);
  const presetConfig = getMotionAudioPresetConfig(preset);
  const requestedTrack =
    requestedMusic?.track && MOTION_AUDIO_TRACKS.has(requestedMusic.track)
      ? requestedMusic.track
      : template.audio?.track && MOTION_AUDIO_TRACKS.has(template.audio.track)
        ? template.audio.track
      : undefined;
  const track = requestedTrack ?? presetConfig.track;
  const audioEnabled = template.audio?.enabled ?? true;
  const musicEnabled = requestedMusic?.enabled ?? true;

  if (audioEnabled === false || musicEnabled === false || templateAudio.enabled === false) {
    return {
      enabled: false,
      preset,
      track,
      volume: requestedMusic?.volume ?? template.audio?.volume ?? templateAudio.volume ?? presetConfig.volume ?? DEFAULT_MOTION_AUDIO_VOLUME,
      fadeIn: requestedMusic?.fadeIn ?? template.audio?.fadeIn ?? templateAudio.fadeIn ?? presetConfig.fadeIn ?? DEFAULT_MOTION_AUDIO_FADE_IN_SECONDS,
      fadeOut: requestedMusic?.fadeOut ?? template.audio?.fadeOut ?? templateAudio.fadeOut ?? presetConfig.fadeOut ?? DEFAULT_MOTION_AUDIO_FADE_OUT_SECONDS,
      ducking: requestedMusic?.ducking ?? template.audio?.ducking ?? templateAudio.ducking ?? presetConfig.ducking,
    };
  }

  return {
    enabled: true,
    preset,
    track,
    volume:
      typeof requestedMusic?.volume === "number"
        ? Math.min(Math.max(requestedMusic.volume, 0), 1)
        : typeof template.audio?.volume === "number"
          ? Math.min(Math.max(template.audio.volume, 0), 1)
          : templateAudio.volume ?? presetConfig.volume ?? DEFAULT_MOTION_AUDIO_VOLUME,
    fadeIn:
      typeof requestedMusic?.fadeIn === "number"
        ? Math.max(requestedMusic.fadeIn, 0)
        : typeof template.audio?.fadeIn === "number"
          ? Math.max(template.audio.fadeIn, 0)
          : templateAudio.fadeIn ?? presetConfig.fadeIn ?? DEFAULT_MOTION_AUDIO_FADE_IN_SECONDS,
    fadeOut:
      typeof requestedMusic?.fadeOut === "number"
        ? Math.max(requestedMusic.fadeOut, 0)
        : typeof template.audio?.fadeOut === "number"
          ? Math.max(template.audio.fadeOut, 0)
          : templateAudio.fadeOut ?? presetConfig.fadeOut ?? DEFAULT_MOTION_AUDIO_FADE_OUT_SECONDS,
    ducking: requestedMusic?.ducking ?? template.audio?.ducking ?? templateAudio.ducking ?? presetConfig.ducking,
    assetPath: await resolveBundledMotionAudioPath(preset, track),
  };
}

function buildGeneratedAudioInput(track: MotionAudioTrack): string {
  if (track === "upbeat") {
    return "aevalsrc=0.09*sin(2*PI*220*t)*(0.58+0.42*sin(2*PI*2.6*t))+0.035*sin(2*PI*440*t):s=44100";
  }

  if (track === "ambient") {
    return "aevalsrc=0.055*sin(2*PI*174*t)+0.03*sin(2*PI*261.63*t)+0.02*sin(2*PI*392*t):s=44100";
  }

  return "aevalsrc=0.075*sin(2*PI*196*t)+0.03*sin(2*PI*293.66*t):s=44100";
}

function buildMotionAudioFilter(input: {
  volume: number;
  durationSeconds: number;
  fadeIn: number;
  fadeOut: number;
}): string {
  const fadeIn = Math.max(Math.min(input.fadeIn, Math.max(input.durationSeconds - 0.1, 0)), 0);
  const fadeOut = Math.max(Math.min(input.fadeOut, Math.max(input.durationSeconds - 0.1, 0)), 0);
  const fadeOutStart = Math.max(input.durationSeconds - fadeOut, 0.1).toFixed(2);

  return `volume=${input.volume.toFixed(2)},afade=t=in:st=0:d=${fadeIn.toFixed(2)},afade=t=out:st=${fadeOutStart}:d=${fadeOut.toFixed(2)}`;
}

function normalizePostAssetMetadata(type: "image", value: unknown): ImagePostAssetMetadata;
function normalizePostAssetMetadata(type: "video", value: unknown): VideoPostAssetMetadata;
function normalizePostAssetMetadata(type: PostAssetType, value: unknown): PostAssetMetadata {
  const record = normalizeRecord(value);
  const allowedKeys = new Set([
    "aspectRatio",
    "source",
    "durationMs",
    "width",
    "height",
    "motionTemplate",
    "posterAssetId",
  ]);

  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new HttpError(400, "invalid_post_asset_metadata", `Unsupported post asset metadata field "${key}".`);
    }
  }

  const aspectRatio = parseOptionalAspectRatio(record.aspectRatio, "metadata.aspectRatio");

  if (type === "image") {
    if (
      record.durationMs !== undefined
      || record.width !== undefined
      || record.height !== undefined
      || record.motionTemplate !== undefined
      || record.posterAssetId !== undefined
    ) {
      throw new HttpError(
        400,
        "invalid_post_asset_metadata",
        "Image assets only support aspectRatio and source metadata.",
      );
    }

    const source = parseOptionalMetadataSource(record.source, "metadata.source");

    if (source && source !== "upload" && source !== "promo_composer") {
      throw new HttpError(
        400,
        "invalid_post_asset_metadata",
        "Image asset metadata.source must be upload or promo_composer.",
      );
    }

    return {
      aspectRatio,
      source:
        source === "upload"
          ? "upload"
          : source === "promo_composer"
            ? "promo_composer"
            : undefined,
    };
  }

  return {
    aspectRatio,
    source: parseOptionalMetadataSource(record.source, "metadata.source"),
    durationMs: parseOptionalPositiveInteger(record.durationMs, "metadata.durationMs"),
    width: parseOptionalPositiveInteger(record.width, "metadata.width"),
    height: parseOptionalPositiveInteger(record.height, "metadata.height"),
    motionTemplate: parseMotionTemplateMetadata(record.motionTemplate),
    posterAssetId: parseOptionalString(record.posterAssetId, "metadata.posterAssetId"),
  };
}

function resolveMotionDurationMs(template: MotionTemplateMetadata): number {
  const candidate = typeof template.durationMs === "number" ? Math.floor(template.durationMs) : DEFAULT_MOTION_DURATION_MS;
  return Math.min(Math.max(candidate, MIN_MOTION_DURATION_MS), MAX_MOTION_DURATION_MS);
}

function resolveMotionAspectRatio(template: MotionTemplateMetadata): MotionTemplateAspectRatio {
  return template.aspectRatio === "portrait" ? "portrait" : "square";
}

async function renderMotionVideoFromImage(input: {
  sourceBytes: Buffer;
  template: MotionTemplateMetadata;
  brandKit?: BrandKit;
}): Promise<{
  bytes: Buffer;
  width: number;
  height: number;
  aspectRatio: PostAssetAspectRatio;
  durationMs: number;
}> {
  const aspectRatio = resolveMotionAspectRatio(input.template);
  const dimensions = MOTION_DIMENSIONS[aspectRatio];
  const durationMs = resolveMotionDurationMs(input.template);
  const audio = await resolveMotionAudioConfig(input.template, aspectRatio);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "motion-lite-"));
  const framePath = path.join(tempDir, "frame.png");
  const outputPath = path.join(tempDir, "motion-lite.mp4");

  try {
    await sharp(input.sourceBytes)
      .resize(dimensions.width, dimensions.height, {
        fit: "cover",
        position: "attention",
      })
      .png()
      .toFile(framePath);
    const motionPlan = await buildMotionFilter({
      width: dimensions.width,
      height: dimensions.height,
      aspectRatio,
      durationMs,
      template: input.template,
      brandKit: input.brandKit,
    });
    const commandArgs = [
      "-y",
      "-loop",
      "1",
      "-framerate",
      String(motionPlan.renderFps),
      "-i",
      framePath,
    ];

    for (const [index, layer] of motionPlan.overlayLayers.entries()) {
      const overlayPath = path.join(tempDir, `overlay-${index}.png`);
      await fs.writeFile(overlayPath, layer.bytes);
      commandArgs.push("-loop", "1", "-framerate", String(motionPlan.renderFps), "-i", overlayPath);
    }

    if (audio.enabled) {
      if (audio.assetPath) {
        commandArgs.push("-stream_loop", "-1", "-i", audio.assetPath);
      } else {
        commandArgs.push(
          "-f",
          "lavfi",
          "-t",
          motionPlan.durationSeconds.toFixed(2),
          "-i",
          buildGeneratedAudioInput(audio.track),
        );
      }
    }

    commandArgs.push(
      "-t",
      motionPlan.durationSeconds.toFixed(2),
      "-filter_complex",
      motionPlan.filterGraph,
      "-map",
      `[bg${motionPlan.overlayLayers.length}]`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-threads",
      "1",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-movflags",
      "+faststart",
    );

    if (audio.enabled) {
      const audioInputIndex = motionPlan.overlayLayers.length + 1;
      commandArgs.push(
        "-map",
        `${audioInputIndex}:a`,
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-filter:a",
        buildMotionAudioFilter({
          volume: audio.volume,
          durationSeconds: motionPlan.durationSeconds,
          fadeIn: audio.fadeIn,
          fadeOut: audio.fadeOut,
        }),
        "-shortest",
      );
    } else {
      commandArgs.push("-an");
    }

    commandArgs.push(outputPath);

    await execFileAsync(process.env.FFMPEG_PATH?.trim() || "ffmpeg", commandArgs, {
      maxBuffer: 8 * 1024 * 1024,
    });

    return {
      bytes: await fs.readFile(outputPath),
      width: dimensions.width,
      height: dimensions.height,
      aspectRatio: dimensions.assetAspectRatio,
      durationMs,
    };
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: string }).code === "ENOENT"
    ) {
      throw new HttpError(
        503,
        "motion_rendering_not_configured",
        "Motion generation is unavailable because ffmpeg is not installed on the server.",
      );
    }

    throw new HttpError(
      500,
      "motion_rendering_failed",
      "Unable to render the motion teaser from this visual right now.",
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
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

function inferAssetType(mimeType: string, requestedType?: PostAssetType): PostAssetType {
  const inferredType =
    ALLOWED_IMAGE_TYPES.has(mimeType)
      ? "image"
      : ALLOWED_VIDEO_TYPES.has(mimeType)
        ? "video"
        : null;

  if (!inferredType) {
    throw new HttpError(
      400,
      "unsupported_media_type",
      "Only JPG, PNG, GIF, and MP4 media files are supported right now.",
    );
  }

  if (requestedType && requestedType !== inferredType) {
    throw new HttpError(
      400,
      "unsupported_media_type",
      `${requestedType === "video" ? "Video" : "Image"} uploads must use a matching media mime type.`,
    );
  }

  return inferredType;
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
    case "video/mp4":
      return "mp4";
    default:
      return "bin";
  }
}

function buildPostAssetFileName(asset: Pick<PostAsset, "id" | "type" | "mimeType">): string {
  return `${asset.type}-${asset.id}.${resolveFileExtension(asset.mimeType)}`;
}

function validatePostAssetInput(
  mimeType: string,
  sizeBytes?: number,
  requestedType?: PostAssetType,
): PostAssetType {
  const assetType = inferAssetType(mimeType, requestedType);
  const maxBytes = assetType === "video" ? resolveMaxVideoBytes() : resolveMaxImageBytes();

  if (typeof sizeBytes === "number" && sizeBytes > maxBytes) {
    throw new HttpError(
      400,
      "media_too_large",
      `${assetType === "video" ? "Videos" : "Images"} must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.`,
    );
  }

  return assetType;
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

function resolveMediaPublicBaseUrl(): string | undefined {
  const configuredBaseUrl = process.env.S3_MEDIA_PUBLIC_BASE_URL?.trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/g, "");
  }

  const bucket = resolveMediaBucket();
  const region = resolveAwsRegion();
  return `https://${bucket}.s3.${region}.amazonaws.com`;
}

function buildPublicUrl(storageKey: string): string {
  const publicBaseUrl = resolveMediaPublicBaseUrl();

  if (!publicBaseUrl) {
    throw new HttpError(
      500,
      "media_public_url_not_configured",
      "S3_MEDIA_PUBLIC_BASE_URL is not configured.",
    );
  }

  return `${publicBaseUrl}/${encodeS3Path(storageKey)}`;
}

function buildPublicUrlForBase(storageKey: string, publicBaseUrl: string): string {
  return `${publicBaseUrl.replace(/\/+$/g, "")}/${encodeS3Path(storageKey)}`;
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
  const baseAsset = {
    id: row.id,
    businessId: row.business_id,
    postId: row.post_id,
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

  if (row.type === "video") {
    return {
      ...baseAsset,
      type: "video",
      metadata: normalizePostAssetMetadata("video", row.metadata_json),
    };
  }

  return {
    ...baseAsset,
    type: "image",
    metadata: normalizePostAssetMetadata("image", row.metadata_json),
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
        metadata_json,
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

async function loadPostAssetRowsForPost(
  businessId: string,
  postId: string,
): Promise<PostAssetRow[]> {
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
        metadata_json,
        created_at,
        updated_at
      from post_assets
      where business_id = $1
        and post_id = $2
      order by order_index asc, created_at asc
    `,
    [businessId, postId],
  );

  return result.rows;
}

export async function createMediaUploadUrl(
  principal: AuthenticatedPrincipal,
  input: CreateMediaUploadUrlRequest,
): Promise<CreateMediaUploadUrlResponse> {
  const businessId = input.businessId.trim();
  const postId = input.postId.trim();
  const mimeType = normalizeMimeType(input.fileType);
  validatePostAssetInput(mimeType, input.sizeBytes, input.assetType);

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);
  await ensureContentPostOwnership(businessId, postId);

  if ((await countPostAssets(postId)) >= MAX_POST_ASSET_COUNT) {
    throw new HttpError(
      400,
      "post_asset_limit_reached",
      `A post can have up to ${MAX_POST_ASSET_COUNT} media assets right now.`,
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
  const type = validatePostAssetInput(mimeType, input.sizeBytes, input.type);
  const source = input.source ?? "upload";
  const metadata =
    type === "video"
      ? normalizePostAssetMetadata("video", input.metadata)
      : normalizePostAssetMetadata("image", input.metadata);

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);
  await ensureContentPostOwnership(businessId, postId);

  if ((await countPostAssets(postId)) >= MAX_POST_ASSET_COUNT) {
    throw new HttpError(
      400,
      "post_asset_limit_reached",
      `A post can have up to ${MAX_POST_ASSET_COUNT} media assets right now.`,
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
        status,
        metadata_json
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
        'ready',
        $10::jsonb
      )
      on conflict (post_id, storage_key)
      do update set
        type = excluded.type,
        source = excluded.source,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        metadata_json = excluded.metadata_json,
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
        metadata_json,
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
      JSON.stringify(metadata),
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
    assetType: asset.type,
  });

  return { asset };
}

export async function createPromoVisualPostAsset(
  principal: AuthenticatedPrincipal,
  input: CreatePromoVisualPostAssetRequest,
): Promise<CreatePromoVisualPostAssetResponse> {
  const businessId = input.businessId.trim();
  const postId = input.postId.trim();
  const layout = parsePromoVisualLayoutId(input.layout);
  const headline = truncateAtWordBoundary(input.headline, 120);
  const subheadline = truncateAtWordBoundary(input.subheadline, 180);
  const cta = truncateAtWordBoundary(input.cta, 28);
  const sourceAssetId = input.sourceAssetId?.trim() || undefined;
  const aspectRatio = input.aspectRatio === "9:16" ? "9:16" : "1:1";

  if (!headline) {
    throw new HttpError(400, "bad_request", "headline is required.");
  }

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);
  await ensureContentPostOwnership(businessId, postId);

  let screenshotBytes: Buffer | undefined;
  let usedSourceAssetId: string | undefined;

  if (sourceAssetId) {
    const sourceAssetRow = await loadPostAssetRow(sourceAssetId, businessId);

    if (
      !sourceAssetRow
      || sourceAssetRow.post_id !== postId
      || sourceAssetRow.type !== "image"
      || sourceAssetRow.status !== "ready"
    ) {
      throw new HttpError(
        404,
        "post_asset_not_found",
        "Select one ready image on this draft before using the screenshot layout.",
      );
    }

    screenshotBytes = await downloadPostAssetBytes(mapPostAsset(sourceAssetRow, false));
    usedSourceAssetId = sourceAssetId;
  }

  const [brandKit, brandLabel] = await Promise.all([
    getBrandKitForBusiness({
      principal,
      businessId,
    }),
    loadBusinessPromoLabel(businessId),
  ]);

  const renderedPromoVisual = await composePromoVisual({
    brandKit,
    brandLabel,
    headline,
    subheadline,
    cta,
    layout,
    aspectRatio,
    screenshotBytes,
  });
  const storageKey = buildStorageKey({
    businessId,
    postId,
    mimeType: "image/png",
    fileName: `promo-${renderedPromoVisual.resolvedLayout}.png`,
  });

  await uploadPostAssetBytesToStorage({
    storageKey,
    bytes: renderedPromoVisual.bytes,
    mimeType: "image/png",
  });

  const createResponse = await createPostAsset(principal, {
    businessId,
    postId,
    storageKey,
    storageUrl: buildStorageUrl(storageKey),
    mimeType: "image/png",
    sizeBytes: renderedPromoVisual.bytes.byteLength,
    type: "image",
    source: "generated",
    metadata: {
      aspectRatio: renderedPromoVisual.aspectRatio,
      source: "promo_composer",
    },
  });

  return {
    asset: createResponse.asset,
    resolvedLayout: renderedPromoVisual.resolvedLayout,
    usedLogo: renderedPromoVisual.usedLogo,
    usedSourceAssetId:
      renderedPromoVisual.usedSourceImage && usedSourceAssetId ? usedSourceAssetId : undefined,
  };
}

export async function generateMotionPostAsset(
  principal: AuthenticatedPrincipal,
  input: GenerateMotionPostAssetRequest,
): Promise<GenerateMotionPostAssetResponse> {
  const businessId = input.businessId.trim();
  const postId = input.postId.trim();
  const sourceAssetId = input.sourceAssetId.trim();
  const motionTemplate = parseMotionTemplateMetadata(input.motionTemplate);

  if (!motionTemplate) {
    throw new HttpError(400, "bad_request", "motionTemplate is required.");
  }

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);
  await ensureContentPostOwnership(businessId, postId);

  const sourceAssetRow = await loadPostAssetRow(sourceAssetId, businessId);

  if (!sourceAssetRow || sourceAssetRow.post_id !== postId || sourceAssetRow.type !== "image" || sourceAssetRow.status !== "ready") {
    throw new HttpError(
      404,
      "post_asset_not_found",
      "Select one ready image on this draft before creating a motion teaser.",
    );
  }

  const readyAssets = await loadReadyPostAssets(businessId, postId);
  const existingDerivedVideos = readyAssets.filter((asset) =>
    asset.type === "video"
    && asset.metadata.source === "motion_template"
    && asset.metadata.posterAssetId === sourceAssetId,
  );
  const unrelatedReadyVideos = readyAssets.filter((asset) =>
    asset.type === "video"
    && !existingDerivedVideos.some((candidate) => candidate.id === asset.id),
  );

  if (unrelatedReadyVideos.length > 0) {
    throw new HttpError(
      400,
      "motion_already_attached",
      "This draft already has another video attached. Remove it before generating a motion teaser from the current image.",
    );
  }

  const sourceAsset = mapPostAsset(sourceAssetRow, false);
  const motionAspectRatio = resolveMotionAspectRatio(motionTemplate);
  const brandKit = await getBrandKitForBusiness({
    principal,
    businessId,
  });
  const removedAssetIds: string[] = [];

  for (const asset of existingDerivedVideos) {
    await deletePostAsset(principal, businessId, asset.id);
    removedAssetIds.push(asset.id);
  }

  const renderedVideo = await renderMotionVideoFromImage({
    sourceBytes: await downloadPostAssetBytes(sourceAsset),
    template: motionTemplate,
    brandKit,
  });
  const resolvedAudio = await resolveMotionAudioConfig(motionTemplate, motionAspectRatio);
  const storageKey = buildStorageKey({
    businessId,
    postId,
    mimeType: "video/mp4",
    fileName: `${motionTemplate.id}.mp4`,
  });

  await uploadPostAssetBytesToStorage({
    storageKey,
    bytes: renderedVideo.bytes,
    mimeType: "video/mp4",
  });

  const createResponse = await createPostAsset(principal, {
    businessId,
    postId,
    storageKey,
    storageUrl: buildStorageUrl(storageKey),
    mimeType: "video/mp4",
    sizeBytes: renderedVideo.bytes.byteLength,
    type: "video",
    source: "generated",
    metadata: {
      aspectRatio: renderedVideo.aspectRatio,
      source: "motion_template",
      durationMs: renderedVideo.durationMs,
      width: renderedVideo.width,
      height: renderedVideo.height,
      motionTemplate: {
        id: motionTemplate.id,
        aspectRatio: motionAspectRatio,
        durationMs: renderedVideo.durationMs,
        loop: false,
        sourceSlideCount: 1,
        overlay: motionTemplate.overlay,
        audio: {
          enabled: resolvedAudio.enabled,
          music: {
            enabled: resolvedAudio.enabled,
            preset: resolvedAudio.preset,
            track: resolvedAudio.track,
            volume: resolvedAudio.volume,
            fadeIn: resolvedAudio.fadeIn,
            fadeOut: resolvedAudio.fadeOut,
            ducking: motionTemplate.audio?.music?.ducking
              ?? motionTemplate.audio?.ducking
              ?? resolvedAudio.ducking,
          },
          voice: {
            enabled: motionTemplate.audio?.voice?.enabled ?? false,
            script: motionTemplate.audio?.voice?.script ?? null,
            provider: motionTemplate.audio?.voice?.provider ?? DEFAULT_MOTION_VOICE_PROVIDER,
            voiceId: motionTemplate.audio?.voice?.voiceId ?? null,
            storageKey: motionTemplate.audio?.voice?.storageKey ?? null,
            assetUrl: motionTemplate.audio?.voice?.assetUrl ?? null,
            volume: motionTemplate.audio?.voice?.volume,
          },
          preset: resolvedAudio.preset,
          track: resolvedAudio.track,
          volume: resolvedAudio.volume,
          fadeIn: resolvedAudio.fadeIn,
          fadeOut: resolvedAudio.fadeOut,
          ducking: motionTemplate.audio?.music?.ducking ?? motionTemplate.audio?.ducking ?? resolvedAudio.ducking,
          voiceTrack: motionTemplate.audio?.voice?.storageKey ?? motionTemplate.audio?.voiceTrack ?? null,
        },
      },
      posterAssetId: sourceAssetId,
    },
  });

  return {
    asset: createResponse.asset,
    removedAssetIds,
  };
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
        metadata_json,
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

export async function reorderPostAssets(
  principal: AuthenticatedPrincipal,
  input: ReorderPostAssetsRequest,
): Promise<ReorderPostAssetsResponse> {
  const businessId = input.businessId.trim();
  const postId = input.postId.trim();
  const assetIds = input.assetIds
    .map((assetId) => assetId.trim())
    .filter((assetId) => assetId !== "");

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);
  await ensureContentPostOwnership(businessId, postId);

  if (assetIds.length === 0) {
    throw new HttpError(400, "bad_request", "assetIds are required.");
  }

  if (new Set(assetIds).size !== assetIds.length) {
    throw new HttpError(400, "bad_request", "assetIds must be unique.");
  }

  const existingAssets = await loadPostAssetRowsForPost(businessId, postId);

  if (existingAssets.length !== assetIds.length) {
    throw new HttpError(
      400,
      "bad_request",
      "assetIds must include every media item currently attached to this draft.",
    );
  }

  const existingAssetIds = new Set(existingAssets.map((asset) => asset.id));

  if (assetIds.some((assetId) => !existingAssetIds.has(assetId))) {
    throw new HttpError(
      400,
      "bad_request",
      "assetIds must reference only media already attached to this draft.",
    );
  }

  const rows = await withDbTransaction(async (client) => {
    await client.query(
      `
        update post_assets as pa
        set
          order_index = ordering.order_index,
          updated_at = now()
        from (
          select asset_id, ordinality - 1 as order_index
          from unnest($3::uuid[]) with ordinality as ordered(asset_id, ordinality)
        ) as ordering
        where pa.id = ordering.asset_id
          and pa.business_id = $1
          and pa.post_id = $2
      `,
      [businessId, postId, assetIds],
    );

    const result = await client.query<PostAssetRow>(
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
          metadata_json,
          created_at,
          updated_at
        from post_assets
        where business_id = $1
          and post_id = $2
        order by order_index asc, created_at asc
      `,
      [businessId, postId],
    );

    return result.rows;
  });

  return {
    assets: rows.map((row) => mapPostAsset(row, true)),
  };
}

export async function getPostAsset(
  principal: AuthenticatedPrincipal,
  businessId: string,
  assetId: string,
): Promise<GetPostAssetResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);

  const asset = await loadPostAssetRow(assetId, businessId);

  if (!asset) {
    throw new HttpError(404, "post_asset_not_found", "Post asset not found.");
  }

  return {
    asset: mapPostAsset(asset, true),
  };
}

export async function getPostAssetDownload(
  principal: AuthenticatedPrincipal,
  businessId: string,
  assetId: string,
): Promise<DownloadPostAssetResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);

  const asset = await loadPostAssetRow(assetId, businessId);

  if (!asset) {
    throw new HttpError(404, "post_asset_not_found", "Post asset not found.");
  }

  const mappedAsset = mapPostAsset(asset, true);

  return {
    asset: mappedAsset,
    downloadUrl: createPostAssetDownloadUrl(mappedAsset, 3600),
    fileName: buildPostAssetFileName(mappedAsset),
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
        metadata_json,
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

export async function loadReadyPostAssets(
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
        metadata_json,
        created_at,
        updated_at
      from post_assets
      where business_id = $1
        and post_id = $2
        and status = 'ready'
      order by order_index asc, created_at asc
    `,
    [businessId, postId],
  );

  return result.rows.map((row) => mapPostAsset(row, false));
}

export async function loadReadyPostImageAssets(
  businessId: string,
  postId: string,
): Promise<PostAsset[]> {
  const assets = await loadReadyPostAssets(businessId, postId);
  return assets.filter((asset) => asset.type === "image");
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

export async function uploadPostAssetBytesToStorage(input: {
  storageKey: string;
  bytes: Buffer;
  mimeType: string;
}): Promise<void> {
  const uploadUrl = createS3PresignedUrl({
    method: "PUT",
    key: input.storageKey,
    expiresInSeconds: 300,
    contentType: input.mimeType,
  });

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": input.mimeType,
      "Content-Length": String(input.bytes.byteLength),
    },
    body: input.bytes,
  });

  if (!response.ok) {
    throw new HttpError(
      502,
      "post_asset_upload_failed",
      "Unable to store the normalized media asset in storage.",
    );
  }
}

export function createPostAssetDownloadUrl(
  asset: Pick<PostAsset, "storageKey">,
  expiresInSeconds = 3600,
): string {
  return createS3PresignedUrl({
    method: "GET",
    key: asset.storageKey,
    expiresInSeconds,
  });
}

export function createPostAssetPublicUrl(asset: Pick<PostAsset, "storageKey">): string {
  return buildPublicUrl(asset.storageKey);
}

export function createPostAssetPublicUrlForBase(
  asset: Pick<PostAsset, "storageKey">,
  publicBaseUrl: string,
): string {
  return buildPublicUrlForBase(asset.storageKey, publicBaseUrl);
}

export function createPostAssetDirectS3Url(asset: Pick<PostAsset, "storageKey">): string {
  const bucket = resolveMediaBucket();
  const region = resolveAwsRegion();
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodeS3Path(asset.storageKey)}`;
}

export function createPostAssetGlobalS3Url(asset: Pick<PostAsset, "storageKey">): string {
  const bucket = resolveMediaBucket();
  return `https://s3.amazonaws.com/${bucket}/${encodeS3Path(asset.storageKey)}`;
}
