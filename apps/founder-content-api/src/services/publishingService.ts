import { Buffer } from "node:buffer";
import type { PostAsset, ScheduledPostSlide } from "../../../../packages/shared-types/index.ts";
import { HttpError } from "../utils/http.ts";
import { downloadPostAssetBytes } from "./postAssetService.ts";
import { getLinkedInPublishingCredentialsForBusiness } from "./socialAuthService.ts";

const LINKEDIN_IMAGES_API_URL = "https://api.linkedin.com/rest/images";
const LINKEDIN_POSTS_API_URL = "https://api.linkedin.com/rest/posts";

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
  response: Record<string, unknown>;
}

function resolveLinkedInApiVersion(): string {
  return process.env.LINKEDIN_API_VERSION?.trim() || "202602";
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

async function createLinkedInPost(
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<LinkedInPostCreationResult> {
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
    response: {
      externalPostId,
    },
  };
}

function ensureSupportedLinkedInImageType(mimeType: string): void {
  if (!["image/png", "image/jpeg", "image/gif"].includes(mimeType)) {
    throw new HttpError(
      400,
      "unsupported_slide_format",
      "LinkedIn multi-image posts support PNG, JPG, and GIF uploads only.",
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
