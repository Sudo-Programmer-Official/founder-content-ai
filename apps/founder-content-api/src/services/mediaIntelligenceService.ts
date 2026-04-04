import type { QueryResultRow } from "pg";
import type {
  BusinessMediaProfile,
  BusinessMediaProfileType,
  DecisionRuleSummary,
  MediaPerformanceConfidenceBand,
  MediaPresetSummary,
  MediaPresetPerformanceSummary,
  MediaRecommendationContentType,
  MediaRecommendationGoal,
  MediaRecommendationSuggestion,
  MediaRecommendationsRequest,
  MediaRecommendationsResponse,
  MediaRuleMatchSummary,
  MediaSuggestionType,
  MediaTypePerformanceSummary,
  PromptTemplateSummary,
  RecordMediaPerformanceStatRequest,
  RecordMediaPerformanceStatResponse,
  UpdateBusinessMediaProfileRequest,
  UpdateBusinessMediaProfileResponse,
  WorkspaceMediaOptimizationSurfaceSummary,
  UpdateWorkspaceMediaOverrideRequest,
  UpdateWorkspaceMediaOverrideResponse,
  WorkspaceMediaResolutionRequest,
  WorkspaceMediaResolutionResponse,
  WorkspaceMediaIntelligenceResponse,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireBusinessMembership } from "./authBusinessService.ts";
import { queryDb } from "./db/client.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "./governanceService.ts";
import { HttpError } from "../utils/http.ts";

interface BusinessMediaProfileRow extends QueryResultRow {
  business_id: string;
  business_type: BusinessMediaProfileType;
  prefer_existing_assets: boolean;
  prefer_text_visuals: boolean;
  allow_generated_illustrations: boolean;
  avoid_realistic_people: boolean;
  allow_screenshot_highlights: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MediaPresetRow extends QueryResultRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  supported_business_types: unknown;
  supported_content_types: unknown;
  supported_goals: unknown;
  media_types: unknown;
  fallback_order: unknown;
  ui_label: string | null;
  priority: number;
  is_active: boolean;
  is_enabled_for_workspace: boolean | null;
  custom_prompt_template_id: string | null;
  custom_settings: unknown;
}

interface PromptMapRow extends QueryResultRow {
  media_preset_id: string;
  media_type: string;
  prompt_template_id: string;
}

interface PromptTemplateRow extends QueryResultRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  variables: unknown;
  notes: string | null;
  version: number;
  is_active: boolean;
}

interface DecisionRuleRow extends QueryResultRow {
  id: string;
  rule_name: string;
  rule_scope: "global" | "business_type" | "workspace";
  business_type: BusinessMediaProfileType | null;
  business_id: string | null;
  conditions: unknown;
  outputs: unknown;
  priority: number;
  is_active: boolean;
}

interface AssetAvailabilityRow extends QueryResultRow {
  id: string;
  asset_type: string;
  mime_type: string;
  created_at: Date | string;
}

interface MediaPresetPerformanceAggregateRow extends QueryResultRow {
  media_preset_id: string;
  surface: MediaRecommendationContentType | "visual_generation";
  sample_count: string | number;
  impressions_sum: string | number;
  clicks_sum: string | number;
  engagements_sum: string | number;
  conversions_sum: string | number;
  last_recorded_at: Date | string | null;
}

interface MediaTypePerformanceAggregateRow extends QueryResultRow {
  media_type: MediaSuggestionType;
  surface: MediaRecommendationContentType | "visual_generation";
  sample_count: string | number;
  impressions_sum: string | number;
  clicks_sum: string | number;
  engagements_sum: string | number;
  conversions_sum: string | number;
  last_recorded_at: Date | string | null;
}

interface MediaPresetPerformanceRow extends QueryResultRow {
  media_preset_id: string;
  media_preset_name: string | null;
  media_preset_slug: string | null;
  surface: MediaRecommendationContentType | "visual_generation";
  sample_count: string | number;
  impressions_sum: string | number;
  clicks_sum: string | number;
  engagements_sum: string | number;
  conversions_sum: string | number;
  avg_score: string | number;
  performance_weight: string | number;
  confidence_band: MediaPerformanceConfidenceBand;
  last_recorded_at: Date | string | null;
}

interface MediaTypePerformanceRow extends QueryResultRow {
  media_type: MediaSuggestionType;
  surface: MediaRecommendationContentType | "visual_generation";
  sample_count: string | number;
  impressions_sum: string | number;
  clicks_sum: string | number;
  engagements_sum: string | number;
  conversions_sum: string | number;
  avg_score: string | number;
  performance_weight: string | number;
  confidence_band: MediaPerformanceConfidenceBand;
  last_recorded_at: Date | string | null;
}

interface LatestGeneratedMediaRow extends QueryResultRow {
  media_preset_id: string | null;
  generated_media_type: MediaSuggestionType;
}

interface RegclassLookupRow extends QueryResultRow {
  relation_name: string | null;
}

async function hasMediaPerformanceRollupTables(): Promise<boolean> {
  const [presetTable, typeTable] = await Promise.all([
    queryDb<RegclassLookupRow>(
      `
        select to_regclass('public.workspace_media_preset_performance')::text as relation_name
      `,
    ),
    queryDb<RegclassLookupRow>(
      `
        select to_regclass('public.workspace_media_type_performance')::text as relation_name
      `,
    ),
  ]);

  return Boolean(presetTable.rows[0]?.relation_name && typeTable.rows[0]?.relation_name);
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateMediaScore(input: {
  impressions: number;
  clicks: number;
  engagements: number;
  conversions: number;
}): number {
  if (input.impressions <= 0) {
    return 0;
  }

  return Number(
    (
      (input.clicks + input.engagements * 2 + input.conversions * 3) /
      input.impressions
    ).toFixed(4),
  );
}

function resolveMediaPerformanceConfidenceBand(input: {
  sampleCount: number;
  impressions: number;
  engagements: number;
  conversions: number;
}): MediaPerformanceConfidenceBand {
  if (input.impressions >= 100 || input.conversions >= 4 || input.sampleCount >= 3) {
    return "high";
  }

  if (input.impressions >= 30 || input.engagements >= 8 || input.conversions >= 1) {
    return "medium";
  }

  return "low";
}

function calculateMediaPerformanceWeight(input: {
  avgScore: number;
  confidenceBand: MediaPerformanceConfidenceBand;
  impressions: number;
  clicks: number;
  engagements: number;
  conversions: number;
}): number {
  const confidenceMultiplier =
    input.confidenceBand === "high" ? 1 : input.confidenceBand === "medium" ? 0.82 : 0.6;
  const baseScore = input.avgScore * 100;
  const engagementBoost = Math.min(input.engagements * 0.35, 12);
  const clickBoost = Math.min(input.clicks * 0.2, 8);
  const conversionBoost = input.conversions * 4;
  const impressionFloor = Math.min(input.impressions / 40, 4);

  return Number(
    (
      (baseScore + engagementBoost + clickBoost + conversionBoost + impressionFloor) *
      confidenceMultiplier
    ).toFixed(4),
  );
}

function mapBusinessMediaProfile(row: BusinessMediaProfileRow): BusinessMediaProfile {
  return {
    businessId: row.business_id,
    businessType: row.business_type,
    preferExistingAssets: row.prefer_existing_assets,
    preferTextVisuals: row.prefer_text_visuals,
    allowGeneratedIllustrations: row.allow_generated_illustrations,
    avoidRealisticPeople: row.avoid_realistic_people,
    allowScreenshotHighlights: row.allow_screenshot_highlights,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapMediaPresetSummary(row: MediaPresetRow): MediaPresetSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    supportedBusinessTypes: normalizeStringArray(row.supported_business_types) as BusinessMediaProfileType[],
    supportedContentTypes: normalizeStringArray(row.supported_content_types) as MediaRecommendationContentType[],
    supportedGoals: normalizeStringArray(row.supported_goals) as MediaRecommendationGoal[],
    mediaTypes: normalizeStringArray(row.media_types) as MediaSuggestionType[],
    fallbackOrder: normalizeStringArray(row.fallback_order) as MediaSuggestionType[],
    uiLabel: row.ui_label ?? undefined,
    priority: row.priority,
    isActive: row.is_active,
    isEnabledForWorkspace: row.is_enabled_for_workspace ?? true,
    customPromptTemplateId: row.custom_prompt_template_id ?? undefined,
    customSettings: normalizeRecord(row.custom_settings),
  };
}

function mapPromptTemplateSummary(row: PromptTemplateRow): PromptTemplateSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    variables: normalizeStringArray(row.variables),
    notes: row.notes ?? undefined,
    version: row.version,
    isActive: row.is_active,
  };
}

function mapDecisionRuleSummary(row: DecisionRuleRow): DecisionRuleSummary {
  return {
    id: row.id,
    ruleName: row.rule_name,
    ruleScope: row.rule_scope,
    businessType: row.business_type ?? undefined,
    businessId: row.business_id ?? undefined,
    conditions: normalizeRecord(row.conditions),
    outputs: normalizeRecord(row.outputs),
    priority: row.priority,
    isActive: row.is_active,
  };
}

function mapMediaPresetPerformanceSummary(
  row: MediaPresetPerformanceRow,
): MediaPresetPerformanceSummary {
  return {
    mediaPresetId: row.media_preset_id,
    mediaPresetName: row.media_preset_name ?? undefined,
    mediaPresetSlug: row.media_preset_slug ?? undefined,
    surface: row.surface,
    sampleCount: toNumber(row.sample_count),
    impressions: toNumber(row.impressions_sum),
    clicks: toNumber(row.clicks_sum),
    engagements: toNumber(row.engagements_sum),
    conversions: toNumber(row.conversions_sum),
    avgScore: toNumber(row.avg_score),
    performanceWeight: toNumber(row.performance_weight),
    confidenceBand: row.confidence_band,
    lastRecordedAt: row.last_recorded_at ? toIsoString(row.last_recorded_at) : undefined,
  };
}

function mapMediaTypePerformanceSummary(
  row: MediaTypePerformanceRow,
): MediaTypePerformanceSummary {
  return {
    mediaType: row.media_type,
    surface: row.surface,
    sampleCount: toNumber(row.sample_count),
    impressions: toNumber(row.impressions_sum),
    clicks: toNumber(row.clicks_sum),
    engagements: toNumber(row.engagements_sum),
    conversions: toNumber(row.conversions_sum),
    avgScore: toNumber(row.avg_score),
    performanceWeight: toNumber(row.performance_weight),
    confidenceBand: row.confidence_band,
    lastRecordedAt: row.last_recorded_at ? toIsoString(row.last_recorded_at) : undefined,
  };
}

function inferBusinessTypeFromNiche(value: string | null | undefined): BusinessMediaProfileType {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (normalized.includes("daycare") || normalized.includes("child") || normalized.includes("kids")) {
    return "daycare";
  }

  if (normalized.includes("fitness") || normalized.includes("gym") || normalized.includes("trainer")) {
    return "fitness";
  }

  if (
    normalized.includes("saas") ||
    normalized.includes("software") ||
    normalized.includes("startup") ||
    normalized.includes("ai")
  ) {
    return "saas";
  }

  return "general";
}

async function ensureBusinessMediaProfile(businessId: string): Promise<BusinessMediaProfile> {
  const existing = await queryDb<BusinessMediaProfileRow>(
    `
      select
        business_id,
        business_type,
        prefer_existing_assets,
        prefer_text_visuals,
        allow_generated_illustrations,
        avoid_realistic_people,
        allow_screenshot_highlights,
        created_at,
        updated_at
      from business_media_profiles
      where business_id = $1
      limit 1
    `,
    [businessId],
  );

  if (existing.rows[0]) {
    return mapBusinessMediaProfile(existing.rows[0]);
  }

  const businessResult = await queryDb<{ niche: string | null }>(
    `
      select niche
      from businesses
      where id = $1
      limit 1
    `,
    [businessId],
  );

  const businessType = inferBusinessTypeFromNiche(businessResult.rows[0]?.niche);

  const inserted = await queryDb<BusinessMediaProfileRow>(
    `
      insert into business_media_profiles (
        business_id,
        business_type,
        prefer_existing_assets,
        prefer_text_visuals,
        allow_generated_illustrations,
        avoid_realistic_people,
        allow_screenshot_highlights
      ) values (
        $1,
        $2,
        true,
        false,
        true,
        true,
        true
      )
      on conflict (business_id)
      do update set
        business_type = excluded.business_type
      returning
        business_id,
        business_type,
        prefer_existing_assets,
        prefer_text_visuals,
        allow_generated_illustrations,
        avoid_realistic_people,
        allow_screenshot_highlights,
        created_at,
        updated_at
    `,
    [businessId, businessType],
  );

  return mapBusinessMediaProfile(inserted.rows[0]);
}

async function loadPresetSummaries(businessId: string): Promise<MediaPresetSummary[]> {
  const result = await queryDb<MediaPresetRow>(
    `
      select
        media_presets.id,
        media_presets.slug,
        media_presets.name,
        media_presets.description,
        media_presets.supported_business_types,
        media_presets.supported_content_types,
        media_presets.supported_goals,
        media_presets.media_types,
        media_presets.fallback_order,
        media_presets.ui_label,
        media_presets.priority,
        media_presets.is_active,
        workspace_media_overrides.is_enabled as is_enabled_for_workspace,
        workspace_media_overrides.custom_prompt_template_id,
        workspace_media_overrides.custom_settings
      from media_presets
      left join workspace_media_overrides
        on workspace_media_overrides.media_preset_id = media_presets.id
       and workspace_media_overrides.business_id = $1
      where media_presets.is_active = true
      order by media_presets.priority asc, media_presets.created_at asc
    `,
    [businessId],
  );

  return result.rows.map(mapMediaPresetSummary);
}

async function loadPromptMap(): Promise<Map<string, Map<MediaSuggestionType, string>>> {
  const result = await queryDb<PromptMapRow>(
    `
      select
        media_preset_id,
        media_type,
        prompt_template_id
      from media_preset_prompt_map
    `,
  );

  const mapping = new Map<string, Map<MediaSuggestionType, string>>();

  for (const row of result.rows) {
    const bucket = mapping.get(row.media_preset_id) ?? new Map<MediaSuggestionType, string>();
    bucket.set(row.media_type as MediaSuggestionType, row.prompt_template_id);
    mapping.set(row.media_preset_id, bucket);
  }

  return mapping;
}

async function loadPromptTemplates(): Promise<PromptTemplateSummary[]> {
  const result = await queryDb<PromptTemplateRow>(
    `
      select
        id,
        slug,
        name,
        category,
        variables,
        notes,
        version,
        is_active
      from prompt_templates
      where is_active = true
      order by category asc, name asc, version desc
    `,
  );

  return result.rows.map(mapPromptTemplateSummary);
}

async function loadDecisionRules(
  businessId: string,
  businessType: BusinessMediaProfileType,
): Promise<DecisionRuleRow[]> {
  const result = await queryDb<DecisionRuleRow>(
    `
      select
        id,
        rule_name,
        rule_scope,
        business_type,
        business_id,
        conditions,
        outputs,
        priority,
        is_active
      from decision_rules
      where is_active = true
        and (
          rule_scope = 'global'
          or (rule_scope = 'business_type' and business_type = $2)
          or (rule_scope = 'workspace' and business_id = $1)
        )
      order by priority asc, created_at asc
    `,
    [businessId, businessType],
  );

  return result.rows;
}

async function loadAvailableImageAssets(businessId: string): Promise<AssetAvailabilityRow[]> {
  const result = await queryDb<AssetAvailabilityRow>(
    `
      select
        id,
        asset_type,
        mime_type,
        created_at
      from workspace_assets
      where business_id = $1
        and is_active = true
        and asset_type in ('image', 'logo', 'screenshot')
      order by usage_count desc, created_at desc
    `,
    [businessId],
  );

  return result.rows;
}

async function refreshMediaPerformanceRollups(businessId: string): Promise<void> {
  if (!(await hasMediaPerformanceRollupTables())) {
    return;
  }

  const [presetAggregates, mediaTypeAggregates] = await Promise.all([
    queryDb<MediaPresetPerformanceAggregateRow>(
      `
        select
          media_preset_id,
          surface,
          count(*) as sample_count,
          coalesce(sum(impressions), 0) as impressions_sum,
          coalesce(sum(clicks), 0) as clicks_sum,
          coalesce(sum(engagements), 0) as engagements_sum,
          coalesce(sum(conversions), 0) as conversions_sum,
          max(updated_at) as last_recorded_at
        from media_performance_stats
        where business_id = $1
          and media_preset_id is not null
        group by media_preset_id, surface
      `,
      [businessId],
    ),
    queryDb<MediaTypePerformanceAggregateRow>(
      `
        select
          media_type,
          surface,
          count(*) as sample_count,
          coalesce(sum(impressions), 0) as impressions_sum,
          coalesce(sum(clicks), 0) as clicks_sum,
          coalesce(sum(engagements), 0) as engagements_sum,
          coalesce(sum(conversions), 0) as conversions_sum,
          max(updated_at) as last_recorded_at
        from media_performance_stats
        where business_id = $1
        group by media_type, surface
      `,
      [businessId],
    ),
  ]);

  await queryDb("delete from workspace_media_preset_performance where business_id = $1", [businessId]);
  await queryDb("delete from workspace_media_type_performance where business_id = $1", [businessId]);

  for (const row of presetAggregates.rows) {
    const impressions = toNumber(row.impressions_sum);
    const clicks = toNumber(row.clicks_sum);
    const engagements = toNumber(row.engagements_sum);
    const conversions = toNumber(row.conversions_sum);
    const sampleCount = toNumber(row.sample_count);
    const avgScore = calculateMediaScore({
      impressions,
      clicks,
      engagements,
      conversions,
    });
    const confidenceBand = resolveMediaPerformanceConfidenceBand({
      sampleCount,
      impressions,
      engagements,
      conversions,
    });
    const performanceWeight = calculateMediaPerformanceWeight({
      avgScore,
      confidenceBand,
      impressions,
      clicks,
      engagements,
      conversions,
    });

    await queryDb(
      `
        insert into workspace_media_preset_performance (
          business_id,
          media_preset_id,
          surface,
          sample_count,
          impressions_sum,
          clicks_sum,
          engagements_sum,
          conversions_sum,
          avg_score,
          performance_weight,
          confidence_band,
          last_recorded_at
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
          $12
        )
      `,
      [
        businessId,
        row.media_preset_id,
        row.surface,
        sampleCount,
        impressions,
        clicks,
        engagements,
        conversions,
        avgScore,
        performanceWeight,
        confidenceBand,
        row.last_recorded_at,
      ],
    );
  }

  for (const row of mediaTypeAggregates.rows) {
    const impressions = toNumber(row.impressions_sum);
    const clicks = toNumber(row.clicks_sum);
    const engagements = toNumber(row.engagements_sum);
    const conversions = toNumber(row.conversions_sum);
    const sampleCount = toNumber(row.sample_count);
    const avgScore = calculateMediaScore({
      impressions,
      clicks,
      engagements,
      conversions,
    });
    const confidenceBand = resolveMediaPerformanceConfidenceBand({
      sampleCount,
      impressions,
      engagements,
      conversions,
    });
    const performanceWeight = calculateMediaPerformanceWeight({
      avgScore,
      confidenceBand,
      impressions,
      clicks,
      engagements,
      conversions,
    });

    await queryDb(
      `
        insert into workspace_media_type_performance (
          business_id,
          media_type,
          surface,
          sample_count,
          impressions_sum,
          clicks_sum,
          engagements_sum,
          conversions_sum,
          avg_score,
          performance_weight,
          confidence_band,
          last_recorded_at
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
          $12
        )
      `,
      [
        businessId,
        row.media_type,
        row.surface,
        sampleCount,
        impressions,
        clicks,
        engagements,
        conversions,
        avgScore,
        performanceWeight,
        confidenceBand,
        row.last_recorded_at,
      ],
    );
  }
}

async function ensureMediaPerformanceRollups(businessId: string): Promise<void> {
  if (!(await hasMediaPerformanceRollupTables())) {
    return;
  }

  let hasPresetRollups;
  let hasTypeRollups;
  let hasRawStats;

  [hasPresetRollups, hasTypeRollups, hasRawStats] = await Promise.all([
    queryDb<{ id: string }>(
      `
        select id
        from workspace_media_preset_performance
        where business_id = $1
        limit 1
      `,
      [businessId],
    ),
    queryDb<{ id: string }>(
      `
        select id
        from workspace_media_type_performance
        where business_id = $1
        limit 1
      `,
      [businessId],
    ),
    queryDb<{ id: string }>(
      `
        select id
        from media_performance_stats
        where business_id = $1
        limit 1
      `,
      [businessId],
    ),
  ]);

  if (!hasRawStats.rows[0]) {
    return;
  }

  if (!hasPresetRollups.rows[0] || !hasTypeRollups.rows[0]) {
    await refreshMediaPerformanceRollups(businessId);
  }
}

async function loadPresetPerformanceRollups(
  businessId: string,
  surface?: MediaRecommendationContentType,
): Promise<MediaPresetPerformanceSummary[]> {
  if (!(await hasMediaPerformanceRollupTables())) {
    return [];
  }

  const result = await queryDb<MediaPresetPerformanceRow>(
    `
      select
        rollups.media_preset_id,
        media_presets.name as media_preset_name,
        media_presets.slug as media_preset_slug,
        rollups.surface,
        rollups.sample_count,
        rollups.impressions_sum,
        rollups.clicks_sum,
        rollups.engagements_sum,
        rollups.conversions_sum,
        rollups.avg_score,
        rollups.performance_weight,
        rollups.confidence_band,
        rollups.last_recorded_at
      from workspace_media_preset_performance rollups
      left join media_presets
        on media_presets.id = rollups.media_preset_id
      where rollups.business_id = $1
        and ($2::text is null or rollups.surface = $2)
      order by rollups.performance_weight desc, rollups.avg_score desc, rollups.updated_at desc
    `,
    [businessId, surface ?? null],
  );

  return result.rows.map(mapMediaPresetPerformanceSummary);
}

async function loadMediaTypePerformanceRollups(
  businessId: string,
  surface?: MediaRecommendationContentType,
): Promise<MediaTypePerformanceSummary[]> {
  if (!(await hasMediaPerformanceRollupTables())) {
    return [];
  }

  const result = await queryDb<MediaTypePerformanceRow>(
    `
      select
        media_type,
        surface,
        sample_count,
        impressions_sum,
        clicks_sum,
        engagements_sum,
        conversions_sum,
        avg_score,
        performance_weight,
        confidence_band,
        last_recorded_at
      from workspace_media_type_performance
      where business_id = $1
        and ($2::text is null or surface = $2)
      order by performance_weight desc, avg_score desc, updated_at desc
    `,
    [businessId, surface ?? null],
  );

  return result.rows.map(mapMediaTypePerformanceSummary);
}

function buildOptimizationSurfaceSummary(
  surface: MediaRecommendationContentType,
  presetPerformance: MediaPresetPerformanceSummary[],
  mediaTypePerformance: MediaTypePerformanceSummary[],
): WorkspaceMediaOptimizationSurfaceSummary {
  const sortedPresets = [...presetPerformance].sort(
    (left, right) => right.performanceWeight - left.performanceWeight || right.avgScore - left.avgScore,
  );
  const sortedMediaTypes = [...mediaTypePerformance].sort(
    (left, right) => right.performanceWeight - left.performanceWeight || right.avgScore - left.avgScore,
  );
  const weakPresets = [...presetPerformance]
    .filter((preset) => preset.impressions >= 20)
    .sort((left, right) => left.performanceWeight - right.performanceWeight || left.avgScore - right.avgScore)
    .slice(0, 2);
  const weakMediaTypes = [...mediaTypePerformance]
    .filter((mediaType) => mediaType.impressions >= 20)
    .sort((left, right) => left.performanceWeight - right.performanceWeight || left.avgScore - right.avgScore)
    .slice(0, 2);

  return {
    surface,
    topPreset: sortedPresets[0],
    topMediaType: sortedMediaTypes[0],
    strongPresets: sortedPresets.slice(0, 3),
    weakPresets,
    strongMediaTypes: sortedMediaTypes.slice(0, 3),
    weakMediaTypes,
  };
}

async function upsertMediaPerformanceStatRow(input: {
  businessId: string;
  mediaPresetId?: string | null;
  mediaType: MediaSuggestionType;
  surface: MediaRecommendationContentType | "visual_generation";
  impressions: number;
  clicks: number;
  engagements: number;
  conversions: number;
}): Promise<number> {
  const score = calculateMediaScore({
    impressions: input.impressions,
    clicks: input.clicks,
    engagements: input.engagements,
    conversions: input.conversions,
  });

  await queryDb(
    `
      insert into media_performance_stats (
        business_id,
        media_preset_id,
        media_type,
        surface,
        impressions,
        clicks,
        engagements,
        conversions,
        score
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9
      )
      on conflict (business_id, media_preset_id, media_type, surface)
      do update set
        impressions = excluded.impressions,
        clicks = excluded.clicks,
        engagements = excluded.engagements,
        conversions = excluded.conversions,
        score = excluded.score,
        updated_at = now()
    `,
    [
      input.businessId,
      input.mediaPresetId ?? null,
      input.mediaType,
      input.surface,
      input.impressions,
      input.clicks,
      input.engagements,
      input.conversions,
      score,
    ],
  );

  return score;
}

function evaluateRuleMatches(
  rules: DecisionRuleRow[],
  context: {
    businessType: BusinessMediaProfileType;
    contentType: MediaRecommendationContentType;
    goal: MediaRecommendationGoal;
    hasUploadedAssets: boolean;
  },
): {
  preferredAction?: string;
  recommendedMediaTypes: MediaSuggestionType[];
  disallowedMediaTypes: MediaSuggestionType[];
} {
  const recommendedMediaTypes: MediaSuggestionType[] = [];
  const disallowedMediaTypes: MediaSuggestionType[] = [];
  let preferredAction: string | undefined;

  for (const rule of rules) {
    const conditions = normalizeRecord(rule.conditions);
    const matches = Object.entries(conditions).every(([key, value]) => {
      if (key === "businessType") {
        return value === context.businessType;
      }

      if (key === "contentType") {
        return value === context.contentType;
      }

      if (key === "goal") {
        return value === context.goal;
      }

      if (key === "hasUploadedAssets") {
        return value === context.hasUploadedAssets;
      }

      return true;
    });

    if (!matches) {
      continue;
    }

    const outputs = normalizeRecord(rule.outputs);

    if (typeof outputs.recommendedAction === "string" && !preferredAction) {
      preferredAction = outputs.recommendedAction;
    }

    recommendedMediaTypes.push(
      ...(normalizeStringArray(outputs.recommendedMediaTypes) as MediaSuggestionType[]),
    );
    disallowedMediaTypes.push(
      ...(normalizeStringArray(outputs.disallowedMediaTypes) as MediaSuggestionType[]),
    );
  }

  return {
    preferredAction,
    recommendedMediaTypes: [...new Set(recommendedMediaTypes)],
    disallowedMediaTypes: [...new Set(disallowedMediaTypes)],
  };
}

function buildRuleMatchSummaries(
  rules: DecisionRuleRow[],
  context: {
    businessType: BusinessMediaProfileType;
    contentType: MediaRecommendationContentType;
    goal: MediaRecommendationGoal;
    hasUploadedAssets: boolean;
  },
): MediaRuleMatchSummary[] {
  const matches: MediaRuleMatchSummary[] = [];

  for (const rule of rules) {
    const conditions = normalizeRecord(rule.conditions);
    const isMatch = Object.entries(conditions).every(([key, value]) => {
      if (key === "businessType") {
        return value === context.businessType;
      }

      if (key === "contentType") {
        return value === context.contentType;
      }

      if (key === "goal") {
        return value === context.goal;
      }

      if (key === "hasUploadedAssets") {
        return value === context.hasUploadedAssets;
      }

      return true;
    });

    if (!isMatch) {
      continue;
    }

    const outputs = normalizeRecord(rule.outputs);

    matches.push({
      id: rule.id,
      ruleName: rule.rule_name,
      ruleScope: rule.rule_scope,
      priority: rule.priority,
      recommendedAction:
        typeof outputs.recommendedAction === "string" ? outputs.recommendedAction : undefined,
      recommendedMediaTypes:
        normalizeStringArray(outputs.recommendedMediaTypes) as MediaSuggestionType[],
      disallowedMediaTypes:
        normalizeStringArray(outputs.disallowedMediaTypes) as MediaSuggestionType[],
    });
  }

  return matches;
}

function supportsPreset(
  preset: MediaPresetSummary,
  input: {
    businessType: BusinessMediaProfileType;
    contentType: MediaRecommendationContentType;
    goal: MediaRecommendationGoal;
  },
): boolean {
  const businessTypeMatch =
    preset.supportedBusinessTypes.length === 0 || preset.supportedBusinessTypes.includes(input.businessType);
  const contentTypeMatch =
    preset.supportedContentTypes.length === 0 || preset.supportedContentTypes.includes(input.contentType);
  const goalMatch = preset.supportedGoals.length === 0 || preset.supportedGoals.includes(input.goal);

  return businessTypeMatch && contentTypeMatch && goalMatch && preset.isEnabledForWorkspace;
}

function mapMediaTypeToVisualTemplate(mediaType: MediaSuggestionType): import("../../../../packages/shared-types/index.ts").VisualTemplateType | undefined {
  switch (mediaType) {
    case "quote_card":
      return "quote";
    case "stat_card":
    case "photo_overlay":
      return "insight";
    case "framework_card":
      return "carousel";
    default:
      return undefined;
  }
}

function getMediaSuggestionLabel(mediaType: MediaSuggestionType): string {
  switch (mediaType) {
    case "quote_card":
      return "Quote card";
    case "stat_card":
      return "Stat card";
    case "framework_card":
      return "Carousel";
    case "photo_overlay":
      return "Brand image";
    case "screenshot_highlight":
      return "Screenshot highlight";
  }
}

async function resolveWorkspaceMediaConfigurationInternal(input: {
  businessId: string;
  contentType: MediaRecommendationContentType;
  goal?: MediaRecommendationGoal;
  hasUploadedAssets?: boolean;
}): Promise<WorkspaceMediaResolutionResponse> {
  const profile = await ensureBusinessMediaProfile(input.businessId);
  await ensureMediaPerformanceRollups(input.businessId);
  const [
    presets,
    promptMap,
    promptTemplates,
    availableAssets,
    decisionRules,
    presetPerformanceRollups,
    mediaTypePerformanceRollups,
  ] = await Promise.all([
    loadPresetSummaries(input.businessId),
    loadPromptMap(),
    loadPromptTemplates(),
    loadAvailableImageAssets(input.businessId),
    loadDecisionRules(input.businessId, profile.businessType),
    loadPresetPerformanceRollups(input.businessId, input.contentType),
    loadMediaTypePerformanceRollups(input.businessId, input.contentType),
  ]);
  const goal = input.goal ?? (input.contentType === "email" ? "conversion" : "authority");
  const hasUploadedAssets =
    typeof input.hasUploadedAssets === "boolean" ? input.hasUploadedAssets : availableAssets.length > 0;

  const ruleResolution = evaluateRuleMatches(decisionRules, {
    businessType: profile.businessType,
    contentType: input.contentType,
    goal,
    hasUploadedAssets,
  });
  const matchedRules = buildRuleMatchSummaries(decisionRules, {
    businessType: profile.businessType,
    contentType: input.contentType,
    goal,
    hasUploadedAssets,
  });

  const presetPerformanceById = new Map(
    presetPerformanceRollups.map((preset) => [preset.mediaPresetId, preset]),
  );
  const mediaTypePerformanceByType = new Map(
    mediaTypePerformanceRollups.map((mediaType) => [mediaType.mediaType, mediaType]),
  );

  const matchingPresets = presets
    .filter((preset) =>
      supportsPreset(preset, {
        businessType: profile.businessType,
        contentType: input.contentType,
        goal,
      }),
    )
    .sort((left, right) => {
      const leftPerformance = presetPerformanceById.get(left.id)?.performanceWeight ?? 0;
      const rightPerformance = presetPerformanceById.get(right.id)?.performanceWeight ?? 0;

      return rightPerformance - leftPerformance || left.priority - right.priority;
    });

  const candidateMediaTypes = [
    ...ruleResolution.recommendedMediaTypes,
    ...matchingPresets.flatMap((preset) =>
      preset.fallbackOrder.length > 0 ? preset.fallbackOrder : preset.mediaTypes),
  ];

  const disallowedMediaTypes = new Set<MediaSuggestionType>(ruleResolution.disallowedMediaTypes);

  if (!profile.allowScreenshotHighlights) {
    disallowedMediaTypes.add("screenshot_highlight");
  }

  let orderedMediaTypes = [...new Set(candidateMediaTypes)].filter((mediaType) => !disallowedMediaTypes.has(mediaType));

  if (
    input.goal === "conversion"
    && profile.businessType !== "saas"
    && profile.allowGeneratedIllustrations
    && !orderedMediaTypes.includes("photo_overlay")
  ) {
    orderedMediaTypes = ["photo_overlay", ...orderedMediaTypes];
  }

  if (profile.preferTextVisuals) {
    orderedMediaTypes = [
      ...orderedMediaTypes.filter((mediaType) => mediaType === "quote_card" || mediaType === "framework_card" || mediaType === "stat_card"),
      ...orderedMediaTypes.filter((mediaType) => mediaType !== "quote_card" && mediaType !== "framework_card" && mediaType !== "stat_card"),
    ];
  }

  if (!profile.allowGeneratedIllustrations) {
    orderedMediaTypes = orderedMediaTypes.filter((mediaType) => mediaType !== "photo_overlay");
  }

  const baseOrderIndex = new Map(orderedMediaTypes.map((mediaType, index) => [mediaType, index]));
  const textVisualTypes = new Set<MediaSuggestionType>([
    "quote_card",
    "framework_card",
    "stat_card",
  ]);
  orderedMediaTypes = [...orderedMediaTypes].sort((left, right) => {
    const leftPreferenceBucket =
      profile.preferTextVisuals && !textVisualTypes.has(left) ? 1 : 0;
    const rightPreferenceBucket =
      profile.preferTextVisuals && !textVisualTypes.has(right) ? 1 : 0;
    const leftPerformance = mediaTypePerformanceByType.get(left)?.performanceWeight ?? 0;
    const rightPerformance = mediaTypePerformanceByType.get(right)?.performanceWeight ?? 0;

    return (
      leftPreferenceBucket - rightPreferenceBucket ||
      rightPerformance - leftPerformance ||
      (baseOrderIndex.get(left) ?? 0) - (baseOrderIndex.get(right) ?? 0)
    );
  });

  const selectedPreset =
    matchingPresets.find((preset) => orderedMediaTypes.some((mediaType) => preset.mediaTypes.includes(mediaType)))
    ?? matchingPresets[0];
  const selectedPresetPerformance = selectedPreset
    ? presetPerformanceById.get(selectedPreset.id)
    : undefined;
  const mediaTypePerformance = orderedMediaTypes
    .map((mediaType) => mediaTypePerformanceByType.get(mediaType))
    .filter((value): value is MediaTypePerformanceSummary => Boolean(value));
  const boostedMediaTypes = mediaTypePerformance
    .filter((mediaType) => mediaType.performanceWeight > 0 && mediaType.confidenceBand !== "low")
    .slice(0, 3)
    .map((mediaType) => mediaType.mediaType);
  const deprioritizedMediaTypes = mediaTypePerformance
    .filter((mediaType) => mediaType.impressions >= 20 && mediaType.avgScore < 0.35)
    .sort((left, right) => left.performanceWeight - right.performanceWeight || left.avgScore - right.avgScore)
    .slice(0, 2)
    .map((mediaType) => mediaType.mediaType);
  const optimizationSummary = buildOptimizationSurfaceSummary(
    input.contentType,
    presetPerformanceRollups,
    mediaTypePerformanceRollups,
  );

  const promptSelections = orderedMediaTypes.map((mediaType) => {
    const owningPreset =
      matchingPresets.find((preset) => preset.mediaTypes.includes(mediaType))
      ?? selectedPreset;
    const templateId = owningPreset
      ? (owningPreset.customPromptTemplateId || promptMap.get(owningPreset.id)?.get(mediaType))
      : undefined;
    const template = templateId ? promptTemplates.find((candidate) => candidate.id === templateId) : undefined;

    return {
      mediaType,
      promptTemplateId: template?.id,
      promptTemplateSlug: template?.slug,
      promptTemplateName: template?.name,
      source: owningPreset?.customPromptTemplateId ? "workspace_override" as const : "default" as const,
    };
  });

  return {
    profile,
    availableAssetCount: availableAssets.length,
    hasUploadedAssets,
    preferredAction: ruleResolution.preferredAction,
    selectedPreset,
    matchingPresets,
    orderedMediaTypes,
    disallowedMediaTypes: [...disallowedMediaTypes],
    matchedRules,
    promptSelections,
    selectedPresetPerformance,
    mediaTypePerformance,
    boostedMediaTypes,
    deprioritizedMediaTypes,
    optimizationSummary,
  };
}

export async function getWorkspaceMediaIntelligence(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<WorkspaceMediaIntelligenceResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "visual_generation");
  await requireBusinessMembership(principal, businessId);

  const profile = await ensureBusinessMediaProfile(businessId);
  await ensureMediaPerformanceRollups(businessId);
  const [
    presets,
    promptTemplates,
    decisionRules,
    postPresetPerformance,
    postMediaTypePerformance,
    emailPresetPerformance,
    emailMediaTypePerformance,
  ] = await Promise.all([
    loadPresetSummaries(businessId),
    loadPromptTemplates(),
    loadDecisionRules(businessId, profile.businessType),
    loadPresetPerformanceRollups(businessId, "post"),
    loadMediaTypePerformanceRollups(businessId, "post"),
    loadPresetPerformanceRollups(businessId, "email"),
    loadMediaTypePerformanceRollups(businessId, "email"),
  ]);

  return {
    profile,
    presets,
    promptTemplates,
    decisionRules: decisionRules.map(mapDecisionRuleSummary),
    optimizationSummaries: [
      buildOptimizationSurfaceSummary("post", postPresetPerformance, postMediaTypePerformance),
      buildOptimizationSurfaceSummary("email", emailPresetPerformance, emailMediaTypePerformance),
    ],
  };
}

export async function resolveWorkspaceMediaConfiguration(
  principal: AuthenticatedPrincipal,
  input: WorkspaceMediaResolutionRequest,
): Promise<WorkspaceMediaResolutionResponse> {
  const businessId = input.businessId.trim();

  await enforceWorkspaceReadAccess(principal, businessId, "visual_generation");
  await requireBusinessMembership(principal, businessId);

  return resolveWorkspaceMediaConfigurationInternal({
    businessId,
    contentType: input.contentType,
    goal: input.goal,
    hasUploadedAssets: input.hasUploadedAssets,
  });
}

export async function updateBusinessMediaProfile(
  principal: AuthenticatedPrincipal,
  input: UpdateBusinessMediaProfileRequest,
): Promise<UpdateBusinessMediaProfileResponse> {
  const businessId = input.businessId.trim();

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "visual_generation",
  });
  await requireBusinessMembership(principal, businessId);

  const result = await queryDb<BusinessMediaProfileRow>(
    `
      insert into business_media_profiles (
        business_id,
        business_type,
        prefer_existing_assets,
        prefer_text_visuals,
        allow_generated_illustrations,
        avoid_realistic_people,
        allow_screenshot_highlights
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7
      )
      on conflict (business_id)
      do update set
        business_type = excluded.business_type,
        prefer_existing_assets = excluded.prefer_existing_assets,
        prefer_text_visuals = excluded.prefer_text_visuals,
        allow_generated_illustrations = excluded.allow_generated_illustrations,
        avoid_realistic_people = excluded.avoid_realistic_people,
        allow_screenshot_highlights = excluded.allow_screenshot_highlights,
        updated_at = now()
      returning
        business_id,
        business_type,
        prefer_existing_assets,
        prefer_text_visuals,
        allow_generated_illustrations,
        avoid_realistic_people,
        allow_screenshot_highlights,
        created_at,
        updated_at
    `,
    [
      businessId,
      input.businessType,
      input.preferExistingAssets,
      input.preferTextVisuals,
      input.allowGeneratedIllustrations,
      input.avoidRealisticPeople,
      input.allowScreenshotHighlights,
    ],
  );

  return {
    profile: mapBusinessMediaProfile(result.rows[0]),
  };
}

export async function updateWorkspaceMediaOverride(
  principal: AuthenticatedPrincipal,
  input: UpdateWorkspaceMediaOverrideRequest,
): Promise<UpdateWorkspaceMediaOverrideResponse> {
  const businessId = input.businessId.trim();

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "visual_generation",
  });
  await requireBusinessMembership(principal, businessId);

  await queryDb(
    `
      insert into workspace_media_overrides (
        business_id,
        media_preset_id,
        is_enabled,
        custom_prompt_template_id,
        custom_settings
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb
      )
      on conflict (business_id, media_preset_id)
      do update set
        is_enabled = excluded.is_enabled,
        custom_prompt_template_id = excluded.custom_prompt_template_id,
        custom_settings = excluded.custom_settings,
        updated_at = now()
    `,
    [
      businessId,
      input.mediaPresetId,
      input.isEnabled,
      input.customPromptTemplateId?.trim() || null,
      JSON.stringify(input.customSettings ?? {}),
    ],
  );

  const presets = await loadPresetSummaries(businessId);
  const preset = presets.find((candidate) => candidate.id === input.mediaPresetId);

  if (!preset) {
    throw new HttpError(404, "media_preset_not_found", "Media preset not found.");
  }

  return {
    preset,
  };
}

export async function getMediaRecommendations(
  principal: AuthenticatedPrincipal,
  input: MediaRecommendationsRequest,
): Promise<MediaRecommendationsResponse> {
  const businessId = input.businessId.trim();

  await enforceWorkspaceReadAccess(principal, businessId, "visual_generation");
  await requireBusinessMembership(principal, businessId);

  const resolution = await resolveWorkspaceMediaConfigurationInternal({
    businessId,
    contentType: input.contentType,
    goal: input.goal,
  });
  const { profile, availableAssetCount } = resolution;
  const orderedMediaTypes = resolution.orderedMediaTypes;
  const recommendedAssetIds = (await loadAvailableImageAssets(businessId)).slice(0, 4).map((asset) => asset.id);
  const promptSelectionMap = new Map(resolution.promptSelections.map((selection) => [selection.mediaType, selection]));

  const suggestions: MediaRecommendationSuggestion[] = [];

  if (
    (profile.preferExistingAssets || resolution.preferredAction === "use_existing_asset") &&
    recommendedAssetIds.length > 0
  ) {
    suggestions.push({
      id: "use-existing-asset",
      actionType: "use_existing_asset",
      title: "Use an existing workspace asset",
      description: "You already have media in the workspace hub. Reuse it before generating something new.",
      reason: "Existing assets are the safest path and keep visuals tied to the real brand surface.",
      recommendedAssetIds,
    });
  }

  for (const mediaType of orderedMediaTypes) {
    const visualTemplateType = mapMediaTypeToVisualTemplate(mediaType);

    if (!visualTemplateType) {
      continue;
    }

    const preset = resolution.matchingPresets.find((candidate) => candidate.mediaTypes.includes(mediaType));
    const promptSelection = promptSelectionMap.get(mediaType);

    if (!preset && mediaType !== "photo_overlay") {
      continue;
    }

    suggestions.push({
      id: `generate-${mediaType}`,
      actionType: "generate_visual",
      title: `Generate ${getMediaSuggestionLabel(mediaType)}`,
      description: preset
        ? `Use the ${preset.uiLabel || preset.name} preset to create a safe, context-aware visual.`
        : "Create a realistic branded image with room for headline overlay and a stronger promotional feel.",
      reason:
        mediaType === "framework_card"
          ? "This content is structured enough to become a 3-5 slide carousel with a clear narrative flow."
          : mediaType === "photo_overlay"
            ? "A realistic lifestyle image makes the offer feel local, trustworthy, and easier to act on."
          : mediaType === "stat_card"
            ? "A compact stat-style visual can add proof without making the post feel overproduced."
            : "A quote-style card keeps the message text-first and brand-safe.",
      suggestedMediaType: mediaType,
      visualTemplateType,
      mediaPresetId: preset?.id,
      mediaPresetSlug: preset?.slug,
      promptTemplateId: promptSelection?.promptTemplateId,
      recommendedAssetIds: [],
    });
  }

  suggestions.push({
    id: "skip-media",
    actionType: "skip",
    title: "Skip media for now",
    description: "Keep this text-first and come back if the post needs more visual support.",
    reason: "Not every post earns a visual. The safest media decision can be no media at all.",
    recommendedAssetIds: [],
  });

  return {
    profile,
    suggestions: suggestions.slice(0, 4),
    availableAssetCount,
  };
}

export async function recordMediaGenerationLog(input: {
  businessId: string;
  contentAssetId?: string;
  mediaPresetId?: string;
  promptTemplateId?: string;
  generatedMediaType: string;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  status: "completed" | "failed";
  errorMessage?: string;
}): Promise<void> {
  await queryDb(
    `
      insert into media_generation_logs (
        business_id,
        content_asset_id,
        media_preset_id,
        prompt_template_id,
        generated_media_type,
        input_payload,
        output_payload,
        status,
        error_message
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        $7::jsonb,
        $8,
        $9
      )
    `,
    [
      input.businessId,
      input.contentAssetId ?? null,
      input.mediaPresetId ?? null,
      input.promptTemplateId ?? null,
      input.generatedMediaType,
      JSON.stringify(input.inputPayload),
      JSON.stringify(input.outputPayload),
      input.status,
      input.errorMessage ?? null,
    ],
  );
}

export async function recordMediaPerformanceStat(
  principal: AuthenticatedPrincipal,
  input: RecordMediaPerformanceStatRequest,
): Promise<RecordMediaPerformanceStatResponse> {
  const businessId = input.businessId.trim();

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "visual_generation",
  });
  await requireBusinessMembership(principal, businessId);

  const impressions = Math.max(0, input.impressions ?? 0);
  const clicks = Math.max(0, input.clicks ?? 0);
  const engagements = Math.max(0, input.engagements ?? 0);
  const conversions = Math.max(0, input.conversions ?? 0);
  const score = await upsertMediaPerformanceStatRow({
    businessId,
    mediaPresetId: input.mediaPresetId ?? null,
    mediaType: input.mediaType,
    surface: input.surface,
    impressions,
    clicks,
    engagements,
    conversions,
  });
  await refreshMediaPerformanceRollups(businessId);

  return { score };
}

export async function recordDerivedMediaPerformanceFromPostFeedback(input: {
  businessId: string;
  contentAssetId?: string | null;
  engagementScore: number;
}): Promise<void> {
  if (!input.contentAssetId) {
    return;
  }

  const latestGeneratedMedia = await queryDb<LatestGeneratedMediaRow>(
    `
      select
        media_preset_id,
        generated_media_type
      from media_generation_logs
      where business_id = $1
        and content_asset_id = $2
        and status = 'completed'
      order by created_at desc
      limit 1
    `,
    [input.businessId, input.contentAssetId],
  );

  const generatedMedia = latestGeneratedMedia.rows[0];

  if (!generatedMedia?.media_preset_id || !generatedMedia.generated_media_type) {
    return;
  }

  const clampedScore = Math.max(0, Math.min(1, input.engagementScore));
  const impressions = 100;
  const engagements = Math.max(0, Math.round(clampedScore * 30));
  const clicks = Math.max(0, Math.round(clampedScore * 20));
  const conversions = Math.max(0, Math.round(clampedScore * 7));

  await upsertMediaPerformanceStatRow({
    businessId: input.businessId,
    mediaPresetId: generatedMedia.media_preset_id,
    mediaType: generatedMedia.generated_media_type,
    surface: "post",
    impressions,
    clicks,
    engagements,
    conversions,
  });
  await refreshMediaPerformanceRollups(input.businessId);
}
