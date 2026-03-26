import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryResultRow } from "pg";
import { generateCompletion } from "../../../../../packages/ai-core/src/generateCompletion.ts";
import { buildBrandAlignedImagePrompt } from "../../../../../packages/content-engine/src/index.ts";
import { brandIntelligencePromptFiles } from "../../../../../packages/prompts/index.ts";
import type {
  BrandProfile,
  BrandProfileQuery,
  BrandProfileResponse,
  BrandPromptContext,
  BrandSignalSummary,
  ContentAsset,
  OnboardingChannel,
  OnboardingGoal,
  SourceItemAnalysis,
  TrendSignal,
  UpdateBrandProfileRequest,
  UpdateBrandProfileResponse,
} from "../../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../../middleware/auth.ts";
import { requireBusinessMembership } from "../authBusinessService.ts";
import { queryDb } from "../db/client.ts";
import { getCompetitiveIntelligenceSnapshot } from "../competitiveIntelligence/service.ts";
import { logWarn } from "../../utils/logger.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");

interface BrandProfileRow extends QueryResultRow {
  id: string;
  business_id: string;
  industry: string | null;
  preferred_tone: string | null;
  target_channels: unknown;
  goals: unknown;
  tone: string | null;
  writing_style: string | null;
  visual_style: string | null;
  topics: unknown;
  patterns: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SourceItemAnalysisRow extends QueryResultRow {
  topic: string;
  hook_type: string;
  tone: string;
  format: string;
  why_it_might_work: string;
  confidence: number | string;
}

interface TrendSignalRow extends QueryResultRow {
  topic: string;
  window_days: 7 | 30;
  source_item_count: number | string;
  momentum: number | string;
  engagement_weighted_trend_score: number | string;
  sample_hook_types: unknown;
}

interface ContentAssetRow extends QueryResultRow {
  content_type: string;
  content_body: unknown;
}

interface ExtractedBrandSignals {
  analyses: SourceItemAnalysis[];
  trends: TrendSignal[];
  contentAssets: ContentAsset[];
  signalSummary: BrandSignalSummary;
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseStringArray<TValue extends string>(value: unknown): TValue[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is TValue => typeof entry === "string");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is TValue => typeof entry === "string")
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

function uniqueValues<TValue extends string>(values: TValue[]): TValue[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))] as TValue[];
}

function mapBrandProfile(row: BrandProfileRow): BrandProfile {
  return {
    id: row.id,
    businessId: row.business_id,
    industry: row.industry ?? undefined,
    preferredTone: (row.preferred_tone as BrandProfile["preferredTone"]) ?? undefined,
    targetChannels: parseStringArray<OnboardingChannel>(row.target_channels),
    goals: parseStringArray<OnboardingGoal>(row.goals),
    tone: row.tone ?? undefined,
    writingStyle: row.writing_style ?? undefined,
    visualStyle: row.visual_style ?? undefined,
    topics: parseStringArray<string>(row.topics),
    patterns: parseStringArray<string>(row.patterns),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function isMissingOptionalTable(error: unknown): boolean {
  const candidate = error as { code?: string };
  return candidate?.code === "42P01" || candidate?.code === "42703";
}

async function queryOptionalRows<TRow extends QueryResultRow>(
  text: string,
  values: unknown[],
  warningLabel: string,
): Promise<TRow[]> {
  try {
    const result = await queryDb<TRow>(text, values);
    return result.rows;
  } catch (error) {
    if (isMissingOptionalTable(error)) {
      logWarn(`Skipping optional brand intelligence query for ${warningLabel}.`, {
        statement: warningLabel,
      });
      return [];
    }

    throw error;
  }
}

async function loadBrandProfileRecord(businessId: string): Promise<BrandProfile | null> {
  const result = await queryDb<BrandProfileRow>(
    `
      select
        id,
        business_id,
        industry,
        preferred_tone,
        target_channels,
        goals,
        tone,
        writing_style,
        visual_style,
        topics,
        patterns,
        created_at,
        updated_at
      from brand_profiles
      where business_id = $1
      limit 1
    `,
    [businessId],
  );

  return result.rows[0] ? mapBrandProfile(result.rows[0]) : null;
}

function extractTextFragments(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractTextFragments(entry));
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((entry) =>
      extractTextFragments(entry),
    );
  }

  return [];
}

function summarizeTextStyle(texts: string[]): string {
  if (texts.length === 0) {
    return "clear founder insights with readable short paragraphs";
  }

  const joined = texts.join("\n");
  const lines = joined
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const shortLineCount = lines.filter((line) => line.length <= 70).length;
  const bulletCount = lines.filter((line) => /^[-*•\d]/.test(line)).length;
  const questionCount = (joined.match(/\?/g) ?? []).length;

  if (bulletCount >= 4) {
    return "list-led breakdowns with clear takeaway lines";
  }

  if (shortLineCount >= Math.max(4, Math.ceil(lines.length * 0.6))) {
    return "short punchy lines with fast scan-friendly spacing";
  }

  if (questionCount >= 2) {
    return "conversational paragraphs with tension-building questions";
  }

  return "structured narrative paragraphs with practical lessons";
}

function countEntries(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();

  for (const value of values) {
    const normalized = value.trim();

    if (!normalized) {
      continue;
    }

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
}

function toDisplayToneLabel(value: string): string {
  switch (value) {
    case "analytical":
      return "analytical";
    case "educational":
      return "educational";
    case "storytelling":
      return "storytelling";
    case "contrarian":
      return "contrarian";
    case "conversational":
      return "conversational";
    case "promotional":
      return "promotional";
    case "bold":
      return "bold";
    case "friendly":
      return "friendly";
    case "professional":
      return "professional";
    default:
      return value;
  }
}

function inferTone(
  profile: BrandProfile | null,
  analyses: SourceItemAnalysis[],
): string {
  const preferred = normalizeOptionalString(profile?.tone) ?? normalizeOptionalString(profile?.preferredTone);

  const topTones = countEntries(analyses.map((analysis) => analysis.tone))
    .slice(0, 2)
    .map(([tone]) => toDisplayToneLabel(tone));

  if (preferred && topTones.length > 0) {
    return uniqueValues([preferred, ...topTones]).slice(0, 2).join(" + ");
  }

  if (preferred) {
    return preferred;
  }

  if (topTones.length > 0) {
    return topTones.join(" + ");
  }

  return "professional + educational";
}

function inferTopics(
  profile: BrandProfile | null,
  analyses: SourceItemAnalysis[],
  trends: TrendSignal[],
): string[] {
  const trendTopics = trends
    .sort((left, right) => right.engagementWeightedTrendScore - left.engagementWeightedTrendScore)
    .map((trend) => trend.topic);
  const analysisTopics = countEntries(analyses.map((analysis) => analysis.topic)).map(([topic]) => topic);

  return uniqueValues([
    ...(profile?.topics ?? []),
    ...(profile?.industry ? [profile.industry] : []),
    ...trendTopics,
    ...analysisTopics,
  ]).slice(0, 5);
}

function inferPatterns(
  profile: BrandProfile | null,
  analyses: SourceItemAnalysis[],
  trends: TrendSignal[],
  writingStyle: string,
): string[] {
  const hookTypePatterns = countEntries(analyses.map((analysis) => analysis.hookType))
    .slice(0, 3)
    .map(([hookType]) => {
      switch (hookType) {
        case "contrarian":
          return "contrarian statement -> lesson -> CTA";
        case "story":
          return "story hook -> insight -> CTA";
        case "how-to":
          return "how-to hook -> steps -> takeaway";
        case "list":
          return "list hook -> lessons -> CTA";
        case "question":
          return "question hook -> answer -> CTA";
        case "curiosity":
          return "curiosity hook -> insight -> CTA";
        case "data":
          return "data point -> interpretation -> CTA";
        default:
          return "hook -> insight -> CTA";
      }
    });

  const trendPatterns = trends
    .flatMap((trend) => trend.sampleHookTypes)
    .slice(0, 3)
    .map((hookType) => {
      if (hookType === "contrarian") {
        return "contrarian take -> supporting point -> CTA";
      }

      if (hookType === "list") {
        return "numbered insight -> takeaway -> CTA";
      }

      return "hook -> insight -> CTA";
    });

  return uniqueValues([
    ...(profile?.patterns ?? []),
    ...hookTypePatterns,
    ...trendPatterns,
    writingStyle.includes("list") ? "framework -> breakdown -> takeaway" : "hook -> insight -> CTA",
  ]).slice(0, 4);
}

function inferVisualStyle(
  profile: BrandProfile | null,
  tone: string,
  topics: string[],
): string {
  if (normalizeOptionalString(profile?.visualStyle)) {
    return profile!.visualStyle!;
  }

  const loweredTone = tone.toLowerCase();
  const loweredTopics = topics.join(" ").toLowerCase();

  if (loweredTone.includes("contrarian") || loweredTone.includes("bold")) {
    return "dark minimal + bold typography";
  }

  if (loweredTone.includes("professional") || loweredTone.includes("analytical") || loweredTone.includes("educational")) {
    return "clean editorial + high contrast typography";
  }

  if (loweredTone.includes("friendly") || loweredTone.includes("story")) {
    return "warm minimal + human-centered editorial";
  }

  if (loweredTopics.includes("ai") || loweredTopics.includes("startup")) {
    return "minimal tech + sharp contrast typography";
  }

  return "clean minimal + bold editorial layout";
}

function toBrandPromptContext(profile: BrandProfile): BrandPromptContext {
  return {
    tone: profile.tone ?? profile.preferredTone,
    writingStyle: profile.writingStyle,
    visualStyle: profile.visualStyle,
    topics: profile.topics,
    patterns: profile.patterns,
  };
}

function summarizeAnalyses(analyses: SourceItemAnalysis[]): string {
  if (analyses.length === 0) {
    return "No competitor analysis signals available.";
  }

  return analyses
    .slice(0, 12)
    .map(
      (analysis) =>
        `${analysis.topic} | tone=${analysis.tone} | hook=${analysis.hookType} | format=${analysis.format}`,
    )
    .join("\n");
}

function summarizeTrends(trends: TrendSignal[]): string {
  if (trends.length === 0) {
    return "No trend signals available.";
  }

  return trends
    .slice(0, 10)
    .map(
      (trend) =>
        `${trend.topic} | window=${trend.windowDays}d | score=${trend.engagementWeightedTrendScore} | momentum=${trend.momentum}`,
    )
    .join("\n");
}

function summarizeContentAssets(contentAssets: ContentAsset[]): string {
  if (contentAssets.length === 0) {
    return "No generated content history available.";
  }

  const texts = contentAssets
    .slice(0, 12)
    .flatMap((asset) => extractTextFragments(asset.contentBody))
    .map((text) => text.slice(0, 240))
    .filter((text) => text !== "");

  return texts.length > 0 ? texts.join("\n---\n") : "No content text available.";
}

function clampList(values: string[] | undefined, fallback: string[]): string[] {
  return uniqueValues(values && values.length > 0 ? values : fallback).slice(0, 5);
}

async function loadBrandExtractionPrompt(): Promise<string> {
  return readFile(path.resolve(repoRoot, brandIntelligencePromptFiles.brandProfileExtractor), "utf8");
}

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function buildPrompt(template: string, variables: Record<string, string | undefined>): string {
  const filteredVariables = Object.fromEntries(
    Object.entries(variables).filter(([, value]) => typeof value === "string" && value.trim() !== ""),
  );

  return [
    template.trim(),
    "",
    "USER INPUT",
    JSON.stringify(filteredVariables, null, 2),
    "",
    "RESPONSE RULES",
    "- Return only valid JSON.",
    "- Do not wrap the JSON in markdown code fences.",
  ].join("\n");
}

async function refineBrandProfileWithAI(
  businessId: string,
  existingProfile: BrandProfile | null,
  signals: ExtractedBrandSignals,
  heuristics: BrandPromptContext,
): Promise<BrandPromptContext | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  try {
    const template = await loadBrandExtractionPrompt();
    const prompt = buildPrompt(template, {
      business_id: businessId,
      business_context: JSON.stringify({
        industry: existingProfile?.industry,
        preferredTone: existingProfile?.preferredTone,
        targetChannels: existingProfile?.targetChannels ?? [],
        goals: existingProfile?.goals ?? [],
        currentProfile: heuristics,
      }),
      signal_summary: JSON.stringify(signals.signalSummary),
      competitor_analysis_summary: summarizeAnalyses(signals.analyses),
      trend_summary: summarizeTrends(signals.trends),
      content_asset_summary: summarizeContentAssets(signals.contentAssets),
    });
    const completion = await generateCompletion(prompt);
    const parsed = JSON.parse(stripCodeFences(completion)) as Record<string, unknown>;

    return {
      tone: normalizeOptionalString(typeof parsed.tone === "string" ? parsed.tone : undefined),
      writingStyle: normalizeOptionalString(
        typeof parsed.writing_style === "string" ? parsed.writing_style : undefined,
      ),
      visualStyle: normalizeOptionalString(
        typeof parsed.visual_style === "string" ? parsed.visual_style : undefined,
      ),
      topics: clampList(parseStringArray<string>(parsed.topics), heuristics.topics ?? []),
      patterns: clampList(parseStringArray<string>(parsed.patterns), heuristics.patterns ?? []),
    };
  } catch (error) {
    logWarn("Falling back to heuristic brand profile extraction.", {
      businessId,
      message: error instanceof Error ? error.message : "Unknown extraction error.",
    });
    return null;
  }
}

async function loadBrandSignals(businessId: string): Promise<ExtractedBrandSignals> {
  const runtimeSnapshot = getCompetitiveIntelligenceSnapshot(businessId);
  const [dbAnalysesRows, dbTrendsRows, contentAssetRows] = await Promise.all([
    queryOptionalRows<SourceItemAnalysisRow>(
      `
        select
          topic,
          hook_type,
          tone,
          format,
          why_it_might_work,
          confidence
        from source_item_analysis
        where business_id = $1
        order by updated_at desc
        limit 50
      `,
      [businessId],
      "source_item_analysis",
    ),
    queryOptionalRows<TrendSignalRow>(
      `
        select
          topic,
          window_days,
          source_item_count,
          momentum,
          engagement_weighted_trend_score,
          sample_hook_types
        from trend_signals
        where business_id = $1
        order by generated_at desc, engagement_weighted_trend_score desc
        limit 20
      `,
      [businessId],
      "trend_signals",
    ),
    queryOptionalRows<ContentAssetRow>(
      `
        select
          content_type,
          content_body
        from content_assets
        where business_id = $1
        order by created_at desc
        limit 30
      `,
      [businessId],
      "content_assets",
    ),
  ]);

  const dbAnalyses: SourceItemAnalysis[] = dbAnalysesRows.map((row, index) => ({
    id: `db-analysis-${index}`,
    businessId,
    sourceItemId: `db-item-${index}`,
    topic: row.topic,
    hookType: row.hook_type as SourceItemAnalysis["hookType"],
    tone: row.tone as SourceItemAnalysis["tone"],
    format: row.format as SourceItemAnalysis["format"],
    whyItMightWork: row.why_it_might_work,
    confidence: Number(row.confidence ?? 0.5),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  const dbTrends: TrendSignal[] = dbTrendsRows.map((row, index) => ({
    id: `db-trend-${index}`,
    businessId,
    topic: row.topic,
    windowDays: row.window_days,
    sourceItemCount: Number(row.source_item_count ?? 0),
    momentum: Number(row.momentum ?? 0),
    engagementWeightedTrendScore: Number(row.engagement_weighted_trend_score ?? 0),
    sampleHookTypes: parseStringArray<TrendSignal["sampleHookTypes"][number]>(row.sample_hook_types),
    generatedAt: new Date().toISOString(),
  }));

  const analyses = [...runtimeSnapshot.analyses, ...dbAnalyses];
  const trends = [...runtimeSnapshot.trends7d, ...runtimeSnapshot.trends30d, ...dbTrends];
  const contentAssets: ContentAsset[] = contentAssetRows.map((row, index) => ({
    id: `content-asset-${index}`,
    businessId,
    contentType: row.content_type as ContentAsset["contentType"],
    contentBody: row.content_body,
    status: "draft",
    createdAt: new Date().toISOString(),
  }));

  return {
    analyses,
    trends,
    contentAssets,
    signalSummary: {
      competitorAnalyses: analyses.length,
      trendSignals: trends.length,
      contentAssets: contentAssets.length,
    },
  };
}

async function upsertBrandProfile(input: {
  businessId: string;
  existingProfile: BrandProfile | null;
  tone?: string;
  writingStyle?: string;
  visualStyle?: string;
  topics?: string[];
  patterns?: string[];
}): Promise<BrandProfile> {
  const result = await queryDb<BrandProfileRow>(
    `
      insert into brand_profiles (
        business_id,
        industry,
        preferred_tone,
        target_channels,
        goals,
        tone,
        writing_style,
        visual_style,
        topics,
        patterns
      ) values (
        $1,
        $2,
        $3,
        $4::jsonb,
        $5::jsonb,
        $6,
        $7,
        $8,
        $9::jsonb,
        $10::jsonb
      )
      on conflict (business_id)
      do update set
        industry = excluded.industry,
        preferred_tone = excluded.preferred_tone,
        target_channels = excluded.target_channels,
        goals = excluded.goals,
        tone = excluded.tone,
        writing_style = excluded.writing_style,
        visual_style = excluded.visual_style,
        topics = excluded.topics,
        patterns = excluded.patterns,
        updated_at = now()
      returning
        id,
        business_id,
        industry,
        preferred_tone,
        target_channels,
        goals,
        tone,
        writing_style,
        visual_style,
        topics,
        patterns,
        created_at,
        updated_at
    `,
    [
      input.businessId,
      input.existingProfile?.industry ?? null,
      input.existingProfile?.preferredTone ?? null,
      JSON.stringify(input.existingProfile?.targetChannels ?? []),
      JSON.stringify(input.existingProfile?.goals ?? []),
      input.tone ?? input.existingProfile?.tone ?? input.existingProfile?.preferredTone ?? null,
      input.writingStyle ?? input.existingProfile?.writingStyle ?? null,
      input.visualStyle ?? input.existingProfile?.visualStyle ?? null,
      JSON.stringify(clampList(input.topics, input.existingProfile?.topics ?? [])),
      JSON.stringify(clampList(input.patterns, input.existingProfile?.patterns ?? [])),
    ],
  );

  return mapBrandProfile(result.rows[0]);
}

async function ensureBrandProfileFromSignals(businessId: string): Promise<{
  brandProfile: BrandProfile;
  signalSummary: BrandSignalSummary;
}> {
  const existingProfile = await loadBrandProfileRecord(businessId);
  const signals = await loadBrandSignals(businessId);

  const contentTexts = signals.contentAssets.flatMap((asset) => extractTextFragments(asset.contentBody));
  const writingStyle =
    normalizeOptionalString(existingProfile?.writingStyle) ?? summarizeTextStyle(contentTexts);
  const tone = inferTone(existingProfile, signals.analyses);
  const topics = inferTopics(existingProfile, signals.analyses, signals.trends);
  const patterns = inferPatterns(existingProfile, signals.analyses, signals.trends, writingStyle);
  const visualStyle = inferVisualStyle(existingProfile, tone, topics);

  const heuristicProfile: BrandPromptContext = {
    tone,
    writingStyle,
    visualStyle,
    topics,
    patterns,
  };

  const aiProfile = await refineBrandProfileWithAI(
    businessId,
    existingProfile,
    signals,
    heuristicProfile,
  );

  const brandProfile = await upsertBrandProfile({
    businessId,
    existingProfile,
    tone: aiProfile?.tone ?? heuristicProfile.tone,
    writingStyle: aiProfile?.writingStyle ?? heuristicProfile.writingStyle,
    visualStyle: aiProfile?.visualStyle ?? heuristicProfile.visualStyle,
    topics: aiProfile?.topics ?? heuristicProfile.topics,
    patterns: aiProfile?.patterns ?? heuristicProfile.patterns,
  });

  return {
    brandProfile,
    signalSummary: signals.signalSummary,
  };
}

function parseRefreshFlag(value: BrandProfileQuery["refreshFromSignals"] | boolean | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true";
  }

  return false;
}

export async function getBrandProfile(
  principal: AuthenticatedPrincipal,
  query: BrandProfileQuery,
): Promise<BrandProfileResponse> {
  await requireBusinessMembership(principal, query.businessId);

  const existingProfile = await loadBrandProfileRecord(query.businessId);
  const needsRefresh =
    parseRefreshFlag(query.refreshFromSignals) ||
    !existingProfile ||
    !existingProfile.tone ||
    !existingProfile.writingStyle ||
    !existingProfile.visualStyle ||
    existingProfile.topics.length === 0 ||
    existingProfile.patterns.length === 0;

  const result = needsRefresh
    ? await ensureBrandProfileFromSignals(query.businessId)
    : {
        brandProfile: existingProfile,
        signalSummary: {
          competitorAnalyses: 0,
          trendSignals: 0,
          contentAssets: 0,
        },
      };

  return {
    brandProfile: result.brandProfile,
    visualPromptTemplate: buildBrandAlignedImagePrompt(
      "Create a brand-aligned LinkedIn visual.",
      toBrandPromptContext(result.brandProfile),
    ),
    signalSummary: result.signalSummary,
  };
}

export async function updateBrandProfile(
  principal: AuthenticatedPrincipal,
  input: UpdateBrandProfileRequest,
): Promise<UpdateBrandProfileResponse> {
  await requireBusinessMembership(principal, input.businessId);

  const baseResult =
    input.refreshFromSignals === false
      ? {
          brandProfile: await loadBrandProfileRecord(input.businessId),
          signalSummary: {
            competitorAnalyses: 0,
            trendSignals: 0,
            contentAssets: 0,
          },
        }
      : await ensureBrandProfileFromSignals(input.businessId);

  const updatedProfile = await upsertBrandProfile({
    businessId: input.businessId,
    existingProfile: baseResult.brandProfile,
    tone: normalizeOptionalString(input.tone) ?? baseResult.brandProfile?.tone,
    writingStyle:
      normalizeOptionalString(input.writingStyle) ?? baseResult.brandProfile?.writingStyle,
    visualStyle: normalizeOptionalString(input.visualStyle) ?? baseResult.brandProfile?.visualStyle,
    topics:
      input.topics && input.topics.length > 0
        ? uniqueValues(input.topics)
        : baseResult.brandProfile?.topics,
    patterns:
      input.patterns && input.patterns.length > 0
        ? uniqueValues(input.patterns)
        : baseResult.brandProfile?.patterns,
  });

  return {
    brandProfile: updatedProfile,
    visualPromptTemplate: buildBrandAlignedImagePrompt(
      "Create a brand-aligned LinkedIn visual.",
      toBrandPromptContext(updatedProfile),
    ),
    signalSummary: baseResult.signalSummary,
  };
}

export async function getBrandPromptContextForBusiness(
  businessId: string | undefined,
): Promise<BrandPromptContext | undefined> {
  const normalizedBusinessId = normalizeOptionalString(businessId);

  if (!normalizedBusinessId) {
    return undefined;
  }

  try {
    const existingProfile = await loadBrandProfileRecord(normalizedBusinessId);

    if (
      existingProfile &&
      existingProfile.tone &&
      existingProfile.writingStyle &&
      existingProfile.visualStyle &&
      existingProfile.topics.length > 0 &&
      existingProfile.patterns.length > 0
    ) {
      return toBrandPromptContext(existingProfile);
    }

    const result = await ensureBrandProfileFromSignals(normalizedBusinessId);
    return toBrandPromptContext(result.brandProfile);
  } catch (error) {
    logWarn("Skipping brand prompt context enrichment.", {
      businessId: normalizedBusinessId,
      message: error instanceof Error ? error.message : "Unknown brand intelligence error.",
    });
    return undefined;
  }
}
