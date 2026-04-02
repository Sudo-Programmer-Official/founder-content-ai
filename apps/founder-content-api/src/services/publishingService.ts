import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import sharp from "sharp";
import type { PostAsset, ScheduledPostSlide } from "../../../../packages/shared-types/index.ts";
import { HttpError } from "../utils/http.ts";
import { logInfo, logWarn } from "../utils/logger.ts";
import {
  createPostAssetDirectS3Url,
  createPostAssetDownloadUrl,
  createPostAssetPublicUrl,
  downloadPostAssetBytes,
  uploadPostAssetBytesToStorage,
} from "./postAssetService.ts";
import {
  getLinkedInPublishingCredentialsForBusiness,
  getMetaPublishingCredentialsForBusiness,
} from "./socialAuthService.ts";

const LINKEDIN_IMAGES_API_URL = "https://api.linkedin.com/rest/images";
const LINKEDIN_POSTS_API_URL = "https://api.linkedin.com/rest/posts";
const META_GRAPH_BASE_URL = "https://graph.facebook.com";
const META_FETCH_USER_AGENT = "facebookexternalhit/1.1";

interface LinkedInImageInitializationResponse {
  value?: {
    uploadUrl?: string;
    image?: string;
  };
  message?: string;
}

interface LinkedInErrorPayload {
  message?: string;
  error_description?: string;
}

interface LinkedInPostCreationResult {
  externalPostId: string;
  externalPostUrl?: string;
  response: Record<string, unknown>;
}

interface MetaGraphErrorPayload {
  error?: {
    code?: number;
    error_subcode?: number;
    type?: string;
    fbtrace_id?: string;
    message?: string;
    error_user_msg?: string;
  };
  message?: string;
}

interface MetaInstagramContainerStatusPayload {
  status_code?: string;
  status?: string;
}

interface MetaInstagramMediaPayload {
  id?: string;
  permalink?: string;
}

interface MetaFacebookPhotoPayload {
  id?: string;
  post_id?: string;
}

interface MetaFacebookVideoPayload {
  id?: string;
  post_id?: string;
  success?: boolean;
}

interface MetaFacebookPostPayload {
  id?: string;
  permalink_url?: string;
}

export type PublishingChannel = "linkedin" | "instagram" | "facebook" | "x";

export interface PublishPlatformPostInput {
  channel: PublishingChannel;
  businessId: string;
  contentText: string;
  assets?: PostAsset[];
  slides?: ScheduledPostSlide[];
  socialAccountId?: string | null;
  socialAccountIdentityId?: string | null;
}

export interface PublishMediaValidationSummary {
  totalCount: number;
  imageCount: number;
  videoCount: number;
  slideCount: number;
}

function countPostAssetsByType(assets: PostAsset[]): { imageCount: number; videoCount: number } {
  let imageCount = 0;
  let videoCount = 0;

  for (const asset of assets) {
    if (asset.type === "image") {
      imageCount += 1;
      continue;
    }

    if (asset.type === "video") {
      videoCount += 1;
    }
  }

  return { imageCount, videoCount };
}

function resolvePublishingChannelLabel(channel: "linkedin" | "facebook" | "instagram"): string {
  switch (channel) {
    case "linkedin":
      return "LinkedIn";
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
  }
}

function isAcceptedInstagramImageMimeType(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return normalized === "image/jpeg" || normalized === "image/jpg";
}

export function validatePublishMediaForChannel(input: {
  channel: "linkedin" | "facebook" | "instagram";
  assets?: PostAsset[];
  slides?: ScheduledPostSlide[];
}): PublishMediaValidationSummary {
  const assets = input.assets ?? [];
  const slides = input.slides ?? [];
  const { imageCount, videoCount } = countPostAssetsByType(assets);
  const slideCount = slides.length;
  const totalCount = imageCount + videoCount + slideCount;
  const channelLabel = resolvePublishingChannelLabel(input.channel);

  if (imageCount > 0 && videoCount > 0) {
    throw new HttpError(
      400,
      "mixed_assets_not_supported",
      "Mixed image and video drafts are not publishable yet. Use only one media type per post.",
    );
  }

  if (assets.length > 0 && slideCount > 0) {
    throw new HttpError(
      400,
      "mixed_asset_sources_not_supported",
      "Publishing does not support mixing attached assets and slide payloads in one request.",
    );
  }

  if (videoCount > 0) {
    if (input.channel === "linkedin") {
      throw new HttpError(
        400,
        "unsupported_asset_type",
        "Video is publishable on Instagram and Facebook. LinkedIn video support is coming soon.",
      );
    }

    if (slideCount > 0) {
      throw new HttpError(
        400,
        "mixed_asset_sources_not_supported",
        "Publishing does not support mixing attached assets and slide payloads in one request.",
      );
    }

    if (videoCount !== 1) {
      throw new HttpError(
        400,
        input.channel === "instagram" ? "instagram_invalid_video_count" : "facebook_invalid_video_count",
        `${channelLabel} video publishing currently supports exactly one ready video asset per post.`,
      );
    }
  }

  if (input.channel === "instagram") {
    if (slideCount > 0) {
      throw new HttpError(
        400,
        "instagram_asset_conversion_required",
        "Instagram publishing currently requires attached image assets instead of slide payloads.",
      );
    }

    if (videoCount === 0 && (imageCount < 1 || imageCount > 10)) {
      throw new HttpError(
        400,
        "instagram_invalid_image_count",
        "Instagram publishing requires between 1 and 10 ready image assets.",
      );
    }
  }

  if (input.channel === "facebook" && videoCount === 0 && totalCount > 10) {
    throw new HttpError(
      400,
      "facebook_invalid_image_count",
      "Facebook publishing supports up to 10 images per post.",
    );
  }

  if (input.channel === "linkedin" && totalCount > 20) {
    throw new HttpError(
      400,
      "invalid_image_count",
      "LinkedIn image posts support at most 20 images.",
    );
  }

  return {
    totalCount,
    imageCount,
    videoCount,
    slideCount,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveLinkedInApiVersion(): string {
  return process.env.LINKEDIN_API_VERSION?.trim() || "202602";
}

function resolveMetaGraphVersion(): string {
  return process.env.META_GRAPH_VERSION?.trim() || "v21.0";
}

function buildLinkedInHeaders(
  accessToken: string,
  hasJsonBody = true,
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Linkedin-Version": resolveLinkedInApiVersion(),
    "X-Restli-Protocol-Version": "2.0.0",
    ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
  };
}

function buildMetaGraphUrl(path: string): string {
  return `${META_GRAPH_BASE_URL}/${resolveMetaGraphVersion()}/${path.replace(/^\/+/, "")}`;
}

function isPrivateIpAddress(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();

  if (normalized === "::1") {
    return true;
  }

  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) {
    return true;
  }

  const version = isIP(normalized);

  if (version !== 4) {
    return false;
  }

  const octets = normalized.split(".").map((segment) => Number(segment));
  const [first, second] = octets;

  return (
    first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
  );
}

function assertPublicHttpsUrl(value: string, message: string, errorCode = "instagram_image_url_not_public"): void {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, errorCode, message);
  }

  const hostname = parsed.hostname.trim().toLowerCase();

  if (
    parsed.protocol !== "https:"
    || !hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.endsWith(".test")
    || hostname.endsWith(".example")
    || hostname.endsWith(".invalid")
    || isPrivateIpAddress(hostname)
    || (isIP(hostname) === 0 && !hostname.includes("."))
  ) {
    throw new HttpError(400, errorCode, message);
  }
}

function buildLinkedInExternalPostUrl(externalPostId: string): string {
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(externalPostId)}`;
}

function buildFacebookExternalPostUrl(externalPostId: string): string {
  return `https://www.facebook.com/${encodeURIComponent(externalPostId)}`;
}

function extractMetaGraphErrorMessage(payload: MetaGraphErrorPayload, fallbackMessage: string): string {
  return (
    payload.error?.error_user_msg?.trim()
    || payload.error?.message?.trim()
    || payload.message?.trim()
    || fallbackMessage
  );
}

async function postMetaGraphForm<TPayload extends MetaGraphErrorPayload>(
  path: string,
  accessToken: string,
  params: Record<string, string | undefined>,
  options?: {
    errorCode?: string;
    fallbackMessage?: string;
  },
): Promise<TPayload> {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.trim() !== "") {
      body.set(key, value);
    }
  }

  body.set("access_token", accessToken);

  const response = await fetch(buildMetaGraphUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as TPayload;

  if (!response.ok || payload.error?.message) {
    logWarn("Meta Graph form request failed.", {
      path,
      statusCode: response.status,
      errorCode: payload.error?.code,
      errorSubcode: payload.error?.error_subcode,
      errorType: payload.error?.type,
      errorMessage: payload.error?.message,
      errorUserMessage: payload.error?.error_user_msg,
      fbTraceId: payload.error?.fbtrace_id,
    });

    throw new HttpError(
      502,
      options?.errorCode ?? "instagram_post_failed",
      extractMetaGraphErrorMessage(payload, options?.fallbackMessage ?? "Meta Graph request failed."),
    );
  }

  return payload;
}

async function getMetaGraphJson<TPayload extends MetaGraphErrorPayload>(
  path: string,
  accessToken: string,
  params: Record<string, string | undefined>,
  options?: {
    errorCode?: string;
    fallbackMessage?: string;
  },
): Promise<TPayload> {
  const url = new URL(buildMetaGraphUrl(path));

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.trim() !== "") {
      url.searchParams.set(key, value);
    }
  }

  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString());
  const payload = (await response.json().catch(() => ({}))) as TPayload;

  if (!response.ok || payload.error?.message) {
    logWarn("Meta Graph JSON request failed.", {
      path,
      statusCode: response.status,
      errorCode: payload.error?.code,
      errorSubcode: payload.error?.error_subcode,
      errorType: payload.error?.type,
      errorMessage: payload.error?.message,
      errorUserMessage: payload.error?.error_user_msg,
      fbTraceId: payload.error?.fbtrace_id,
    });

    throw new HttpError(
      502,
      options?.errorCode ?? "instagram_post_failed",
      extractMetaGraphErrorMessage(payload, options?.fallbackMessage ?? "Meta Graph request failed."),
    );
  }

  return payload;
}

async function postMetaGraphMultipart<TPayload extends MetaGraphErrorPayload>(
  path: string,
  accessToken: string,
  params: Record<string, string | undefined>,
  file: {
    fieldName: string;
    bytes: Buffer;
    mimeType: string;
    fileName: string;
  },
  options?: {
    errorCode?: string;
    fallbackMessage?: string;
  },
): Promise<TPayload> {
  const body = new FormData();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.trim() !== "") {
      body.set(key, value);
    }
  }

  body.set("access_token", accessToken);
  body.set(file.fieldName, new Blob([file.bytes], { type: file.mimeType }), file.fileName);

  const response = await fetch(buildMetaGraphUrl(path), {
    method: "POST",
    body,
  });
  const payload = (await response.json().catch(() => ({}))) as TPayload;

  if (!response.ok || payload.error?.message) {
    throw new HttpError(
      502,
      options?.errorCode ?? "facebook_post_failed",
      extractMetaGraphErrorMessage(payload, options?.fallbackMessage ?? "Meta Graph request failed."),
    );
  }

  return payload;
}

function parseDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());

  if (!match) {
    throw new HttpError(400, "invalid_slide", "Scheduled slide must be a base64 data URL.");
  }

  return {
    mimeType: match[1].toLowerCase(),
    bytes: Buffer.from(match[2], "base64"),
  };
}

function resolveImageFileName(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "upload.jpg";
    case "image/png":
      return "upload.png";
    case "image/gif":
      return "upload.gif";
    default:
      return "upload.bin";
  }
}

function buildBaseLinkedInPostPayload(authorUrn: string, commentary: string): Record<string, unknown> {
  return {
    author: authorUrn,
    commentary,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
}

function collectTaggedEntitiesPaths(value: unknown, currentPath = "$"): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectTaggedEntitiesPaths(entry, `${currentPath}[${index}]`));
  }

  const record = value as Record<string, unknown>;
  const taggedEntitiesPath =
    Object.prototype.hasOwnProperty.call(record, "taggedEntities") ? [`${currentPath}.taggedEntities`] : [];

  return Object.entries(record).flatMap(([key, entry]) =>
    key === "taggedEntities"
      ? taggedEntitiesPath
      : collectTaggedEntitiesPaths(entry, `${currentPath}.${key}`),
  );
}

async function createLinkedInPost(
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<LinkedInPostCreationResult> {
  const taggedEntitiesPaths = collectTaggedEntitiesPaths(payload);

  if (taggedEntitiesPaths.length > 0) {
    throw new HttpError(
      422,
      "linkedin_payload_invalid",
      `LinkedIn payload contains unsupported taggedEntities fields at ${taggedEntitiesPaths.join(", ")}.`,
    );
  }

  const postResponse = await fetch(LINKEDIN_POSTS_API_URL, {
    method: "POST",
    headers: buildLinkedInHeaders(accessToken),
    body: JSON.stringify(payload),
  });

  if (!postResponse.ok) {
    const responsePayload = (await postResponse.json().catch(() => ({}))) as LinkedInErrorPayload;
    throw new HttpError(
      502,
      "linkedin_post_failed",
      responsePayload.message ??
        responsePayload.error_description ??
        "LinkedIn post creation failed.",
    );
  }

  const externalPostId =
    postResponse.headers.get("x-restli-id") ||
    postResponse.headers.get("x-linkedin-id") ||
    "";

  if (!externalPostId) {
    throw new HttpError(
      502,
      "linkedin_post_failed",
      "LinkedIn post creation succeeded without returning a post identifier.",
    );
  }

  return {
    externalPostId,
    externalPostUrl: buildLinkedInExternalPostUrl(externalPostId),
    response: {
      externalPostId,
      externalPostUrl: buildLinkedInExternalPostUrl(externalPostId),
    },
  };
}

function ensureSupportedLinkedInImageType(mimeType: string): void {
  if (!["image/png", "image/jpeg", "image/gif"].includes(mimeType)) {
    throw new HttpError(
      400,
      "unsupported_slide_format",
      "Image uploads support PNG, JPG, and GIF formats only.",
    );
  }
}

async function initializeLinkedInImageUpload(
  accessToken: string,
  ownerUrn: string,
): Promise<{ uploadUrl: string; imageUrn: string }> {
  const response = await fetch(`${LINKEDIN_IMAGES_API_URL}?action=initializeUpload`, {
    method: "POST",
    headers: buildLinkedInHeaders(accessToken),
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: ownerUrn,
      },
    }),
  });

  const payload = (await response.json()) as LinkedInImageInitializationResponse;

  if (!response.ok || !payload.value?.uploadUrl || !payload.value.image) {
    throw new HttpError(
      502,
      "linkedin_upload_init_failed",
      payload.message ?? "LinkedIn image upload initialization failed.",
    );
  }

  return {
    uploadUrl: payload.value.uploadUrl,
    imageUrn: payload.value.image,
  };
}

async function uploadSlideToLinkedIn(
  accessToken: string,
  ownerUrn: string,
  slide: ScheduledPostSlide,
): Promise<{ imageUrn: string; altText?: string }> {
  const parsed = parseDataUrl(slide.imageDataUrl);
  ensureSupportedLinkedInImageType(parsed.mimeType);
  return uploadImageBytesToLinkedIn(accessToken, ownerUrn, {
    bytes: parsed.bytes,
    mimeType: slide.mimeType?.trim() || parsed.mimeType,
    altText: slide.altText?.trim() || undefined,
  });
}

async function uploadImageBytesToLinkedIn(
  accessToken: string,
  ownerUrn: string,
  input: { bytes: Buffer; mimeType: string; altText?: string },
): Promise<{ imageUrn: string; altText?: string }> {
  ensureSupportedLinkedInImageType(input.mimeType);
  const initialization = await initializeLinkedInImageUpload(accessToken, ownerUrn);
  const uploadResponse = await fetch(initialization.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": input.mimeType,
    },
    body: input.bytes,
  });

  if (!uploadResponse.ok) {
    const payload =
      (await uploadResponse.text().catch(() => "")) || "LinkedIn image upload failed.";
    throw new HttpError(502, "linkedin_upload_failed", payload);
  }

  return {
    imageUrn: initialization.imageUrn,
    altText: input.altText,
  };
}

async function uploadPostAssetToLinkedIn(
  accessToken: string,
  ownerUrn: string,
  asset: PostAsset,
): Promise<{ imageUrn: string; altText?: string }> {
  const bytes = await downloadPostAssetBytes(asset);

  return uploadImageBytesToLinkedIn(accessToken, ownerUrn, {
    bytes,
    mimeType: asset.mimeType,
  });
}

function buildLinkedInMultiImageEntry(input: {
  imageUrn: string;
  altText?: string;
}): Record<string, unknown> {
  return {
    id: input.imageUrn,
    ...(input.altText ? { altText: input.altText.slice(0, 4086) } : {}),
  };
}

export async function publishLinkedInMultiImagePost(input: {
  businessId: string;
  contentText: string;
  slides: ScheduledPostSlide[];
  socialAccountId?: string | null;
  socialAccountIdentityId?: string | null;
}): Promise<{ externalPostId: string; response: Record<string, unknown> }> {
  if (input.slides.length < 2 || input.slides.length > 20) {
    throw new HttpError(
      400,
      "invalid_slide_count",
      "LinkedIn multi-image posts require between 2 and 20 images.",
    );
  }

  const credentials = await getLinkedInPublishingCredentialsForBusiness({
    businessId: input.businessId,
    socialAccountId: input.socialAccountId,
    socialAccountIdentityId: input.socialAccountIdentityId,
  });
  const uploadedSlides = [];

  for (const slide of input.slides) {
    uploadedSlides.push(
      await uploadSlideToLinkedIn(credentials.accessToken, credentials.selectedIdentityUrn, slide),
    );
  }

  const postCreation = await createLinkedInPost(
    credentials.accessToken,
    {
      ...buildBaseLinkedInPostPayload(credentials.selectedIdentityUrn, input.contentText),
      content: {
        multiImage: {
          images: uploadedSlides.map((slide) => buildLinkedInMultiImageEntry(slide)),
        },
      },
    },
  );

  return {
    externalPostId: postCreation.externalPostId,
    response: {
      ...postCreation.response,
      uploadedImageCount: uploadedSlides.length,
    },
  };
}

export async function publishLinkedInImagePost(input: {
  businessId: string;
  contentText: string;
  assets: PostAsset[];
  socialAccountId?: string | null;
  socialAccountIdentityId?: string | null;
}): Promise<{ externalPostId: string; response: Record<string, unknown> }> {
  if (input.assets.length === 0) {
    throw new HttpError(400, "missing_post_assets", "At least one image asset is required.");
  }

  if (input.assets.length > 20) {
    throw new HttpError(
      400,
      "invalid_image_count",
      "LinkedIn image posts support at most 20 images.",
    );
  }

  const credentials = await getLinkedInPublishingCredentialsForBusiness({
    businessId: input.businessId,
    socialAccountId: input.socialAccountId,
    socialAccountIdentityId: input.socialAccountIdentityId,
  });
  const uploadedAssets = [];

  for (const asset of input.assets) {
    uploadedAssets.push(
      await uploadPostAssetToLinkedIn(
        credentials.accessToken,
        credentials.selectedIdentityUrn,
        asset,
      ),
    );
  }

  const content =
    uploadedAssets.length === 1
      ? {
          media: {
            id: uploadedAssets[0].imageUrn,
            ...(uploadedAssets[0].altText ? { altText: uploadedAssets[0].altText } : {}),
          },
        }
      : {
          multiImage: {
            images: uploadedAssets.map((asset) => buildLinkedInMultiImageEntry(asset)),
          },
        };

  const postCreation = await createLinkedInPost(credentials.accessToken, {
    ...buildBaseLinkedInPostPayload(credentials.selectedIdentityUrn, input.contentText),
    content,
  });

  return {
    externalPostId: postCreation.externalPostId,
    response: {
      ...postCreation.response,
      uploadedImageCount: uploadedAssets.length,
    },
  };
}

export async function publishLinkedInTextPost(input: {
  businessId: string;
  contentText: string;
  socialAccountId?: string | null;
  socialAccountIdentityId?: string | null;
}): Promise<{ externalPostId: string; response: Record<string, unknown> }> {
  const contentText = input.contentText.trim();

  if (!contentText) {
    throw new HttpError(400, "bad_request", "contentText is required.");
  }

  const credentials = await getLinkedInPublishingCredentialsForBusiness({
    businessId: input.businessId,
    socialAccountId: input.socialAccountId,
    socialAccountIdentityId: input.socialAccountIdentityId,
  });
  return createLinkedInPost(
    credentials.accessToken,
    buildBaseLinkedInPostPayload(credentials.selectedIdentityUrn, contentText),
  );
}

async function publishLinkedInPost(input: PublishPlatformPostInput): Promise<LinkedInPostCreationResult> {
  const assets = input.assets ?? [];
  const slides = input.slides ?? [];

  if (assets.length > 0) {
    return publishLinkedInImagePost({
      businessId: input.businessId,
      contentText: input.contentText,
      assets,
      socialAccountId: input.socialAccountId,
      socialAccountIdentityId: input.socialAccountIdentityId,
    });
  }

  if (slides.length > 0) {
    return publishLinkedInMultiImagePost({
      businessId: input.businessId,
      contentText: input.contentText,
      slides,
      socialAccountId: input.socialAccountId,
      socialAccountIdentityId: input.socialAccountIdentityId,
    });
  }

  return publishLinkedInTextPost({
    businessId: input.businessId,
    contentText: input.contentText,
    socialAccountId: input.socialAccountId,
    socialAccountIdentityId: input.socialAccountIdentityId,
  });
}

async function waitForInstagramContainerReady(
  creationId: string,
  accessToken: string,
): Promise<void> {
  const maxPolls = 6;

  for (let pollIndex = 0; pollIndex < maxPolls; pollIndex += 1) {
    if (pollIndex > 0) {
      await sleep(3000);
    }

    const statusPayload = await getMetaGraphJson<MetaInstagramContainerStatusPayload & MetaGraphErrorPayload>(
      creationId,
      accessToken,
      { fields: "status_code,status" },
      {
        errorCode: "instagram_post_failed",
        fallbackMessage: "Unable to inspect Instagram media processing status.",
      },
    );
    const normalizedStatus =
      statusPayload.status_code?.trim().toUpperCase()
      || statusPayload.status?.trim().toUpperCase()
      || "";

    if (!normalizedStatus || normalizedStatus === "FINISHED") {
      return;
    }

    if (normalizedStatus === "ERROR" || normalizedStatus === "EXPIRED") {
      throw new HttpError(
        502,
        "instagram_post_failed",
        "Instagram media processing failed before publish.",
      );
    }
  }

  throw new HttpError(
    502,
    "instagram_post_failed",
    "Instagram media processing did not finish before publish.",
  );
}

async function fetchInstagramMediaPermalink(
  mediaId: string,
  accessToken: string,
): Promise<string> {
  const payload = await getMetaGraphJson<MetaInstagramMediaPayload & MetaGraphErrorPayload>(
    mediaId,
    accessToken,
    { fields: "id,permalink" },
    {
      errorCode: "instagram_post_failed",
      fallbackMessage: "Unable to resolve the Instagram post permalink.",
    },
  );
  const permalink = payload.permalink?.trim();

  if (!permalink) {
    throw new HttpError(
      502,
      "instagram_post_failed",
      "Instagram publish succeeded without returning a permalink.",
    );
  }

  return permalink;
}

function resolvePublicAssetUrl(
  asset: Pick<PostAsset, "storageKey">,
  message: string,
  errorCode: string,
): string {
  const imageUrl = createPostAssetDownloadUrl(asset, 3600);
  assertPublicHttpsUrl(imageUrl, message, errorCode);

  return imageUrl;
}

function resolveInstagramAssetUrl(
  asset: Pick<PostAsset, "storageKey">,
  message: string,
  errorCode: string,
): string {
  const assetUrl = createPostAssetPublicUrl(asset);
  assertPublicHttpsUrl(assetUrl, message, errorCode);

  return assetUrl;
}

function normalizeAssetUrlForLogs(assetUrl: string): string {
  try {
    const parsed = new URL(assetUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return assetUrl;
  }
}

function looksLikeRawS3AssetUrl(assetUrl: string): boolean {
  try {
    const parsed = new URL(assetUrl);
    return /\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i.test(parsed.hostname) || /\.s3\.amazonaws\.com$/i.test(parsed.hostname);
  } catch {
    return /amazonaws\.com/i.test(assetUrl);
  }
}

function buildInstagramMediaAccessFailureMessage(assetUrl: string): string {
  if (looksLikeRawS3AssetUrl(assetUrl)) {
    return "Instagram could not access the current S3 asset URL. Configure S3_MEDIA_PUBLIC_BASE_URL to a truly public CDN or bucket URL, and ensure the object returns 200 without auth.";
  }

  return "The selected media URL is not publicly accessible. Configure a stable public HTTPS media URL with no auth or redirects.";
}

function hasSignedMediaUrlSignature(assetUrl: string): boolean {
  try {
    const parsed = new URL(assetUrl);
    const queryKeys = Array.from(parsed.searchParams.keys()).map((key) => key.trim().toLowerCase());

    return queryKeys.some((key) => (
      key.startsWith("x-amz-")
      || key.startsWith("x-goog-")
      || key === "awsaccesskeyid"
      || key === "googleaccessid"
      || key === "signature"
      || key === "key-pair-id"
    ));
  } catch {
    return /(x-amz-|x-goog-|awsaccesskeyid=|googleaccessid=|signature=|key-pair-id=)/i.test(assetUrl);
  }
}

function isSuccessfulMediaPreflightStatus(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

function isRedirectStatus(statusCode: number): boolean {
  return statusCode >= 300 && statusCode < 400;
}

function resolveMediaContentType(response: Response): string {
  return response.headers.get("content-type")?.trim().toLowerCase().split(";")[0] || "";
}

function resolveMediaContentLength(response: Response): number | null {
  const contentRange = response.headers.get("content-range")?.trim() || "";
  const totalBytesMatch = contentRange.match(/\/(\d+)\s*$/);

  if (totalBytesMatch) {
    const totalBytes = Number.parseInt(totalBytesMatch[1], 10);

    if (Number.isFinite(totalBytes) && totalBytes > 0) {
      return totalBytes;
    }
  }

  const contentLengthHeader = response.headers.get("content-length")?.trim() || "";
  const contentLength = Number.parseInt(contentLengthHeader, 10);

  if (Number.isFinite(contentLength) && contentLength > 0) {
    return contentLength;
  }
  return null;
}

function isAcceptedInstagramMediaContentType(
  contentType: string,
  expectedKind: "image" | "video",
): boolean {
  if (expectedKind === "image") {
    return contentType === "image/jpeg";
  }

  return contentType.startsWith("video/");
}

function resolveInstagramPublicMediaPrefix(): string {
  return process.env.S3_INSTAGRAM_PUBLIC_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "public-instagram";
}

function buildInstagramPublicStorageKey(asset: Pick<PostAsset, "businessId" | "postId" | "id">): string {
  return [
    resolveInstagramPublicMediaPrefix(),
    asset.businessId,
    asset.postId,
    `${asset.id}.jpg`,
  ].join("/");
}

interface InstagramReadyImageTarget {
  originalUrl: string;
  finalUrl: string;
  fallbackUrl?: string;
  sourceMimeType: string;
  publishMimeType: string;
  normalized: boolean;
}

function resolveInstagramFallbackUrl(storageKey: string, currentUrl: string): string | undefined {
  const directS3Url = createPostAssetDirectS3Url({ storageKey });
  return directS3Url === currentUrl ? undefined : directS3Url;
}

async function createInstagramReadyImageUrl(asset: PostAsset): Promise<InstagramReadyImageTarget> {
  if (asset.type !== "image") {
    throw new HttpError(
      400,
      "instagram_invalid_image_format",
      "Instagram image publishing requires a ready image asset.",
    );
  }

  const originalUrl = resolveInstagramAssetUrl(
    asset,
    "Instagram publishing requires a stable public HTTPS image URL.",
    "instagram_image_url_not_public",
  );

  const sourceBytes = await downloadPostAssetBytes(asset);
  const normalizedBytes = await sharp(sourceBytes)
    .flatten({ background: "#ffffff" })
    .toColorspace("srgb")
    .jpeg({
      quality: 90,
      mozjpeg: false,
      progressive: false,
      chromaSubsampling: "4:2:0",
    })
    .toBuffer();
  const normalizedStorageKey = buildInstagramPublicStorageKey(asset);
  const normalizedMetadata = await sharp(normalizedBytes).metadata();

  logInfo("Preparing public Instagram-ready image asset.", {
    assetId: asset.id,
    sourceMimeType: asset.mimeType,
    publishMimeType: "image/jpeg",
    originalUrl: normalizeAssetUrlForLogs(originalUrl),
    publicStorageKey: normalizedStorageKey,
    width: normalizedMetadata.width,
    height: normalizedMetadata.height,
    sizeBytes: normalizedBytes.byteLength,
    progressive: normalizedMetadata.isProgressive ?? false,
  });

  await uploadPostAssetBytesToStorage({
    storageKey: normalizedStorageKey,
    bytes: normalizedBytes,
    mimeType: "image/jpeg",
  });

  const finalUrl = createPostAssetDirectS3Url({ storageKey: normalizedStorageKey });

  logInfo("Prepared Instagram-ready public image asset.", {
    assetId: asset.id,
    sourceMimeType: asset.mimeType,
    publishMimeType: "image/jpeg",
    originalUrl: normalizeAssetUrlForLogs(originalUrl),
    finalUrl: normalizeAssetUrlForLogs(finalUrl),
  });

  return {
    originalUrl,
    finalUrl,
    fallbackUrl: resolveInstagramFallbackUrl(normalizedStorageKey, finalUrl),
    sourceMimeType: asset.mimeType,
    publishMimeType: "image/jpeg",
    normalized: !isAcceptedInstagramImageMimeType(asset.mimeType),
  };
}

async function assertMetaCanFetchAssetUrl(
  assetUrl: string,
  expectedKind: "image" | "video",
  errorCode: string,
): Promise<void> {
  const safeUrl = normalizeAssetUrlForLogs(assetUrl);

  if (hasSignedMediaUrlSignature(assetUrl)) {
    throw new HttpError(
      422,
      "presigned_url_not_allowed_for_instagram",
      "Instagram requires a stable public media URL. Expiring signed URLs are not allowed.",
      { mediaUrl: safeUrl },
    );
  }

  logInfo("Preflighting Instagram media URL.", {
    mediaUrl: safeUrl,
    expectedKind,
  });

  const headResponse = await fetch(assetUrl, {
    method: "HEAD",
    headers: {
      "User-Agent": META_FETCH_USER_AGENT,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);

  if (headResponse && isRedirectStatus(headResponse.status)) {
    throw new HttpError(
      422,
      errorCode,
      "Instagram publishing requires a direct public media URL with no redirects.",
      { mediaUrl: safeUrl },
    );
  }

  const response = await fetch(assetUrl, {
    method: "GET",
    headers: {
      "User-Agent": META_FETCH_USER_AGENT,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);

  if (!response) {
    throw new HttpError(
      422,
      errorCode,
      "The selected media URL is not publicly reachable from outside the app.",
      { mediaUrl: safeUrl },
    );
  }

  if (isRedirectStatus(response.status)) {
    throw new HttpError(
      422,
      errorCode,
      "Instagram publishing requires a direct public media URL with no redirects.",
      { mediaUrl: safeUrl },
    );
  }

  if (!isSuccessfulMediaPreflightStatus(response.status)) {
    logWarn("Instagram media URL preflight failed.", {
      mediaUrl: safeUrl,
      expectedKind,
      headStatusCode: headResponse?.status ?? null,
      getStatusCode: response.status,
      preflightMethod: "HEAD+GET",
      contentType: resolveMediaContentType(response),
    });

    throw new HttpError(
      422,
      errorCode,
      buildInstagramMediaAccessFailureMessage(assetUrl),
      { mediaUrl: safeUrl, statusCode: response.status },
    );
  }

  const contentType = resolveMediaContentType(response);
  const contentLength = resolveMediaContentLength(response);

  response.body?.cancel().catch(() => undefined);

  if (!isAcceptedInstagramMediaContentType(contentType, expectedKind)) {
    const message =
      expectedKind === "image"
        ? `Instagram publishing requires image/jpeg assets. The selected media URL returned ${contentType || "an unknown content type"}.`
        : `The selected media URL did not return a valid ${expectedKind} content type.`;

    throw new HttpError(
      422,
      errorCode,
      message,
      { mediaUrl: safeUrl, contentType },
    );
  }

  if (!contentLength) {
    throw new HttpError(
      422,
      errorCode,
      "Instagram publishing requires a direct media URL that returns a valid Content-Length header.",
      { mediaUrl: safeUrl, contentLength: null },
    );
  }

  logInfo("Instagram media URL passed preflight.", {
    mediaUrl: safeUrl,
    expectedKind,
    preflightMethod: "HEAD+GET",
    headStatusCode: headResponse?.status ?? null,
    statusCode: response.status,
    contentType,
    contentLength,
  });
}

function normalizeInstagramMediaFetchError(
  error: unknown,
  assetUrl: string,
): never {
  if (isInstagramMediaFetchFailure(error)) {
    const safeUrl = normalizeAssetUrlForLogs(assetUrl);

    logWarn("Instagram could not fetch the supplied media URL.", {
      mediaUrl: safeUrl,
    });

    throw new HttpError(
      422,
      "instagram_media_invalid",
      "Instagram could not download this media. Use a stable public HTTPS asset URL with no redirects or expiring signature.",
      { mediaUrl: safeUrl },
    );
  }

  throw error;
}

function isInstagramMediaFetchFailure(error: unknown): boolean {
  return (
    error instanceof HttpError
    && error.code === "instagram_post_failed"
    && /could not be fetched from this uri/i.test(error.message)
  );
}

async function createInstagramImageContainer(input: {
  instagramUserId: string;
  accessToken: string;
  asset: PostAsset;
  caption?: string;
  isCarouselItem?: boolean;
}): Promise<string> {
  const createContainer = async (imageUrl: string): Promise<{ id?: string } & MetaGraphErrorPayload> =>
    postMetaGraphForm<{ id?: string } & MetaGraphErrorPayload>(
      `${input.instagramUserId}/media`,
      input.accessToken,
      {
        image_url: imageUrl,
        caption: input.caption?.trim() || undefined,
        is_carousel_item: input.isCarouselItem ? "true" : undefined,
      },
      {
        errorCode: "instagram_post_failed",
        fallbackMessage: "Instagram media container creation failed.",
      },
    );

  const imageTarget = await createInstagramReadyImageUrl(input.asset);

  logInfo("Resolved Instagram publish media target.", {
    assetId: input.asset.id,
    originalUrl: normalizeAssetUrlForLogs(imageTarget.originalUrl),
    finalUrl: normalizeAssetUrlForLogs(imageTarget.finalUrl),
    sourceMimeType: input.asset.mimeType,
    publishMimeType: imageTarget.publishMimeType,
    normalized: imageTarget.normalized,
    isCarouselItem: Boolean(input.isCarouselItem),
  });

  await assertMetaCanFetchAssetUrl(imageTarget.finalUrl, "image", "instagram_media_invalid");
  let creation: { id?: string } & MetaGraphErrorPayload;

  try {
    creation = await createContainer(imageTarget.finalUrl);
  } catch (error) {
    if (
      isInstagramMediaFetchFailure(error)
      && imageTarget.fallbackUrl
      && imageTarget.fallbackUrl !== imageTarget.finalUrl
    ) {
      logWarn("Instagram rejected primary media URL. Retrying with direct S3 URL.", {
        assetId: input.asset.id,
        primaryUrl: normalizeAssetUrlForLogs(imageTarget.finalUrl),
        fallbackUrl: normalizeAssetUrlForLogs(imageTarget.fallbackUrl),
      });
      try {
        await assertMetaCanFetchAssetUrl(imageTarget.fallbackUrl, "image", "instagram_media_invalid");
      } catch (fallbackPreflightError) {
        logWarn("Instagram direct S3 fallback preflight failed.", {
          assetId: input.asset.id,
          primaryUrl: normalizeAssetUrlForLogs(imageTarget.finalUrl),
          fallbackUrl: normalizeAssetUrlForLogs(imageTarget.fallbackUrl),
          message: fallbackPreflightError instanceof Error ? fallbackPreflightError.message : "Unknown error",
        });

        throw new HttpError(
          422,
          "instagram_media_invalid",
          "Instagram rejected the CDN media URL, and the direct S3 origin is not publicly readable. Check CloudFront or CDN rules for Meta crawlers, or make the fallback origin public.",
          {
            primaryUrl: normalizeAssetUrlForLogs(imageTarget.finalUrl),
            fallbackUrl: normalizeAssetUrlForLogs(imageTarget.fallbackUrl),
          },
        );
      }
      try {
        creation = await createContainer(imageTarget.fallbackUrl);
      } catch (fallbackError) {
        normalizeInstagramMediaFetchError(fallbackError, imageTarget.fallbackUrl);
      }
    } else {
      normalizeInstagramMediaFetchError(error, imageTarget.finalUrl);
    }
  }

  const creationId = creation.id?.trim();

  if (!creationId) {
    throw new HttpError(
      502,
      "instagram_post_failed",
      "Instagram media container creation did not return an id.",
    );
  }

  await waitForInstagramContainerReady(creationId, input.accessToken);
  return creationId;
}

async function createInstagramVideoContainer(input: {
  instagramUserId: string;
  accessToken: string;
  asset: PostAsset;
  caption?: string;
}): Promise<string> {
  const videoUrl = resolveInstagramAssetUrl(
    input.asset,
    "Instagram publishing requires a stable public HTTPS video URL.",
    "instagram_video_url_not_public",
  );
  await assertMetaCanFetchAssetUrl(videoUrl, "video", "instagram_media_invalid");
  const creation = await postMetaGraphForm<{ id?: string } & MetaGraphErrorPayload>(
    `${input.instagramUserId}/media`,
    input.accessToken,
    {
      video_url: videoUrl,
      caption: input.caption?.trim() || undefined,
    },
    {
      errorCode: "instagram_post_failed",
      fallbackMessage: "Instagram video container creation failed.",
    },
  ).catch((error) => normalizeInstagramMediaFetchError(error, videoUrl));
  const creationId = creation.id?.trim();

  if (!creationId) {
    throw new HttpError(
      502,
      "instagram_post_failed",
      "Instagram video container creation did not return an id.",
    );
  }

  await waitForInstagramContainerReady(creationId, input.accessToken);
  return creationId;
}

async function fetchFacebookPostPermalink(
  postId: string,
  accessToken: string,
): Promise<string> {
  const payload = await getMetaGraphJson<MetaFacebookPostPayload & MetaGraphErrorPayload>(
    postId,
    accessToken,
    { fields: "id,permalink_url" },
    {
      errorCode: "facebook_post_failed",
      fallbackMessage: "Unable to resolve the Facebook post permalink.",
    },
  );

  return payload.permalink_url?.trim() || buildFacebookExternalPostUrl(postId);
}

async function uploadFacebookPhotoFromAsset(input: {
  pageId: string;
  accessToken: string;
  asset: PostAsset;
}): Promise<string> {
  const imageUrl = resolvePublicAssetUrl(
    input.asset,
    "Facebook publishing requires a public HTTPS image URL.",
    "facebook_image_url_not_public",
  );
  const payload = await postMetaGraphForm<MetaFacebookPhotoPayload & MetaGraphErrorPayload>(
    `${input.pageId}/photos`,
    input.accessToken,
    {
      url: imageUrl,
      published: "false",
    },
    {
      errorCode: "facebook_post_failed",
      fallbackMessage: "Facebook photo upload failed.",
    },
  );
  const photoId = payload.id?.trim();

  if (!photoId) {
    throw new HttpError(502, "facebook_post_failed", "Facebook photo upload did not return a media id.");
  }

  return photoId;
}

async function uploadFacebookPhotoFromSlide(input: {
  pageId: string;
  accessToken: string;
  slide: ScheduledPostSlide;
}): Promise<string> {
  const parsed = parseDataUrl(input.slide.imageDataUrl);
  ensureSupportedLinkedInImageType(parsed.mimeType);
  const mimeType = input.slide.mimeType?.trim() || parsed.mimeType;
  const payload = await postMetaGraphMultipart<MetaFacebookPhotoPayload & MetaGraphErrorPayload>(
    `${input.pageId}/photos`,
    input.accessToken,
    {
      published: "false",
    },
    {
      fieldName: "source",
      bytes: parsed.bytes,
      mimeType,
      fileName: resolveImageFileName(mimeType),
    },
    {
      errorCode: "facebook_post_failed",
      fallbackMessage: "Facebook photo upload failed.",
    },
  );
  const photoId = payload.id?.trim();

  if (!photoId) {
    throw new HttpError(502, "facebook_post_failed", "Facebook photo upload did not return a media id.");
  }

  return photoId;
}

async function uploadFacebookVideoFromAsset(input: {
  pageId: string;
  accessToken: string;
  asset: PostAsset;
  description?: string;
}): Promise<MetaFacebookVideoPayload> {
  const videoUrl = resolvePublicAssetUrl(
    input.asset,
    "Facebook publishing requires a public HTTPS video URL.",
    "facebook_video_url_not_public",
  );
  const payload = await postMetaGraphForm<MetaFacebookVideoPayload & MetaGraphErrorPayload>(
    `${input.pageId}/videos`,
    input.accessToken,
    {
      file_url: videoUrl,
      description: input.description?.trim() || undefined,
    },
    {
      errorCode: "facebook_post_failed",
      fallbackMessage: "Facebook video upload failed.",
    },
  );

  if (!payload.id?.trim() && !payload.post_id?.trim()) {
    throw new HttpError(502, "facebook_post_failed", "Facebook video upload did not return an id.");
  }

  return payload;
}

async function publishInstagram(
  input: PublishPlatformPostInput,
): Promise<LinkedInPostCreationResult> {
  const assets = input.assets ?? [];

  const credentials = await getMetaPublishingCredentialsForBusiness({
    businessId: input.businessId,
    channel: "instagram",
    socialAccountId: input.socialAccountId,
    socialAccountIdentityId: input.socialAccountIdentityId,
  });
  const caption = input.contentText.trim();
  const accessToken = credentials.accessToken;
  const instagramUserId = credentials.instagramUserId;

  if (!instagramUserId) {
    throw new HttpError(
      409,
      "instagram_not_connected",
      "The connected Facebook Page does not have a linked Instagram business account.",
    );
  }

  const creationId =
    assets.length === 1
      ? await (assets[0].type === "video"
        ? createInstagramVideoContainer({
          instagramUserId,
          accessToken,
          asset: assets[0],
          caption,
        })
        : createInstagramImageContainer({
          instagramUserId,
          accessToken,
          asset: assets[0],
          caption,
        }))
      : await (async () => {
        const childCreationIds = [];

        for (const [index, asset] of assets.entries()) {
          logInfo("Creating Instagram carousel child container.", {
            assetId: asset.id,
            childIndex: index,
            childCount: assets.length,
          });
          childCreationIds.push(
            await createInstagramImageContainer({
              instagramUserId,
              accessToken,
              asset,
              isCarouselItem: true,
            }),
          );
        }

        logInfo("Creating Instagram carousel parent container.", {
          childCount: childCreationIds.length,
        });
        const parentCreation = await postMetaGraphForm<{ id?: string } & MetaGraphErrorPayload>(
          `${instagramUserId}/media`,
          accessToken,
          {
            media_type: "CAROUSEL",
            children: childCreationIds.join(","),
            caption: caption || undefined,
          },
          {
            errorCode: "instagram_post_failed",
            fallbackMessage: "Instagram carousel container creation failed.",
          },
        );
        const parentCreationId = parentCreation.id?.trim();

        if (!parentCreationId) {
          throw new HttpError(
            502,
            "instagram_post_failed",
            "Instagram carousel container creation did not return an id.",
          );
        }

        await waitForInstagramContainerReady(parentCreationId, accessToken);
        return parentCreationId;
      })();

  const publishPayload = await postMetaGraphForm<{ id?: string } & MetaGraphErrorPayload>(
    `${instagramUserId}/media_publish`,
    accessToken,
    {
      creation_id: creationId,
    },
    {
      errorCode: "instagram_post_failed",
      fallbackMessage: "Instagram publish failed.",
    },
  );
  const externalPostId = publishPayload.id?.trim();

  if (!externalPostId) {
    throw new HttpError(
      502,
      "instagram_post_failed",
      "Instagram publish completed without returning a media id.",
    );
  }

  const externalPostUrl = await fetchInstagramMediaPermalink(externalPostId, accessToken);

  return {
    externalPostId,
    externalPostUrl,
    response: {
      externalPostId,
      externalPostUrl,
      creationId,
      uploadedImageCount: assets.filter((asset) => asset.type === "image").length,
      uploadedVideoCount: assets.filter((asset) => asset.type === "video").length,
      instagramUserId,
      instagramBusinessAccountId: credentials.instagramBusinessAccountId,
    },
  };
}

async function publishFacebook(
  input: PublishPlatformPostInput,
): Promise<LinkedInPostCreationResult> {
  const assets = input.assets ?? [];
  const slides = input.slides ?? [];
  const imageCount = assets.length + slides.length;
  const { videoCount } = countPostAssetsByType(assets);

  const credentials = await getMetaPublishingCredentialsForBusiness({
    businessId: input.businessId,
    channel: "facebook",
    socialAccountId: input.socialAccountId,
    socialAccountIdentityId: input.socialAccountIdentityId,
  });
  const pageId = credentials.pageId;
  const accessToken = credentials.pageAccessToken;
  const contentText = input.contentText.trim();

  if (videoCount === 1) {
    const videoPayload = await uploadFacebookVideoFromAsset({
      pageId,
      accessToken,
      asset: assets[0],
      description: contentText,
    });
    const externalPostId = videoPayload.post_id?.trim() || videoPayload.id?.trim();

    if (!externalPostId) {
      throw new HttpError(502, "facebook_post_failed", "Facebook video publish did not return an id.");
    }

    const externalPostUrl = await fetchFacebookPostPermalink(externalPostId, accessToken);

    return {
      externalPostId,
      externalPostUrl,
      response: {
        externalPostId,
        externalPostUrl,
        uploadedImageCount: 0,
        uploadedVideoCount: 1,
        videoId: videoPayload.id?.trim() || undefined,
      },
    };
  }

  if (imageCount === 0) {
    const payload = await postMetaGraphForm<MetaFacebookPostPayload & MetaGraphErrorPayload>(
      `${pageId}/feed`,
      accessToken,
      {
        message: contentText,
      },
      {
        errorCode: "facebook_post_failed",
        fallbackMessage: "Facebook post creation failed.",
      },
    );
    const externalPostId = payload.id?.trim();

    if (!externalPostId) {
      throw new HttpError(502, "facebook_post_failed", "Facebook post creation did not return an id.");
    }

    return {
      externalPostId,
      externalPostUrl: await fetchFacebookPostPermalink(externalPostId, accessToken),
      response: {
        externalPostId,
        externalPostUrl: await fetchFacebookPostPermalink(externalPostId, accessToken),
        uploadedImageCount: 0,
      },
    };
  }

  const mediaIds = [];

  for (const asset of assets) {
    mediaIds.push(await uploadFacebookPhotoFromAsset({ pageId, accessToken, asset }));
  }

  for (const slide of slides) {
    mediaIds.push(await uploadFacebookPhotoFromSlide({ pageId, accessToken, slide }));
  }

  const feedPayload = await postMetaGraphForm<MetaFacebookPostPayload & MetaGraphErrorPayload>(
    `${pageId}/feed`,
    accessToken,
    Object.fromEntries([
      ["message", contentText || undefined],
      ...mediaIds.map((mediaId, index) => [
        `attached_media[${index}]`,
        JSON.stringify({ media_fbid: mediaId }),
      ]),
    ]),
    {
      errorCode: "facebook_post_failed",
      fallbackMessage: "Facebook post creation failed.",
    },
  );
  const externalPostId = feedPayload.id?.trim();

  if (!externalPostId) {
    throw new HttpError(502, "facebook_post_failed", "Facebook post creation did not return an id.");
  }

  const externalPostUrl = await fetchFacebookPostPermalink(externalPostId, accessToken);

  return {
    externalPostId,
    externalPostUrl,
    response: {
      externalPostId,
      externalPostUrl,
      uploadedImageCount: mediaIds.length,
      uploadedVideoCount: 0,
    },
  };
}

export async function publishPlatformPost(
  input: PublishPlatformPostInput,
): Promise<{ externalPostId: string; externalPostUrl?: string; response: Record<string, unknown> }> {
  if (input.channel === "linkedin" || input.channel === "instagram" || input.channel === "facebook") {
    validatePublishMediaForChannel({
      channel: input.channel,
      assets: input.assets,
      slides: input.slides,
    });
  }

  switch (input.channel) {
    case "linkedin":
      return publishLinkedInPost(input);
    case "instagram":
      return publishInstagram(input);
    case "facebook":
      return publishFacebook(input);
    case "x":
      throw new HttpError(
        501,
        "publishing_channel_not_supported",
        `Publishing to ${input.channel} is not supported yet.`,
      );
    default:
      throw new HttpError(400, "bad_request", "Unsupported publishing channel.");
  }
}
