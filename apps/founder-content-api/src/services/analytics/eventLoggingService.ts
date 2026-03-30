import type {
  AnalyticsEventType,
  AnalyticsInputType,
  ContentAssetStatus,
  ContentAssetSourceKind,
  ContentAssetType,
  ContentAsset,
  UsageEvent,
} from "../../../../../packages/shared-types/index.ts";
import { isDatabaseConfigured, queryDb } from "../db/client.ts";
import { logError } from "../../utils/logger.ts";
import { toErrorContext } from "../../utils/http.ts";
import {
  buildContentAssetIntelligenceFromText,
  resolveStoredContentAssetIntelligence,
} from "../contentIntelligenceService.ts";

interface UsageEventRow {
  id: string;
  user_id: string | null;
  business_id: string | null;
  event_type: AnalyticsEventType;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
}

interface EventMetadata {
  [key: string]: unknown;
}

interface GenerationLogOptions {
  userId?: string;
  businessId?: string;
  inputType: AnalyticsInputType;
  inputPayload: unknown;
  outputPayload?: unknown;
  success: boolean;
  latencyMs: number;
}

interface ContentAssetOptions {
  businessId?: string;
  userId?: string;
  contentType: ContentAssetType;
  contentBody: unknown;
  title?: string;
  status?: ContentAssetStatus;
  pipelineStage?: Exclude<ContentAssetStatus, "published">;
  sourceKind?: ContentAssetSourceKind;
  sourceIdeaId?: string;
  intelligence?: ContentAsset["intelligence"];
}

interface ContentAssetRow {
  id: string;
  business_id: string | null;
  user_id: string | null;
  content_type: ContentAssetType;
  title: string | null;
  content_body: unknown;
  status: ContentAssetStatus;
  pipeline_stage: Exclude<ContentAssetStatus, "published"> | null;
  source_kind: ContentAssetSourceKind | null;
  source_idea_id: string | null;
  content_metadata: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function estimateTokens(value: unknown): number {
  const serialized = JSON.stringify(value ?? "");
  return Math.max(1, Math.ceil(serialized.length / 4));
}

function mapUsageEvent(row: UsageEventRow): UsageEvent {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    businessId: row.business_id ?? undefined,
    eventType: row.event_type,
    metadata: row.metadata ?? {},
    createdAt: toIsoString(row.created_at),
  };
}

export async function logEvent(
  eventType: AnalyticsEventType,
  userId?: string,
  businessId?: string,
  metadata: EventMetadata = {},
): Promise<UsageEvent> {
  const result = await queryDb<UsageEventRow>(
    `
      insert into usage_events (
        user_id,
        business_id,
        event_type,
        metadata
      ) values (
        $1,
        $2,
        $3,
        $4::jsonb
      )
      returning
        id,
        user_id,
        business_id,
        event_type,
        metadata,
        created_at
    `,
    [userId ?? null, businessId ?? null, eventType, JSON.stringify(metadata)],
  );

  return mapUsageEvent(result.rows[0]);
}

export async function safeLogEvent(
  eventType: AnalyticsEventType,
  userId?: string,
  businessId?: string,
  metadata: EventMetadata = {},
): Promise<UsageEvent | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    return await logEvent(eventType, userId, businessId, metadata);
  } catch (error) {
    logError("Failed to persist analytics usage event.", {
      eventType,
      userId,
      businessId,
      ...toErrorContext(error),
    });
    return null;
  }
}

export async function logContentGeneration(options: GenerationLogOptions): Promise<void> {
  const tokensUsed =
    options.success && options.outputPayload !== undefined
      ? estimateTokens(options.inputPayload) + estimateTokens(options.outputPayload)
      : estimateTokens(options.inputPayload);

  await queryDb(
    `
      insert into content_generation_logs (
        user_id,
        business_id,
        input_type,
        tokens_used,
        model,
        latency_ms,
        success
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7
      )
    `,
    [
      options.userId ?? null,
      options.businessId ?? null,
      options.inputType,
      tokensUsed,
      process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      Math.max(0, Math.round(options.latencyMs)),
      options.success,
    ],
  );
}

export async function safeLogContentGeneration(options: GenerationLogOptions): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await logContentGeneration(options);
  } catch (error) {
    logError("Failed to persist content generation log.", {
      inputType: options.inputType,
      userId: options.userId,
      businessId: options.businessId,
      ...toErrorContext(error),
    });
  }
}

export async function createContentAsset(options: ContentAssetOptions): Promise<void> {
  const textContent = extractTextContent(options.contentBody) ?? options.title ?? "";
  const intelligence = options.intelligence ?? buildContentAssetIntelligenceFromText(textContent);

  await queryDb(
    `
      insert into content_assets (
        business_id,
        user_id,
        content_type,
        title,
        content_body,
        status,
        pipeline_stage,
        source_kind,
        source_idea_id,
        content_metadata
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        $6,
        $7,
        $8,
        $9,
        $10::jsonb
      )
    `,
    [
      options.businessId ?? null,
      options.userId ?? null,
      options.contentType,
      options.title ?? null,
      JSON.stringify(options.contentBody),
      options.status ?? "draft",
      options.pipelineStage ?? "draft",
      options.sourceKind ?? "generated",
      options.sourceIdeaId ?? null,
      JSON.stringify(intelligence ?? {}),
    ],
  );
}

function extractTextContent(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.content === "string" && candidate.content.trim() !== "") {
    return candidate.content.trim();
  }

  if (typeof candidate.post === "string" && candidate.post.trim() !== "") {
    return candidate.post.trim();
  }

  if (Array.isArray(candidate.variations)) {
    const firstVariation = candidate.variations.find(
      (variation) =>
        variation &&
        typeof variation === "object" &&
        typeof (variation as Record<string, unknown>).content === "string",
    ) as Record<string, unknown> | undefined;

    if (typeof firstVariation?.content === "string" && firstVariation.content.trim() !== "") {
      return firstVariation.content.trim();
    }
  }

  return undefined;
}

function mapContentAsset(row: ContentAssetRow): ContentAsset {
  const textContent = extractTextContent(row.content_body);

  return {
    id: row.id,
    businessId: row.business_id ?? undefined,
    userId: row.user_id ?? undefined,
    contentType: row.content_type,
    title: row.title ?? undefined,
    contentBody: row.content_body,
    status: row.status,
    pipelineStage: row.pipeline_stage ?? undefined,
    sourceKind: row.source_kind ?? undefined,
    sourceIdeaId: row.source_idea_id ?? undefined,
    textContent,
    intelligence: resolveStoredContentAssetIntelligence(row.content_metadata, textContent ?? ""),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export async function createContentAssetRecord(
  options: ContentAssetOptions,
): Promise<ContentAsset> {
  const textContent = extractTextContent(options.contentBody) ?? options.title ?? "";
  const intelligence = options.intelligence ?? buildContentAssetIntelligenceFromText(textContent);

  const result = await queryDb<ContentAssetRow>(
    `
      insert into content_assets (
        business_id,
        user_id,
        content_type,
        title,
        content_body,
        status,
        pipeline_stage,
        source_kind,
        source_idea_id,
        content_metadata
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        $6,
        $7,
        $8,
        $9,
        $10::jsonb
      )
      returning
        id,
        business_id,
        user_id,
        content_type,
        title,
        content_body,
        status,
        pipeline_stage,
        source_kind,
        source_idea_id,
        content_metadata,
        created_at,
        updated_at
    `,
    [
      options.businessId ?? null,
      options.userId ?? null,
      options.contentType,
      options.title ?? null,
      JSON.stringify(options.contentBody),
      options.status ?? "draft",
      options.pipelineStage ?? "draft",
      options.sourceKind ?? "generated",
      options.sourceIdeaId ?? null,
      JSON.stringify(intelligence ?? {}),
    ],
  );

  return mapContentAsset(result.rows[0]);
}

export async function safeCreateContentAsset(options: ContentAssetOptions): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await createContentAsset(options);
  } catch (error) {
    logError("Failed to persist content asset.", {
      contentType: options.contentType,
      userId: options.userId,
      businessId: options.businessId,
      ...toErrorContext(error),
    });
  }
}
