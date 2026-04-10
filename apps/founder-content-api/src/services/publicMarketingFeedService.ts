import type { QueryResultRow } from "pg";
import type {
  PostAsset,
  PublicSocialProofMediaType,
  PublicSocialProofPost,
  PublicSocialProofResponse,
} from "../../../../packages/shared-types/index.ts";
import { loadPostAssetsByPostIds } from "./postAssetService.ts";
import { isDatabaseConfigured, queryDb } from "./db/client.ts";
import { logInfo, logWarn } from "../utils/logger.ts";

const DEFAULT_SOCIAL_PROOF_LIMIT = 12;
const MAX_SOCIAL_PROOF_LIMIT = 18;
const SOURCE_SYNC_LIMIT = 72;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const UUID_LIKE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let lastSocialProofSyncAt = 0;
let socialProofSyncPromise: Promise<void> | null = null;

interface PublishedSocialProofSourceRow extends QueryResultRow {
  scheduled_post_id: string;
  business_id: string;
  platform: "linkedin" | "facebook" | "instagram";
  content_text: string;
  asset_group_id: string | null;
  asset_payload: unknown;
  external_post_id: string | null;
  external_post_url: string;
  published_at: Date | string;
  author_display_name: string | null;
  author_avatar_url: string | null;
  workspace_brand_name: string;
  workspace_website_url: string | null;
}

interface MarketingSocialProofRow extends QueryResultRow {
  id: string;
  business_id: string;
  source_scheduled_post_id: string | null;
  source_asset_group_id: string | null;
  platform: "linkedin" | "facebook" | "instagram";
  external_post_id: string | null;
  external_post_url: string;
  author_display_name: string;
  author_avatar_url: string | null;
  workspace_brand_name: string;
  workspace_website_url: string | null;
  caption_preview: string;
  media_type: PublicSocialProofMediaType;
  thumbnail_url: string | null;
  is_featured: boolean;
  published_at: Date | string;
}

function resolveMarketingShowcaseBusinessIds(): string[] {
  const rawValue = process.env.MARKETING_SHOWCASE_BUSINESS_IDS?.trim();

  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => UUID_LIKE_PATTERN.test(value));
}

function toIsoString(value: Date | string | null | undefined): string {
  return new Date(value ?? Date.now()).toISOString();
}

function clampSocialProofLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) {
    return DEFAULT_SOCIAL_PROOF_LIMIT;
  }

  return Math.min(Math.max(Math.round(limit), 1), MAX_SOCIAL_PROOF_LIMIT);
}

function extractSlidesFromPayload(assetPayload: unknown): unknown[] {
  if (!assetPayload || typeof assetPayload !== "object" || Array.isArray(assetPayload)) {
    return [];
  }

  const slides = (assetPayload as Record<string, unknown>).slides;
  return Array.isArray(slides) ? slides : [];
}

function inferMediaType(source: PublishedSocialProofSourceRow, assets: PostAsset[]): PublicSocialProofMediaType {
  const slideCount = extractSlidesFromPayload(source.asset_payload).length;

  if (slideCount > 1 || assets.length > 1) {
    return "carousel";
  }

  if (assets.some((asset) => asset.type === "video")) {
    return "video";
  }

  if (assets.some((asset) => asset.type === "image")) {
    return "image";
  }

  return "text";
}

function pickThumbnailUrl(assets: PostAsset[]): string | undefined {
  return undefined;
}

function pickSignedPreviewUrl(assets: PostAsset[]): string | undefined {
  const imageAsset = assets.find((asset) => asset.type === "image" && asset.previewUrl);
  return imageAsset?.previewUrl ?? undefined;
}

function normalizeCaptionPreview(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function mapMarketingSocialProofRow(row: MarketingSocialProofRow): PublicSocialProofPost {
  return {
    id: row.id,
    platform: row.platform,
    externalPostUrl: row.external_post_url,
    externalPostId: row.external_post_id ?? undefined,
    authorDisplayName: row.author_display_name,
    authorAvatarUrl: row.author_avatar_url ?? undefined,
    workspaceBrandName: row.workspace_brand_name,
    workspaceWebsiteUrl: row.workspace_website_url ?? undefined,
    captionPreview: row.caption_preview,
    publishedAt: toIsoString(row.published_at),
    thumbnailUrl: row.thumbnail_url ?? undefined,
    mediaType: row.media_type,
    featured: row.is_featured,
  };
}

async function loadPublishedSocialProofSources(
  allowedBusinessIds: string[],
): Promise<PublishedSocialProofSourceRow[]> {
  if (allowedBusinessIds.length === 0) {
    return [];
  }

  const result = await queryDb<PublishedSocialProofSourceRow>(
    `
      select *
      from (
        select distinct on (sp.business_id, sp.platform, coalesce(sp.external_post_id, sp.external_post_url))
          sp.id as scheduled_post_id,
          sp.business_id,
          sp.platform,
          sp.content_text,
          sp.asset_group_id,
          sp.asset_payload,
          sp.external_post_id,
          sp.external_post_url,
          sp.published_at,
          sai.display_name as author_display_name,
          sai.avatar_url as author_avatar_url,
          b.brand_name as workspace_brand_name,
          b.website_url as workspace_website_url
        from scheduled_posts sp
        join businesses b
          on b.id = sp.business_id
        left join social_account_identities sai
          on sai.id = sp.social_account_identity_id
        where sp.business_id = any($1::uuid[])
          and sp.status = 'published'
          and sp.external_post_url is not null
          and sp.published_at is not null
        order by
          sp.business_id,
          sp.platform,
          coalesce(sp.external_post_id, sp.external_post_url),
          sp.published_at desc
      ) published_posts
      order by published_at desc
      limit $2
    `,
    [allowedBusinessIds, SOURCE_SYNC_LIMIT],
  );

  return result.rows;
}

async function syncPublicSocialProofFeed(): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  const allowedBusinessIds = resolveMarketingShowcaseBusinessIds();

  if (allowedBusinessIds.length === 0) {
    return;
  }

  const sourceRows = await loadPublishedSocialProofSources(allowedBusinessIds);
  const assetGroupIds = Array.from(
    new Set(
      sourceRows
        .map((row) => row.asset_group_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );
  const assetsByGroupId = await loadPostAssetsByPostIds(assetGroupIds);

  for (const sourceRow of sourceRows) {
    const assets = sourceRow.asset_group_id
      ? assetsByGroupId.get(sourceRow.asset_group_id) ?? []
      : [];
    const mediaType = inferMediaType(sourceRow, assets);
    const thumbnailUrl = pickThumbnailUrl(assets) ?? null;
    const authorDisplayName = sourceRow.author_display_name?.trim() || sourceRow.workspace_brand_name;

    await queryDb(
      `
        insert into marketing_social_proof_feed (
          business_id,
          source_scheduled_post_id,
          platform,
          external_post_id,
          external_post_url,
          author_display_name,
          author_avatar_url,
          workspace_brand_name,
          workspace_website_url,
          caption_preview,
          media_type,
          thumbnail_url,
          is_public_marketing_safe,
          published_at
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          true,
          $13::timestamptz
        )
        on conflict (platform, external_post_url)
        do update set
          business_id = excluded.business_id,
          source_scheduled_post_id = excluded.source_scheduled_post_id,
          external_post_id = excluded.external_post_id,
          author_display_name = excluded.author_display_name,
          author_avatar_url = excluded.author_avatar_url,
          workspace_brand_name = excluded.workspace_brand_name,
          workspace_website_url = excluded.workspace_website_url,
          caption_preview = excluded.caption_preview,
          media_type = excluded.media_type,
          thumbnail_url = excluded.thumbnail_url,
          is_public_marketing_safe = true,
          published_at = excluded.published_at,
          updated_at = now()
      `,
      [
        sourceRow.business_id,
        sourceRow.scheduled_post_id,
        sourceRow.platform,
        sourceRow.external_post_id,
        sourceRow.external_post_url,
        authorDisplayName,
        sourceRow.author_avatar_url,
        sourceRow.workspace_brand_name,
        sourceRow.workspace_website_url,
        normalizeCaptionPreview(sourceRow.content_text),
        mediaType,
        thumbnailUrl,
        toIsoString(sourceRow.published_at),
      ],
    );
  }

  logInfo("Synced marketing social proof feed.", {
    sourceCount: sourceRows.length,
    businessCount: allowedBusinessIds.length,
  });
}

async function ensurePublicSocialProofFeedSynced(): Promise<void> {
  if (Date.now() - lastSocialProofSyncAt < SYNC_INTERVAL_MS) {
    return;
  }

  if (socialProofSyncPromise) {
    await socialProofSyncPromise;
    return;
  }

  socialProofSyncPromise = (async () => {
    try {
      await syncPublicSocialProofFeed();
      lastSocialProofSyncAt = Date.now();
    } catch (error) {
      logWarn("Unable to sync marketing social proof feed.", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    } finally {
      socialProofSyncPromise = null;
    }
  })();

  await socialProofSyncPromise;
}

export async function listPublicSocialProof(limit?: number): Promise<PublicSocialProofResponse> {
  if (!isDatabaseConfigured()) {
    return { posts: [] };
  }

  const allowedBusinessIds = resolveMarketingShowcaseBusinessIds();

  if (allowedBusinessIds.length === 0) {
    return { posts: [] };
  }

  await ensurePublicSocialProofFeedSynced();

  const result = await queryDb<MarketingSocialProofRow>(
    `
      select
        marketing_social_proof_feed.id,
        marketing_social_proof_feed.business_id,
        marketing_social_proof_feed.source_scheduled_post_id,
        source_post.asset_group_id as source_asset_group_id,
        marketing_social_proof_feed.platform,
        marketing_social_proof_feed.external_post_id,
        marketing_social_proof_feed.external_post_url,
        marketing_social_proof_feed.author_display_name,
        marketing_social_proof_feed.author_avatar_url,
        marketing_social_proof_feed.workspace_brand_name,
        marketing_social_proof_feed.workspace_website_url,
        marketing_social_proof_feed.caption_preview,
        marketing_social_proof_feed.media_type,
        marketing_social_proof_feed.thumbnail_url,
        marketing_social_proof_feed.is_featured,
        marketing_social_proof_feed.published_at
      from marketing_social_proof_feed
      left join scheduled_posts source_post
        on source_post.id = marketing_social_proof_feed.source_scheduled_post_id
      where marketing_social_proof_feed.is_public_marketing_safe = true
        and marketing_social_proof_feed.business_id = any($1::uuid[])
      order by
        marketing_social_proof_feed.is_featured desc,
        marketing_social_proof_feed.featured_rank asc nulls last,
        marketing_social_proof_feed.published_at desc
      limit $2
    `,
    [allowedBusinessIds, clampSocialProofLimit(limit)],
  );

  const sourceAssetGroupIds = Array.from(
    new Set(
      result.rows
        .map((row) => row.source_asset_group_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );
  const previewAssetsByGroupId = await loadPostAssetsByPostIds(sourceAssetGroupIds, { includePreviewUrls: true });

  return {
    posts: result.rows.map((row) => {
      const previewAssets = row.source_asset_group_id
        ? previewAssetsByGroupId.get(row.source_asset_group_id) ?? []
        : [];
      const signedPreviewUrl = pickSignedPreviewUrl(previewAssets);

      return mapMarketingSocialProofRow({
        ...row,
        thumbnail_url: signedPreviewUrl ?? row.thumbnail_url,
      });
    }),
  };
}
