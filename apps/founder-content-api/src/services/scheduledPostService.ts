import type { QueryResultRow } from "pg";
import type {
  PostAsset,
  PublishPostRequest,
  PublishPostResponse,
  SchedulePostRequest,
  SchedulePostResponse,
  ScheduledPost,
  ScheduledPostMutationAction,
  ScheduledPostSlide,
  ScheduledPostsResponse,
  ScheduledPostStatus,
  UpdateScheduledPostRequest,
  UpdateScheduledPostResponse,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireBusinessMembership } from "./authBusinessService.ts";
import { updateContentPipelineItem } from "./controlDashboardService.ts";
import { queryDb, withDbTransaction } from "./db/client.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "./governanceService.ts";
import { loadPostAssetsByPostIds, loadReadyPostImageAssets } from "./postAssetService.ts";
import {
  publishLinkedInImagePost,
  publishLinkedInMultiImagePost,
  publishLinkedInTextPost,
} from "./publishingService.ts";
import { sendScheduledPostPublishedNotification } from "./scheduledPostNotificationService.ts";
import { HttpError } from "../utils/http.ts";
import { logError, logInfo, logWarn } from "../utils/logger.ts";

interface ScheduledPostRow extends QueryResultRow {
  id: string;
  business_id: string;
  user_id: string;
  social_account_id: string | null;
  social_account_identity_id: string | null;
  platform: "linkedin";
  content_text: string;
  asset_group_id: string | null;
  asset_payload: unknown;
  scheduled_at: Date | string;
  audience_timezone: string;
  status: ScheduledPostStatus;
  external_post_id: string | null;
  external_post_url: string | null;
  error_message: string | null;
  retry_count: string | number;
  last_attempt_at: Date | string | null;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SocialPublishingTargetRow extends QueryResultRow {
  id: string;
  selected_identity_id: string;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSlides(assetPayload: unknown): ScheduledPostSlide[] {
  if (
    assetPayload &&
    typeof assetPayload === "object" &&
    "slides" in assetPayload &&
    Array.isArray((assetPayload as { slides?: unknown[] }).slides)
  ) {
    return (assetPayload as { slides: unknown[] }).slides.flatMap((slide) => {
      if (!slide || typeof slide !== "object") {
        return [];
      }

      const candidate = slide as Record<string, unknown>;
      const imageDataUrl = typeof candidate.imageDataUrl === "string" ? candidate.imageDataUrl : null;

      if (!imageDataUrl) {
        return [];
      }

      return [
        {
          imageDataUrl,
          altText: typeof candidate.altText === "string" ? candidate.altText : undefined,
          mimeType: typeof candidate.mimeType === "string" ? candidate.mimeType : undefined,
        },
      ];
    });
  }

  return [];
}

function mapScheduledPost(row: ScheduledPostRow): ScheduledPost {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    platform: row.platform,
    contentText: row.content_text,
    assetGroupId: row.asset_group_id ?? undefined,
    slides: parseSlides(row.asset_payload),
    assets: [],
    scheduledAt: new Date(row.scheduled_at).toISOString(),
    audienceTimezone: row.audience_timezone,
    status: row.status,
    externalPostId: row.external_post_id ?? undefined,
    externalPostUrl: row.external_post_url ?? undefined,
    errorMessage: row.error_message ?? undefined,
    retryCount: toNumber(row.retry_count),
    lastAttemptAt: toIsoString(row.last_attempt_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    publishedAt: toIsoString(row.published_at),
  };
}

function isUuidLike(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

async function loadLinkedPostAssetsMap(rows: ScheduledPostRow[]): Promise<Map<string, PostAsset[]>> {
  const postIds = Array.from(
    new Set(
      rows
        .map((row) => row.asset_group_id)
        .filter((value): value is string => isUuidLike(value)),
    ),
  );

  return loadPostAssetsByPostIds(postIds, { includePreviewUrls: true });
}

function mapScheduledPostWithAssets(
  row: ScheduledPostRow,
  linkedAssetsMap: Map<string, PostAsset[]>,
): ScheduledPost {
  const linkedAssets = row.asset_group_id ? linkedAssetsMap.get(row.asset_group_id) ?? [] : [];

  return {
    ...mapScheduledPost(row),
    assets: linkedAssets,
  };
}

function normalizeTimezone(value: string | undefined | null): string | null {
  const normalized = value?.trim();

  if (!normalized) {
    return null;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized });
    return normalized;
  } catch {
    throw new HttpError(400, "bad_request", "audienceTimezone must be a valid IANA timezone.");
  }
}

function parseScheduledAt(value: string): Date {
  const scheduledAt = new Date(value);

  if (Number.isNaN(scheduledAt.getTime())) {
    throw new HttpError(400, "bad_request", "scheduledAt must be a valid ISO timestamp.");
  }

  return scheduledAt;
}

function normalizeSlides(slides: SchedulePostRequest["slides"]): ScheduledPostSlide[] {
  const normalizedSlides = (slides ?? []).flatMap((slide) => {
    const imageDataUrl = slide.imageDataUrl?.trim();

    if (!imageDataUrl) {
      return [];
    }

    return [
      {
        imageDataUrl,
        altText: slide.altText?.trim() || undefined,
        mimeType: slide.mimeType?.trim().toLowerCase() || undefined,
      },
    ];
  });

  if (normalizedSlides.length === 0) {
    return [];
  }

  if (normalizedSlides.length < 2 || normalizedSlides.length > 20) {
    throw new HttpError(
      400,
      "bad_request",
      "LinkedIn carousel scheduled posts require between 2 and 20 slide images.",
    );
  }

  return normalizedSlides;
}

function resolveDailyLimit(): number {
  const parsed = Number(process.env.POST_SAFETY_DAILY_LIMIT ?? 3);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 3;
}

function resolveMinGapMinutes(): number {
  const parsed = Number(process.env.POST_SAFETY_MIN_GAP_MINUTES ?? 180);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 180;
}

function resolveJitterMinutes(): number {
  const parsed = Number(process.env.POST_SAFETY_JITTER_MINUTES ?? 9);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 9;
}

function resolveMaxRetryCount(): number {
  const parsed = Number(process.env.SCHEDULED_POST_MAX_RETRIES ?? 1);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
}

function applySchedulingJitter(scheduledAt: Date): Date {
  const jitterMinutes = resolveJitterMinutes();

  if (jitterMinutes <= 0) {
    return scheduledAt;
  }

  const offsetMinutes = Math.floor(Math.random() * (jitterMinutes + 1));
  return new Date(scheduledAt.getTime() + offsetMinutes * 60 * 1000);
}

async function enforceDailyPostLimit(
  userId: string,
  scheduledAt: Date,
  ignoreScheduledPostId?: string | null,
): Promise<void> {
  const startOfDay = new Date(scheduledAt);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
  const result = await queryDb<{ total: string | number }>(
    `
      select count(*)::int as total
      from scheduled_posts
      where user_id = $1
        and status in ('scheduled', 'processing', 'published')
        and scheduled_at >= $2
        and scheduled_at < $3
        and ($4::uuid is null or id <> $4)
    `,
    [userId, startOfDay.toISOString(), endOfDay.toISOString(), ignoreScheduledPostId ?? null],
  );

  if (toNumber(result.rows[0]?.total) >= resolveDailyLimit()) {
    throw new HttpError(
      429,
      "posting_limit_reached",
      "Daily scheduling limit reached for this user.",
    );
  }
}

async function enforceMinimumGap(
  userId: string,
  scheduledAt: Date,
  ignoreScheduledPostId?: string | null,
): Promise<void> {
  const minGapMinutes = resolveMinGapMinutes();

  if (minGapMinutes <= 0) {
    return;
  }

  const gapStart = new Date(scheduledAt.getTime() - minGapMinutes * 60 * 1000);
  const gapEnd = new Date(scheduledAt.getTime() + minGapMinutes * 60 * 1000);
  const result = await queryDb<{ scheduled_at: Date | string }>(
    `
      select scheduled_at
      from scheduled_posts
      where user_id = $1
        and status in ('scheduled', 'processing', 'published')
        and scheduled_at >= $2
        and scheduled_at <= $3
        and ($5::uuid is null or id <> $5)
      order by abs(extract(epoch from (scheduled_at - $4::timestamptz))) asc
      limit 1
    `,
    [
      userId,
      gapStart.toISOString(),
      gapEnd.toISOString(),
      scheduledAt.toISOString(),
      ignoreScheduledPostId ?? null,
    ],
  );

  if (result.rows[0]?.scheduled_at) {
    throw new HttpError(
      409,
      "posting_gap_conflict",
      `Leave at least ${minGapMinutes} minutes between scheduled posts for the same user.`,
    );
  }
}

async function resolveLinkedInPublishingTarget(businessId: string): Promise<{
  socialAccountId: string;
  socialAccountIdentityId: string;
}> {
  const result = await queryDb<SocialPublishingTargetRow>(
    `
      select
        bsc.social_account_id as id,
        bsc.selected_identity_id
      from business_social_channels bsc
      join social_accounts sa on sa.id = bsc.social_account_id
      where bsc.business_id = $1
        and bsc.platform = 'linkedin'
        and bsc.status = 'connected'
        and sa.status = 'connected'
      limit 1
    `,
    [businessId],
  );

  const socialAccountId = result.rows[0]?.id;

  const selectedIdentityId = result.rows[0]?.selected_identity_id;

  if (!socialAccountId || !selectedIdentityId) {
    throw new HttpError(
      409,
      "linkedin_not_connected",
      "Connect a LinkedIn account before scheduling posts.",
    );
  }

  return {
    socialAccountId,
    socialAccountIdentityId: selectedIdentityId,
  };
}

async function resolveBusinessTimezone(businessId: string): Promise<string> {
  const result = await queryDb<{ timezone: string }>(
    `
      select timezone
      from businesses
      where id = $1
      limit 1
    `,
    [businessId],
  );

  const timezone = result.rows[0]?.timezone?.trim();
  return timezone || "UTC";
}

async function recordPublicationEvent(
  scheduledPostId: string,
  status: ScheduledPostStatus,
  response: Record<string, unknown>,
): Promise<void> {
  await queryDb(
    `
      insert into publication_events (
        scheduled_post_id,
        status,
        response
      ) values (
        $1,
        $2,
        $3::jsonb
      )
    `,
    [scheduledPostId, status, JSON.stringify(response)],
  );
}

async function syncLinkedContentAssetStage(input: {
  businessId: string;
  linkedAssetId?: string | null;
  stage: "review" | "scheduled" | "posted";
}): Promise<void> {
  const linkedAssetId = input.linkedAssetId?.trim();

  if (!linkedAssetId) {
    return;
  }

  await queryDb(
    `
      update content_assets
      set
        status = case when $3 = 'posted' then 'published' else status end,
        pipeline_stage = $3,
        updated_at = now()
      where id = $1
        and business_id = $2
    `,
    [linkedAssetId, input.businessId, input.stage],
  );
}

async function loadScheduledPostRow(
  businessId: string,
  scheduledPostId: string,
): Promise<ScheduledPostRow> {
  const result = await queryDb<ScheduledPostRow>(
    `
      select
        id,
        business_id,
        user_id,
        social_account_id,
        social_account_identity_id,
        platform,
        content_text,
        asset_group_id,
        asset_payload,
        scheduled_at,
        audience_timezone,
        status,
        external_post_id,
        external_post_url,
        error_message,
        retry_count,
        last_attempt_at,
        published_at,
        created_at,
        updated_at
      from scheduled_posts
      where id = $1
        and business_id = $2
      limit 1
    `,
    [scheduledPostId, businessId],
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "scheduled_post_not_found", "Scheduled post not found.");
  }

  return row;
}

function canPauseScheduledPost(status: ScheduledPostStatus): boolean {
  return status === "scheduled";
}

function canResumeScheduledPost(status: ScheduledPostStatus): boolean {
  return status === "paused";
}

function canCancelScheduledPost(status: ScheduledPostStatus): boolean {
  return status === "scheduled" || status === "paused" || status === "failed";
}

function canRescheduleScheduledPost(status: ScheduledPostStatus): boolean {
  return status === "scheduled" || status === "paused" || status === "failed";
}

function canRetryScheduledPost(status: ScheduledPostStatus): boolean {
  return status === "failed";
}

async function markScheduledPostPublished(
  scheduledPostId: string,
  publishResult: { externalPostId: string; response: Record<string, unknown> },
  linkedAssetId?: string | null,
  businessId?: string,
): Promise<void> {
  await queryDb(
    `
      update scheduled_posts
      set
        status = 'published',
        external_post_id = $2,
        external_post_url = $3,
        error_message = null,
        published_at = now(),
        updated_at = now()
      where id = $1
    `,
    [
      scheduledPostId,
      publishResult.externalPostId,
      `https://www.linkedin.com/feed/update/${encodeURIComponent(publishResult.externalPostId)}`,
    ],
  );

  await recordPublicationEvent(scheduledPostId, "published", publishResult.response);

  if (businessId) {
    await syncLinkedContentAssetStage({
      businessId,
      linkedAssetId,
      stage: "posted",
    });
  }
}

async function markScheduledPostFailed(scheduledPostId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown publishing error.";

  await queryDb(
    `
      update scheduled_posts
      set
        status = 'failed',
        error_message = $2,
        updated_at = now()
      where id = $1
    `,
    [scheduledPostId, message],
  );

  await recordPublicationEvent(scheduledPostId, "failed", {
    message,
  });
}

async function claimDueScheduledPosts(limit: number): Promise<ScheduledPostRow[]> {
  return withDbTransaction(async (client) => {
    const result = await client.query<ScheduledPostRow>(
      `
        with due_posts as (
          select id
          from scheduled_posts
          where status = 'scheduled'
            and scheduled_at <= now()
            and platform = 'linkedin'
            and coalesce(retry_count, 0) < $2
          order by scheduled_at asc
          limit $1
          for update skip locked
        )
        update scheduled_posts sp
        set
          status = 'processing',
          error_message = null,
          retry_count = coalesce(sp.retry_count, 0) + 1,
          last_attempt_at = now(),
          updated_at = now()
        from due_posts
        where sp.id = due_posts.id
        returning
          sp.id,
          sp.business_id,
          sp.user_id,
          sp.social_account_id,
          sp.social_account_identity_id,
          sp.platform,
          sp.content_text,
          sp.asset_group_id,
          sp.asset_payload,
          sp.scheduled_at,
          sp.audience_timezone,
          sp.status,
          sp.external_post_id,
          sp.external_post_url,
          sp.error_message,
          sp.retry_count,
          sp.last_attempt_at,
          sp.published_at,
          sp.created_at,
          sp.updated_at
      `,
      [limit, resolveMaxRetryCount()],
    );

    for (const row of result.rows) {
      await client.query(
        `
          insert into publication_events (
            scheduled_post_id,
            status,
            response
          ) values (
            $1,
            'processing',
            $2::jsonb
          )
        `,
        [row.id, JSON.stringify({ claimedAt: new Date().toISOString() })],
      );
    }

    return result.rows;
  });
}

function normalizeScheduledPostMutationAction(
  value: UpdateScheduledPostRequest["action"],
): ScheduledPostMutationAction {
  switch (value) {
    case "pause":
    case "resume":
    case "cancel":
    case "reschedule":
    case "retry":
      return value;
    default:
      throw new HttpError(400, "bad_request", "action must be pause, resume, cancel, retry, or reschedule.");
  }
}

export async function updateScheduledPost(
  principal: AuthenticatedPrincipal,
  scheduledPostId: string,
  input: UpdateScheduledPostRequest,
): Promise<UpdateScheduledPostResponse> {
  const businessId = input.businessId.trim();

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "scheduler",
    usageMetric: "posts",
  });
  await requireBusinessMembership(principal, businessId);

  const existing = await loadScheduledPostRow(businessId, scheduledPostId);
  const action = normalizeScheduledPostMutationAction(input.action);

  if (action === "pause") {
    if (!canPauseScheduledPost(existing.status)) {
      throw new HttpError(409, "scheduled_post_conflict", "Only scheduled posts can be paused.");
    }

    const result = await queryDb<ScheduledPostRow>(
      `
        update scheduled_posts
        set
          status = 'paused',
          updated_at = now()
        where id = $1
        returning
          id,
          business_id,
          user_id,
          social_account_id,
          social_account_identity_id,
          platform,
          content_text,
          asset_group_id,
          asset_payload,
          scheduled_at,
          audience_timezone,
          status,
          external_post_id,
          external_post_url,
          error_message,
          retry_count,
          last_attempt_at,
          published_at,
          created_at,
          updated_at
      `,
      [existing.id],
    );

    await recordPublicationEvent(existing.id, "paused", {
      action: "pause",
      previousStatus: existing.status,
    });
    const linkedAssetsMap = await loadLinkedPostAssetsMap(result.rows);

    return { scheduledPost: mapScheduledPostWithAssets(result.rows[0], linkedAssetsMap) };
  }

  if (action === "resume") {
    if (!canResumeScheduledPost(existing.status)) {
      throw new HttpError(409, "scheduled_post_conflict", "Only paused posts can be resumed.");
    }

    const result = await queryDb<ScheduledPostRow>(
      `
        update scheduled_posts
        set
          status = 'scheduled',
          error_message = null,
          updated_at = now()
        where id = $1
        returning
          id,
          business_id,
          user_id,
          social_account_id,
          social_account_identity_id,
          platform,
          content_text,
          asset_group_id,
          asset_payload,
          scheduled_at,
          audience_timezone,
          status,
          external_post_id,
          external_post_url,
          error_message,
          retry_count,
          last_attempt_at,
          published_at,
          created_at,
          updated_at
      `,
      [existing.id],
    );

    await recordPublicationEvent(existing.id, "scheduled", {
      action: "resume",
      previousStatus: existing.status,
      scheduledAt: new Date(existing.scheduled_at).toISOString(),
      audienceTimezone: existing.audience_timezone,
    });
    const linkedAssetsMap = await loadLinkedPostAssetsMap(result.rows);

    return { scheduledPost: mapScheduledPostWithAssets(result.rows[0], linkedAssetsMap) };
  }

  if (action === "cancel") {
    if (!canCancelScheduledPost(existing.status)) {
      throw new HttpError(
        409,
        "scheduled_post_conflict",
        "Only scheduled, paused, or failed posts can be canceled.",
      );
    }

    const result = await queryDb<ScheduledPostRow>(
      `
        update scheduled_posts
        set
          status = 'canceled',
          updated_at = now()
        where id = $1
        returning
          id,
          business_id,
          user_id,
          social_account_id,
          social_account_identity_id,
          platform,
          content_text,
          asset_group_id,
          asset_payload,
          scheduled_at,
          audience_timezone,
          status,
          external_post_id,
          external_post_url,
          error_message,
          retry_count,
          last_attempt_at,
          published_at,
          created_at,
          updated_at
      `,
      [existing.id],
    );

    await recordPublicationEvent(existing.id, "canceled", {
      action: "cancel",
      previousStatus: existing.status,
    });
    await syncLinkedContentAssetStage({
      businessId,
      linkedAssetId: existing.asset_group_id,
      stage: "review",
    });
    const linkedAssetsMap = await loadLinkedPostAssetsMap(result.rows);

    return { scheduledPost: mapScheduledPostWithAssets(result.rows[0], linkedAssetsMap) };
  }

  if (action === "retry") {
    if (!canRetryScheduledPost(existing.status)) {
      throw new HttpError(409, "scheduled_post_conflict", "Only failed posts can be retried.");
    }

    const result = await queryDb<ScheduledPostRow>(
      `
        update scheduled_posts
        set
          status = 'scheduled',
          error_message = null,
          retry_count = 0,
          last_attempt_at = null,
          updated_at = now()
        where id = $1
        returning
          id,
          business_id,
          user_id,
          social_account_id,
          social_account_identity_id,
          platform,
          content_text,
          asset_group_id,
          asset_payload,
          scheduled_at,
          audience_timezone,
          status,
          external_post_id,
          external_post_url,
          error_message,
          retry_count,
          last_attempt_at,
          published_at,
          created_at,
          updated_at
      `,
      [existing.id],
    );

    await recordPublicationEvent(existing.id, "scheduled", {
      action: "retry",
      previousStatus: existing.status,
      scheduledAt: new Date(existing.scheduled_at).toISOString(),
      audienceTimezone: existing.audience_timezone,
    });
    const linkedAssetsMap = await loadLinkedPostAssetsMap(result.rows);

    return { scheduledPost: mapScheduledPostWithAssets(result.rows[0], linkedAssetsMap) };
  }

  if (!canRescheduleScheduledPost(existing.status)) {
    throw new HttpError(
      409,
      "scheduled_post_conflict",
      "Only scheduled, paused, or failed posts can be rescheduled.",
    );
  }

  if (!input.scheduledAt?.trim()) {
    throw new HttpError(400, "bad_request", "scheduledAt is required when rescheduling.");
  }

  const nextAudienceTimezone =
    normalizeTimezone(input.audienceTimezone) ??
    existing.audience_timezone ??
    (await resolveBusinessTimezone(businessId));
  const nextScheduledAt = applySchedulingJitter(parseScheduledAt(input.scheduledAt.trim()));

  await enforceDailyPostLimit(existing.user_id, nextScheduledAt, existing.id);
  await enforceMinimumGap(existing.user_id, nextScheduledAt, existing.id);

  const nextStatus: ScheduledPostStatus = existing.status === "paused" ? "paused" : "scheduled";
  const result = await queryDb<ScheduledPostRow>(
    `
      update scheduled_posts
      set
        scheduled_at = $2,
        audience_timezone = $3,
        status = $4,
        error_message = null,
        retry_count = case when $5::boolean then 0 else retry_count end,
        last_attempt_at = case when $5::boolean then null else last_attempt_at end,
        updated_at = now()
      where id = $1
      returning
        id,
        business_id,
        user_id,
        social_account_id,
        social_account_identity_id,
        platform,
        content_text,
        asset_group_id,
        asset_payload,
        scheduled_at,
        audience_timezone,
        status,
        external_post_id,
        external_post_url,
        error_message,
        retry_count,
        last_attempt_at,
        published_at,
        created_at,
        updated_at
    `,
    [
      existing.id,
      nextScheduledAt.toISOString(),
      nextAudienceTimezone,
      nextStatus,
      existing.status === "failed",
    ],
  );

  await recordPublicationEvent(existing.id, nextStatus, {
    action: "reschedule",
    previousStatus: existing.status,
    scheduledAt: nextScheduledAt.toISOString(),
    audienceTimezone: nextAudienceTimezone,
  });
  const linkedAssetsMap = await loadLinkedPostAssetsMap(result.rows);

  return { scheduledPost: mapScheduledPostWithAssets(result.rows[0], linkedAssetsMap) };
}

export async function createScheduledPost(
  principal: AuthenticatedPrincipal,
  input: SchedulePostRequest,
): Promise<SchedulePostResponse> {
  const businessId = input.businessId.trim();

  if (!principal.userId) {
    throw new HttpError(401, "auth_required", "Authenticated user context is incomplete.");
  }

  if (input.platform !== "linkedin") {
    throw new HttpError(400, "bad_request", "Only LinkedIn scheduling is supported right now.");
  }

  const contentText = input.contentText.trim();

  if (!contentText) {
    throw new HttpError(400, "bad_request", "contentText is required.");
  }

  const scheduledAt = applySchedulingJitter(parseScheduledAt(input.scheduledAt));
  const slides = normalizeSlides(input.slides);
  const audienceTimezone =
    normalizeTimezone(input.audienceTimezone) ?? (await resolveBusinessTimezone(businessId));
  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "scheduler",
    usageMetric: "posts",
  });
  await requireBusinessMembership(principal, businessId);
  await enforceDailyPostLimit(principal.userId, scheduledAt);
  await enforceMinimumGap(principal.userId, scheduledAt);
  const publishingTarget = await resolveLinkedInPublishingTarget(businessId);
  const linkedAssetId = input.assetGroupId?.trim() || null;
  const result = await queryDb<ScheduledPostRow>(
    `
      insert into scheduled_posts (
        business_id,
        user_id,
        social_account_id,
        social_account_identity_id,
        platform,
        content_text,
        asset_group_id,
        asset_payload,
        scheduled_at,
        audience_timezone,
        status
      ) values (
        $1,
        $2,
        $3,
        $4,
        'linkedin',
        $5,
        $6,
        $7::jsonb,
        $8,
        $9,
        'scheduled'
      )
      returning
        id,
        business_id,
        user_id,
        social_account_id,
        social_account_identity_id,
        platform,
        content_text,
        asset_group_id,
        asset_payload,
        scheduled_at,
        audience_timezone,
        status,
        external_post_id,
        external_post_url,
        error_message,
        retry_count,
        last_attempt_at,
        published_at,
        created_at,
        updated_at
    `,
    [
      businessId,
      principal.userId,
      publishingTarget.socialAccountId,
      publishingTarget.socialAccountIdentityId,
      contentText,
      linkedAssetId,
      JSON.stringify({ slides }),
      scheduledAt.toISOString(),
      audienceTimezone,
    ],
  );

  await recordPublicationEvent(result.rows[0].id, "scheduled", {
    scheduledAt: scheduledAt.toISOString(),
    audienceTimezone,
    slideCount: slides.length,
  });

  await syncLinkedContentAssetStage({
    businessId,
    linkedAssetId,
    stage: "scheduled",
  });
  const linkedAssetsMap = await loadLinkedPostAssetsMap(result.rows);

  return {
    scheduledPost: mapScheduledPostWithAssets(result.rows[0], linkedAssetsMap),
  };
}

export async function publishPostNow(
  principal: AuthenticatedPrincipal,
  input: PublishPostRequest,
): Promise<PublishPostResponse> {
  const businessId = input.businessId.trim();
  const contentText = input.contentText.trim();

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  if (!principal.userId) {
    throw new HttpError(401, "auth_required", "Authenticated user context is incomplete.");
  }

  if (input.platform !== "linkedin") {
    throw new HttpError(400, "bad_request", "Only LinkedIn publishing is supported.");
  }

  if (!contentText) {
    throw new HttpError(400, "bad_request", "contentText is required.");
  }

  const publishingTarget = await resolveLinkedInPublishingTarget(businessId);
  const audienceTimezone = await resolveBusinessTimezone(businessId);

  const readyAssets =
    input.assetId?.trim() && isUuidLike(input.assetId.trim())
      ? await loadReadyPostImageAssets(businessId, input.assetId.trim())
      : [];

  const publishResult =
    readyAssets.length > 0
      ? await publishLinkedInImagePost({
          businessId,
          contentText,
          assets: readyAssets,
        })
      : await publishLinkedInTextPost({
          businessId,
          contentText,
        });

  const externalPostUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(publishResult.externalPostId)}`;
  let asset: PublishPostResponse["asset"];

  if (input.assetId?.trim()) {
    const pipelineUpdate = await updateContentPipelineItem(
      principal,
      businessId,
      input.assetId.trim(),
      {
        title: input.title?.trim() || undefined,
        textContent: contentText,
        status: "posted",
      },
    );

    asset = pipelineUpdate.asset;
  }

  try {
    const historyResult = await queryDb<ScheduledPostRow>(
      `
        insert into scheduled_posts (
          business_id,
          user_id,
          social_account_id,
          social_account_identity_id,
          platform,
          content_text,
          asset_group_id,
          asset_payload,
          scheduled_at,
          audience_timezone,
          status,
          external_post_id,
          external_post_url,
          retry_count,
          last_attempt_at,
          published_at
        ) values (
          $1,
          $2,
          $3,
          $4,
          'linkedin',
          $5,
          $6,
          $7::jsonb,
          now(),
          $8,
          'published',
          $9,
          $10,
          0,
          now(),
          now()
        )
        returning id
      `,
      [
        businessId,
        principal.userId,
        publishingTarget.socialAccountId,
        publishingTarget.socialAccountIdentityId,
        contentText,
        input.assetId?.trim() || null,
        JSON.stringify({ slides: [] }),
        audienceTimezone,
        publishResult.externalPostId,
        externalPostUrl,
      ],
    );

    await recordPublicationEvent(historyResult.rows[0].id, "published", publishResult.response);
  } catch (error) {
    logWarn("LinkedIn post published but the local history row was not recorded.", {
      businessId,
      message: error instanceof Error ? error.message : "Unknown error",
      externalPostId: publishResult.externalPostId,
    });
  }

  return {
    platform: "linkedin",
    externalPostId: publishResult.externalPostId,
    externalPostUrl,
    publishedAt: new Date().toISOString(),
    asset,
  };
}

export async function listScheduledPosts(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<ScheduledPostsResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "scheduler");
  await requireBusinessMembership(principal, businessId);

  const result = await queryDb<ScheduledPostRow>(
    `
      select
        id,
        business_id,
        user_id,
        social_account_id,
        social_account_identity_id,
        platform,
        content_text,
        asset_group_id,
        asset_payload,
        scheduled_at,
        audience_timezone,
        status,
        external_post_id,
        external_post_url,
        error_message,
        retry_count,
        last_attempt_at,
        published_at,
        created_at,
        updated_at
      from scheduled_posts
      where business_id = $1
      order by scheduled_at desc
      limit 200
    `,
    [businessId],
  );
  const linkedAssetsMap = await loadLinkedPostAssetsMap(result.rows);

  return {
    scheduledPosts: result.rows.map((row) => mapScheduledPostWithAssets(row, linkedAssetsMap)),
  };
}

export async function processDueScheduledPosts(limit: number): Promise<{
  claimed: number;
  published: number;
  failed: number;
}> {
  const duePosts = await claimDueScheduledPosts(limit);
  let published = 0;
  let failed = 0;

  for (const duePost of duePosts) {
    try {
      const readyAssets =
        duePost.asset_group_id && isUuidLike(duePost.asset_group_id)
          ? await loadReadyPostImageAssets(duePost.business_id, duePost.asset_group_id)
          : [];
      const slides = parseSlides(duePost.asset_payload);
      const publishResult =
        readyAssets.length > 0
          ? await publishLinkedInImagePost({
              businessId: duePost.business_id,
              contentText: duePost.content_text,
              assets: readyAssets,
              socialAccountId: duePost.social_account_id,
              socialAccountIdentityId: duePost.social_account_identity_id,
            })
          : slides.length > 0
          ? await publishLinkedInMultiImagePost({
              businessId: duePost.business_id,
              contentText: duePost.content_text,
              slides,
              socialAccountId: duePost.social_account_id,
              socialAccountIdentityId: duePost.social_account_identity_id,
            })
          : await publishLinkedInTextPost({
              businessId: duePost.business_id,
              contentText: duePost.content_text,
              socialAccountId: duePost.social_account_id,
              socialAccountIdentityId: duePost.social_account_identity_id,
            });

      await markScheduledPostPublished(
        duePost.id,
        publishResult,
        duePost.asset_group_id,
        duePost.business_id,
      );
      try {
        await sendScheduledPostPublishedNotification(duePost.id);
      } catch (error) {
        logWarn("Scheduled post published but notification email failed.", {
          scheduledPostId: duePost.id,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
      published += 1;
      logInfo("Published scheduled LinkedIn post.", {
        scheduledPostId: duePost.id,
        externalPostId: publishResult.externalPostId,
      });
    } catch (error) {
      await markScheduledPostFailed(duePost.id, error);
      failed += 1;
      logError("Failed to publish scheduled LinkedIn post.", {
        scheduledPostId: duePost.id,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    claimed: duePosts.length,
    published,
    failed,
  };
}
