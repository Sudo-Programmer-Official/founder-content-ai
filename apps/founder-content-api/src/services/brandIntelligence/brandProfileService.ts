import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryResultRow } from "pg";
import { generateCompletion } from "../../../../../packages/ai-core/src/generateCompletion.ts";
import { buildBrandAlignedImagePrompt } from "../../../../../packages/content-engine/src/index.ts";
import { brandIntelligencePromptFiles } from "../../../../../packages/prompts/index.ts";
import type {
  BrandCompetitorReference,
  BrandProfile,
  BrandProfileQuery,
  BrandProfileResponse,
  BrandPromptContext,
  BrandSignalSummary,
  ContentAsset,
  OnboardingChannel,
  OnboardingGoal,
  WorkspaceMode,
  SourceItemAnalysis,
  TrendSignal,
  UpdateBrandProfileRequest,
  UpdateBrandProfileResponse,
} from "../../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../../middleware/auth.ts";
import { requireBusinessMembership } from "../authBusinessService.ts";
import { queryDb } from "../db/client.ts";
import { getCompetitiveIntelligenceSnapshot } from "../competitiveIntelligence/service.ts";
import { normalizePublicUrl } from "../competitiveIntelligence/fetchUtils.ts";
import { logWarn } from "../../utils/logger.ts";
import { loadWorkspaceKnowledgeProfileForBusiness } from "./workspaceKnowledgeService.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");

interface BrandProfileRow extends QueryResultRow {
  id: string;
  business_id: string;
  workspace_mode: WorkspaceMode | null;
  industry: string | null;
  location: string | null;
  preferred_tone: string | null;
  target_channels: unknown;
  goals: unknown;
  linkedin_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  website_url: string | null;
  tone: string | null;
  writing_style: string | null;
  visual_style: string | null;
  topics: unknown;
  patterns: unknown;
  selected_competitors: unknown;
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

interface CompetitorSuggestionSeed extends BrandCompetitorReference {
  tags: string[];
}

const competitorSuggestionCatalog: CompetitorSuggestionSeed[] = [
  {
    id: "justin-welsh",
    label: "Justin Welsh",
    url: "https://www.justinwelsh.me/",
    sourceType: "website_page",
    rationale: "Strong founder-led hooks, short paragraphs, and audience-growth positioning.",
    origin: "suggested",
    tags: ["founder", "saas", "audience", "growth", "linkedin", "creator", "personal-brand"],
  },
  {
    id: "lenny-rachitsky",
    label: "Lenny Rachitsky",
    url: "https://www.lennysnewsletter.com/",
    sourceType: "website_page",
    rationale: "Clear product and growth frameworks with practical founder education.",
    origin: "suggested",
    tags: ["product", "growth", "saas", "startup", "education", "newsletter"],
  },
  {
    id: "sahil-bloom",
    label: "Sahil Bloom",
    url: "https://www.sahilbloom.com/",
    sourceType: "website_page",
    rationale: "High-performing opinion-led hooks and sharp audience-building structure.",
    origin: "suggested",
    tags: ["founder", "audience", "growth", "storytelling", "contrarian", "personal-brand"],
  },
  {
    id: "april-dunford",
    label: "April Dunford",
    url: "https://www.aprildunford.com/",
    sourceType: "website_page",
    rationale: "Excellent positioning language and messaging clarity for B2B and SaaS products.",
    origin: "suggested",
    tags: ["positioning", "messaging", "b2b", "saas", "product-marketing"],
  },
  {
    id: "wes-kao",
    label: "Wes Kao",
    url: "https://www.weskao.com/",
    sourceType: "website_page",
    rationale: "Sharp educational content with crisp frameworks and strong teaching voice.",
    origin: "suggested",
    tags: ["education", "frameworks", "writing", "audience", "growth", "messaging"],
  },
  {
    id: "katelyn-bourgoin",
    label: "Katelyn Bourgoin",
    url: "https://www.katelynbourgoin.com/",
    sourceType: "website_page",
    rationale: "Buyer-psychology angles and memorable hooks for growth and marketing content.",
    origin: "suggested",
    tags: ["marketing", "growth", "psychology", "audience", "messaging"],
  },
  {
    id: "brian-balfour",
    label: "Brian Balfour",
    url: "https://brianbalfour.com/",
    sourceType: "website_page",
    rationale: "Deep startup and growth-system thinking for operators scaling products.",
    origin: "suggested",
    tags: ["growth", "startup", "saas", "product", "systems"],
  },
  {
    id: "gergely-orosz",
    label: "Gergely Orosz",
    url: "https://newsletter.pragmaticengineer.com/",
    sourceType: "website_page",
    rationale: "Technical storytelling and engineering leadership patterns that resonate with builders.",
    origin: "suggested",
    tags: ["engineering", "developer", "ai", "technical", "builders", "software"],
  },
  {
    id: "swyx",
    label: "swyx",
    url: "https://www.swyx.io/",
    sourceType: "website_page",
    rationale: "Builder-first AI and developer content with strong curiosity-driven hooks.",
    origin: "suggested",
    tags: ["ai", "developer", "engineering", "builders", "technical", "startup"],
  },
];

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalPublicUrl(value: string | undefined | null): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalizePublicUrl(normalized) : undefined;
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

function parseCompetitorReferences(value: unknown): BrandCompetitorReference[] {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return [];
          }
        })()
      : value;

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((entry) => normalizeCompetitorReference(entry));
}

function uniqueValues<TValue extends string>(values: TValue[]): TValue[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))] as TValue[];
}

function normalizeCompetitorReference(value: unknown): BrandCompetitorReference[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const candidate = value as Partial<BrandCompetitorReference>;
  const label = normalizeOptionalString(candidate.label);

  if (!label) {
    return [];
  }

  const normalizedUrl = normalizeOptionalPublicUrl(candidate.url);
  const sourceType =
    candidate.sourceType === "public_url" || candidate.sourceType === "website_page"
      ? candidate.sourceType
      : normalizedUrl?.includes("linkedin.com")
        ? "public_url"
        : "website_page";

  const origin = candidate.origin === "suggested" ? "suggested" : "custom";
  const idBase = normalizeOptionalString(candidate.id) ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return [{
    id: idBase || `competitor-${Date.now()}`,
    label,
    url: normalizedUrl,
    sourceType,
    rationale: normalizeOptionalString(candidate.rationale),
    origin,
  }];
}

function dedupeCompetitorReferences(
  competitors: BrandCompetitorReference[] | undefined,
): BrandCompetitorReference[] {
  if (!competitors) {
    return [];
  }

  const deduped = new Map<string, BrandCompetitorReference>();

  for (const competitor of competitors.flatMap((entry) => normalizeCompetitorReference(entry))) {
    const key = competitor.url?.toLowerCase() ?? competitor.label.toLowerCase();

    if (!deduped.has(key)) {
      deduped.set(key, competitor);
    }
  }

  return Array.from(deduped.values()).slice(0, 8);
}

function tokenizeSuggestionInputs(profile: BrandProfile | null): string[] {
  const hostFragments = [
    profile?.linkedinUrl,
    profile?.instagramUrl,
    profile?.facebookUrl,
    profile?.websiteUrl,
  ]
    .flatMap((value) => normalizeOptionalString(value)?.toLowerCase().split(/[^a-z0-9]+/g) ?? []);

  return uniqueValues([
    profile?.industry ?? "",
    profile?.tone ?? "",
    profile?.writingStyle ?? "",
    profile?.visualStyle ?? "",
    ...(profile?.topics ?? []),
    ...(profile?.patterns ?? []),
    ...hostFragments,
  ]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((value) => value.length >= 2));
}

function buildSuggestedCompetitors(profile: BrandProfile | null): BrandCompetitorReference[] {
  const tokens = new Set(tokenizeSuggestionInputs(profile));

  const ranked = competitorSuggestionCatalog
    .map((candidate) => ({
      candidate,
      score: candidate.tags.reduce((total, tag) => total + (tokens.has(tag) ? 2 : 0), 0) +
        (profile?.selectedCompetitors.some((entry) => entry.id === candidate.id) ? 1 : 0),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.candidate.label.localeCompare(right.candidate.label);
    })
    .map((entry) => entry.candidate);

  const defaultFallbackOrder = [
    "justin-welsh",
    "lenny-rachitsky",
    "april-dunford",
    "wes-kao",
    "gergely-orosz",
  ];

  const fallback = defaultFallbackOrder
    .map((id) => competitorSuggestionCatalog.find((entry) => entry.id === id))
    .filter((entry): entry is CompetitorSuggestionSeed => Boolean(entry));

  return dedupeCompetitorReferences([...ranked, ...fallback]).slice(0, 5);
}

function mapBrandProfile(row: BrandProfileRow): BrandProfile {
  return {
    id: row.id,
    businessId: row.business_id,
    workspaceMode: row.workspace_mode ?? "founder",
    industry: row.industry ?? undefined,
    location: row.location ?? undefined,
    preferredTone: (row.preferred_tone as BrandProfile["preferredTone"]) ?? undefined,
    targetChannels: parseStringArray<OnboardingChannel>(row.target_channels),
    goals: parseStringArray<OnboardingGoal>(row.goals),
    linkedinUrl: row.linkedin_url ?? undefined,
    instagramUrl: row.instagram_url ?? undefined,
    facebookUrl: row.facebook_url ?? undefined,
    websiteUrl: row.website_url ?? undefined,
    tone: row.tone ?? undefined,
    writingStyle: row.writing_style ?? undefined,
    visualStyle: row.visual_style ?? undefined,
    topics: parseStringArray<string>(row.topics),
    patterns: parseStringArray<string>(row.patterns),
    selectedCompetitors: parseCompetitorReferences(row.selected_competitors),
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
        workspace_mode,
        industry,
        location,
        preferred_tone,
        target_channels,
        goals,
        linkedin_url,
        instagram_url,
        facebook_url,
        website_url,
        tone,
        writing_style,
        visual_style,
        topics,
        patterns,
        selected_competitors,
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

function toBrandPromptContext(
  profile: BrandProfile,
  suggestedCompetitors?: BrandCompetitorReference[],
  knowledgeProfile?: {
    voiceSummary?: string;
    audienceSummary?: string;
    positioningSummary?: string;
    beliefs?: string[];
    topicClusters?: string[];
  },
): BrandPromptContext {
  const marketReferences = (
    profile.selectedCompetitors.length > 0
      ? profile.selectedCompetitors
      : suggestedCompetitors?.slice(0, 3) ?? []
  )
    .map((competitor) =>
      competitor.rationale
        ? `${competitor.label} (${competitor.rationale})`
        : competitor.label,
    );
  const topics = uniqueValues([
    ...profile.topics,
    ...(knowledgeProfile?.topicClusters ?? []),
  ]);

  return {
    tone: profile.tone ?? profile.preferredTone,
    writingStyle: profile.writingStyle,
    visualStyle: profile.visualStyle,
    goals: profile.goals,
    topics,
    patterns: profile.patterns,
    marketReferences,
    voiceSummary: knowledgeProfile?.voiceSummary,
    audience: knowledgeProfile?.audienceSummary,
    positioning: knowledgeProfile?.positioningSummary,
    beliefs: uniqueValues(knowledgeProfile?.beliefs ?? []),
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
  workspaceMode?: WorkspaceMode;
  location?: string;
  linkedinUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  tone?: string;
  writingStyle?: string;
  visualStyle?: string;
  topics?: string[];
  patterns?: string[];
  selectedCompetitors?: BrandCompetitorReference[];
}): Promise<BrandProfile> {
  const result = await queryDb<BrandProfileRow>(
    `
      insert into brand_profiles (
        business_id,
        workspace_mode,
        industry,
        location,
        preferred_tone,
        target_channels,
        goals,
        linkedin_url,
        instagram_url,
        facebook_url,
        website_url,
        tone,
        writing_style,
        visual_style,
        topics,
        patterns,
        selected_competitors
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        $7::jsonb,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15::jsonb,
        $16::jsonb,
        $17::jsonb
      )
      on conflict (business_id)
      do update set
        workspace_mode = excluded.workspace_mode,
        industry = excluded.industry,
        location = excluded.location,
        preferred_tone = excluded.preferred_tone,
        target_channels = excluded.target_channels,
        goals = excluded.goals,
        linkedin_url = excluded.linkedin_url,
        instagram_url = excluded.instagram_url,
        facebook_url = excluded.facebook_url,
        website_url = excluded.website_url,
        tone = excluded.tone,
        writing_style = excluded.writing_style,
        visual_style = excluded.visual_style,
        topics = excluded.topics,
        patterns = excluded.patterns,
        selected_competitors = excluded.selected_competitors,
        updated_at = now()
      returning
        id,
        business_id,
        workspace_mode,
        industry,
        location,
        preferred_tone,
        target_channels,
        goals,
        linkedin_url,
        instagram_url,
        facebook_url,
        website_url,
        tone,
        writing_style,
        visual_style,
        topics,
        patterns,
        selected_competitors,
        created_at,
        updated_at
    `,
    [
      input.businessId,
      input.workspaceMode ?? input.existingProfile?.workspaceMode ?? "founder",
      input.existingProfile?.industry ?? null,
      input.location ?? input.existingProfile?.location ?? null,
      input.existingProfile?.preferredTone ?? null,
      JSON.stringify(input.existingProfile?.targetChannels ?? []),
      JSON.stringify(input.existingProfile?.goals ?? []),
      input.linkedinUrl ?? input.existingProfile?.linkedinUrl ?? null,
      input.instagramUrl ?? input.existingProfile?.instagramUrl ?? null,
      input.facebookUrl ?? input.existingProfile?.facebookUrl ?? null,
      input.websiteUrl ?? input.existingProfile?.websiteUrl ?? null,
      input.tone ?? input.existingProfile?.tone ?? input.existingProfile?.preferredTone ?? null,
      input.writingStyle ?? input.existingProfile?.writingStyle ?? null,
      input.visualStyle ?? input.existingProfile?.visualStyle ?? null,
      JSON.stringify(clampList(input.topics, input.existingProfile?.topics ?? [])),
      JSON.stringify(clampList(input.patterns, input.existingProfile?.patterns ?? [])),
      JSON.stringify(
        dedupeCompetitorReferences(
          input.selectedCompetitors ?? input.existingProfile?.selectedCompetitors,
        ),
      ),
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
    workspaceMode: existingProfile?.workspaceMode,
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

  const suggestedCompetitors = buildSuggestedCompetitors(result.brandProfile);
  const knowledgeProfile = await loadWorkspaceKnowledgeProfileForBusiness(query.businessId);

  return {
    brandProfile: result.brandProfile,
    suggestedCompetitors,
    visualPromptTemplate: buildBrandAlignedImagePrompt(
      "Create a brand-aligned LinkedIn visual.",
      toBrandPromptContext(result.brandProfile, suggestedCompetitors, knowledgeProfile),
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
    workspaceMode:
      input.workspaceMode !== undefined
        ? input.workspaceMode
        : baseResult.brandProfile?.workspaceMode,
    location:
      input.location !== undefined
        ? normalizeOptionalString(input.location)
        : baseResult.brandProfile?.location,
    linkedinUrl:
      input.linkedinUrl !== undefined
        ? normalizeOptionalPublicUrl(input.linkedinUrl)
        : baseResult.brandProfile?.linkedinUrl,
    instagramUrl:
      input.instagramUrl !== undefined
        ? normalizeOptionalPublicUrl(input.instagramUrl)
        : baseResult.brandProfile?.instagramUrl,
    facebookUrl:
      input.facebookUrl !== undefined
        ? normalizeOptionalPublicUrl(input.facebookUrl)
        : baseResult.brandProfile?.facebookUrl,
    websiteUrl:
      input.websiteUrl !== undefined
        ? normalizeOptionalPublicUrl(input.websiteUrl)
        : baseResult.brandProfile?.websiteUrl,
    tone:
      input.tone !== undefined
        ? normalizeOptionalString(input.tone)
        : baseResult.brandProfile?.tone,
    writingStyle:
      input.writingStyle !== undefined
        ? normalizeOptionalString(input.writingStyle)
        : baseResult.brandProfile?.writingStyle,
    visualStyle:
      input.visualStyle !== undefined
        ? normalizeOptionalString(input.visualStyle)
        : baseResult.brandProfile?.visualStyle,
    topics: input.topics !== undefined ? uniqueValues(input.topics) : baseResult.brandProfile?.topics,
    patterns:
      input.patterns !== undefined
        ? uniqueValues(input.patterns)
        : baseResult.brandProfile?.patterns,
    selectedCompetitors:
      input.selectedCompetitors !== undefined
        ? dedupeCompetitorReferences(input.selectedCompetitors)
        : baseResult.brandProfile?.selectedCompetitors,
  });

  const suggestedCompetitors = buildSuggestedCompetitors(updatedProfile);
  const knowledgeProfile = await loadWorkspaceKnowledgeProfileForBusiness(input.businessId);

  return {
    brandProfile: updatedProfile,
    suggestedCompetitors,
    visualPromptTemplate: buildBrandAlignedImagePrompt(
      "Create a brand-aligned LinkedIn visual.",
      toBrandPromptContext(updatedProfile, suggestedCompetitors, knowledgeProfile),
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
    const [existingProfile, knowledgeProfile] = await Promise.all([
      loadBrandProfileRecord(normalizedBusinessId),
      loadWorkspaceKnowledgeProfileForBusiness(normalizedBusinessId),
    ]);
    const suggestedCompetitors = existingProfile ? buildSuggestedCompetitors(existingProfile) : [];

    if (
      existingProfile &&
      existingProfile.tone &&
      existingProfile.writingStyle &&
      existingProfile.visualStyle &&
      existingProfile.topics.length > 0 &&
      existingProfile.patterns.length > 0
    ) {
      return toBrandPromptContext(existingProfile, suggestedCompetitors, knowledgeProfile);
    }

    const result = await ensureBrandProfileFromSignals(normalizedBusinessId);
    return toBrandPromptContext(
      result.brandProfile,
      buildSuggestedCompetitors(result.brandProfile),
      knowledgeProfile,
    );
  } catch (error) {
    logWarn("Skipping brand prompt context enrichment.", {
      businessId: normalizedBusinessId,
      message: error instanceof Error ? error.message : "Unknown brand intelligence error.",
    });
    return undefined;
  }
}
