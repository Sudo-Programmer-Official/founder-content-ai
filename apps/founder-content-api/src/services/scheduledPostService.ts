import { createHash } from "node:crypto";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import type {
  PostAsset,
  PostPerformanceLabel,
  PublishPostRequest,
  PublishPostResponse,
  SchedulePostRequest,
  SchedulePostResponse,
  SchedulingSafetyWarning,
  ScheduledPost,
  ScheduledPostMutationAction,
  ScheduledPostSlide,
  ScheduledPostsResponse,
  ScheduledPostStatus,
  SocialAccountIdentityType,
  UpdateScheduledPostRequest,
  UpdateScheduledPostPerformanceRequest,
  UpdateScheduledPostPerformanceResponse,
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
import {
  claimQueuedJobs,
  createJob,
  markJobCompleted,
  markJobFailed,
  markJobTerminalFailed,
  pauseJob,
  releaseJob,
} from "./jobQueueService.ts";
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
  social_account_identity_display_name?: string | null;
  social_account_identity_type?: SocialAccountIdentityType | null;
  platform: "linkedin";
  content_text: string;
  asset_group_id: string | null;
  asset_payload: unknown;
  scheduled_at: Date | string;
  earliest_dispatch_at: Date | string;
  latest_dispatch_at: Date | string;
  dispatch_job_id: string | null;
  dispatch_priority: string | number;
  hook_hash: string | null;
  body_hash: string | null;
  content_fingerprint: string | null;
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

interface PostMetricRow extends QueryResultRow {
  scheduled_post_id: string;
  performance_label: PostPerformanceLabel | null;
  engagement_score: string | number | null;
  updated_at: Date | string;
}

interface SocialPublishingTargetRow extends QueryResultRow {
  id: string;
  selected_identity_id: string;
}

interface ScheduledPostPublishJobPayload {
  scheduledPostId: string;
}

interface SchedulingConflictCheckResult extends QueryResultRow {
  id: string;
}

async function executeQuery<TRow extends QueryResultRow>(
  text: string,
  values: unknown[],
  client?: PoolClient,
): Promise<QueryResult<TRow>> {
  if (client) {
    return client.query<TRow>(text, values);
  }

  return queryDb<TRow>(text, values);
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

function mapScheduledPost(
  row: ScheduledPostRow,
  metric?: {
    performanceLabel?: PostPerformanceLabel;
    engagementScore?: number;
    performanceRecordedAt?: string;
  },
): ScheduledPost {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    platform: row.platform,
    selectedIdentityId: row.social_account_identity_id ?? undefined,
    selectedIdentityDisplayName: row.social_account_identity_display_name ?? undefined,
    selectedIdentityType: row.social_account_identity_type ?? undefined,
    contentText: row.content_text,
    assetGroupId: row.asset_group_id ?? undefined,
    slides: parseSlides(row.asset_payload),
    assets: [],
    scheduledAt: new Date(row.scheduled_at).toISOString(),
    earliestDispatchAt: new Date(row.earliest_dispatch_at).toISOString(),
    latestDispatchAt: new Date(row.latest_dispatch_at).toISOString(),
    audienceTimezone: row.audience_timezone,
    status: row.status,
    dispatchPriority: toNumber(row.dispatch_priority),
    dispatchJobId: row.dispatch_job_id ?? undefined,
    externalPostId: row.external_post_id ?? undefined,
    externalPostUrl: row.external_post_url ?? undefined,
    errorMessage: row.error_message ?? undefined,
    retryCount: toNumber(row.retry_count),
    performanceLabel: metric?.performanceLabel,
    performanceRecordedAt: metric?.performanceRecordedAt,
    engagementScore: metric?.engagementScore,
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

async function loadPostMetricsMap(rows: ScheduledPostRow[]): Promise<
  Map<
    string,
    {
      performanceLabel?: PostPerformanceLabel;
      engagementScore?: number;
      performanceRecordedAt?: string;
    }
  >
> {
  const scheduledPostIds = Array.from(new Set(rows.map((row) => row.id))).filter(Boolean);

  if (scheduledPostIds.length === 0) {
    return new Map();
  }

  const result = await queryDb<PostMetricRow>(
    `
      select
        scheduled_post_id,
        performance_label,
        engagement_score,
        updated_at
      from post_metrics
      where scheduled_post_id = any($1::uuid[])
    `,
    [scheduledPostIds],
  );

  return new Map(
    result.rows.map((row) => [
      row.scheduled_post_id,
      {
        performanceLabel: row.performance_label ?? undefined,
        engagementScore:
          row.engagement_score === null || row.engagement_score === undefined
            ? undefined
            : Number(row.engagement_score),
        performanceRecordedAt: toIsoString(row.updated_at),
      },
    ]),
  );
}

function mapScheduledPostWithAssets(
  row: ScheduledPostRow,
  linkedAssetsMap: Map<string, PostAsset[]>,
  metricsMap: Map<
    string,
    {
      performanceLabel?: PostPerformanceLabel;
      engagementScore?: number;
      performanceRecordedAt?: string;
    }
  >,
): ScheduledPost {
  const linkedAssets = row.asset_group_id ? linkedAssetsMap.get(row.asset_group_id) ?? [] : [];

  return {
    ...mapScheduledPost(row, metricsMap.get(row.id)),
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
  const parsed = Number(process.env.POST_SAFETY_DAILY_LIMIT ?? 2);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 2;
}

function resolveMinGapMinutes(): number {
  const parsed = Number(process.env.POST_SAFETY_MIN_GAP_MINUTES ?? 240);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 240;
}

function resolveJitterMinutes(): number {
  const parsed = Number(process.env.POST_SAFETY_JITTER_MINUTES ?? 20);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 20;
}

function resolveMaxRetryCount(): number {
  const parsed = Number(process.env.SCHEDULED_POST_MAX_RETRIES ?? 2);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 2;
}

function resolveDispatchPriority(): number {
  const parsed = Number(process.env.POST_PUBLISH_JOB_PRIORITY ?? 40);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 40;
}

function normalizeContentForHash(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function extractHookCandidate(contentText: string): string {
  const firstNonEmptyLine = contentText
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return firstNonEmptyLine ?? contentText.trim();
}

function buildContentFingerprint(contentText: string): {
  hookHash: string;
  bodyHash: string;
  contentFingerprint: string;
} {
  const normalizedBody = normalizeContentForHash(contentText);
  const normalizedHook = normalizeContentForHash(extractHookCandidate(contentText));

  return {
    hookHash: hashText(normalizedHook),
    bodyHash: hashText(normalizedBody),
    contentFingerprint: hashText(`${normalizedHook}::${normalizedBody}`),
  };
}

function selectDispatchRunAfter(start: Date, end: Date): Date {
  const spanMs = Math.max(0, end.getTime() - start.getTime());

  if (spanMs === 0) {
    return start;
  }

  return new Date(start.getTime() + Math.floor(Math.random() * (spanMs + 1)));
}

function buildDispatchWindow(scheduledAt: Date): {
  earliestDispatchAt: Date;
  latestDispatchAt: Date;
  runAfter: Date;
} {
  const jitterMinutes = resolveJitterMinutes();
  const earlyMinutes = Math.floor(jitterMinutes * 0.4);
  const nowFloor = new Date(Date.now() + 60 * 1000);
  const earliestDispatchAt = new Date(
    Math.max(scheduledAt.getTime() - earlyMinutes * 60 * 1000, nowFloor.getTime()),
  );
  const latestDispatchAt = new Date(
    Math.max(scheduledAt.getTime() + jitterMinutes * 60 * 1000, earliestDispatchAt.getTime()),
  );

  return {
    earliestDispatchAt,
    latestDispatchAt,
    runAfter: selectDispatchRunAfter(earliestDispatchAt, latestDispatchAt),
  };
}

function buildImmediateDispatchWindow(dispatchAt = new Date()): {
  earliestDispatchAt: Date;
  latestDispatchAt: Date;
  runAfter: Date;
} {
  return {
    earliestDispatchAt: dispatchAt,
    latestDispatchAt: dispatchAt,
    runAfter: dispatchAt,
  };
}

function buildDailyLimitWarning(limit: number): SchedulingSafetyWarning {
  return {
    code: "daily_limit",
    title: "Daily LinkedIn limit reached",
    message: `This workspace already has ${limit} LinkedIn post${limit === 1 ? "" : "s"} planned for this day. Schedule anyway?`,
  };
}

function buildMinimumGapWarning(minGapMinutes: number): SchedulingSafetyWarning {
  return {
    code: "minimum_gap",
    title: "Posts are too close together",
    message: `Another LinkedIn post is already scheduled within ${minGapMinutes} minutes of this time. Schedule anyway?`,
  };
}

function summarizePublishFailure(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.code === "linkedin_not_connected") {
      return "LinkedIn connection expired or is not configured. Reconnect LinkedIn and retry the post.";
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "Unknown publishing error.";
}

function isRetryablePublishError(error: unknown): boolean {
  if (error instanceof HttpError) {
    if (error.code === "linkedin_not_connected") {
      return false;
    }

    if (error.statusCode >= 500) {
      return true;
    }

    return false;
  }

  return true;
}

async function loadDailyLimitWarning(
  businessId: string,
  scheduledAt: Date,
  ignoreScheduledPostId?: string | null,
): Promise<SchedulingSafetyWarning | null> {
  const startOfDay = new Date(scheduledAt);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);
  const result = await queryDb<{ total: string | number }>(
    `
      select count(*)::int as total
      from scheduled_posts
      where business_id = $1
        and platform = 'linkedin'
        and status in ('scheduled', 'processing', 'published')
        and scheduled_at >= $2
        and scheduled_at < $3
        and ($4::uuid is null or id <> $4)
    `,
    [businessId, startOfDay.toISOString(), endOfDay.toISOString(), ignoreScheduledPostId ?? null],
  );

  const limit = resolveDailyLimit();

  if (toNumber(result.rows[0]?.total) >= limit) {
    return buildDailyLimitWarning(limit);
  }

  return null;
}

async function loadMinimumGapWarning(
  businessId: string,
  scheduledAt: Date,
  ignoreScheduledPostId?: string | null,
): Promise<SchedulingSafetyWarning | null> {
  const minGapMinutes = resolveMinGapMinutes();

  if (minGapMinutes <= 0) {
    return null;
  }

  const gapStart = new Date(scheduledAt.getTime() - minGapMinutes * 60 * 1000);
  const gapEnd = new Date(scheduledAt.getTime() + minGapMinutes * 60 * 1000);
  const result = await queryDb<{ scheduled_at: Date | string }>(
    `
      select scheduled_at
      from scheduled_posts
      where business_id = $1
        and platform = 'linkedin'
        and status in ('scheduled', 'processing', 'published')
        and scheduled_at >= $2
        and scheduled_at <= $3
        and ($5::uuid is null or id <> $5)
      order by abs(extract(epoch from (scheduled_at - $4::timestamptz))) asc
      limit 1
    `,
    [
      businessId,
      gapStart.toISOString(),
      gapEnd.toISOString(),
      scheduledAt.toISOString(),
      ignoreScheduledPostId ?? null,
    ],
  );

  if (result.rows[0]?.scheduled_at) {
    return buildMinimumGapWarning(minGapMinutes);
  }

  return null;
}

async function collectSchedulingSafetyWarnings(input: {
  businessId: string;
  scheduledAt: Date;
  ignoreScheduledPostId?: string | null;
}): Promise<SchedulingSafetyWarning[]> {
  const [dailyLimitWarning, minimumGapWarning] = await Promise.all([
    loadDailyLimitWarning(input.businessId, input.scheduledAt, input.ignoreScheduledPostId),
    loadMinimumGapWarning(input.businessId, input.scheduledAt, input.ignoreScheduledPostId),
  ]);

  return [dailyLimitWarning, minimumGapWarning].filter(
    (warning): warning is SchedulingSafetyWarning => Boolean(warning),
  );
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

async function hasActivePublishingConflict(row: ScheduledPostRow): Promise<boolean> {
  const result = await queryDb<SchedulingConflictCheckResult>(
    `
      select id
      from scheduled_posts
      where id <> $1::uuid
        and status = 'processing'
        and (
          business_id = $2::uuid
          or (
            $3::uuid is not null
            and social_account_identity_id = $3::uuid
          )
        )
      limit 1
    `,
    [row.id, row.business_id, row.social_account_identity_id ?? null],
  );

  return Boolean(result.rows[0]?.id);
}

async function updateScheduledPostDispatchState(
  input: {
    scheduledPostId: string;
    scheduledAt: Date;
    businessId: string;
    contentText: string;
    previousDispatchJobId?: string | null;
    dispatchMode?: "scheduled" | "immediate";
  },
  client: PoolClient,
): Promise<{
  dispatchJobId: string;
  earliestDispatchAt: string;
  latestDispatchAt: string;
  runAfter: string;
}> {
  if (input.previousDispatchJobId) {
    await pauseJob(input.previousDispatchJobId, client);
  }

  const dispatchWindow =
    input.dispatchMode === "immediate"
      ? buildImmediateDispatchWindow(input.scheduledAt)
      : buildDispatchWindow(input.scheduledAt);
  const fingerprint = buildContentFingerprint(input.contentText);
  const queuedJob = await createJob<ScheduledPostPublishJobPayload>({
    businessId: input.businessId,
    type: "post_publish",
    priority: resolveDispatchPriority(),
    payload: {
      scheduledPostId: input.scheduledPostId,
    },
    maxAttempts: resolveMaxRetryCount(),
    runAfter: dispatchWindow.runAfter.toISOString(),
    client,
  });

  await executeQuery(
    `
      update scheduled_posts
      set
        earliest_dispatch_at = $2::timestamptz,
        latest_dispatch_at = $3::timestamptz,
        dispatch_priority = $4::int,
        dispatch_job_id = $5::uuid,
        hook_hash = $6,
        body_hash = $7,
        content_fingerprint = $8,
        updated_at = now()
      where id = $1::uuid
    `,
    [
      input.scheduledPostId,
      dispatchWindow.earliestDispatchAt.toISOString(),
      dispatchWindow.latestDispatchAt.toISOString(),
      resolveDispatchPriority(),
      queuedJob.id,
      fingerprint.hookHash,
      fingerprint.bodyHash,
      fingerprint.contentFingerprint,
    ],
    client,
  );

  return {
    dispatchJobId: queuedJob.id,
    earliestDispatchAt: dispatchWindow.earliestDispatchAt.toISOString(),
    latestDispatchAt: dispatchWindow.latestDispatchAt.toISOString(),
    runAfter: dispatchWindow.runAfter.toISOString(),
  };
}

async function markScheduledPostQueuedForRetry(
  scheduledPostId: string,
  errorMessage: string,
  retryCount: number,
): Promise<void> {
  await executeQuery(
    `
      update scheduled_posts
      set
        status = 'scheduled',
        error_message = $2,
        retry_count = $3::int,
        last_attempt_at = now(),
        updated_at = now()
      where id = $1::uuid
    `,
    [scheduledPostId, errorMessage, retryCount],
  );

  await recordPublicationEvent(scheduledPostId, "scheduled", {
    retryQueued: true,
    message: errorMessage,
    retryCount,
  });
}

async function markScheduledPostProcessing(scheduledPostId: string, attemptCount: number): Promise<void> {
  await executeQuery(
    `
      update scheduled_posts
      set
        status = 'processing',
        error_message = null,
        retry_count = $2::int,
        last_attempt_at = now(),
        updated_at = now()
      where id = $1::uuid
    `,
    [scheduledPostId, attemptCount],
  );

  await recordPublicationEvent(scheduledPostId, "processing", {
    claimedAt: new Date().toISOString(),
    attemptCount,
  });
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
  stage: "draft" | "review" | "scheduled" | "posted";
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
        sp.id,
        sp.business_id,
        sp.user_id,
        sp.social_account_id,
        sp.social_account_identity_id,
        sai.display_name as social_account_identity_display_name,
        sai.identity_type as social_account_identity_type,
        sp.platform,
        sp.content_text,
        sp.asset_group_id,
        sp.asset_payload,
        sp.scheduled_at,
        sp.earliest_dispatch_at,
        sp.latest_dispatch_at,
        sp.dispatch_job_id,
        sp.dispatch_priority,
        sp.hook_hash,
        sp.body_hash,
        sp.content_fingerprint,
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
      from scheduled_posts sp
      left join social_account_identities sai
        on sai.id = sp.social_account_identity_id
      where sp.id = $1
        and sp.business_id = $2
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

function canPublishNowScheduledPost(status: ScheduledPostStatus): boolean {
  return status === "scheduled" || status === "paused" || status === "failed";
}

function canMoveScheduledPostToDraft(row: ScheduledPostRow): boolean {
  return Boolean(
    row.asset_group_id
      && (row.status === "scheduled" || row.status === "paused" || row.status === "failed" || row.status === "canceled"),
  );
}

function normalizePostPerformanceLabel(value: string): PostPerformanceLabel {
  switch (value) {
    case "low":
    case "medium":
    case "high":
      return value;
    default:
      throw new HttpError(400, "bad_request", "performanceLabel must be low, medium, or high.");
  }
}

function engagementScoreFromPerformanceLabel(label: PostPerformanceLabel): number {
  switch (label) {
    case "high":
      return 0.9;
    case "medium":
      return 0.6;
    default:
      return 0.25;
  }
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

async function backfillScheduledPostDispatchJobs(limit: number): Promise<number> {
  return withDbTransaction(async (client) => {
    const result = await executeQuery<ScheduledPostRow>(
      `
        select
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
          sp.earliest_dispatch_at,
          sp.latest_dispatch_at,
          sp.dispatch_job_id,
          sp.dispatch_priority,
          sp.hook_hash,
          sp.body_hash,
          sp.content_fingerprint,
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
        from scheduled_posts sp
        left join jobs j on j.id = sp.dispatch_job_id
        where sp.platform = 'linkedin'
          and sp.status = 'scheduled'
          and (
            sp.dispatch_job_id is null
            or j.id is null
            or j.status not in ('queued', 'processing')
          )
        order by sp.scheduled_at asc
        limit $1
        for update of sp skip locked
      `,
      [limit],
      client,
    );

    for (const row of result.rows) {
      await updateScheduledPostDispatchState(
        {
          scheduledPostId: row.id,
          scheduledAt: new Date(row.scheduled_at),
          businessId: row.business_id,
          contentText: row.content_text,
          previousDispatchJobId: row.dispatch_job_id,
        },
        client,
      );
    }

    return result.rows.length;
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
    case "publish_now":
    case "move_to_draft":
      return value;
    default:
      throw new HttpError(
        400,
        "bad_request",
        "action must be pause, resume, cancel, retry, reschedule, publish_now, or move_to_draft.",
      );
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

    await withDbTransaction(async (client) => {
      if (existing.dispatch_job_id) {
        await pauseJob(existing.dispatch_job_id, client);
      }

      await executeQuery(
        `
          update scheduled_posts
          set
            status = 'paused',
            updated_at = now()
          where id = $1::uuid
        `,
        [existing.id],
        client,
      );
    });

    await recordPublicationEvent(existing.id, "paused", {
      action: "pause",
      previousStatus: existing.status,
    });
    const updatedRow = await loadScheduledPostRow(businessId, existing.id);
    const linkedAssetsMap = await loadLinkedPostAssetsMap([updatedRow]);
    const metricsMap = await loadPostMetricsMap([updatedRow]);

    return { scheduledPost: mapScheduledPostWithAssets(updatedRow, linkedAssetsMap, metricsMap) };
  }

  if (action === "resume") {
    if (!canResumeScheduledPost(existing.status)) {
      throw new HttpError(409, "scheduled_post_conflict", "Only paused posts can be resumed.");
    }

    await withDbTransaction(async (client) => {
      await executeQuery(
        `
          update scheduled_posts
          set
            status = 'scheduled',
            error_message = null,
            updated_at = now()
          where id = $1::uuid
        `,
        [existing.id],
        client,
      );

      await updateScheduledPostDispatchState(
        {
          scheduledPostId: existing.id,
          scheduledAt: new Date(existing.scheduled_at),
          businessId,
          contentText: existing.content_text,
          previousDispatchJobId: existing.dispatch_job_id,
        },
        client,
      );
    });

    await recordPublicationEvent(existing.id, "scheduled", {
      action: "resume",
      previousStatus: existing.status,
      scheduledAt: new Date(existing.scheduled_at).toISOString(),
      audienceTimezone: existing.audience_timezone,
    });
    const updatedRow = await loadScheduledPostRow(businessId, existing.id);
    const linkedAssetsMap = await loadLinkedPostAssetsMap([updatedRow]);
    const metricsMap = await loadPostMetricsMap([updatedRow]);

    return { scheduledPost: mapScheduledPostWithAssets(updatedRow, linkedAssetsMap, metricsMap) };
  }

  if (action === "cancel") {
    if (!canCancelScheduledPost(existing.status)) {
      throw new HttpError(
        409,
        "scheduled_post_conflict",
        "Only scheduled, paused, or failed posts can be canceled.",
      );
    }

    await withDbTransaction(async (client) => {
      if (existing.dispatch_job_id) {
        await pauseJob(existing.dispatch_job_id, client);
      }

      await executeQuery(
        `
          update scheduled_posts
          set
            status = 'canceled',
            updated_at = now()
          where id = $1::uuid
        `,
        [existing.id],
        client,
      );
    });

    await recordPublicationEvent(existing.id, "canceled", {
      action: "cancel",
      previousStatus: existing.status,
    });
    await syncLinkedContentAssetStage({
      businessId,
      linkedAssetId: existing.asset_group_id,
      stage: "review",
    });
    const updatedRow = await loadScheduledPostRow(businessId, existing.id);
    const linkedAssetsMap = await loadLinkedPostAssetsMap([updatedRow]);
    const metricsMap = await loadPostMetricsMap([updatedRow]);

    return { scheduledPost: mapScheduledPostWithAssets(updatedRow, linkedAssetsMap, metricsMap) };
  }

  if (action === "retry") {
    if (!canRetryScheduledPost(existing.status)) {
      throw new HttpError(409, "scheduled_post_conflict", "Only failed posts can be retried.");
    }

    await withDbTransaction(async (client) => {
      await executeQuery(
        `
          update scheduled_posts
          set
            status = 'scheduled',
            error_message = null,
            retry_count = 0,
            last_attempt_at = null,
            updated_at = now()
          where id = $1::uuid
        `,
        [existing.id],
        client,
      );

      await updateScheduledPostDispatchState(
        {
          scheduledPostId: existing.id,
          scheduledAt: new Date(existing.scheduled_at),
          businessId,
          contentText: existing.content_text,
          previousDispatchJobId: existing.dispatch_job_id,
        },
        client,
      );
    });

    await recordPublicationEvent(existing.id, "scheduled", {
      action: "retry",
      previousStatus: existing.status,
      scheduledAt: new Date(existing.scheduled_at).toISOString(),
      audienceTimezone: existing.audience_timezone,
    });
    const updatedRow = await loadScheduledPostRow(businessId, existing.id);
    const linkedAssetsMap = await loadLinkedPostAssetsMap([updatedRow]);
    const metricsMap = await loadPostMetricsMap([updatedRow]);

    return { scheduledPost: mapScheduledPostWithAssets(updatedRow, linkedAssetsMap, metricsMap) };
  }

  if (action === "publish_now") {
    if (!canPublishNowScheduledPost(existing.status)) {
      throw new HttpError(
        409,
        "scheduled_post_conflict",
        "Only scheduled, paused, or failed posts can be pushed to publish now.",
      );
    }

    const immediateDispatchAt = new Date();

    await withDbTransaction(async (client) => {
      await executeQuery(
        `
          update scheduled_posts
          set
            scheduled_at = $2::timestamptz,
            audience_timezone = $3,
            status = 'scheduled',
            error_message = null,
            retry_count = case when $4::boolean then 0 else retry_count end,
            last_attempt_at = case when $4::boolean then null else last_attempt_at end,
            updated_at = now()
          where id = $1::uuid
        `,
        [
          existing.id,
          immediateDispatchAt.toISOString(),
          existing.audience_timezone,
          existing.status === "failed",
        ],
        client,
      );

      await updateScheduledPostDispatchState(
        {
          scheduledPostId: existing.id,
          scheduledAt: immediateDispatchAt,
          businessId,
          contentText: existing.content_text,
          previousDispatchJobId: existing.dispatch_job_id,
          dispatchMode: "immediate",
        },
        client,
      );
    });

    await recordPublicationEvent(existing.id, "scheduled", {
      action: "publish_now",
      previousStatus: existing.status,
      scheduledAt: immediateDispatchAt.toISOString(),
      audienceTimezone: existing.audience_timezone,
    });
    await syncLinkedContentAssetStage({
      businessId,
      linkedAssetId: existing.asset_group_id,
      stage: "scheduled",
    });
    const updatedRow = await loadScheduledPostRow(businessId, existing.id);
    const linkedAssetsMap = await loadLinkedPostAssetsMap([updatedRow]);
    const metricsMap = await loadPostMetricsMap([updatedRow]);

    return { scheduledPost: mapScheduledPostWithAssets(updatedRow, linkedAssetsMap, metricsMap) };
  }

  if (action === "move_to_draft") {
    if (!canMoveScheduledPostToDraft(existing)) {
      throw new HttpError(
        409,
        "scheduled_post_conflict",
        "Only scheduled slots with a linked draft can be moved back to the backlog.",
      );
    }

    await withDbTransaction(async (client) => {
      if (existing.dispatch_job_id) {
        await pauseJob(existing.dispatch_job_id, client);
      }

      await executeQuery(
        `
          update scheduled_posts
          set
            status = 'canceled',
            updated_at = now()
          where id = $1::uuid
        `,
        [existing.id],
        client,
      );
    });

    await recordPublicationEvent(existing.id, "canceled", {
      action: "move_to_draft",
      previousStatus: existing.status,
    });
    await syncLinkedContentAssetStage({
      businessId,
      linkedAssetId: existing.asset_group_id,
      stage: "draft",
    });
    const updatedRow = await loadScheduledPostRow(businessId, existing.id);
    const linkedAssetsMap = await loadLinkedPostAssetsMap([updatedRow]);
    const metricsMap = await loadPostMetricsMap([updatedRow]);

    return { scheduledPost: mapScheduledPostWithAssets(updatedRow, linkedAssetsMap, metricsMap) };
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
  const nextScheduledAt = parseScheduledAt(input.scheduledAt.trim());
  const safetyWarnings = await collectSchedulingSafetyWarnings({
    businessId,
    scheduledAt: nextScheduledAt,
    ignoreScheduledPostId: existing.id,
  });

  if (safetyWarnings.length > 0 && !input.ignoreSafetyWarnings) {
    throw new HttpError(
      409,
      "scheduling_safety_warning",
      safetyWarnings[0]?.message ?? "Scheduling needs confirmation.",
      { warnings: safetyWarnings },
    );
  }

  const nextStatus: ScheduledPostStatus = existing.status === "paused" ? "paused" : "scheduled";
  await withDbTransaction(async (client) => {
    if (existing.dispatch_job_id) {
      await pauseJob(existing.dispatch_job_id, client);
    }

    const dispatchWindow = buildDispatchWindow(nextScheduledAt);

    await executeQuery(
      `
        update scheduled_posts
        set
          scheduled_at = $2::timestamptz,
          earliest_dispatch_at = $3::timestamptz,
          latest_dispatch_at = $4::timestamptz,
          audience_timezone = $5,
          status = $6,
          error_message = null,
          retry_count = case when $7::boolean then 0 else retry_count end,
          last_attempt_at = case when $7::boolean then null else last_attempt_at end,
          updated_at = now()
        where id = $1::uuid
      `,
      [
        existing.id,
        nextScheduledAt.toISOString(),
        dispatchWindow.earliestDispatchAt.toISOString(),
        dispatchWindow.latestDispatchAt.toISOString(),
        nextAudienceTimezone,
        nextStatus,
        existing.status === "failed",
      ],
      client,
    );

    if (nextStatus === "scheduled") {
      await updateScheduledPostDispatchState(
        {
          scheduledPostId: existing.id,
          scheduledAt: nextScheduledAt,
          businessId,
          contentText: existing.content_text,
          previousDispatchJobId: existing.dispatch_job_id,
        },
        client,
      );
    }
  });

  await recordPublicationEvent(existing.id, nextStatus, {
    action: "reschedule",
    previousStatus: existing.status,
    scheduledAt: nextScheduledAt.toISOString(),
    audienceTimezone: nextAudienceTimezone,
  });
  const updatedRow = await loadScheduledPostRow(businessId, existing.id);
  const linkedAssetsMap = await loadLinkedPostAssetsMap([updatedRow]);
  const metricsMap = await loadPostMetricsMap([updatedRow]);

  return {
    scheduledPost: mapScheduledPostWithAssets(updatedRow, linkedAssetsMap, metricsMap),
    safetyWarnings,
  };
}

export async function createScheduledPost(
  principal: AuthenticatedPrincipal,
  input: SchedulePostRequest,
): Promise<SchedulePostResponse> {
  const businessId = input.businessId.trim();

  if (input.platform !== "linkedin") {
    throw new HttpError(400, "bad_request", "Only LinkedIn scheduling is supported right now.");
  }

  const contentText = input.contentText.trim();

  if (!contentText) {
    throw new HttpError(400, "bad_request", "contentText is required.");
  }

  const scheduledAt = parseScheduledAt(input.scheduledAt);
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

  if (!principal.userId) {
    throw new HttpError(401, "auth_required", "Authenticated user context is incomplete.");
  }

  const safetyWarnings = await collectSchedulingSafetyWarnings({
    businessId,
    scheduledAt,
  });

  if (safetyWarnings.length > 0 && !input.ignoreSafetyWarnings) {
    throw new HttpError(
      409,
      "scheduling_safety_warning",
      safetyWarnings[0]?.message ?? "Scheduling needs confirmation.",
      { warnings: safetyWarnings },
    );
  }
  const publishingTarget = await resolveLinkedInPublishingTarget(businessId);
  const linkedAssetId = input.assetGroupId?.trim() || null;
  let createdScheduledPostId = "";

  await withDbTransaction(async (client) => {
    const dispatchWindow = buildDispatchWindow(scheduledAt);
    const fingerprint = buildContentFingerprint(contentText);
    const insertResult = await executeQuery<{ id: string }>(
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
          earliest_dispatch_at,
          latest_dispatch_at,
          audience_timezone,
          status,
          dispatch_priority,
          hook_hash,
          body_hash,
          content_fingerprint
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          'linkedin',
          $5,
          $6,
          $7::jsonb,
          $8::timestamptz,
          $9::timestamptz,
          $10::timestamptz,
          $11,
          'scheduled',
          $12::int,
          $13,
          $14,
          $15
        )
        returning id
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
        dispatchWindow.earliestDispatchAt.toISOString(),
        dispatchWindow.latestDispatchAt.toISOString(),
        audienceTimezone,
        resolveDispatchPriority(),
        fingerprint.hookHash,
        fingerprint.bodyHash,
        fingerprint.contentFingerprint,
      ],
      client,
    );

    createdScheduledPostId = insertResult.rows[0].id;

    await updateScheduledPostDispatchState(
      {
        scheduledPostId: createdScheduledPostId,
        scheduledAt,
        businessId,
        contentText,
      },
      client,
    );
  });

  await recordPublicationEvent(createdScheduledPostId, "scheduled", {
    scheduledAt: scheduledAt.toISOString(),
    audienceTimezone,
    slideCount: slides.length,
  });

  await syncLinkedContentAssetStage({
    businessId,
    linkedAssetId,
    stage: "scheduled",
  });
  const createdRow = await loadScheduledPostRow(businessId, createdScheduledPostId);
  const linkedAssetsMap = await loadLinkedPostAssetsMap([createdRow]);
  const metricsMap = await loadPostMetricsMap([createdRow]);

  return {
    scheduledPost: mapScheduledPostWithAssets(createdRow, linkedAssetsMap, metricsMap),
    safetyWarnings,
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
          earliest_dispatch_at,
          latest_dispatch_at,
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
          now(),
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
        sp.id,
        sp.business_id,
        sp.user_id,
        sp.social_account_id,
        sp.social_account_identity_id,
        sai.display_name as social_account_identity_display_name,
        sai.identity_type as social_account_identity_type,
        sp.platform,
        sp.content_text,
        sp.asset_group_id,
        sp.asset_payload,
        sp.scheduled_at,
        sp.earliest_dispatch_at,
        sp.latest_dispatch_at,
        sp.dispatch_job_id,
        sp.dispatch_priority,
        sp.hook_hash,
        sp.body_hash,
        sp.content_fingerprint,
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
      from scheduled_posts sp
      left join social_account_identities sai
        on sai.id = sp.social_account_identity_id
      where sp.business_id = $1
      order by sp.scheduled_at desc
      limit 200
    `,
    [businessId],
  );
  const linkedAssetsMap = await loadLinkedPostAssetsMap(result.rows);
  const metricsMap = await loadPostMetricsMap(result.rows);

  return {
    scheduledPosts: result.rows.map((row) => mapScheduledPostWithAssets(row, linkedAssetsMap, metricsMap)),
  };
}

export async function updateScheduledPostPerformance(
  principal: AuthenticatedPrincipal,
  scheduledPostId: string,
  input: UpdateScheduledPostPerformanceRequest,
): Promise<UpdateScheduledPostPerformanceResponse> {
  const businessId = input.businessId.trim();
  const performanceLabel = normalizePostPerformanceLabel(input.performanceLabel);

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "scheduler",
    usageMetric: "posts",
  });
  await requireBusinessMembership(principal, businessId);

  const existing = await loadScheduledPostRow(businessId, scheduledPostId);

  if (existing.status !== "published") {
    throw new HttpError(
      409,
      "scheduled_post_conflict",
      "Performance can only be recorded after the post has been published.",
    );
  }

  await queryDb(
    `
      insert into post_metrics (
        business_id,
        scheduled_post_id,
        source,
        performance_label,
        engagement_score
      ) values (
        $1::uuid,
        $2::uuid,
        'manual',
        $3,
        $4
      )
      on conflict (scheduled_post_id)
      do update set
        source = excluded.source,
        performance_label = excluded.performance_label,
        engagement_score = excluded.engagement_score,
        updated_at = now()
    `,
    [
      businessId,
      scheduledPostId,
      performanceLabel,
      engagementScoreFromPerformanceLabel(performanceLabel),
    ],
  );

  await recordPublicationEvent(existing.id, "published", {
    action: "performance_feedback",
    performanceLabel,
  });

  const updatedRow = await loadScheduledPostRow(businessId, existing.id);
  const linkedAssetsMap = await loadLinkedPostAssetsMap([updatedRow]);
  const metricsMap = await loadPostMetricsMap([updatedRow]);

  return {
    scheduledPost: mapScheduledPostWithAssets(updatedRow, linkedAssetsMap, metricsMap),
  };
}

export async function processDueScheduledPosts(limit: number): Promise<{
  claimed: number;
  published: number;
  failed: number;
}> {
  await backfillScheduledPostDispatchJobs(Math.max(limit * 2, 10));
  const queuedJobs = await claimQueuedJobs<ScheduledPostPublishJobPayload>({
    types: ["post_publish"],
    batchSize: limit,
    lockedBy: process.env.RENDER_SERVICE_NAME?.trim() || `app-worker:${process.pid}`,
    staleAfterMinutes: 20,
  });
  let published = 0;
  let failed = 0;

  for (const job of queuedJobs) {
    if (!job.businessId || !job.payload.scheduledPostId) {
      await markJobTerminalFailed(job.id, "Scheduled publish job is missing required context.");
      failed += 1;
      continue;
    }

    let duePost: ScheduledPostRow;

    try {
      duePost = await loadScheduledPostRow(job.businessId, job.payload.scheduledPostId);
    } catch {
      await markJobTerminalFailed(job.id, "Scheduled post no longer exists.");
      failed += 1;
      continue;
    }

    if (duePost.status !== "scheduled") {
      await markJobCompleted(job.id);
      continue;
    }

    if (duePost.dispatch_job_id && duePost.dispatch_job_id !== job.id) {
      await markJobCompleted(job.id);
      continue;
    }

    if (await hasActivePublishingConflict(duePost)) {
      await releaseJob(
        job.id,
        {
          runAfter: new Date(Date.now() + 60 * 1000).toISOString(),
          errorMessage: "Delayed briefly to keep LinkedIn publishing safely serialized for this workspace.",
        },
      );
      continue;
    }

    try {
      await markScheduledPostProcessing(duePost.id, job.attempts);
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
      await markJobCompleted(job.id);
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
      const failureMessage = summarizePublishFailure(error);
      const shouldRetry = isRetryablePublishError(error) && job.attempts < job.maxAttempts;

      if (shouldRetry) {
        await markScheduledPostQueuedForRetry(duePost.id, failureMessage, job.attempts);
        await markJobFailed(job.id, failureMessage);
      } else {
        await markScheduledPostFailed(duePost.id, new Error(failureMessage));
        await markJobTerminalFailed(job.id, failureMessage);
        failed += 1;
      }

      logError("Failed to publish scheduled LinkedIn post.", {
        scheduledPostId: duePost.id,
        message: failureMessage,
        retryQueued: shouldRetry,
      });
    }
  }

  return {
    claimed: queuedJobs.length,
    published,
    failed,
  };
}
