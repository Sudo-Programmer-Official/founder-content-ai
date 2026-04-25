import { createHash } from "node:crypto";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import type {
  ContentDistributionGroup,
  CreatePublishAttemptRequest,
  CreatePublishAttemptResponse,
  PostAsset,
  PostPerformanceLabel,
  PublishAttempt,
  PublishAttemptDetailResponse,
  PublishAttemptMediaSummary,
  PublishAttemptPlatform,
  PublishAttemptPlatformStatus,
  PublishAttemptSourceKind,
  PublishAttemptsResponse,
  PublishAttemptStatus,
  PublishPostRequest,
  PublishPostResponse,
  RetryPublishAttemptRequest,
  RetryPublishAttemptResponse,
  SchedulePostRequest,
  SchedulePostResponse,
  ScheduleItem,
  SchedulingSafetyWarning,
  ScheduledPost,
  ScheduledPostMutationAction,
  ScheduledPostSlide,
  ScheduledPostsResponse,
  ScheduledPostStatus,
  SocialAccountIdentityType,
  SocialPlatform,
  UpdateScheduledPostRequest,
  UpdateScheduledPostPerformanceRequest,
  UpdateScheduledPostPerformanceResponse,
  UpdateScheduledPostResponse,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireBusinessMembership } from "./authBusinessService.ts";
import {
  getBusinessAccessState,
  resolveScheduledQueueLimit,
} from "./adminControlService.ts";
import { updateContentPipelineItem } from "./controlDashboardService.ts";
import { getTableColumnSet, queryDb, withDbTransaction } from "./db/client.ts";
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
import { loadPostAssetsByPostIds, loadReadyPostAssets } from "./postAssetService.ts";
import {
  publishPlatformPost,
  resolvePublishAssetsForChannel,
  validatePublishMediaForChannel,
} from "./publishingService.ts";
import {
  safeRecordContentGenerationSuggestionPerformance,
  safeRecordContentGenerationSuggestionPublished,
  safeRecordContentGenerationSuggestionScheduled,
} from "./contentGenerationFeedbackService.ts";
import { recordDerivedMediaPerformanceFromPostFeedback } from "./mediaIntelligenceService.ts";
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
  platform: SocialPlatform;
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
  selected_identity_id: string | null;
}

interface LinkedDistributionGroupRow extends QueryResultRow {
  id: string;
  editable_until: Date | string | null;
}

interface LinkedScheduleItemDistributionRow extends QueryResultRow {
  id: string;
  distribution_group_id: string | null;
}

interface DistributionGroupScheduleItemRow extends QueryResultRow {
  status: ScheduleItem["status"];
  scheduled_at: Date | string | null;
  published_at: Date | string | null;
}

interface LinkedScheduleExecutionContextRow extends QueryResultRow {
  schedule_item_id: string;
  distribution_group_id: string | null;
  channel: string;
}

interface ScheduledPostAttemptSeedRow extends ScheduledPostRow {
  schedule_item_id: string | null;
  distribution_group_id: string | null;
  group_title: string | null;
}

interface ScheduledPostPublishJobPayload {
  scheduledPostId: string;
}

interface SchedulingConflictCheckResult extends QueryResultRow {
  id: string;
}

interface ScheduledQueueUsageRow extends QueryResultRow {
  total: string | number;
}

interface DirectPublishReuseRow extends QueryResultRow {
  id: string;
  status: ScheduledPostStatus;
  external_post_id: string | null;
  external_post_url: string | null;
  published_at: Date | string | null;
  created_at: Date | string;
}

interface ContentAssetBodyOnlyRow extends QueryResultRow {
  content_body: unknown;
}

interface PublishAttemptRow extends QueryResultRow {
  id: string;
  business_id: string;
  user_id: string | null;
  source_kind: PublishAttemptSourceKind;
  status: PublishAttemptStatus;
  title: string | null;
  content_text: string | null;
  asset_group_id: string | null;
  asset_payload: unknown;
  distribution_group_id: string | null;
  retry_of_attempt_id: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PublishAttemptPlatformRow extends QueryResultRow {
  id: string;
  publish_attempt_id: string;
  business_id: string;
  platform: SocialPlatform;
  status: PublishAttemptPlatformStatus;
  content_text: string;
  asset_group_id: string | null;
  asset_payload: unknown;
  media_summary: unknown;
  scheduled_post_id: string | null;
  schedule_item_id: string | null;
  distribution_group_id: string | null;
  social_account_id: string | null;
  social_account_identity_id: string | null;
  external_post_id: string | null;
  external_post_url: string | null;
  error_code: string | null;
  error_message: string | null;
  response_json: unknown;
  retry_of_publish_attempt_platform_id: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
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

function getZonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function formatDateKeyInTimezone(value: string, timeZone: string): string {
  const parts = getZonedParts(new Date(value), timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatTimeInTimezone(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function buildEditableUntil(value: string, minutesBefore = 5): string {
  return new Date(new Date(value).getTime() - minutesBefore * 60_000).toISOString();
}

function extractPublishAttemptTitle(contentText: string): string {
  const firstLine = contentText
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return (firstLine || "Publishing attempt").slice(0, 160);
}

function buildLinkedInExternalPostUrl(externalPostId: string): string {
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(externalPostId)}`;
}

function resolveSocialPlatformLabel(platform: "linkedin" | "facebook" | "instagram"): string {
  switch (platform) {
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
    default:
      return "LinkedIn";
  }
}

async function loadScheduledQueueUsage(
  businessId: string,
  client?: PoolClient,
): Promise<number> {
  const scheduledPostColumns = await getTableColumnSet("scheduled_posts");
  const groupingBranches: string[] = [];

  if (scheduledPostColumns.has("asset_group_id")) {
    groupingBranches.push(
      "when asset_group_id is not null then asset_group_id::text || '|' || scheduled_at::text",
    );
  }

  if (scheduledPostColumns.has("content_fingerprint")) {
    groupingBranches.push(
      "when content_fingerprint is not null then content_fingerprint || '|' || scheduled_at::text",
    );
  }

  const fallbackGroupingExpression = groupingBranches.length > 0
    ? `case
            ${groupingBranches.join("\n            ")}
            else id::text
          end`
    : "id::text";
  const queueIdentityExpression = scheduledPostColumns.has("distribution_group_id")
    ? `coalesce(distribution_group_id::text, ${fallbackGroupingExpression})`
    : fallbackGroupingExpression;
  const result = await executeQuery<ScheduledQueueUsageRow>(
    `
      select count(
        distinct ${queueIdentityExpression}
      )::int as total
      from scheduled_posts
      where business_id = $1
        and platform in ('linkedin', 'instagram', 'facebook')
        and status in ('scheduled', 'processing', 'paused', 'failed')
    `,
    [businessId],
    client,
  );

  return toNumber(result.rows[0]?.total);
}

async function lockBusinessForScheduling(
  businessId: string,
  client: PoolClient,
): Promise<void> {
  const result = await executeQuery<{ id: string }>(
    `
      select id
      from businesses
      where id = $1
      limit 1
      for update
    `,
    [businessId],
    client,
  );

  if (!result.rows[0]) {
    throw new HttpError(404, "business_not_found", "Workspace not found.");
  }
}

async function enforceScheduledQueueLimit(
  businessId: string,
  client?: PoolClient,
): Promise<void> {
  const access = await getBusinessAccessState(businessId, client);
  const scheduledQueueLimit = resolveScheduledQueueLimit(access.planCode);

  if (scheduledQueueLimit === null) {
    return;
  }

  const scheduledQueueUsed = await loadScheduledQueueUsage(businessId, client);

  if (scheduledQueueUsed < scheduledQueueLimit) {
    return;
  }

  throw new HttpError(
    429,
    "scheduled_queue_limit_reached",
    "Plan your week in advance and stay consistent. Upgrade to unlock scheduling queue.",
    {
      scheduledQueueLimit,
      scheduledQueueUsed,
      scheduledQueueRemaining: Math.max(0, scheduledQueueLimit - scheduledQueueUsed),
      upgradeTitle: "Queue your week, not just one post",
      upgradeMessage: "Unlock multiple scheduled posts so you can stay consistent beyond the first win.",
    },
  );
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

function deriveDistributionGroupStatus(
  statuses: ScheduleItem["status"][],
): ContentDistributionGroup["status"] {
  if (statuses.length === 0) {
    return "draft";
  }

  if (statuses.every((status) => status === "draft")) {
    return "draft";
  }

  if (statuses.every((status) => status === "canceled")) {
    return "canceled";
  }

  if (statuses.every((status) => status === "paused")) {
    return "paused";
  }

  if (statuses.every((status) => status === "published")) {
    return "published";
  }

  if (statuses.every((status) => status === "failed")) {
    return "failed";
  }

  if (statuses.some((status) => status === "processing")) {
    return "processing";
  }

  if (statuses.some((status) => status === "failed")) {
    return "partial";
  }

  if (statuses.some((status) => status === "published")) {
    return "processing";
  }

  if (statuses.every((status) => status === "scheduled")) {
    return "scheduled";
  }

  return "scheduled";
}

async function loadLinkedDistributionGroup(
  scheduledPostId: string,
): Promise<LinkedDistributionGroupRow | null> {
  const result = await queryDb<LinkedDistributionGroupRow>(
    `
      select
        cdg.id,
        cdg.editable_until
      from schedule_items si
      join content_distribution_groups cdg
        on cdg.id = si.distribution_group_id
      where si.legacy_scheduled_post_id = $1::uuid
      limit 1
    `,
    [scheduledPostId],
  );

  return result.rows[0] ?? null;
}

async function loadScheduleExecutionContext(
  scheduledPostId: string,
): Promise<{
  scheduleItemId?: string;
  distributionGroupId?: string;
  channel?: string;
}> {
  const result = await queryDb<LinkedScheduleExecutionContextRow>(
    `
      select
        si.id as schedule_item_id,
        si.distribution_group_id,
        si.channel
      from schedule_items si
      where si.legacy_scheduled_post_id = $1::uuid
      limit 1
    `,
    [scheduledPostId],
  );

  const row = result.rows[0];

  return {
    scheduleItemId: row?.schedule_item_id ?? undefined,
    distributionGroupId: row?.distribution_group_id ?? undefined,
    channel: row?.channel ?? undefined,
  };
}

async function loadScheduledAttemptSeedRows(
  businessId: string,
  distributionGroupId: string,
  client?: PoolClient,
): Promise<ScheduledPostAttemptSeedRow[]> {
  const result = await executeQuery<ScheduledPostAttemptSeedRow>(
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
        sp.updated_at,
        si.id as schedule_item_id,
        si.distribution_group_id,
        cdg.title as group_title
      from schedule_items si
      join scheduled_posts sp
        on sp.id = si.legacy_scheduled_post_id
      left join social_account_identities sai
        on sai.id = sp.social_account_identity_id
      left join content_distribution_groups cdg
        on cdg.id = si.distribution_group_id
      where sp.business_id = $1::uuid
        and si.distribution_group_id = $2::uuid
        and sp.status in ('scheduled', 'processing')
      order by sp.created_at asc
    `,
    [businessId, distributionGroupId],
    client,
  );

  return result.rows;
}

async function reconcileDistributionGroupState(distributionGroupId: string): Promise<void> {
  const result = await queryDb<DistributionGroupScheduleItemRow>(
    `
      select
        status,
        scheduled_at,
        published_at
      from schedule_items
      where distribution_group_id = $1::uuid
    `,
    [distributionGroupId],
  );

  if (result.rows.length === 0) {
    return;
  }

  const nextStatus = deriveDistributionGroupStatus(result.rows.map((row) => row.status));
  const editableCandidates = result.rows
    .filter(
      (row) =>
        row.scheduled_at &&
        row.status !== "published" &&
        row.status !== "failed" &&
        row.status !== "canceled",
    )
    .map((row) => new Date(row.scheduled_at as Date | string).getTime())
    .filter((value) => Number.isFinite(value));
  const nextEditableUntil =
    editableCandidates.length > 0
      ? buildEditableUntil(new Date(Math.min(...editableCandidates)).toISOString())
      : null;
  const publishedCandidates = result.rows
    .filter((row) => row.status === "published" && row.published_at)
    .map((row) => new Date(row.published_at as Date | string).getTime())
    .filter((value) => Number.isFinite(value));
  const nextPublishedAt =
    nextStatus === "published" && publishedCandidates.length > 0
      ? new Date(Math.max(...publishedCandidates)).toISOString()
      : null;

  await queryDb(
    `
      update content_distribution_groups
      set
        status = $2,
        editable_until = $3::timestamptz,
        published_at = $4::timestamptz,
        updated_at = now()
      where id = $1::uuid
    `,
    [distributionGroupId, nextStatus, nextEditableUntil, nextPublishedAt],
  );

  logInfo("Reconciled content distribution group state.", {
    distributionGroupId,
    status: nextStatus,
    scheduleItemCount: result.rows.length,
  });
}

async function syncScheduleItemStateForScheduledPost(input: {
  scheduledPostId: string;
  status: ScheduleItem["status"];
  scheduledAt?: string;
  audienceTimezone?: string;
  externalReferenceId?: string;
  externalReferenceUrl?: string;
  publishedAt?: string;
}): Promise<void> {
  const scheduledAt = input.scheduledAt?.trim();
  const audienceTimezone = input.audienceTimezone?.trim();
  const scheduledDate =
    scheduledAt && audienceTimezone ? formatDateKeyInTimezone(scheduledAt, audienceTimezone) : null;
  const scheduledTime =
    scheduledAt && audienceTimezone ? formatTimeInTimezone(scheduledAt, audienceTimezone) : null;

  const result = await queryDb<LinkedScheduleItemDistributionRow>(
    `
      update schedule_items
      set
        status = $2,
        scheduled_date = coalesce($3::date, scheduled_date),
        scheduled_time = coalesce($4::time, scheduled_time),
        audience_timezone = coalesce($5, audience_timezone),
        scheduled_at = coalesce($6::timestamptz, scheduled_at),
        external_reference_id = coalesce($7, external_reference_id),
        external_reference_url = coalesce($8, external_reference_url),
        published_at = coalesce($9::timestamptz, published_at),
        updated_at = now()
      where legacy_scheduled_post_id = $1::uuid
      returning id, distribution_group_id
    `,
    [
      input.scheduledPostId,
      input.status,
      scheduledDate,
      scheduledTime,
      audienceTimezone ?? null,
      scheduledAt ?? null,
      input.externalReferenceId ?? null,
      input.externalReferenceUrl ?? null,
      input.publishedAt ?? null,
    ],
  );

  const distributionGroupIds = Array.from(
    new Set(
      result.rows
        .map((row) => row.distribution_group_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );
  const scheduleItemIds = Array.from(new Set(result.rows.map((row) => row.id).filter(Boolean)));

  if (result.rows.length > 0) {
    logInfo("Synced schedule item state from scheduled post.", {
      scheduledPostId: input.scheduledPostId,
      scheduleItemIds,
      distributionGroupIds,
      status: input.status,
      externalReferenceId: input.externalReferenceId ?? undefined,
    });
  }

  for (const distributionGroupId of distributionGroupIds) {
    await reconcileDistributionGroupState(distributionGroupId);
  }
}

async function enforceEditableWindowForScheduledPost(
  scheduledPostId: string,
  action: ScheduledPostMutationAction,
): Promise<void> {
  const linkedGroup = await loadLinkedDistributionGroup(scheduledPostId);

  if (!linkedGroup?.editable_until) {
    return;
  }

  if (Date.now() <= new Date(linkedGroup.editable_until).getTime()) {
    return;
  }

  throw new HttpError(
    409,
    "editing_window_closed",
    `The editing window has closed for this scheduled content. ${action} is no longer allowed.`,
  );
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

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function parsePublishAttemptMediaSummary(value: unknown): PublishAttemptMediaSummary {
  const parsed = parseJsonRecord(value);
  const imageCount = typeof parsed.imageCount === "number" || typeof parsed.imageCount === "string"
    ? parsed.imageCount
    : null;
  const videoCount = typeof parsed.videoCount === "number" || typeof parsed.videoCount === "string"
    ? parsed.videoCount
    : null;
  const slideCount = typeof parsed.slideCount === "number" || typeof parsed.slideCount === "string"
    ? parsed.slideCount
    : null;

  return {
    imageCount: toNumber(imageCount),
    videoCount: toNumber(videoCount),
    slideCount: toNumber(slideCount),
  };
}

function mapPublishAttemptPlatform(row: PublishAttemptPlatformRow): PublishAttemptPlatform {
  return {
    id: row.id,
    publishAttemptId: row.publish_attempt_id,
    platform: row.platform,
    status: row.status,
    contentText: row.content_text,
    assetGroupId: row.asset_group_id ?? undefined,
    slides: parseSlides(row.asset_payload),
    mediaSummary: parsePublishAttemptMediaSummary(row.media_summary),
    scheduledPostId: row.scheduled_post_id ?? undefined,
    scheduleItemId: row.schedule_item_id ?? undefined,
    distributionGroupId: row.distribution_group_id ?? undefined,
    externalPostId: row.external_post_id ?? undefined,
    externalPostUrl: row.external_post_url ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    retryOfPublishAttemptPlatformId: row.retry_of_publish_attempt_platform_id ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: toIsoString(row.completed_at),
  };
}

function mapPublishAttempt(
  row: PublishAttemptRow,
  platformRows: PublishAttemptPlatformRow[],
): PublishAttempt {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id ?? undefined,
    sourceKind: row.source_kind,
    status: row.status,
    title: row.title ?? undefined,
    contentText: row.content_text ?? undefined,
    assetGroupId: row.asset_group_id ?? undefined,
    slides: parseSlides(row.asset_payload),
    distributionGroupId: row.distribution_group_id ?? undefined,
    retryOfAttemptId: row.retry_of_attempt_id ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: toIsoString(row.completed_at),
    platforms: platformRows.map(mapPublishAttemptPlatform),
  };
}

function derivePublishAttemptStatus(statuses: PublishAttemptPlatformStatus[]): PublishAttemptStatus {
  if (statuses.length === 0) {
    return "failed";
  }

  if (statuses.some((status) => status === "processing")) {
    return "processing";
  }

  if (statuses.every((status) => status === "success")) {
    return "success";
  }

  if (statuses.every((status) => status === "failed")) {
    return "failed";
  }

  return "partial";
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

function assertScheduledAtIsFuture(scheduledAt: Date): void {
  if (scheduledAt.getTime() <= Date.now()) {
    throw new HttpError(400, "scheduled_time_in_past", "scheduledAt must be in the future.");
  }
}

function normalizeSlides(
  platform: SchedulePostRequest["platform"],
  slides: SchedulePostRequest["slides"],
): ScheduledPostSlide[] {
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

  if (platform === "instagram") {
    throw new HttpError(
      400,
      "instagram_asset_conversion_required",
      "Instagram scheduling currently requires attached image assets instead of slide payloads.",
    );
  }

  if (platform === "facebook") {
    if (normalizedSlides.length > 10) {
      throw new HttpError(
        400,
        "facebook_invalid_image_count",
        "Facebook scheduled posts support up to 10 slide images.",
      );
    }

    return normalizedSlides;
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

function resolveDispatchDelaySeconds(
  platform: SocialPlatform,
  bound: "min" | "max",
): number {
  const envName =
    platform === "linkedin"
      ? bound === "min"
        ? "POST_DISPATCH_LINKEDIN_MIN_DELAY_SECONDS"
        : "POST_DISPATCH_LINKEDIN_MAX_DELAY_SECONDS"
      : platform === "facebook"
        ? bound === "min"
          ? "POST_DISPATCH_FACEBOOK_MIN_DELAY_SECONDS"
          : "POST_DISPATCH_FACEBOOK_MAX_DELAY_SECONDS"
        : bound === "min"
          ? "POST_DISPATCH_INSTAGRAM_MIN_DELAY_SECONDS"
          : "POST_DISPATCH_INSTAGRAM_MAX_DELAY_SECONDS";
  const fallback =
    platform === "linkedin"
      ? bound === "min"
        ? 0
        : 8
      : platform === "facebook"
        ? bound === "min"
          ? 6
          : 18
        : bound === "min"
          ? 14
          : 30;
  const parsed = Number(process.env[envName]?.trim() ?? fallback);

  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function resolveDispatchDelayRange(platform: SocialPlatform): {
  minDelaySeconds: number;
  maxDelaySeconds: number;
} {
  const minDelaySeconds = resolveDispatchDelaySeconds(platform, "min");
  const maxDelaySeconds = Math.max(minDelaySeconds, resolveDispatchDelaySeconds(platform, "max"));

  return {
    minDelaySeconds,
    maxDelaySeconds,
  };
}

function resolveConflictRetryDelaySeconds(platform: SocialPlatform, attemptCount: number): number {
  const baseFloor =
    platform === "instagram"
      ? 8
      : platform === "facebook"
        ? 6
        : 4;
  const baseCeiling =
    platform === "instagram"
      ? 16
      : platform === "facebook"
        ? 12
        : 10;
  const configuredMax = Number(process.env.POST_PUBLISH_CONFLICT_RETRY_MAX_SECONDS?.trim() ?? 20);
  const maxDelaySeconds =
    Number.isFinite(configuredMax) && configuredMax > 0
      ? Math.max(baseCeiling, Math.floor(configuredMax))
      : 20;
  const attemptBump = Math.min(Math.max(attemptCount - 1, 0) * 2, 6);
  const randomizedFloor = baseFloor + attemptBump;
  const randomizedCeiling = Math.min(maxDelaySeconds, baseCeiling + attemptBump);
  const span = Math.max(0, randomizedCeiling - randomizedFloor);

  return randomizedFloor + (span > 0 ? Math.floor(Math.random() * (span + 1)) : 0);
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

function buildDirectPublishFingerprint(input: {
  platform: SocialPlatform;
  contentText: string;
  assets: PostAsset[];
  slides: ScheduledPostSlide[];
}): {
  hookHash: string;
  bodyHash: string;
  contentFingerprint: string;
} {
  const textFingerprint = buildContentFingerprint(input.contentText);
  const assetSignature = input.assets.map((asset) => ({
    id: asset.id,
    type: asset.type,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    orderIndex: asset.orderIndex,
    updatedAt: asset.updatedAt,
  }));
  const slideSignature = input.slides.map((slide) => ({
    imageDataUrl: slide.imageDataUrl,
    mimeType: slide.mimeType ?? null,
    altText: slide.altText ?? null,
  }));
  const payloadSignature = JSON.stringify({
    platform: input.platform,
    normalizedBody: normalizeContentForHash(input.contentText),
    assets: assetSignature,
    slides: slideSignature,
  });

  return {
    hookHash: textFingerprint.hookHash,
    bodyHash: textFingerprint.bodyHash,
    contentFingerprint: hashText(`${textFingerprint.contentFingerprint}::${payloadSignature}`),
  };
}

function selectDispatchRunAfter(start: Date, end: Date): Date {
  const spanMs = Math.max(0, end.getTime() - start.getTime());

  if (spanMs === 0) {
    return start;
  }

  return new Date(start.getTime() + Math.floor(Math.random() * (spanMs + 1)));
}

function buildDispatchWindow(scheduledAt: Date, platform: SocialPlatform): {
  earliestDispatchAt: Date;
  latestDispatchAt: Date;
  runAfter: Date;
} {
  const delayRange = resolveDispatchDelayRange(platform);
  const nowFloor = new Date();
  const earliestDispatchAt = new Date(
    Math.max(scheduledAt.getTime() + delayRange.minDelaySeconds * 1000, nowFloor.getTime()),
  );
  const latestDispatchAt = new Date(
    Math.max(scheduledAt.getTime() + delayRange.maxDelaySeconds * 1000, earliestDispatchAt.getTime()),
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

    if (error.code === "facebook_not_connected") {
      return "Facebook is not configured for this workspace. Connect a Facebook Page and retry the post.";
    }

    if (error.code === "instagram_not_connected") {
      return "Instagram is not configured for this workspace. Connect a Facebook Page with a linked Instagram business account and retry the post.";
    }

    if (error.code === "unsupported_asset_type") {
      return error.message;
    }

    if (error.code === "mixed_assets_not_supported") {
      return "Mixed image and video drafts are not publishable yet. Use only one media type per post.";
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "Unknown publishing error.";
}

function isRetryablePublishError(error: unknown): boolean {
  if (error instanceof HttpError) {
    if (
      error.code === "linkedin_not_connected"
      || error.code === "facebook_not_connected"
      || error.code === "instagram_not_connected"
      || error.code === "unsupported_asset_type"
      || error.code === "mixed_assets_not_supported"
      || error.code === "mixed_asset_sources_not_supported"
      || error.code === "instagram_asset_conversion_required"
    ) {
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
  platform: SchedulePostRequest["platform"];
  ignoreScheduledPostId?: string | null;
}): Promise<SchedulingSafetyWarning[]> {
  if (input.platform !== "linkedin") {
    return [];
  }

  const [dailyLimitWarning, minimumGapWarning] = await Promise.all([
    loadDailyLimitWarning(input.businessId, input.scheduledAt, input.ignoreScheduledPostId),
    loadMinimumGapWarning(input.businessId, input.scheduledAt, input.ignoreScheduledPostId),
  ]);

  return [dailyLimitWarning, minimumGapWarning].filter(
    (warning): warning is SchedulingSafetyWarning => Boolean(warning),
  );
}

async function resolvePublishingTarget(
  businessId: string,
  platform: SchedulePostRequest["platform"],
  client?: PoolClient,
): Promise<{
  socialAccountId: string;
  socialAccountIdentityId: string;
}> {
  if (platform === "linkedin") {
    const result = await executeQuery<SocialPublishingTargetRow>(
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
      client,
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

  if (platform === "instagram") {
    const result = await executeQuery<SocialPublishingTargetRow>(
      `
        select
          bsc.social_account_id as id,
          sai.id as selected_identity_id
        from business_social_channels bsc
        join social_accounts sa on sa.id = bsc.social_account_id
        left join social_account_identities sai
          on sai.social_account_id = sa.id
         and sai.platform = 'instagram'
        where bsc.business_id = $1
          and bsc.platform = 'facebook'
          and bsc.status = 'connected'
          and sa.status = 'connected'
        limit 1
      `,
      [businessId],
      client,
    );

    const socialAccountId = result.rows[0]?.id;
    const selectedIdentityId = result.rows[0]?.selected_identity_id;

    if (!socialAccountId || !selectedIdentityId) {
      throw new HttpError(
        409,
        "instagram_not_connected",
        "Connect a Facebook Page with a linked Instagram business account before scheduling posts.",
      );
    }

    return {
      socialAccountId,
      socialAccountIdentityId: selectedIdentityId,
    };
  }

  if (platform === "facebook") {
    const result = await executeQuery<SocialPublishingTargetRow>(
      `
        select
          bsc.social_account_id as id,
          bsc.selected_identity_id
        from business_social_channels bsc
        join social_accounts sa on sa.id = bsc.social_account_id
        where bsc.business_id = $1
          and bsc.platform = 'facebook'
          and bsc.status = 'connected'
          and sa.status = 'connected'
        limit 1
      `,
      [businessId],
      client,
    );

    const socialAccountId = result.rows[0]?.id;
    const selectedIdentityId = result.rows[0]?.selected_identity_id;

    if (!socialAccountId || !selectedIdentityId) {
      throw new HttpError(
        409,
        "facebook_not_connected",
        "Connect a Facebook Page before scheduling posts.",
      );
    }

    return {
      socialAccountId,
      socialAccountIdentityId: selectedIdentityId,
    };
  }

  throw new HttpError(
    400,
    "bad_request",
    `Scheduling is not supported for ${platform}.`,
  );
}

async function loadReadyAssetsForPostGroup(
  businessId: string,
  assetGroupId: string | null | undefined,
): Promise<PostAsset[]> {
  const normalizedAssetGroupId = assetGroupId?.trim();

  if (!normalizedAssetGroupId || !isUuidLike(normalizedAssetGroupId)) {
    return [];
  }

  return loadReadyPostAssets(businessId, normalizedAssetGroupId);
}

function summarizePublishMedia(assets: PostAsset[], slides: ScheduledPostSlide[]): {
  imageCount: number;
  videoCount: number;
  slideCount: number;
} {
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

  return {
    imageCount,
    videoCount,
    slideCount: slides.length,
  };
}

function normalizePublishAssetPreferences(value: unknown): {
  primaryAssetId?: string;
  posterAssetId?: string;
} | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const mediaPreferences =
    candidate.mediaPreferences && typeof candidate.mediaPreferences === "object" && !Array.isArray(candidate.mediaPreferences)
      ? candidate.mediaPreferences as Record<string, unknown>
      : null;

  if (!mediaPreferences) {
    return undefined;
  }

  const primaryAssetId =
    typeof mediaPreferences.primaryAssetId === "string" && mediaPreferences.primaryAssetId.trim() !== ""
      ? mediaPreferences.primaryAssetId.trim()
      : undefined;
  const posterAssetId =
    typeof mediaPreferences.posterAssetId === "string" && mediaPreferences.posterAssetId.trim() !== ""
      ? mediaPreferences.posterAssetId.trim()
      : undefined;

  return primaryAssetId || posterAssetId
    ? {
        primaryAssetId,
        posterAssetId,
      }
    : undefined;
}

async function loadPublishAssetPreferences(
  businessId: string,
  assetGroupId: string | null | undefined,
): Promise<{ primaryAssetId?: string; posterAssetId?: string } | undefined> {
  const normalizedAssetGroupId = assetGroupId?.trim();

  if (!normalizedAssetGroupId || !isUuidLike(normalizedAssetGroupId)) {
    return undefined;
  }

  const result = await queryDb<ContentAssetBodyOnlyRow>(
    `
      select content_body
      from content_assets
      where id = $1
        and business_id = $2
      limit 1
    `,
    [normalizedAssetGroupId, businessId],
  );

  return normalizePublishAssetPreferences(result.rows[0]?.content_body);
}

async function loadValidatedReadyAssetsForPlatform(
  businessId: string,
  platform: "linkedin" | "facebook" | "instagram",
  assetGroupId: string | null | undefined,
  slides: ScheduledPostSlide[] = [],
): Promise<PostAsset[]> {
  const readyAssets = await loadReadyAssetsForPostGroup(businessId, assetGroupId);
  const preferences = await loadPublishAssetPreferences(businessId, assetGroupId);
  const resolvedAssets = resolvePublishAssetsForChannel(platform, readyAssets, preferences);
  validatePublishMediaForChannel({
    channel: platform,
    assets: resolvedAssets,
    slides,
    preferences,
  });
  return resolvedAssets;
}

function resolvePublishedExternalPostUrl(
  platform: SocialPlatform,
  publishResult: { externalPostId: string; externalPostUrl?: string },
): string {
  if (publishResult.externalPostUrl?.trim()) {
    return publishResult.externalPostUrl.trim();
  }

  if (platform === "linkedin") {
    return buildLinkedInExternalPostUrl(publishResult.externalPostId);
  }

  if (platform === "facebook") {
    return `https://www.facebook.com/${encodeURIComponent(publishResult.externalPostId)}`;
  }

  throw new HttpError(
    502,
    "publish_post_failed",
    `${platform} publish succeeded without returning a post URL.`,
  );
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
          (
            $2::uuid is not null
            and social_account_id = $2::uuid
          )
          or (
            $3::uuid is not null
            and social_account_identity_id = $3::uuid
          )
        )
      limit 1
    `,
    [row.id, row.social_account_id ?? null, row.social_account_identity_id ?? null],
  );

  return Boolean(result.rows[0]?.id);
}

async function updateScheduledPostDispatchState(
  input: {
    scheduledPostId: string;
    scheduledAt: Date;
    businessId: string;
    platform: SocialPlatform;
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
      : buildDispatchWindow(input.scheduledAt, input.platform);
  const fingerprint = buildContentFingerprint(input.contentText);
  const queuedJob = await createJob<ScheduledPostPublishJobPayload>({
    businessId: input.businessId,
    jobKey: `post_publish:${input.scheduledPostId}`,
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
  await syncScheduleItemStateForScheduledPost({
    scheduledPostId,
    status: "scheduled",
  });
}

async function markScheduledPostProcessing(
  scheduledPostId: string,
  attemptCount: number,
  expectedDispatchJobId?: string | null,
): Promise<boolean> {
  const result = await executeQuery(
    `
      update scheduled_posts
      set
        status = 'processing',
        error_message = null,
        retry_count = $2::int,
        last_attempt_at = now(),
        updated_at = now()
      where id = $1::uuid
        and status = 'scheduled'
        and dispatch_job_id is not distinct from $3::uuid
    `,
    [scheduledPostId, attemptCount, expectedDispatchJobId ?? null],
  );

  if ((result.rowCount ?? 0) === 0) {
    return false;
  }

  await recordPublicationEvent(scheduledPostId, "processing", {
    claimedAt: new Date().toISOString(),
    attemptCount,
  });
  await syncScheduleItemStateForScheduledPost({
    scheduledPostId,
    status: "processing",
  });

  return true;
}

async function recordPublicationEvent(
  scheduledPostId: string,
  status: ScheduledPostStatus,
  response: Record<string, unknown>,
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
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
    client,
  );
}

function summarizePublishErrorCode(error: unknown): string {
  if (error instanceof HttpError) {
    return error.code;
  }

  return "publish_attempt_failed";
}

async function reconcilePublishAttemptStatus(
  publishAttemptId: string,
  client?: PoolClient,
): Promise<void> {
  const result = await executeQuery<{ status: PublishAttemptPlatformStatus }>(
    `
      select status
      from publish_attempt_platforms
      where publish_attempt_id = $1::uuid
    `,
    [publishAttemptId],
    client,
  );

  const statuses = result.rows.map((row) => row.status);
  const nextStatus = derivePublishAttemptStatus(statuses);
  const completedAt = nextStatus === "processing" ? null : new Date().toISOString();

  await executeQuery(
    `
      update publish_attempts
      set
        status = $2,
        completed_at = $3::timestamptz,
        updated_at = now()
      where id = $1::uuid
    `,
    [publishAttemptId, nextStatus, completedAt],
    client,
  );
}

async function createPublishAttemptLedger(input: {
  businessId: string;
  userId?: string | null;
  sourceKind: PublishAttemptSourceKind;
  title?: string | null;
  contentText?: string | null;
  assetGroupId?: string | null;
  slides?: ScheduledPostSlide[];
  distributionGroupId?: string | null;
  retryOfAttemptId?: string | null;
  metadata?: Record<string, unknown>;
  platforms: Array<{
    platform: SocialPlatform;
    contentText: string;
    assetGroupId?: string | null;
    slides?: ScheduledPostSlide[];
    mediaSummary: PublishAttemptMediaSummary;
    scheduledPostId?: string | null;
    scheduleItemId?: string | null;
    distributionGroupId?: string | null;
    socialAccountId?: string | null;
    socialAccountIdentityId?: string | null;
    retryOfPublishAttemptPlatformId?: string | null;
    status?: PublishAttemptPlatformStatus;
    externalPostId?: string | null;
    externalPostUrl?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    response?: Record<string, unknown>;
  }>;
  client?: PoolClient;
}): Promise<{
  publishAttemptId: string;
  platformAttemptIds: Map<SocialPlatform, string>;
  platformAttempts: Array<{
    id: string;
    platform: SocialPlatform;
    scheduledPostId?: string;
    scheduleItemId?: string;
  }>;
}> {
  const parentResult = await executeQuery<{ id: string }>(
    `
      insert into publish_attempts (
        business_id,
        user_id,
        source_kind,
        status,
        title,
        content_text,
        asset_group_id,
        asset_payload,
        distribution_group_id,
        retry_of_attempt_id,
        metadata_json
      ) values (
        $1::uuid,
        $2::uuid,
        $3,
        'processing',
        $4,
        $5,
        $6::uuid,
        $7::jsonb,
        $8::uuid,
        $9::uuid,
        $10::jsonb
      )
      returning id
    `,
    [
      input.businessId,
      input.userId ?? null,
      input.sourceKind,
      input.title?.trim() || null,
      input.contentText?.trim() || null,
      input.assetGroupId?.trim() || null,
      JSON.stringify({ slides: input.slides ?? [] }),
      input.distributionGroupId?.trim() || null,
      input.retryOfAttemptId?.trim() || null,
      JSON.stringify(input.metadata ?? {}),
    ],
    input.client,
  );

  const publishAttemptId = parentResult.rows[0]?.id;

  if (!publishAttemptId) {
    throw new HttpError(500, "publish_attempt_create_failed", "Unable to create publish attempt.");
  }

  const platformAttemptIds = new Map<SocialPlatform, string>();
  const platformAttempts: Array<{
    id: string;
    platform: SocialPlatform;
    scheduledPostId?: string;
    scheduleItemId?: string;
  }> = [];

  for (const platformInput of input.platforms) {
    const platformResult = await executeQuery<{ id: string }>(
      `
        insert into publish_attempt_platforms (
          publish_attempt_id,
          business_id,
          platform,
          status,
          content_text,
          asset_group_id,
          asset_payload,
          media_summary,
          scheduled_post_id,
          schedule_item_id,
          distribution_group_id,
          social_account_id,
          social_account_identity_id,
          external_post_id,
          external_post_url,
          error_code,
          error_message,
          response_json,
          retry_of_publish_attempt_platform_id,
          completed_at
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6::uuid,
          $7::jsonb,
          $8::jsonb,
          $9::uuid,
          $10::uuid,
          $11::uuid,
          $12::uuid,
          $13::uuid,
          $14,
          $15,
          $16,
          $17,
          $18::jsonb,
          $19::uuid,
          case when $4 = 'processing' then null else now() end
        )
        returning id
      `,
      [
        publishAttemptId,
        input.businessId,
        platformInput.platform,
        platformInput.status ?? "processing",
        platformInput.contentText,
        platformInput.assetGroupId?.trim() || null,
        JSON.stringify({ slides: platformInput.slides ?? [] }),
        JSON.stringify(platformInput.mediaSummary),
        platformInput.scheduledPostId?.trim() || null,
        platformInput.scheduleItemId?.trim() || null,
        platformInput.distributionGroupId?.trim() || null,
        platformInput.socialAccountId?.trim() || null,
        platformInput.socialAccountIdentityId?.trim() || null,
        platformInput.externalPostId?.trim() || null,
        platformInput.externalPostUrl?.trim() || null,
        platformInput.errorCode?.trim() || null,
        platformInput.errorMessage?.trim() || null,
        JSON.stringify(platformInput.response ?? {}),
        platformInput.retryOfPublishAttemptPlatformId?.trim() || null,
      ],
      input.client,
    );

    const platformAttemptId = platformResult.rows[0]?.id;

    if (!platformAttemptId) {
      throw new HttpError(500, "publish_attempt_create_failed", "Unable to create publish attempt platform.");
    }

    platformAttemptIds.set(platformInput.platform, platformAttemptId);
    platformAttempts.push({
      id: platformAttemptId,
      platform: platformInput.platform,
      scheduledPostId: platformInput.scheduledPostId?.trim() || undefined,
      scheduleItemId: platformInput.scheduleItemId?.trim() || undefined,
    });
  }

  await reconcilePublishAttemptStatus(publishAttemptId, input.client);

  return { publishAttemptId, platformAttemptIds, platformAttempts };
}

async function updatePublishAttemptPlatformState(input: {
  platformAttemptId: string;
  status: PublishAttemptPlatformStatus;
  scheduledPostId?: string | null;
  externalPostId?: string | null;
  externalPostUrl?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  response?: Record<string, unknown>;
  client?: PoolClient;
}): Promise<void> {
  const result = await executeQuery<{ publish_attempt_id: string }>(
    `
      update publish_attempt_platforms
      set
        status = $2,
        scheduled_post_id = coalesce($3::uuid, scheduled_post_id),
        external_post_id = $4,
        external_post_url = $5,
        error_code = $6,
        error_message = $7,
        response_json = coalesce($8::jsonb, response_json),
        completed_at = case when $2 = 'processing' then null else now() end,
        updated_at = now()
      where id = $1::uuid
      returning publish_attempt_id
    `,
    [
      input.platformAttemptId,
      input.status,
      input.scheduledPostId?.trim() || null,
      input.externalPostId?.trim() || null,
      input.externalPostUrl?.trim() || null,
      input.errorCode?.trim() || null,
      input.errorMessage?.trim() || null,
      input.response ? JSON.stringify(input.response) : null,
    ],
    input.client,
  );

  const publishAttemptId = result.rows[0]?.publish_attempt_id;

  if (!publishAttemptId) {
    throw new HttpError(404, "publish_attempt_platform_not_found", "Publish attempt platform not found.");
  }

  await reconcilePublishAttemptStatus(publishAttemptId, input.client);
}

async function loadPublishAttemptRows(
  businessId: string,
  attemptIds?: string[],
): Promise<{
  attempts: PublishAttemptRow[];
  platforms: PublishAttemptPlatformRow[];
}> {
  const attemptsResult = attemptIds && attemptIds.length > 0
    ? await queryDb<PublishAttemptRow>(
      `
        select
          id,
          business_id,
          user_id,
          source_kind,
          status,
          title,
          content_text,
          asset_group_id,
          asset_payload,
          distribution_group_id,
          retry_of_attempt_id,
          completed_at,
          created_at,
          updated_at
        from publish_attempts
        where business_id = $1::uuid
          and id = any($2::uuid[])
        order by created_at desc
      `,
      [businessId, attemptIds],
    )
    : await queryDb<PublishAttemptRow>(
      `
        select
          id,
          business_id,
          user_id,
          source_kind,
          status,
          title,
          content_text,
          asset_group_id,
          asset_payload,
          distribution_group_id,
          retry_of_attempt_id,
          completed_at,
          created_at,
          updated_at
        from publish_attempts
        where business_id = $1::uuid
        order by created_at desc
        limit 100
      `,
      [businessId],
    );

  const foundAttemptIds = attemptsResult.rows.map((row) => row.id);

  if (foundAttemptIds.length === 0) {
    return {
      attempts: [],
      platforms: [],
    };
  }

  const platformResult = await queryDb<PublishAttemptPlatformRow>(
    `
      select
        id,
        publish_attempt_id,
        business_id,
        platform,
        status,
        content_text,
        asset_group_id,
        asset_payload,
        media_summary,
        scheduled_post_id,
        schedule_item_id,
        distribution_group_id,
        social_account_id,
        social_account_identity_id,
        external_post_id,
        external_post_url,
        error_code,
        error_message,
        response_json,
        retry_of_publish_attempt_platform_id,
        completed_at,
        created_at,
        updated_at
      from publish_attempt_platforms
      where publish_attempt_id = any($1::uuid[])
      order by created_at asc
    `,
    [foundAttemptIds],
  );

  return {
    attempts: attemptsResult.rows,
    platforms: platformResult.rows,
  };
}

async function loadPublishAttemptOrThrow(
  businessId: string,
  publishAttemptId: string,
): Promise<PublishAttempt> {
  const rows = await loadPublishAttemptRows(businessId, [publishAttemptId]);
  const attemptRow = rows.attempts[0];

  if (!attemptRow) {
    throw new HttpError(404, "publish_attempt_not_found", "Publish attempt not found.");
  }

  return mapPublishAttempt(
    attemptRow,
    rows.platforms.filter((row) => row.publish_attempt_id === attemptRow.id),
  );
}

async function ensureScheduledPublishAttemptForPlatform(input: {
  duePost: ScheduledPostRow;
  scheduleItemId?: string;
  distributionGroupId?: string;
  mediaSummary: PublishAttemptMediaSummary;
}): Promise<{ publishAttemptId: string; platformAttemptId: string }> {
  return withDbTransaction(async (client) => {
    const existing = await executeQuery<{ publish_attempt_id: string; platform_attempt_id: string }>(
      `
        select
          pa.id as publish_attempt_id,
          pap.id as platform_attempt_id
        from publish_attempts pa
        join publish_attempt_platforms pap
          on pap.publish_attempt_id = pa.id
        where pa.business_id = $1::uuid
          and pa.source_kind = 'scheduled'
          and pa.status = 'processing'
          and pap.scheduled_post_id = $2::uuid
        order by pa.created_at desc
        limit 1
      `,
      [input.duePost.business_id, input.duePost.id],
      client,
    );

    if (existing.rows[0]?.publish_attempt_id && existing.rows[0]?.platform_attempt_id) {
      return {
        publishAttemptId: existing.rows[0].publish_attempt_id,
        platformAttemptId: existing.rows[0].platform_attempt_id,
      };
    }

    const seedRows =
      input.distributionGroupId
        ? await loadScheduledAttemptSeedRows(input.duePost.business_id, input.distributionGroupId, client)
        : [
          {
            ...input.duePost,
            schedule_item_id: input.scheduleItemId ?? null,
            distribution_group_id: input.distributionGroupId ?? null,
            group_title: null,
          } satisfies ScheduledPostAttemptSeedRow,
        ];

    const platformInputs = [];

    for (const seedRow of seedRows) {
      const isCurrentRow = seedRow.id === input.duePost.id;
      const slides = parseSlides(seedRow.asset_payload);
      const mediaSummary = isCurrentRow
        ? input.mediaSummary
        : summarizePublishMedia(
          seedRow.asset_group_id && isUuidLike(seedRow.asset_group_id)
            ? await loadReadyPostAssets(seedRow.business_id, seedRow.asset_group_id)
            : [],
          slides,
        );

      platformInputs.push({
        platform: seedRow.platform,
        contentText: seedRow.content_text,
        assetGroupId: seedRow.asset_group_id,
        slides,
        mediaSummary,
        scheduledPostId: seedRow.id,
        scheduleItemId: seedRow.schedule_item_id,
        distributionGroupId: seedRow.distribution_group_id,
        socialAccountId: seedRow.social_account_id,
        socialAccountIdentityId: seedRow.social_account_identity_id,
      });
    }

    const title =
      seedRows[0]?.group_title?.trim()
      || extractPublishAttemptTitle(input.duePost.content_text);

    const { publishAttemptId, platformAttemptIds, platformAttempts } = await createPublishAttemptLedger({
      businessId: input.duePost.business_id,
      userId: input.duePost.user_id,
      sourceKind: "scheduled",
      title,
      contentText: input.duePost.content_text,
      assetGroupId: input.duePost.asset_group_id,
      slides: parseSlides(input.duePost.asset_payload),
      distributionGroupId: input.distributionGroupId ?? null,
      platforms: platformInputs,
      client,
    });

    const platformAttemptId =
      platformAttempts.find((attempt) => attempt.scheduledPostId === input.duePost.id)?.id
      ?? platformAttempts.find((attempt) =>
        attempt.platform === input.duePost.platform
        && attempt.scheduleItemId === input.scheduleItemId
      )?.id
      ?? platformAttemptIds.get(input.duePost.platform);

    if (!platformAttemptId) {
      throw new HttpError(500, "publish_attempt_create_failed", "Unable to seed scheduled publish attempt.");
    }

    return {
      publishAttemptId,
      platformAttemptId,
    };
  });
}

async function syncLinkedContentAssetStage(input: {
  businessId: string;
  linkedAssetId?: string | null;
  stage: "draft" | "review" | "scheduled" | "posted";
  client?: PoolClient;
}): Promise<void> {
  const linkedAssetId = input.linkedAssetId?.trim();

  if (!linkedAssetId) {
    return;
  }

  await executeQuery(
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
    input.client,
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

function assertScheduledPostMutationApplied(
  result: QueryResult<QueryResultRow>,
  action: ScheduledPostMutationAction,
): void {
  if ((result.rowCount ?? 0) > 0) {
    return;
  }

  throw new HttpError(
    409,
    "scheduled_post_conflict",
    `The scheduled post changed while ${action} was being applied. Refresh and try again.`,
  );
}

async function markScheduledPostPublished(
  scheduledPostId: string,
  platform: SocialPlatform,
  publishResult: { externalPostId: string; externalPostUrl?: string; response: Record<string, unknown> },
  linkedAssetId?: string | null,
  businessId?: string,
): Promise<void> {
  const externalPostUrl = resolvePublishedExternalPostUrl(platform, publishResult);

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
      externalPostUrl,
    ],
  );

  await recordPublicationEvent(scheduledPostId, "published", publishResult.response);
  await syncScheduleItemStateForScheduledPost({
    scheduledPostId,
    status: "published",
    externalReferenceId: publishResult.externalPostId,
    externalReferenceUrl: externalPostUrl,
    publishedAt: new Date().toISOString(),
  });

  if (businessId) {
    await Promise.all([
      syncLinkedContentAssetStage({
        businessId,
        linkedAssetId,
        stage: "posted",
      }),
      linkedAssetId
        ? safeRecordContentGenerationSuggestionPublished({
            businessId,
            assetId: linkedAssetId,
            scheduledPostId,
          })
        : Promise.resolve(),
    ]);
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
  await syncScheduleItemStateForScheduledPost({
    scheduledPostId,
    status: "failed",
  });
}

async function prepareDirectPublishExecution(input: {
  businessId: string;
  userId: string;
  platform: SocialPlatform;
  contentText: string;
  assetGroupId?: string | null;
  slides: ScheduledPostSlide[];
  assets: PostAsset[];
  socialAccountId?: string | null;
  socialAccountIdentityId?: string | null;
  audienceTimezone: string;
}): Promise<{
  existingPublished?: PublishPostResponse;
  scheduledPostId?: string;
}> {
  const fingerprint = buildDirectPublishFingerprint({
    platform: input.platform,
    contentText: input.contentText,
    assets: input.assets,
    slides: input.slides,
  });

  return withDbTransaction(async (client) => {
    const assetGroupId = input.assetGroupId?.trim() || null;

    if (assetGroupId && isUuidLike(assetGroupId)) {
      const assetLock = await executeQuery<{ id: string }>(
        `
          select id
          from content_assets
          where id = $1::uuid
            and business_id = $2::uuid
          limit 1
          for update
        `,
        [assetGroupId, input.businessId],
        client,
      );

      if (!assetLock.rows[0]) {
        throw new HttpError(404, "content_asset_not_found", "Draft not found.");
      }
    }

    const recentResult = await executeQuery<DirectPublishReuseRow>(
      `
        select
          id,
          status,
          external_post_id,
          external_post_url,
          published_at,
          created_at
        from scheduled_posts
        where business_id = $1::uuid
          and platform = $2
          and dispatch_job_id is null
          and content_fingerprint = $3
          and created_at >= now() - interval '10 minutes'
          and status in ('processing', 'published')
        order by created_at desc
        limit 1
      `,
      [
        input.businessId,
        input.platform,
        fingerprint.contentFingerprint,
      ],
      client,
    );

    const recent = recentResult.rows[0];

    if (recent?.status === "processing") {
      throw new HttpError(
        409,
        "publish_post_in_progress",
        `A ${resolveSocialPlatformLabel(input.platform)} publish for this draft is already in progress. Wait a moment and refresh.`,
      );
    }

    if (recent?.status === "published" && recent.external_post_id) {
      return {
        existingPublished: {
          platform: input.platform,
          externalPostId: recent.external_post_id,
          externalPostUrl:
            recent.external_post_url
            ?? resolvePublishedExternalPostUrl(input.platform, {
              externalPostId: recent.external_post_id,
            }),
          publishedAt: toIsoString(recent.published_at) ?? new Date(recent.created_at).toISOString(),
        },
      };
    }

    const inserted = await executeQuery<{ id: string }>(
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
          retry_count,
          last_attempt_at,
          hook_hash,
          body_hash,
          content_fingerprint
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5,
          $6,
          $7,
          $8::jsonb,
          now(),
          now(),
          now(),
          $9,
          'processing',
          0,
          now(),
          $10,
          $11,
          $12
        )
        returning id
      `,
      [
        input.businessId,
        input.userId,
        input.socialAccountId ?? null,
        input.socialAccountIdentityId ?? null,
        input.platform,
        input.contentText,
        assetGroupId,
        JSON.stringify({ slides: input.slides, directPublish: true }),
        input.audienceTimezone,
        fingerprint.hookHash,
        fingerprint.bodyHash,
        fingerprint.contentFingerprint,
      ],
      client,
    );

    const scheduledPostId = inserted.rows[0]?.id;

    if (!scheduledPostId) {
      throw new HttpError(500, "publish_history_create_failed", "Unable to prepare publish history.");
    }

    await recordPublicationEvent(
      scheduledPostId,
      "processing",
      {
        directPublish: true,
        requestedAt: new Date().toISOString(),
      },
      client,
    );

    return { scheduledPostId };
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
          platform: row.platform,
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

  if (action === "reschedule" || action === "publish_now" || action === "move_to_draft") {
    await enforceEditableWindowForScheduledPost(existing.id, action);
  }

  if (action === "pause") {
    if (!canPauseScheduledPost(existing.status)) {
      throw new HttpError(409, "scheduled_post_conflict", "Only scheduled posts can be paused.");
    }

    await withDbTransaction(async (client) => {
      if (existing.dispatch_job_id) {
        await pauseJob(existing.dispatch_job_id, client);
      }

      const updateResult = await executeQuery(
        `
          update scheduled_posts
          set
            status = 'paused',
            updated_at = now()
          where id = $1::uuid
            and status = $2
            and dispatch_job_id is not distinct from $3::uuid
        `,
        [existing.id, existing.status, existing.dispatch_job_id ?? null],
        client,
      );

      assertScheduledPostMutationApplied(updateResult, action);
    });

    await recordPublicationEvent(existing.id, "paused", {
      action: "pause",
      previousStatus: existing.status,
    });
    await syncScheduleItemStateForScheduledPost({
      scheduledPostId: existing.id,
      status: "paused",
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
      const updateResult = await executeQuery(
        `
          update scheduled_posts
          set
            status = 'scheduled',
            error_message = null,
            updated_at = now()
          where id = $1::uuid
            and status = $2
            and dispatch_job_id is not distinct from $3::uuid
        `,
        [existing.id, existing.status, existing.dispatch_job_id ?? null],
        client,
      );

      assertScheduledPostMutationApplied(updateResult, action);

      await updateScheduledPostDispatchState(
        {
          scheduledPostId: existing.id,
          scheduledAt: new Date(existing.scheduled_at),
          businessId,
          platform: existing.platform,
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
    await syncScheduleItemStateForScheduledPost({
      scheduledPostId: existing.id,
      status: "scheduled",
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

      const updateResult = await executeQuery(
        `
          update scheduled_posts
          set
            status = 'canceled',
            updated_at = now()
          where id = $1::uuid
            and status = $2
            and dispatch_job_id is not distinct from $3::uuid
        `,
        [existing.id, existing.status, existing.dispatch_job_id ?? null],
        client,
      );

      assertScheduledPostMutationApplied(updateResult, action);
    });

    await recordPublicationEvent(existing.id, "canceled", {
      action: "cancel",
      previousStatus: existing.status,
    });
    await syncScheduleItemStateForScheduledPost({
      scheduledPostId: existing.id,
      status: "canceled",
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
      const updateResult = await executeQuery(
        `
          update scheduled_posts
          set
            status = 'scheduled',
            error_message = null,
            retry_count = 0,
            last_attempt_at = null,
            updated_at = now()
          where id = $1::uuid
            and status = $2
            and dispatch_job_id is not distinct from $3::uuid
        `,
        [existing.id, existing.status, existing.dispatch_job_id ?? null],
        client,
      );

      assertScheduledPostMutationApplied(updateResult, action);

      await updateScheduledPostDispatchState(
        {
          scheduledPostId: existing.id,
          scheduledAt: new Date(existing.scheduled_at),
          businessId,
          platform: existing.platform,
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
    await syncScheduleItemStateForScheduledPost({
      scheduledPostId: existing.id,
      status: "scheduled",
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
      const updateResult = await executeQuery(
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
            and status = $5
            and dispatch_job_id is not distinct from $6::uuid
        `,
        [
          existing.id,
          immediateDispatchAt.toISOString(),
          existing.audience_timezone,
          existing.status === "failed",
          existing.status,
          existing.dispatch_job_id ?? null,
        ],
        client,
      );

      assertScheduledPostMutationApplied(updateResult, action);

      await updateScheduledPostDispatchState(
        {
          scheduledPostId: existing.id,
          scheduledAt: immediateDispatchAt,
          businessId,
          platform: existing.platform,
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
    await syncScheduleItemStateForScheduledPost({
      scheduledPostId: existing.id,
      status: "scheduled",
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

      const updateResult = await executeQuery(
        `
          update scheduled_posts
          set
            status = 'canceled',
            updated_at = now()
          where id = $1::uuid
            and status = $2
            and dispatch_job_id is not distinct from $3::uuid
        `,
        [existing.id, existing.status, existing.dispatch_job_id ?? null],
        client,
      );

      assertScheduledPostMutationApplied(updateResult, action);
    });

    await recordPublicationEvent(existing.id, "canceled", {
      action: "move_to_draft",
      previousStatus: existing.status,
    });
    await syncScheduleItemStateForScheduledPost({
      scheduledPostId: existing.id,
      status: "canceled",
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
  assertScheduledAtIsFuture(nextScheduledAt);
  const safetyWarnings = await collectSchedulingSafetyWarnings({
    businessId,
    scheduledAt: nextScheduledAt,
    platform: existing.platform,
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

    const dispatchWindow = buildDispatchWindow(nextScheduledAt, existing.platform);

    const updateResult = await executeQuery(
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
          and status = $8
          and dispatch_job_id is not distinct from $9::uuid
      `,
      [
        existing.id,
        nextScheduledAt.toISOString(),
        dispatchWindow.earliestDispatchAt.toISOString(),
        dispatchWindow.latestDispatchAt.toISOString(),
        nextAudienceTimezone,
        nextStatus,
        existing.status === "failed",
        existing.status,
        existing.dispatch_job_id ?? null,
      ],
      client,
    );

    assertScheduledPostMutationApplied(updateResult, action);

    if (nextStatus === "scheduled") {
      await updateScheduledPostDispatchState(
        {
          scheduledPostId: existing.id,
          scheduledAt: nextScheduledAt,
          businessId,
          platform: existing.platform,
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
  await syncScheduleItemStateForScheduledPost({
    scheduledPostId: existing.id,
    status: nextStatus,
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

export async function createScheduledPostInTransaction(input: {
  businessId: string;
  userId: string;
  platform: SchedulePostRequest["platform"];
  contentText: string;
  assetGroupId?: string | null;
  slides: ScheduledPostSlide[];
  scheduledAt: Date;
  audienceTimezone: string;
  client: PoolClient;
}): Promise<{
  scheduledPostId: string;
  scheduledAt: string;
  audienceTimezone: string;
  linkedAssetId?: string | null;
}> {
  await lockBusinessForScheduling(input.businessId, input.client);
  await enforceScheduledQueueLimit(input.businessId, input.client);

  const publishingTarget = await resolvePublishingTarget(
    input.businessId,
    input.platform,
    input.client,
  );
  const dispatchWindow = buildDispatchWindow(input.scheduledAt, input.platform);
  const fingerprint = buildContentFingerprint(input.contentText);
  const linkedAssetId = input.assetGroupId?.trim() || null;
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
        $5,
        $6,
        $7,
        $8::jsonb,
        $9::timestamptz,
        $10::timestamptz,
        $11::timestamptz,
        $12,
        'scheduled',
        $13::int,
        $14,
        $15,
        $16
      )
      returning id
    `,
    [
      input.businessId,
      input.userId,
      publishingTarget.socialAccountId,
      publishingTarget.socialAccountIdentityId,
      input.platform,
      input.contentText,
      linkedAssetId,
      JSON.stringify({ slides: input.slides }),
      input.scheduledAt.toISOString(),
      dispatchWindow.earliestDispatchAt.toISOString(),
      dispatchWindow.latestDispatchAt.toISOString(),
      input.audienceTimezone,
      resolveDispatchPriority(),
      fingerprint.hookHash,
      fingerprint.bodyHash,
      fingerprint.contentFingerprint,
    ],
    input.client,
  );

  const scheduledPostId = insertResult.rows[0].id;

  await updateScheduledPostDispatchState(
    {
      scheduledPostId,
      scheduledAt: input.scheduledAt,
      businessId: input.businessId,
      platform: input.platform,
      contentText: input.contentText,
    },
    input.client,
  );

  await recordPublicationEvent(
    scheduledPostId,
    "scheduled",
    {
      scheduledAt: input.scheduledAt.toISOString(),
      audienceTimezone: input.audienceTimezone,
      slideCount: input.slides.length,
      platform: input.platform,
    },
    input.client,
  );

  await syncLinkedContentAssetStage({
    businessId: input.businessId,
    linkedAssetId,
    stage: "scheduled",
    client: input.client,
  });

  return {
    scheduledPostId,
    scheduledAt: input.scheduledAt.toISOString(),
    audienceTimezone: input.audienceTimezone,
    linkedAssetId,
  };
}

export async function createScheduledPost(
  principal: AuthenticatedPrincipal,
  input: SchedulePostRequest,
): Promise<SchedulePostResponse> {
  const businessId = input.businessId.trim();

  if (
    input.platform !== "linkedin"
    && input.platform !== "instagram"
    && input.platform !== "facebook"
  ) {
    throw new HttpError(
      400,
      "bad_request",
      "Only LinkedIn, Facebook, and Instagram scheduling are supported right now.",
    );
  }

  const contentText = input.contentText.trim();

  if (!contentText) {
    throw new HttpError(400, "bad_request", "contentText is required.");
  }

  const scheduledAt = parseScheduledAt(input.scheduledAt);
  assertScheduledAtIsFuture(scheduledAt);
  const slides = normalizeSlides(input.platform, input.slides);
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

  await enforceScheduledQueueLimit(businessId);

  if (input.platform === "linkedin" || input.platform === "instagram" || input.platform === "facebook") {
    await loadValidatedReadyAssetsForPlatform(businessId, input.platform, input.assetGroupId, slides);
  }

  const safetyWarnings = await collectSchedulingSafetyWarnings({
    businessId,
    scheduledAt,
    platform: input.platform,
  });

  if (safetyWarnings.length > 0 && !input.ignoreSafetyWarnings) {
    throw new HttpError(
      409,
      "scheduling_safety_warning",
      safetyWarnings[0]?.message ?? "Scheduling needs confirmation.",
      { warnings: safetyWarnings },
    );
  }

  const scheduled = await withDbTransaction((client) =>
    createScheduledPostInTransaction({
      businessId,
      userId: principal.userId!,
      platform: input.platform,
      contentText,
      assetGroupId: input.assetGroupId?.trim() || null,
      slides,
      scheduledAt,
      audienceTimezone,
      client,
    }),
  );

  if (scheduled.linkedAssetId) {
    await safeRecordContentGenerationSuggestionScheduled({
      businessId,
      assetId: scheduled.linkedAssetId,
      scheduledPostId: scheduled.scheduledPostId,
      scheduledAt: scheduled.scheduledAt,
    });
  }
  const createdRow = await loadScheduledPostRow(businessId, scheduled.scheduledPostId);
  const linkedAssetsMap = await loadLinkedPostAssetsMap([createdRow]);
  const metricsMap = await loadPostMetricsMap([createdRow]);

  return {
    scheduledPost: mapScheduledPostWithAssets(createdRow, linkedAssetsMap, metricsMap),
    safetyWarnings,
  };
}

export async function createPublishAttempt(
  principal: AuthenticatedPrincipal,
  input: CreatePublishAttemptRequest,
): Promise<CreatePublishAttemptResponse> {
  const businessId = input.businessId.trim();
  const requestedPlatformInputs = Array.from(
    new Map(
      (input.platformInputs ?? [])
        .filter(
          (entry): entry is { platform: SocialPlatform; contentText: string } =>
            Boolean(entry)
            && (entry.platform === "linkedin" || entry.platform === "facebook" || entry.platform === "instagram")
            && typeof entry.contentText === "string",
        )
        .map((entry) => [entry.platform, entry.contentText.trim()]),
    ).entries(),
  ).map(([platform, contentText]) => ({ platform, contentText }));
  const platforms = Array.from(
    new Set(
      (requestedPlatformInputs.length > 0
        ? requestedPlatformInputs.map((entry) => entry.platform)
        : (input.platforms ?? [])
      ).filter(
        (platform): platform is SocialPlatform =>
          platform === "linkedin" || platform === "facebook" || platform === "instagram",
      ),
    ),
  );
  const sharedContentText = input.contentText.trim();
  const contentTextByPlatform = new Map<SocialPlatform, string>(
    requestedPlatformInputs.map((entry) => [entry.platform, entry.contentText]),
  );
  const assetGroupId = input.assetId?.trim() || null;
  const slides = input.slides ?? [];

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  if (!principal.userId) {
    throw new HttpError(401, "auth_required", "Authenticated user context is incomplete.");
  }

  if (platforms.length === 0) {
    throw new HttpError(400, "bad_request", "Select at least one platform to publish.");
  }

  for (const platform of platforms) {
    const resolvedContentText = contentTextByPlatform.get(platform) || sharedContentText;

    if (!resolvedContentText.trim()) {
      throw new HttpError(400, "bad_request", `contentText is required for ${platform}.`);
    }

    contentTextByPlatform.set(platform, resolvedContentText.trim());
  }

  const requestedAssets = await loadReadyAssetsForPostGroup(businessId, assetGroupId);
  const mediaSummary = summarizePublishMedia(requestedAssets, slides);
  const fallbackContentText = sharedContentText || contentTextByPlatform.get(platforms[0]) || "";
  const title = input.title?.trim() || extractPublishAttemptTitle(fallbackContentText);
  const ledger = await createPublishAttemptLedger({
    businessId,
    userId: principal.userId,
    sourceKind: "manual",
    title,
    contentText: fallbackContentText,
    assetGroupId,
    slides,
    platforms: platforms.map((platform) => ({
      platform,
      contentText: contentTextByPlatform.get(platform) || fallbackContentText,
      assetGroupId,
      slides,
      mediaSummary,
    })),
  });

  for (const platform of platforms) {
    const platformAttemptId = ledger.platformAttemptIds.get(platform);

    if (!platformAttemptId) {
      continue;
    }

    try {
      const platformContentText = contentTextByPlatform.get(platform) || fallbackContentText;
      const result = await runDirectPlatformPublishInternal(principal, {
        businessId,
        platform,
        contentText: platformContentText,
        assetId: assetGroupId ?? undefined,
        slides,
        title: input.title?.trim(),
      });

      await updatePublishAttemptPlatformState({
        platformAttemptId,
        status: "success",
        scheduledPostId: result.scheduledPostId,
        externalPostId: result.publishResponse.externalPostId,
        externalPostUrl: result.publishResponse.externalPostUrl,
        response: {
          publishedAt: result.publishResponse.publishedAt,
          reusedExisting: result.reusedExisting,
        },
      });
    } catch (error) {
      await updatePublishAttemptPlatformState({
        platformAttemptId,
        status: "failed",
        errorCode: summarizePublishErrorCode(error),
        errorMessage: summarizePublishFailure(error),
        response: {
          message: error instanceof Error ? error.message : "Unknown publishing error.",
        },
      });
    }
  }

  return {
    publishAttempt: await loadPublishAttemptOrThrow(businessId, ledger.publishAttemptId),
  };
}

export async function listPublishAttempts(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<PublishAttemptsResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);

  const rows = await loadPublishAttemptRows(businessId);
  const platformRowsByAttempt = new Map<string, PublishAttemptPlatformRow[]>();

  for (const row of rows.platforms) {
    const current = platformRowsByAttempt.get(row.publish_attempt_id) ?? [];
    current.push(row);
    platformRowsByAttempt.set(row.publish_attempt_id, current);
  }

  return {
    publishAttempts: rows.attempts.map((row) =>
      mapPublishAttempt(row, platformRowsByAttempt.get(row.id) ?? [])),
  };
}

export async function getPublishAttemptDetail(
  principal: AuthenticatedPrincipal,
  businessId: string,
  publishAttemptId: string,
): Promise<PublishAttemptDetailResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);

  return {
    publishAttempt: await loadPublishAttemptOrThrow(businessId, publishAttemptId),
  };
}

export async function retryPublishAttempt(
  principal: AuthenticatedPrincipal,
  publishAttemptId: string,
  input: RetryPublishAttemptRequest,
): Promise<RetryPublishAttemptResponse> {
  const businessId = input.businessId.trim();

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  if (!principal.userId) {
    throw new HttpError(401, "auth_required", "Authenticated user context is incomplete.");
  }

  const priorAttempt = await loadPublishAttemptOrThrow(businessId, publishAttemptId);
  const failedPlatforms = priorAttempt.platforms.filter((platform) => platform.status === "failed");

  if (failedPlatforms.length === 0) {
    throw new HttpError(409, "publish_attempt_retry_not_needed", "This publish attempt has no failed platforms to retry.");
  }

  const recoveredResult = await queryDb<{ retry_of_publish_attempt_platform_id: string }>(
    `
      select retry_of_publish_attempt_platform_id
      from publish_attempt_platforms
      where retry_of_publish_attempt_platform_id = any($1::uuid[])
        and status = 'success'
    `,
    [failedPlatforms.map((platform) => platform.id)],
  );
  const recoveredPlatformIds = new Set(
    recoveredResult.rows
      .map((row) => row.retry_of_publish_attempt_platform_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  const retryablePlatforms = failedPlatforms.filter((platform) => !recoveredPlatformIds.has(platform.id));

  if (retryablePlatforms.length === 0) {
    throw new HttpError(
      409,
      "publish_attempt_retry_not_needed",
      "All failed platforms from this attempt have already been recovered.",
    );
  }

  const overrideContentText = input.contentText?.trim();
  const overrideAssetGroupId = input.assetId?.trim() || null;
  const overrideSlides = input.slides;
  const requestedAssets = overrideAssetGroupId
    ? await loadReadyAssetsForPostGroup(businessId, overrideAssetGroupId)
    : [];

  const retryLedger = await createPublishAttemptLedger({
    businessId,
    userId: principal.userId,
    sourceKind: "retry",
    title: input.title?.trim() || priorAttempt.title || extractPublishAttemptTitle(priorAttempt.contentText || ""),
    contentText: overrideContentText || priorAttempt.contentText || retryablePlatforms[0]?.contentText || "",
    assetGroupId: overrideAssetGroupId || priorAttempt.assetGroupId || null,
    slides: overrideSlides ?? priorAttempt.slides,
    distributionGroupId: priorAttempt.distributionGroupId,
    retryOfAttemptId: priorAttempt.id,
    platforms: retryablePlatforms.map((platform) => {
      const contentText = overrideContentText || platform.contentText;
      const slides = overrideSlides ?? platform.slides;
      const mediaSummary =
        overrideSlides || overrideAssetGroupId
          ? summarizePublishMedia(requestedAssets, slides)
          : platform.mediaSummary;

      return {
        platform: platform.platform,
        contentText,
        assetGroupId: overrideAssetGroupId || platform.assetGroupId || null,
        slides,
        mediaSummary,
        retryOfPublishAttemptPlatformId: platform.id,
      };
    }),
  });

  for (const platform of retryablePlatforms) {
    const platformAttemptId = retryLedger.platformAttemptIds.get(platform.platform);

    if (!platformAttemptId) {
      continue;
    }

    const contentText = overrideContentText || platform.contentText;
    const slides = overrideSlides ?? platform.slides;
    const assetId = overrideAssetGroupId || platform.assetGroupId;

    try {
      const result = await runDirectPlatformPublishInternal(principal, {
        businessId,
        platform: platform.platform,
        contentText,
        assetId: assetId ?? undefined,
        slides,
        title: input.title?.trim() || priorAttempt.title,
      });

      await updatePublishAttemptPlatformState({
        platformAttemptId,
        status: "success",
        scheduledPostId: result.scheduledPostId,
        externalPostId: result.publishResponse.externalPostId,
        externalPostUrl: result.publishResponse.externalPostUrl,
        response: {
          publishedAt: result.publishResponse.publishedAt,
          reusedExisting: result.reusedExisting,
        },
      });
    } catch (error) {
      await updatePublishAttemptPlatformState({
        platformAttemptId,
        status: "failed",
        errorCode: summarizePublishErrorCode(error),
        errorMessage: summarizePublishFailure(error),
        response: {
          message: error instanceof Error ? error.message : "Unknown publishing error.",
        },
      });
    }
  }

  return {
    publishAttempt: await loadPublishAttemptOrThrow(businessId, retryLedger.publishAttemptId),
  };
}

async function runDirectPlatformPublishInternal(
  principal: AuthenticatedPrincipal,
  input: PublishPostRequest,
): Promise<{
  publishResponse: PublishPostResponse;
  scheduledPostId?: string;
  mediaSummary: PublishAttemptMediaSummary;
  reusedExisting: boolean;
}> {
  const businessId = input.businessId.trim();
  const platform = input.platform;
  const contentText = input.contentText.trim();
  const slides = normalizeSlides(platform, input.slides ?? []);

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  if (!principal.userId) {
    throw new HttpError(401, "auth_required", "Authenticated user context is incomplete.");
  }

  if (platform !== "linkedin" && platform !== "instagram" && platform !== "facebook") {
    throw new HttpError(
      400,
      "bad_request",
      "Only LinkedIn, Facebook, and Instagram publishing are supported right now.",
    );
  }

  if (!contentText) {
    throw new HttpError(400, "bad_request", "contentText is required.");
  }

  const readyAssets =
    platform === "linkedin" || platform === "instagram" || platform === "facebook"
      ? await loadValidatedReadyAssetsForPlatform(businessId, platform, input.assetId?.trim(), slides)
      : [];
  const mediaSummary = summarizePublishMedia(readyAssets, slides);

  const publishingTarget = await resolvePublishingTarget(businessId, platform);
  const audienceTimezone = await resolveBusinessTimezone(businessId);
  const directPublishPreparation = await prepareDirectPublishExecution({
    businessId,
    userId: principal.userId,
    platform,
    contentText,
    assetGroupId: input.assetId?.trim() || null,
    slides,
    assets: readyAssets,
    socialAccountId: publishingTarget.socialAccountId,
    socialAccountIdentityId: publishingTarget.socialAccountIdentityId,
    audienceTimezone,
  });
  logInfo("Starting direct platform publish.", {
    businessId,
    platform,
    assetId: input.assetId?.trim() || null,
    imageCount: mediaSummary.imageCount,
    videoCount: mediaSummary.videoCount,
    slideCount: mediaSummary.slideCount,
  });

  if (directPublishPreparation.existingPublished) {
    logInfo("Skipped duplicate direct platform publish and reused existing result.", {
      businessId,
      platform,
      assetId: input.assetId?.trim() || null,
      externalPostId: directPublishPreparation.existingPublished.externalPostId,
      externalPostUrl: directPublishPreparation.existingPublished.externalPostUrl,
    });

    return {
      publishResponse: directPublishPreparation.existingPublished,
      mediaSummary,
      reusedExisting: true,
    };
  }

  try {
    const publishResult = await publishPlatformPost({
      channel: platform,
      businessId,
      contentText,
      assets: readyAssets,
      slides,
      socialAccountId: publishingTarget.socialAccountId,
      socialAccountIdentityId: publishingTarget.socialAccountIdentityId,
    });

    const externalPostUrl = resolvePublishedExternalPostUrl(platform, publishResult);
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
    if (directPublishPreparation.scheduledPostId) {
      await markScheduledPostPublished(
        directPublishPreparation.scheduledPostId,
        platform,
        publishResult,
        input.assetId?.trim() || null,
        businessId,
      );
    }

    logInfo("Published direct platform post.", {
      businessId,
      platform,
      assetId: input.assetId?.trim() || null,
      imageCount: mediaSummary.imageCount,
      videoCount: mediaSummary.videoCount,
      slideCount: mediaSummary.slideCount,
      externalPostId: publishResult.externalPostId,
      externalPostUrl,
    });

    return {
      publishResponse: {
        platform,
        externalPostId: publishResult.externalPostId,
        externalPostUrl,
        publishedAt: new Date().toISOString(),
        asset,
      },
      scheduledPostId: directPublishPreparation.scheduledPostId,
      mediaSummary,
      reusedExisting: false,
    };
  } catch (error) {
    logWarn("Failed direct platform publish.", {
      businessId,
      platform,
      assetId: input.assetId?.trim() || null,
      imageCount: mediaSummary.imageCount,
      videoCount: mediaSummary.videoCount,
      slideCount: mediaSummary.slideCount,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    if (directPublishPreparation.scheduledPostId) {
      try {
        await markScheduledPostFailed(directPublishPreparation.scheduledPostId, error);
      } catch (markFailedError) {
        logWarn("Direct publish failed and the local history row could not be updated.", {
          businessId,
          platform,
          scheduledPostId: directPublishPreparation.scheduledPostId,
          message: markFailedError instanceof Error ? markFailedError.message : "Unknown error",
        });
      }
    }

    throw error;
  }
}

export async function publishPostNow(
  principal: AuthenticatedPrincipal,
  input: PublishPostRequest,
): Promise<PublishPostResponse> {
  const result = await runDirectPlatformPublishInternal(principal, input);
  return result.publishResponse;
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

  try {
    await recordDerivedMediaPerformanceFromPostFeedback({
      businessId,
      contentAssetId: existing.asset_group_id,
      engagementScore: engagementScoreFromPerformanceLabel(performanceLabel),
    });
  } catch (error) {
    logWarn("Unable to bridge scheduled post feedback into media performance stats.", {
      scheduledPostId: existing.id,
      businessId,
      assetGroupId: existing.asset_group_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await safeRecordContentGenerationSuggestionPerformance({
    businessId,
    scheduledPostId,
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
  backfilled: number;
  claimed: number;
  published: number;
  failed: number;
}> {
  const backfilled = await backfillScheduledPostDispatchJobs(Math.max(limit * 2, 10));
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
      const conflictRetryDelaySeconds = resolveConflictRetryDelaySeconds(duePost.platform, job.attempts);
      await releaseJob(
        job.id,
        {
          runAfter: new Date(Date.now() + conflictRetryDelaySeconds * 1000).toISOString(),
          errorMessage: `Delayed briefly to keep ${resolveSocialPlatformLabel(duePost.platform)} publishing safely coordinated.`,
          refundAttempt: true,
        },
      );
      continue;
    }

    try {
      const executionContext = await loadScheduleExecutionContext(duePost.id);
      const readyAssets =
        duePost.asset_group_id && isUuidLike(duePost.asset_group_id)
          ? await loadReadyPostAssets(duePost.business_id, duePost.asset_group_id)
          : [];
      const slides = parseSlides(duePost.asset_payload);
      const mediaSummary = summarizePublishMedia(readyAssets, slides);
      logInfo("Starting scheduled platform publish.", {
        jobId: job.id,
        scheduledPostId: duePost.id,
        scheduleItemId: executionContext.scheduleItemId,
        distributionGroupId: executionContext.distributionGroupId,
        channel: executionContext.channel ?? duePost.platform,
        attemptCount: job.attempts,
        imageCount: mediaSummary.imageCount,
        videoCount: mediaSummary.videoCount,
        slideCount: mediaSummary.slideCount,
      });

      const claimedForProcessing = await markScheduledPostProcessing(duePost.id, job.attempts, job.id);

      if (!claimedForProcessing) {
        await markJobCompleted(job.id);
        logInfo("Skipped scheduled platform publish because state changed before claim.", {
          jobId: job.id,
          scheduledPostId: duePost.id,
          scheduleItemId: executionContext.scheduleItemId,
          distributionGroupId: executionContext.distributionGroupId,
          channel: executionContext.channel ?? duePost.platform,
        });
        continue;
      }

      const publishAttempt = await ensureScheduledPublishAttemptForPlatform({
        duePost,
        scheduleItemId: executionContext.scheduleItemId,
        distributionGroupId: executionContext.distributionGroupId,
        mediaSummary,
      });

      const publishResult = await publishPlatformPost({
        channel: duePost.platform,
        businessId: duePost.business_id,
        contentText: duePost.content_text,
        assets: readyAssets,
        slides,
        socialAccountId: duePost.social_account_id,
        socialAccountIdentityId: duePost.social_account_identity_id,
      });

      await markScheduledPostPublished(
        duePost.id,
        duePost.platform,
        publishResult,
        duePost.asset_group_id,
        duePost.business_id,
      );
      try {
        await updatePublishAttemptPlatformState({
          platformAttemptId: publishAttempt.platformAttemptId,
          status: "success",
          scheduledPostId: duePost.id,
          externalPostId: publishResult.externalPostId,
          externalPostUrl:
            resolvePublishedExternalPostUrl(duePost.platform, publishResult),
          response: publishResult.response,
        });
      } catch (attemptError) {
        logWarn("Scheduled publish succeeded but publish ledger update failed.", {
          scheduledPostId: duePost.id,
          publishAttemptId: publishAttempt.publishAttemptId,
          message: attemptError instanceof Error ? attemptError.message : "Unknown error",
        });
      }
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
      logInfo("Published scheduled platform post.", {
        jobId: job.id,
        scheduledPostId: duePost.id,
        scheduleItemId: executionContext.scheduleItemId,
        distributionGroupId: executionContext.distributionGroupId,
        channel: executionContext.channel ?? duePost.platform,
        externalPostId: publishResult.externalPostId,
        externalPostUrl: publishResult.externalPostUrl,
        imageCount: mediaSummary.imageCount,
        videoCount: mediaSummary.videoCount,
        slideCount: mediaSummary.slideCount,
      });
    } catch (error) {
      const executionContext = await loadScheduleExecutionContext(duePost.id);
      const readyAssets =
        duePost.asset_group_id && isUuidLike(duePost.asset_group_id)
          ? await loadReadyPostAssets(duePost.business_id, duePost.asset_group_id)
          : [];
      const slides = parseSlides(duePost.asset_payload);
      const mediaSummary = summarizePublishMedia(readyAssets, slides);
      const failureMessage = summarizePublishFailure(error);
      const shouldRetry = isRetryablePublishError(error) && job.attempts < job.maxAttempts;
      let publishAttempt: { publishAttemptId: string; platformAttemptId: string } | null = null;

      try {
        publishAttempt = await ensureScheduledPublishAttemptForPlatform({
          duePost,
          scheduleItemId: executionContext.scheduleItemId,
          distributionGroupId: executionContext.distributionGroupId,
          mediaSummary,
        });
      } catch (attemptError) {
        logWarn("Unable to attach scheduled publish failure to the publish ledger.", {
          scheduledPostId: duePost.id,
          message: attemptError instanceof Error ? attemptError.message : "Unknown error",
        });
      }

      if (shouldRetry) {
        await markScheduledPostQueuedForRetry(duePost.id, failureMessage, job.attempts);
        await markJobFailed(job.id, failureMessage);
        if (publishAttempt) {
          await updatePublishAttemptPlatformState({
            platformAttemptId: publishAttempt.platformAttemptId,
            status: "processing",
            scheduledPostId: duePost.id,
            errorCode: summarizePublishErrorCode(error),
            errorMessage: failureMessage,
            response: {
              retryQueued: true,
              attemptCount: job.attempts,
            },
          });
        }
      } else {
        await markScheduledPostFailed(duePost.id, new Error(failureMessage));
        await markJobTerminalFailed(job.id, failureMessage);
        if (publishAttempt) {
          await updatePublishAttemptPlatformState({
            platformAttemptId: publishAttempt.platformAttemptId,
            status: "failed",
            scheduledPostId: duePost.id,
            errorCode: summarizePublishErrorCode(error),
            errorMessage: failureMessage,
            response: {
              retryQueued: false,
              attemptCount: job.attempts,
            },
          });
        }
        failed += 1;
      }

      logError("Failed to publish scheduled platform post.", {
        jobId: job.id,
        scheduledPostId: duePost.id,
        scheduleItemId: executionContext.scheduleItemId,
        distributionGroupId: executionContext.distributionGroupId,
        channel: executionContext.channel ?? duePost.platform,
        message: failureMessage,
        retryQueued: shouldRetry,
        attemptCount: job.attempts,
        imageCount: mediaSummary.imageCount,
        videoCount: mediaSummary.videoCount,
        slideCount: mediaSummary.slideCount,
      });
    }
  }

  return {
    backfilled,
    claimed: queuedJobs.length,
    published,
    failed,
  };
}
