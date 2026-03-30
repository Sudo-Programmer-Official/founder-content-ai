import type { QueryResultRow } from "pg";
import type {
  ConfirmContentBatchRequest,
  ConfirmContentBatchResponse,
  ContentBatch,
  ContentBatchSpacing,
  ContentItem,
  ContentVariant,
  CreateContentPipelineItemResponse,
  GenerateContentBatchRequest,
  GenerateContentBatchResponse,
  GetContentBatchResponse,
  ScheduleItem,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { generatePostsWithAI } from "./aiService.ts";
import { createContentAssetRecord, safeLogContentGeneration, safeLogEvent } from "./analytics/eventLoggingService.ts";
import { queryDb, withDbTransaction } from "./db/client.ts";
import { enforceWorkspaceReadAccess, enforceWorkspaceWriteAccess } from "./governanceService.ts";
import { createScheduledPost } from "./scheduledPostService.ts";
import { HttpError } from "../utils/http.ts";

interface ContentBatchRow extends QueryResultRow {
  id: string;
  business_id: string;
  user_id: string | null;
  lane: "social" | "email";
  primary_channel: "linkedin" | "instagram" | "facebook" | "email";
  days: string | number;
  title: string | null;
  status: "draft" | "confirmed" | "scheduled" | "archived";
  default_audience_timezone: string | null;
  default_scheduled_time: string | null;
  confirmed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ContentItemRow extends QueryResultRow {
  id: string;
  business_id: string;
  user_id: string | null;
  batch_id: string | null;
  source_asset_id: string | null;
  idea_text: string | null;
  base_text: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ContentVariantRow extends QueryResultRow {
  id: string;
  business_id: string;
  user_id: string | null;
  content_item_id: string;
  source_asset_id: string | null;
  channel: "linkedin" | "instagram" | "facebook" | "email";
  lane: "social" | "email";
  title: string | null;
  text_content: string;
  html_content: string | null;
  media_json: unknown;
  source: "generated" | "manual" | "remix";
  status: ContentVariant["status"];
  is_customized: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ScheduleItemRow extends QueryResultRow {
  id: string;
  business_id: string;
  content_item_id: string;
  variant_id: string;
  channel: "linkedin" | "instagram" | "facebook" | "email";
  lane: "social" | "email";
  scheduled_date: Date | string;
  scheduled_time: string;
  audience_timezone: string | null;
  scheduled_at: Date | string | null;
  status: ScheduleItem["status"];
  external_reference_id: string | null;
  external_reference_url: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  published_at: Date | string | null;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toNumber(value: string | number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapContentBatch(row: ContentBatchRow): ContentBatch {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id ?? undefined,
    lane: row.lane,
    primaryChannel: row.primary_channel,
    days: toNumber(row.days),
    title: row.title ?? undefined,
    status: row.status,
    defaultAudienceTimezone: row.default_audience_timezone ?? undefined,
    defaultScheduledTime: row.default_scheduled_time ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    confirmedAt: toIsoString(row.confirmed_at),
  };
}

function mapContentItem(row: ContentItemRow): ContentItem {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id ?? undefined,
    batchId: row.batch_id ?? undefined,
    sourceAssetId: row.source_asset_id ?? undefined,
    idea: row.idea_text ?? undefined,
    baseText: row.base_text ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function parseMedia(value: unknown): { images: string[]; videos: string[] } {
  if (!value || typeof value !== "object") {
    return { images: [], videos: [] };
  }

  const candidate = value as Record<string, unknown>;
  const images = Array.isArray(candidate.images)
    ? candidate.images.filter((entry): entry is string => typeof entry === "string")
    : [];
  const videos = Array.isArray(candidate.videos)
    ? candidate.videos.filter((entry): entry is string => typeof entry === "string")
    : [];

  return { images, videos };
}

function mapContentVariant(row: ContentVariantRow): ContentVariant {
  return {
    id: row.id,
    contentItemId: row.content_item_id,
    businessId: row.business_id,
    channel: row.channel,
    lane: row.lane,
    title: row.title ?? undefined,
    text: row.text_content,
    html: row.html_content ?? undefined,
    media: parseMedia(row.media_json),
    status: row.status,
    source: row.source,
    isCustomized: row.is_customized,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function normalizeDateString(value: Date | string): string {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

function mapScheduleItem(row: ScheduleItemRow): ScheduleItem {
  return {
    id: row.id,
    businessId: row.business_id,
    contentItemId: row.content_item_id,
    variantId: row.variant_id,
    channel: row.channel,
    lane: row.lane,
    scheduledDate: normalizeDateString(row.scheduled_date),
    scheduledTime: row.scheduled_time.slice(0, 5),
    audienceTimezone: row.audience_timezone ?? undefined,
    scheduledAt: toIsoString(row.scheduled_at),
    status: row.status,
    externalReferenceId: row.external_reference_id ?? undefined,
    externalReferenceUrl: row.external_reference_url ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    publishedAt: toIsoString(row.published_at),
  };
}

function normalizePrompt(value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new HttpError(400, "bad_request", "prompt is required.");
  }

  return normalized;
}

function normalizeDays(value: number | undefined): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 31) {
    throw new HttpError(400, "bad_request", "days must be an integer between 1 and 31.");
  }

  return parsed;
}

function normalizeTime(value: string | undefined, fallback = "09:00"): string {
  const normalized = value?.trim() || fallback;

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new HttpError(400, "bad_request", "defaultScheduledTime must use HH:MM format.");
  }

  return normalized;
}

function normalizeDateKey(value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new HttpError(400, "bad_request", "startDate must use YYYY-MM-DD format.");
  }

  return normalized;
}

function normalizeTimezone(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();

  if (!normalized) {
    return undefined;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized });
    return normalized;
  } catch {
    throw new HttpError(400, "bad_request", "audienceTimezone must be a valid IANA timezone.");
  }
}

function buildTitle(value: string, fallback: string): string {
  const firstLine = value
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return fallback;
  }

  return firstLine.slice(0, 96);
}

function buildDailyPrompt(input: {
  prompt: string;
  dayIndex: number;
  totalDays: number;
  recentDrafts: string[];
}): string {
  const priorContext =
    input.recentDrafts.length > 0
      ? `\nAvoid repeating these recent batch directions:\n${input.recentDrafts
          .slice(-3)
          .map((entry, index) => `${index + 1}. ${entry}`)
          .join("\n")}`
      : "";

  return `${input.prompt}

Create a distinct LinkedIn post for day ${input.dayIndex} of ${input.totalDays}.
Keep the batch cohesive, but make this entry feel materially different from the others.${priorContext}`;
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

  return result.rows[0]?.timezone?.trim() || "UTC";
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

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  const timeZoneName = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(timeZoneName ?? "");

  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes);
}

function zonedDateTimeToUtc(dateKey: string, timeValue: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcMs), timeZone);
    utcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60_000;
  }

  return new Date(utcMs);
}

function buildScheduleDateKeys(startDate: string, count: number, spacing: ContentBatchSpacing): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${startDate}T12:00:00.000Z`);

  while (keys.length < count) {
    const weekday = cursor.getUTCDay();
    const include = spacing === "daily" || (weekday !== 0 && weekday !== 6);

    if (include) {
      keys.push(cursor.toISOString().slice(0, 10));
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
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

async function loadBatchRow(businessId: string, batchId: string): Promise<ContentBatchRow> {
  const result = await queryDb<ContentBatchRow>(
    `
      select
        id,
        business_id,
        user_id,
        lane,
        primary_channel,
        days,
        title,
        status,
        default_audience_timezone,
        default_scheduled_time,
        confirmed_at,
        created_at,
        updated_at
      from content_batches
      where id = $1
        and business_id = $2
      limit 1
    `,
    [batchId, businessId],
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "content_batch_not_found", "Content batch was not found.");
  }

  return row;
}

async function loadContentItemsForBatch(batchId: string): Promise<ContentItemRow[]> {
  const result = await queryDb<ContentItemRow>(
    `
      select
        id,
        business_id,
        user_id,
        batch_id,
        source_asset_id,
        idea_text,
        base_text,
        created_at,
        updated_at
      from content_items
      where batch_id = $1
      order by created_at asc
    `,
    [batchId],
  );

  return result.rows;
}

async function loadVariantsForBatch(batchId: string): Promise<ContentVariantRow[]> {
  const result = await queryDb<ContentVariantRow>(
    `
      select
        cv.id,
        cv.business_id,
        cv.user_id,
        cv.content_item_id,
        cv.source_asset_id,
        cv.channel,
        cv.lane,
        cv.title,
        cv.text_content,
        cv.html_content,
        cv.media_json,
        cv.source,
        cv.status,
        cv.is_customized,
        cv.created_at,
        cv.updated_at
      from content_variants cv
      join content_items ci on ci.id = cv.content_item_id
      where ci.batch_id = $1
      order by ci.created_at asc, cv.created_at asc
    `,
    [batchId],
  );

  return result.rows;
}

async function loadScheduleItemsForBatch(batchId: string): Promise<ScheduleItemRow[]> {
  const result = await queryDb<ScheduleItemRow>(
    `
      select
        si.id,
        si.business_id,
        si.content_item_id,
        si.variant_id,
        si.channel,
        si.lane,
        si.scheduled_date,
        si.scheduled_time,
        si.audience_timezone,
        si.scheduled_at,
        si.status,
        si.external_reference_id,
        si.external_reference_url,
        si.created_at,
        si.updated_at,
        si.published_at
      from schedule_items si
      join content_items ci on ci.id = si.content_item_id
      where ci.batch_id = $1
      order by si.scheduled_at asc nulls last, si.created_at asc
    `,
    [batchId],
  );

  return result.rows;
}

async function loadBatchDetail(businessId: string, batchId: string): Promise<GetContentBatchResponse> {
  const [batchRow, itemRows, variantRows, scheduleRows] = await Promise.all([
    loadBatchRow(businessId, batchId),
    loadContentItemsForBatch(batchId),
    loadVariantsForBatch(batchId),
    loadScheduleItemsForBatch(batchId),
  ]);

  return {
    batch: mapContentBatch(batchRow),
    items: itemRows.map(mapContentItem),
    variants: variantRows.map(mapContentVariant),
    scheduleItems: scheduleRows.map(mapScheduleItem),
  };
}

export async function generateContentBatch(
  principal: AuthenticatedPrincipal,
  input: GenerateContentBatchRequest,
): Promise<GenerateContentBatchResponse> {
  const businessId = input.businessId.trim();
  const prompt = normalizePrompt(input.prompt);
  const days = normalizeDays(input.days);
  const lane = input.lane;
  const primaryChannel = input.primaryChannel;
  const tone = input.tone?.trim() || "storytelling";
  const length = input.length?.trim() || "medium";
  const defaultAudienceTimezone = normalizeTimezone(input.audienceTimezone);
  const defaultScheduledTime = normalizeTime(input.defaultScheduledTime, "09:00");

  if (lane !== "social" || primaryChannel !== "linkedin") {
    throw new HttpError(
      400,
      "unsupported_content_batch",
      "Only LinkedIn social content batches are supported right now.",
    );
  }

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "content_generation",
    usageMetric: "posts",
  });

  const recentDrafts: string[] = [];
  const generatedItems: Array<{
    ideaText: string;
    baseText: string;
    variantTitle: string;
    variantText: string;
    angle?: string;
  }> = [];

  for (let index = 0; index < days; index += 1) {
    const response = await generatePostsWithAI({
      topic: buildDailyPrompt({
        prompt,
        dayIndex: index + 1,
        totalDays: days,
        recentDrafts,
      }),
      tone,
      length,
      businessId,
    });

    const primaryVariation = response.variations[0];
    const variantText = primaryVariation?.content?.trim();

    if (!variantText) {
      throw new HttpError(502, "content_generation_failed", "AI generation returned an empty draft.");
    }

    recentDrafts.push(variantText.slice(0, 220));
    generatedItems.push({
      ideaText: `Day ${index + 1}: ${prompt}`,
      baseText: variantText,
      variantTitle: buildTitle(variantText, `Day ${index + 1}`),
      variantText,
      angle: primaryVariation?.angle,
    });
  }

  const persisted = await withDbTransaction(async (client) => {
    const batchResult = await client.query<ContentBatchRow>(
      `
        insert into content_batches (
          business_id,
          user_id,
          lane,
          primary_channel,
          days,
          title,
          status,
          default_audience_timezone,
          default_scheduled_time
        ) values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          'draft',
          $7,
          $8
        )
        returning
          id,
          business_id,
          user_id,
          lane,
          primary_channel,
          days,
          title,
          status,
          default_audience_timezone,
          default_scheduled_time,
          confirmed_at,
          created_at,
          updated_at
      `,
      [
        businessId,
        principal.userId ?? null,
        lane,
        primaryChannel,
        days,
        input.title?.trim() || `LinkedIn batch · ${days} day${days === 1 ? "" : "s"}`,
        defaultAudienceTimezone ?? null,
        defaultScheduledTime,
      ],
    );

    const batchRow = batchResult.rows[0];
    const itemRows: ContentItemRow[] = [];
    const variantRows: ContentVariantRow[] = [];

    for (const [index, generated] of generatedItems.entries()) {
      const itemResult = await client.query<ContentItemRow>(
        `
          insert into content_items (
            business_id,
            user_id,
            batch_id,
            idea_text,
            base_text,
            metadata_json
          ) values (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6::jsonb
          )
          returning
            id,
            business_id,
            user_id,
            batch_id,
            source_asset_id,
            idea_text,
            base_text,
            created_at,
            updated_at
        `,
        [
          businessId,
          principal.userId ?? null,
          batchRow.id,
          generated.ideaText,
          generated.baseText,
          JSON.stringify({ dayIndex: index + 1 }),
        ],
      );

      const itemRow = itemResult.rows[0];
      itemRows.push(itemRow);

      const variantResult = await client.query<ContentVariantRow>(
        `
          insert into content_variants (
            business_id,
            user_id,
            content_item_id,
            channel,
            lane,
            title,
            text_content,
            media_json,
            source,
            status,
            is_customized,
            metadata_json
          ) values (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            '{"images":[],"videos":[]}'::jsonb,
            'generated',
            'draft',
            false,
            $8::jsonb
          )
          returning
            id,
            business_id,
            user_id,
            content_item_id,
            source_asset_id,
            channel,
            lane,
            title,
            text_content,
            html_content,
            media_json,
            source,
            status,
            is_customized,
            created_at,
            updated_at
        `,
        [
          businessId,
          principal.userId ?? null,
          itemRow.id,
          primaryChannel,
          lane,
          generated.variantTitle,
          generated.variantText,
          JSON.stringify({ dayIndex: index + 1, angle: generated.angle ?? null }),
        ],
      );

      variantRows.push(variantResult.rows[0]);
    }

    return {
      batch: mapContentBatch(batchRow),
      items: itemRows.map(mapContentItem),
      variants: variantRows.map(mapContentVariant),
    };
  });

  await Promise.all([
    safeLogEvent("post_generated", principal.userId, businessId, {
      route: "/api/content/batches/generate",
      batchId: persisted.batch.id,
      days,
    }),
    safeLogContentGeneration({
      userId: principal.userId,
      businessId,
      inputType: "idea",
      inputPayload: { prompt, tone, length, days },
      outputPayload: persisted.variants.map((variant) => variant.text),
      success: true,
      latencyMs: 0,
    }),
  ]);

  return persisted;
}

export async function getContentBatch(
  principal: AuthenticatedPrincipal,
  businessId: string,
  batchId: string,
): Promise<GetContentBatchResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "content_generation");
  return loadBatchDetail(businessId, batchId);
}

export async function confirmContentBatch(
  principal: AuthenticatedPrincipal,
  input: ConfirmContentBatchRequest,
): Promise<ConfirmContentBatchResponse> {
  const businessId = input.businessId.trim();
  const batchId = input.batchId.trim();
  const startDate = normalizeDateKey(input.startDate);
  const spacing: ContentBatchSpacing = input.spacing === "weekdays" ? "weekdays" : "daily";

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "scheduler",
    usageMetric: "posts",
  });

  const detail = await loadBatchDetail(businessId, batchId);

  if (detail.batch.lane !== "social" || detail.batch.primaryChannel !== "linkedin") {
    throw new HttpError(
      400,
      "unsupported_content_batch",
      "Only LinkedIn social content batches can be confirmed right now.",
    );
  }

  if (detail.batch.status === "scheduled") {
    throw new HttpError(409, "content_batch_already_scheduled", "This content batch has already been scheduled.");
  }

  if (detail.scheduleItems.length > 0) {
    throw new HttpError(
      409,
      "content_batch_partially_scheduled",
      "This content batch already has schedule items. Open the planner instead of confirming it again.",
    );
  }

  if (detail.items.length === 0 || detail.variants.length === 0) {
    throw new HttpError(409, "content_batch_empty", "This content batch has no generated items to schedule.");
  }

  const audienceTimezone =
    normalizeTimezone(input.audienceTimezone) ??
    detail.batch.defaultAudienceTimezone ??
    (await resolveBusinessTimezone(businessId));
  const defaultScheduledTime = normalizeTime(
    input.defaultScheduledTime,
    detail.batch.defaultScheduledTime ?? "09:00",
  );
  const scheduleDateKeys = buildScheduleDateKeys(startDate, detail.items.length, spacing);
  const variantsByItemId = new Map(detail.variants.map((variant) => [variant.contentItemId, variant]));
  const createdScheduleItems: ScheduleItem[] = [];

  for (const [index, item] of detail.items.entries()) {
    const variant = variantsByItemId.get(item.id);

    if (!variant) {
      throw new HttpError(
        409,
        "content_variant_missing",
        "One or more batch items are missing their channel variant.",
      );
    }

    const contentAsset = await createContentAssetRecord({
      businessId,
      userId: principal.userId,
      contentType: variant.channel === "email" ? "email" : "post",
      title: variant.title ?? buildTitle(variant.text, `Day ${index + 1}`),
      contentBody: {
        content: variant.text,
        batchId,
        contentItemId: item.id,
        variantId: variant.id,
        channel: variant.channel,
        lane: variant.lane,
      },
      sourceKind: "generated",
      pipelineStage: "review",
    });

    await Promise.all([
      queryDb(
        `
          update content_items
          set source_asset_id = $2, updated_at = now()
          where id = $1
        `,
        [item.id, contentAsset.id],
      ),
      queryDb(
        `
          update content_variants
          set source_asset_id = $2, status = 'scheduled', updated_at = now()
          where id = $1
        `,
        [variant.id, contentAsset.id],
      ),
    ]);

    const requestedScheduledAt = zonedDateTimeToUtc(
      scheduleDateKeys[index],
      defaultScheduledTime,
      audienceTimezone,
    ).toISOString();

    const scheduled = await createScheduledPost(principal, {
      businessId,
      platform: "linkedin",
      contentText: variant.text,
      assetGroupId: contentAsset.id,
      slides: [],
      scheduledAt: requestedScheduledAt,
      audienceTimezone,
    });

    const scheduleResult = await queryDb<ScheduleItemRow>(
      `
        insert into schedule_items (
          business_id,
          user_id,
          content_item_id,
          variant_id,
          legacy_scheduled_post_id,
          channel,
          lane,
          scheduled_date,
          scheduled_time,
          audience_timezone,
          scheduled_at,
          status,
          external_reference_id,
          external_reference_url,
          published_at
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
          $11,
          $12,
          $13,
          $14,
          $15
        )
        returning
          id,
          business_id,
          content_item_id,
          variant_id,
          channel,
          lane,
          scheduled_date,
          scheduled_time,
          audience_timezone,
          scheduled_at,
          status,
          external_reference_id,
          external_reference_url,
          created_at,
          updated_at,
          published_at
      `,
      [
        businessId,
        principal.userId ?? null,
        item.id,
        variant.id,
        scheduled.scheduledPost.id,
        variant.channel,
        variant.lane,
        formatDateKeyInTimezone(scheduled.scheduledPost.scheduledAt, audienceTimezone),
        formatTimeInTimezone(scheduled.scheduledPost.scheduledAt, audienceTimezone),
        audienceTimezone,
        scheduled.scheduledPost.scheduledAt,
        scheduled.scheduledPost.status,
        scheduled.scheduledPost.externalPostId ?? null,
        scheduled.scheduledPost.externalPostUrl ?? null,
        scheduled.scheduledPost.publishedAt ?? null,
      ],
    );

    createdScheduleItems.push(mapScheduleItem(scheduleResult.rows[0]));
  }

  const updatedBatchResult = await queryDb<ContentBatchRow>(
    `
      update content_batches
      set
        status = 'scheduled',
        confirmed_at = coalesce(confirmed_at, now()),
        default_audience_timezone = $2,
        default_scheduled_time = $3,
        updated_at = now()
      where id = $1
      returning
        id,
        business_id,
        user_id,
        lane,
        primary_channel,
        days,
        title,
        status,
        default_audience_timezone,
        default_scheduled_time,
        confirmed_at,
        created_at,
        updated_at
    `,
    [batchId, audienceTimezone, defaultScheduledTime],
  );

  await safeLogEvent("first_content_scheduled", principal.userId, businessId, {
    route: "/api/content/batches/:batchId/confirm",
    batchId,
    scheduledCount: createdScheduleItems.length,
  });

  return {
    batch: mapContentBatch(updatedBatchResult.rows[0]),
    scheduleItems: createdScheduleItems,
  };
}
