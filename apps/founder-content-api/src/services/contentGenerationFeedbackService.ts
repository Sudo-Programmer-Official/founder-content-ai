import type { QueryResultRow } from "pg";
import type { PostPerformanceLabel, RepurposeStrategy } from "../../../../packages/shared-types/index.ts";
import { isDatabaseConfigured, queryDb } from "./db/client.ts";
import { logError } from "../utils/logger.ts";

interface ContentGenerationSuggestionFeedbackRow extends QueryResultRow {
  business_id: string;
  source_asset_id: string | null;
  suggestion_id: string;
  strategy: RepurposeStrategy;
  selection_origin: string;
  selected_at: Date | string;
  edit_count: string | number;
  scheduled_post_id: string | null;
  scheduled_at: Date | string | null;
  published_at: Date | string | null;
  performance_label: PostPerformanceLabel | null;
}

export interface ContentGenerationSuggestionFeedbackSummary {
  strategyScores: Map<RepurposeStrategy, number>;
  sourceAssetScores: Map<string, number>;
  sourceStrategyScores: Map<string, number>;
}

const FEEDBACK_LOOKBACK_DAYS = 120;
const FEEDBACK_ABANDON_AFTER_HOURS = 72;

function createEmptySummary(): ContentGenerationSuggestionFeedbackSummary {
  return {
    strategyScores: new Map(),
    sourceAssetScores: new Map(),
    sourceStrategyScores: new Map(),
  };
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addScore<TKey extends string>(map: Map<TKey, number>, key: TKey, score: number): void {
  map.set(key, (map.get(key) ?? 0) + score);
}

function calculateFeedbackScore(row: ContentGenerationSuggestionFeedbackRow): number {
  let score = 1;
  const editCount = Math.max(0, toNumber(row.edit_count));

  if (editCount > 0) {
    score += Math.min(2, editCount * 0.45);
  }

  if (row.scheduled_at) {
    score += 2.5;
  }

  if (row.published_at) {
    score += 3.5;
  }

  switch (row.performance_label) {
    case "high":
      score += 4.5;
      break;
    case "medium":
      score += 2.25;
      break;
    case "low":
      score -= 3.5;
      break;
    default:
      break;
  }

  if (!row.scheduled_at && !row.published_at) {
    const hoursSinceSelected =
      (Date.now() - new Date(row.selected_at).getTime()) / (1000 * 60 * 60);

    if (hoursSinceSelected >= FEEDBACK_ABANDON_AFTER_HOURS) {
      score -= 1.75;
    }
  }

  return score;
}

function buildFeedbackSummary(
  rows: ContentGenerationSuggestionFeedbackRow[],
): ContentGenerationSuggestionFeedbackSummary {
  const summary = createEmptySummary();

  for (const row of rows) {
    const score = calculateFeedbackScore(row);

    addScore(summary.strategyScores, row.strategy, score);

    if (row.source_asset_id) {
      addScore(summary.sourceAssetScores, row.source_asset_id, score);
      addScore(summary.sourceStrategyScores, `${row.source_asset_id}:${row.strategy}`, score);
    }
  }

  return summary;
}

export async function loadContentGenerationSuggestionFeedbackSummary(
  businessId: string,
): Promise<ContentGenerationSuggestionFeedbackSummary> {
  if (!isDatabaseConfigured()) {
    return createEmptySummary();
  }

  try {
    const result = await queryDb<ContentGenerationSuggestionFeedbackRow>(
      `
        select
          business_id,
          source_asset_id,
          suggestion_id,
          strategy,
          selection_origin,
          selected_at,
          edit_count,
          scheduled_post_id,
          scheduled_at,
          published_at,
          performance_label
        from content_generation_suggestion_feedback
        where business_id = $1::uuid
          and selected_at >= now() - ($2::int * interval '1 day')
        order by updated_at desc
      `,
      [businessId, FEEDBACK_LOOKBACK_DAYS],
    );

    return buildFeedbackSummary(result.rows);
  } catch (error) {
    logError("Failed to load content generation feedback summary.", {
      businessId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return createEmptySummary();
  }
}

export async function safeRecordContentGenerationSuggestionSelection(input: {
  businessId: string;
  userId?: string;
  generatedAssetId: string;
  sourceAssetId: string;
  suggestionId: string;
  strategy: RepurposeStrategy;
  origin?: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await queryDb(
      `
        insert into content_generation_suggestion_feedback (
          business_id,
          user_id,
          generated_asset_id,
          source_asset_id,
          suggestion_id,
          strategy,
          selection_origin,
          selected_at,
          updated_at
        ) values (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5,
          $6,
          $7,
          now(),
          now()
        )
        on conflict (generated_asset_id)
        do update set
          user_id = coalesce(excluded.user_id, content_generation_suggestion_feedback.user_id),
          source_asset_id = excluded.source_asset_id,
          suggestion_id = excluded.suggestion_id,
          strategy = excluded.strategy,
          selection_origin = excluded.selection_origin,
          updated_at = now()
      `,
      [
        input.businessId,
        input.userId ?? null,
        input.generatedAssetId,
        input.sourceAssetId,
        input.suggestionId,
        input.strategy,
        input.origin?.trim() || "generate_for_me",
      ],
    );
  } catch (error) {
    logError("Failed to record content generation suggestion selection.", {
      businessId: input.businessId,
      generatedAssetId: input.generatedAssetId,
      suggestionId: input.suggestionId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

export async function safeRecordContentGenerationSuggestionEdited(input: {
  businessId: string;
  assetId: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await queryDb(
      `
        update content_generation_suggestion_feedback
        set
          edit_count = edit_count + 1,
          first_edited_at = coalesce(first_edited_at, now()),
          last_edited_at = now(),
          updated_at = now()
        where business_id = $1::uuid
          and generated_asset_id = $2::uuid
      `,
      [input.businessId, input.assetId],
    );
  } catch (error) {
    logError("Failed to record content generation suggestion edit.", {
      businessId: input.businessId,
      assetId: input.assetId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

export async function safeRecordContentGenerationSuggestionScheduled(input: {
  businessId: string;
  assetId: string;
  scheduledPostId?: string | null;
  scheduledAt?: string | null;
}): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await queryDb(
      `
        update content_generation_suggestion_feedback
        set
          scheduled_post_id = coalesce($3::uuid, scheduled_post_id),
          scheduled_at = coalesce($4::timestamptz, scheduled_at, now()),
          updated_at = now()
        where business_id = $1::uuid
          and generated_asset_id = $2::uuid
      `,
      [input.businessId, input.assetId, input.scheduledPostId ?? null, input.scheduledAt ?? null],
    );
  } catch (error) {
    logError("Failed to record content generation suggestion scheduling.", {
      businessId: input.businessId,
      assetId: input.assetId,
      scheduledPostId: input.scheduledPostId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

export async function safeRecordContentGenerationSuggestionPublished(input: {
  businessId: string;
  assetId: string;
  scheduledPostId?: string | null;
  publishedAt?: string | null;
}): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await queryDb(
      `
        update content_generation_suggestion_feedback
        set
          scheduled_post_id = coalesce($3::uuid, scheduled_post_id),
          published_at = coalesce($4::timestamptz, published_at, now()),
          updated_at = now()
        where business_id = $1::uuid
          and generated_asset_id = $2::uuid
      `,
      [input.businessId, input.assetId, input.scheduledPostId ?? null, input.publishedAt ?? null],
    );
  } catch (error) {
    logError("Failed to record content generation suggestion publication.", {
      businessId: input.businessId,
      assetId: input.assetId,
      scheduledPostId: input.scheduledPostId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

export async function safeRecordContentGenerationSuggestionPerformance(input: {
  businessId: string;
  scheduledPostId: string;
  performanceLabel: PostPerformanceLabel;
}): Promise<void> {
  if (!isDatabaseConfigured()) {
    return;
  }

  try {
    await queryDb(
      `
        update content_generation_suggestion_feedback
        set
          performance_label = $3,
          performance_recorded_at = now(),
          updated_at = now()
        where business_id = $1::uuid
          and scheduled_post_id = $2::uuid
      `,
      [input.businessId, input.scheduledPostId, input.performanceLabel],
    );
  } catch (error) {
    logError("Failed to record content generation suggestion performance.", {
      businessId: input.businessId,
      scheduledPostId: input.scheduledPostId,
      performanceLabel: input.performanceLabel,
      error: error instanceof Error ? error.message : "unknown_error",
    });
  }
}
