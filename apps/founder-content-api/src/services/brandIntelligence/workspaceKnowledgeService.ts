import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient, QueryResultRow } from "pg";
import { generateCompletion } from "../../../../../packages/ai-core/src/generateCompletion.ts";
import { brandIntelligencePromptFiles } from "../../../../../packages/prompts/index.ts";
import type {
  BrandProfile,
  CreateWorkspaceKnowledgeSourceRequest,
  CreateWorkspaceKnowledgeSourceResponse,
  RefreshWorkspaceKnowledgeResponse,
  UpdateWorkspaceKnowledgeProfileRequest,
  UpdateWorkspaceKnowledgeProfileResponse,
  WorkspaceKnowledgeProcessingStatus,
  WorkspaceKnowledgeProfile,
  WorkspaceKnowledgeResponse,
  WorkspaceKnowledgeSource,
  WorkspaceKnowledgeSourceType,
} from "../../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../../middleware/auth.ts";
import { requireBusinessMembership } from "../authBusinessService.ts";
import { previewContentIngestion } from "../content/ingestionService.ts";
import { queryDb, withDbTransaction } from "../db/client.ts";
import {
  claimQueuedJobs,
  createJob,
  markJobCompleted,
  markJobFailed,
  markJobTerminalFailed,
} from "../jobQueueService.ts";
import { logWarn } from "../../utils/logger.ts";
import { HttpError } from "../../utils/http.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
const DEFAULT_WORKSPACE_KNOWLEDGE_JOB_PRIORITY = 95;
const DEFAULT_WORKSPACE_KNOWLEDGE_BATCH_SIZE = 2;

interface WorkspaceKnowledgeSourceRow extends QueryResultRow {
  id: string;
  business_id: string;
  created_by: string | null;
  source_type: WorkspaceKnowledgeSourceType;
  title: string | null;
  source_url: string | null;
  raw_text: string;
  extracted_text: string;
  metadata_json: unknown;
  processing_status: WorkspaceKnowledgeProcessingStatus;
  processing_error: string | null;
  processing_job_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WorkspaceKnowledgeProfileRow extends QueryResultRow {
  business_id: string;
  voice_summary: string | null;
  audience_summary: string | null;
  positioning_summary: string | null;
  beliefs: unknown;
  topic_clusters: unknown;
  source_count: string | number;
  processing_status: WorkspaceKnowledgeProcessingStatus;
  processing_error: string | null;
  last_processed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface BrandProfileContextRow extends QueryResultRow {
  id: string;
  business_id: string;
  industry: string | null;
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

interface KnowledgeProcessJobPayload {
  businessId?: string;
  sourceId?: string;
}

interface ExtractedKnowledgeProfile {
  voiceSummary?: string;
  audienceSummary?: string;
  positioningSummary?: string;
  beliefs: string[];
  topicClusters: string[];
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeOptionalString(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseStringArray<TValue extends string>(value: unknown): TValue[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is TValue => typeof entry === "string" && entry.trim() !== "");
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is TValue => typeof entry === "string" && entry.trim() !== "")
        : [];
    } catch {
      return [];
    }
  }

  return [];
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  return (lastSpaceIndex > 120 ? truncated.slice(0, lastSpaceIndex) : truncated).trim();
}

function buildSourceLabel(source: WorkspaceKnowledgeSource): string {
  return source.title
    ?? source.sourceUrl
    ?? (source.sourceType === "note" ? "Workspace note" : "Workspace source");
}

function getSourceText(source: WorkspaceKnowledgeSource): string {
  return normalizeWhitespace(source.extractedText || source.rawText || "");
}

function mapWorkspaceKnowledgeSource(row: WorkspaceKnowledgeSourceRow): WorkspaceKnowledgeSource {
  return {
    id: row.id,
    businessId: row.business_id,
    createdBy: row.created_by ?? undefined,
    sourceType: row.source_type,
    title: row.title ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    rawText: row.raw_text,
    extractedText: row.extracted_text,
    metadata:
      row.metadata_json && typeof row.metadata_json === "object" && !Array.isArray(row.metadata_json)
        ? row.metadata_json as Record<string, unknown>
        : undefined,
    processingStatus: row.processing_status,
    processingError: row.processing_error ?? undefined,
    processingJobId: row.processing_job_id ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapWorkspaceKnowledgeProfile(row: WorkspaceKnowledgeProfileRow): WorkspaceKnowledgeProfile {
  return {
    businessId: row.business_id,
    voiceSummary: row.voice_summary ?? undefined,
    audienceSummary: row.audience_summary ?? undefined,
    positioningSummary: row.positioning_summary ?? undefined,
    beliefs: parseStringArray<string>(row.beliefs),
    topicClusters: parseStringArray<string>(row.topic_clusters),
    sourceCount: toNumber(row.source_count),
    processingStatus: row.processing_status,
    processingError: row.processing_error ?? undefined,
    lastProcessedAt: toIsoString(row.last_processed_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapBrandProfileContext(row: BrandProfileContextRow): BrandProfile {
  return {
    id: row.id,
    businessId: row.business_id,
    industry: row.industry ?? undefined,
    preferredTone: (row.preferred_tone as BrandProfile["preferredTone"] | null) ?? undefined,
    targetChannels: parseStringArray<BrandProfile["targetChannels"][number]>(row.target_channels),
    goals: parseStringArray<BrandProfile["goals"][number]>(row.goals),
    linkedinUrl: row.linkedin_url ?? undefined,
    instagramUrl: row.instagram_url ?? undefined,
    facebookUrl: row.facebook_url ?? undefined,
    websiteUrl: row.website_url ?? undefined,
    tone: row.tone ?? undefined,
    writingStyle: row.writing_style ?? undefined,
    visualStyle: row.visual_style ?? undefined,
    topics: parseStringArray<string>(row.topics),
    patterns: parseStringArray<string>(row.patterns),
    selectedCompetitors: [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function loadWorkspaceKnowledgePrompt(): Promise<string> {
  return readFile(path.resolve(repoRoot, brandIntelligencePromptFiles.workspaceKnowledgeExtractor), "utf8");
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

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "about", "after", "again", "also", "been", "being", "build", "building", "from", "into", "just",
    "more", "most", "over", "that", "their", "them", "then", "there", "these", "this", "through",
    "want", "with", "your", "while", "will", "founders", "founder", "product", "brand",
  ]);

  const counts = new Map<string, number>();

  for (const word of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (stopWords.has(word)) {
      continue;
    }

    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([value]) => value.replace(/-/g, " "))
    .map((value) => value.replace(/\b\w/g, (match) => match.toUpperCase()));
}

function deriveHeuristicKnowledgeProfile(
  businessId: string,
  sources: WorkspaceKnowledgeSource[],
  brandProfile: BrandProfile | null,
): ExtractedKnowledgeProfile {
  const combinedText = sources.map((source) => getSourceText(source)).filter(Boolean).join("\n\n");
  const topics = uniqueValues([
    ...(brandProfile?.topics ?? []),
    ...extractKeywords(combinedText),
  ]).slice(0, 6);
  const toneParts = uniqueValues([
    brandProfile?.tone ?? brandProfile?.preferredTone ?? "",
    brandProfile?.writingStyle ?? "",
  ]).filter(Boolean);
  const voiceSummary = toneParts.length > 0
    ? `${toneParts.join(", ")} voice for workspace content.`
    : "Direct, practical, no-fluff voice for workspace content.";
  const audienceSummary = combinedText.toLowerCase().includes("founder")
    ? "Founders and operators who need clear, execution-focused guidance."
    : brandProfile?.industry
      ? `${brandProfile.industry} buyers and operators who want practical signal over fluff.`
      : "Operators and customers who respond to practical, concrete guidance.";
  const positioningSummary = brandProfile?.websiteUrl
    ? `The workspace is positioned around ${brandProfile.websiteUrl} and practical execution outcomes.`
    : `The workspace ${businessId} is positioned around practical execution, clarity, and repeatable systems.`;
  const beliefs = uniqueValues([
    combinedText.toLowerCase().includes("consistency") ? "Consistency compounds faster than hacks." : "",
    combinedText.toLowerCase().includes("ship") || combinedText.toLowerCase().includes("shipping")
      ? "Shipping matters more than perfection."
      : "",
    "Practical advice should beat generic motivation.",
  ]).slice(0, 4);

  return {
    voiceSummary,
    audienceSummary,
    positioningSummary,
    beliefs,
    topicClusters: topics,
  };
}

function summarizeKnowledgeSources(sources: WorkspaceKnowledgeSource[]): string {
  if (sources.length === 0) {
    return "No completed knowledge sources are available.";
  }

  return sources
    .slice(0, 8)
    .map((source) => {
      const label = buildSourceLabel(source);
      const body = truncateText(getSourceText(source), 700);
      return `${label}\n${body}`;
    })
    .join("\n\n---\n\n");
}

async function refineKnowledgeProfileWithAI(input: {
  businessId: string;
  brandProfile: BrandProfile | null;
  sources: WorkspaceKnowledgeSource[];
  heuristic: ExtractedKnowledgeProfile;
}): Promise<ExtractedKnowledgeProfile | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  try {
    const template = await loadWorkspaceKnowledgePrompt();
    const prompt = buildPrompt(template, {
      business_id: input.businessId,
      existing_brand_profile: JSON.stringify({
        tone: input.brandProfile?.tone ?? input.brandProfile?.preferredTone,
        writingStyle: input.brandProfile?.writingStyle,
        visualStyle: input.brandProfile?.visualStyle,
        topics: input.brandProfile?.topics ?? [],
        patterns: input.brandProfile?.patterns ?? [],
        goals: input.brandProfile?.goals ?? [],
        heuristic: input.heuristic,
      }),
      knowledge_sources_summary: summarizeKnowledgeSources(input.sources),
    });
    const completion = await generateCompletion(prompt, {
      jsonMode: true,
    });
    const parsed = JSON.parse(stripCodeFences(completion)) as Record<string, unknown>;

    return {
      voiceSummary: normalizeOptionalString(
        typeof parsed.voice_summary === "string" ? parsed.voice_summary : undefined,
      ),
      audienceSummary: normalizeOptionalString(
        typeof parsed.audience_summary === "string" ? parsed.audience_summary : undefined,
      ),
      positioningSummary: normalizeOptionalString(
        typeof parsed.positioning_summary === "string" ? parsed.positioning_summary : undefined,
      ),
      beliefs: uniqueValues(parseStringArray<string>(parsed.beliefs)).slice(0, 6),
      topicClusters: uniqueValues(parseStringArray<string>(parsed.topic_clusters)).slice(0, 6),
    };
  } catch (error) {
    logWarn("Falling back to heuristic workspace knowledge extraction.", {
      businessId: input.businessId,
      message: error instanceof Error ? error.message : "Unknown workspace knowledge extraction error.",
    });
    return null;
  }
}

function mergeKnowledgeProfiles(
  heuristic: ExtractedKnowledgeProfile,
  refined: ExtractedKnowledgeProfile | null,
): ExtractedKnowledgeProfile {
  return {
    voiceSummary: refined?.voiceSummary ?? heuristic.voiceSummary,
    audienceSummary: refined?.audienceSummary ?? heuristic.audienceSummary,
    positioningSummary: refined?.positioningSummary ?? heuristic.positioningSummary,
    beliefs: uniqueValues([...(refined?.beliefs ?? []), ...heuristic.beliefs]).slice(0, 6),
    topicClusters: uniqueValues([...(refined?.topicClusters ?? []), ...heuristic.topicClusters]).slice(0, 6),
  };
}

function resolveKnowledgeProcessingPriority(): number {
  const rawValue = process.env.WORKSPACE_KNOWLEDGE_JOB_PRIORITY?.trim();
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_WORKSPACE_KNOWLEDGE_JOB_PRIORITY;
}

function resolveKnowledgeProcessingBatchSize(): number {
  const rawValue = process.env.WORKSPACE_KNOWLEDGE_WORKER_BATCH_SIZE?.trim();
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WORKSPACE_KNOWLEDGE_BATCH_SIZE;
}

async function loadWorkspaceKnowledgeSourcesInternal(
  businessId: string,
  client?: PoolClient,
): Promise<WorkspaceKnowledgeSource[]> {
  const result = client
    ? await client.query<WorkspaceKnowledgeSourceRow>(
      `
        select
          id,
          business_id,
          created_by,
          source_type,
          title,
          source_url,
          raw_text,
          extracted_text,
          metadata_json,
          processing_status,
          processing_error,
          processing_job_id,
          created_at,
          updated_at
        from workspace_knowledge_sources
        where business_id = $1::uuid
        order by created_at desc
      `,
      [businessId],
    )
    : await queryDb<WorkspaceKnowledgeSourceRow>(
      `
        select
          id,
          business_id,
          created_by,
          source_type,
          title,
          source_url,
          raw_text,
          extracted_text,
          metadata_json,
          processing_status,
          processing_error,
          processing_job_id,
          created_at,
          updated_at
        from workspace_knowledge_sources
        where business_id = $1::uuid
        order by created_at desc
      `,
      [businessId],
    );

  return result.rows.map((row) => mapWorkspaceKnowledgeSource(row));
}

async function loadWorkspaceKnowledgeProfileRecord(
  businessId: string,
  client?: PoolClient,
): Promise<WorkspaceKnowledgeProfile | undefined> {
  const result = client
    ? await client.query<WorkspaceKnowledgeProfileRow>(
      `
        select
          business_id,
          voice_summary,
          audience_summary,
          positioning_summary,
          beliefs,
          topic_clusters,
          source_count,
          processing_status,
          processing_error,
          last_processed_at,
          created_at,
          updated_at
        from workspace_knowledge_profiles
        where business_id = $1::uuid
        limit 1
      `,
      [businessId],
    )
    : await queryDb<WorkspaceKnowledgeProfileRow>(
      `
        select
          business_id,
          voice_summary,
          audience_summary,
          positioning_summary,
          beliefs,
          topic_clusters,
          source_count,
          processing_status,
          processing_error,
          last_processed_at,
          created_at,
          updated_at
        from workspace_knowledge_profiles
        where business_id = $1::uuid
        limit 1
      `,
      [businessId],
    );

  const row = result.rows[0];
  return row ? mapWorkspaceKnowledgeProfile(row) : undefined;
}

async function loadBrandProfileContext(businessId: string): Promise<BrandProfile | null> {
  const result = await queryDb<BrandProfileContextRow>(
    `
      select
        id,
        business_id,
        industry,
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
      where business_id = $1::uuid
      limit 1
    `,
    [businessId],
  );

  const row = result.rows[0];
  return row ? mapBrandProfileContext(row) : null;
}

async function upsertWorkspaceKnowledgeProfile(
  businessId: string,
  input: {
    voiceSummary?: string;
    audienceSummary?: string;
    positioningSummary?: string;
    beliefs?: string[];
    topicClusters?: string[];
    sourceCount?: number;
    processingStatus: WorkspaceKnowledgeProcessingStatus;
    processingError?: string;
    touchProcessedAt?: boolean;
  },
  client?: PoolClient,
): Promise<WorkspaceKnowledgeProfile> {
  const queryResult = client
    ? await client.query<WorkspaceKnowledgeProfileRow>(
      `
        insert into workspace_knowledge_profiles (
          business_id,
          voice_summary,
          audience_summary,
          positioning_summary,
          beliefs,
          topic_clusters,
          source_count,
          processing_status,
          processing_error,
          last_processed_at
        ) values (
          $1::uuid,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6::jsonb,
          $7::int,
          $8,
          $9,
          case when $10::boolean then now() else null end
        )
        on conflict (business_id)
        do update set
          voice_summary = coalesce(excluded.voice_summary, workspace_knowledge_profiles.voice_summary),
          audience_summary = coalesce(excluded.audience_summary, workspace_knowledge_profiles.audience_summary),
          positioning_summary = coalesce(excluded.positioning_summary, workspace_knowledge_profiles.positioning_summary),
          beliefs = case
            when jsonb_array_length(excluded.beliefs) > 0 then excluded.beliefs
            else workspace_knowledge_profiles.beliefs
          end,
          topic_clusters = case
            when jsonb_array_length(excluded.topic_clusters) > 0 then excluded.topic_clusters
            else workspace_knowledge_profiles.topic_clusters
          end,
          source_count = greatest(workspace_knowledge_profiles.source_count, excluded.source_count),
          processing_status = excluded.processing_status,
          processing_error = excluded.processing_error,
          last_processed_at = case
            when $10::boolean then now()
            else workspace_knowledge_profiles.last_processed_at
          end,
          updated_at = now()
        returning
          business_id,
          voice_summary,
          audience_summary,
          positioning_summary,
          beliefs,
          topic_clusters,
          source_count,
          processing_status,
          processing_error,
          last_processed_at,
          created_at,
          updated_at
      `,
      [
        businessId,
        input.voiceSummary ?? null,
        input.audienceSummary ?? null,
        input.positioningSummary ?? null,
        JSON.stringify(input.beliefs ?? []),
        JSON.stringify(input.topicClusters ?? []),
        input.sourceCount ?? 0,
        input.processingStatus,
        input.processingError ?? null,
        input.touchProcessedAt ?? false,
      ],
    )
    : await queryDb<WorkspaceKnowledgeProfileRow>(
      `
        insert into workspace_knowledge_profiles (
          business_id,
          voice_summary,
          audience_summary,
          positioning_summary,
          beliefs,
          topic_clusters,
          source_count,
          processing_status,
          processing_error,
          last_processed_at
        ) values (
          $1::uuid,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6::jsonb,
          $7::int,
          $8,
          $9,
          case when $10::boolean then now() else null end
        )
        on conflict (business_id)
        do update set
          voice_summary = coalesce(excluded.voice_summary, workspace_knowledge_profiles.voice_summary),
          audience_summary = coalesce(excluded.audience_summary, workspace_knowledge_profiles.audience_summary),
          positioning_summary = coalesce(excluded.positioning_summary, workspace_knowledge_profiles.positioning_summary),
          beliefs = case
            when jsonb_array_length(excluded.beliefs) > 0 then excluded.beliefs
            else workspace_knowledge_profiles.beliefs
          end,
          topic_clusters = case
            when jsonb_array_length(excluded.topic_clusters) > 0 then excluded.topic_clusters
            else workspace_knowledge_profiles.topic_clusters
          end,
          source_count = greatest(workspace_knowledge_profiles.source_count, excluded.source_count),
          processing_status = excluded.processing_status,
          processing_error = excluded.processing_error,
          last_processed_at = case
            when $10::boolean then now()
            else workspace_knowledge_profiles.last_processed_at
          end,
          updated_at = now()
        returning
          business_id,
          voice_summary,
          audience_summary,
          positioning_summary,
          beliefs,
          topic_clusters,
          source_count,
          processing_status,
          processing_error,
          last_processed_at,
          created_at,
          updated_at
      `,
      [
        businessId,
        input.voiceSummary ?? null,
        input.audienceSummary ?? null,
        input.positioningSummary ?? null,
        JSON.stringify(input.beliefs ?? []),
        JSON.stringify(input.topicClusters ?? []),
        input.sourceCount ?? 0,
        input.processingStatus,
        input.processingError ?? null,
        input.touchProcessedAt ?? false,
      ],
    );

  return mapWorkspaceKnowledgeProfile(queryResult.rows[0]);
}

async function updateSourceProcessingState(
  sourceId: string,
  input: {
    processingStatus: WorkspaceKnowledgeProcessingStatus;
    processingError?: string;
    extractedText?: string;
    metadata?: Record<string, unknown>;
    title?: string;
  },
  client?: PoolClient,
): Promise<void> {
  const values = [
    sourceId,
    input.processingStatus,
    input.processingError ?? null,
    input.extractedText ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.title ?? null,
  ];

  if (client) {
    await client.query(
      `
        update workspace_knowledge_sources
        set
          processing_status = $2,
          processing_error = $3,
          extracted_text = coalesce($4, extracted_text),
          metadata_json = coalesce($5::jsonb, metadata_json),
          title = coalesce($6, title),
          updated_at = now()
        where id = $1::uuid
      `,
      values,
    );
    return;
  }

  await queryDb(
    `
      update workspace_knowledge_sources
      set
        processing_status = $2,
        processing_error = $3,
        extracted_text = coalesce($4, extracted_text),
        metadata_json = coalesce($5::jsonb, metadata_json),
        title = coalesce($6, title),
        updated_at = now()
      where id = $1::uuid
    `,
    values,
  );
}

async function resolveProcessedSource(source: WorkspaceKnowledgeSource): Promise<{
  extractedText: string;
  metadata?: Record<string, unknown>;
  title?: string;
}> {
  if (source.sourceType === "note") {
    const extractedText = normalizeWhitespace(source.rawText);

    if (!extractedText) {
      throw new Error("Workspace note is empty.");
    }

    return {
      extractedText,
      title: source.title ?? truncateText(extractedText, 72),
    };
  }

  if (!source.sourceUrl) {
    throw new Error("Workspace knowledge source is missing a website URL.");
  }

  const preview = await previewContentIngestion({
    sourceUrls: [{
      url: source.sourceUrl,
      label: buildSourceLabel(source),
    }],
  });
  const item = preview.items[0];

  if (!item) {
    throw new Error("Unable to extract content from this workspace URL.");
  }

  return {
    extractedText: item.rawText,
    title: source.title ?? item.title ?? buildSourceLabel(source),
    metadata: {
      ...(source.metadata ?? {}),
      ingestion: item.metadata ?? {},
    },
  };
}

async function deriveWorkspaceKnowledgeProfile(
  businessId: string,
  sources: WorkspaceKnowledgeSource[],
): Promise<ExtractedKnowledgeProfile> {
  const completedSources = sources.filter((source) => getSourceText(source) !== "");
  const brandProfile = await loadBrandProfileContext(businessId);
  const heuristic = deriveHeuristicKnowledgeProfile(businessId, completedSources, brandProfile);
  const refined = await refineKnowledgeProfileWithAI({
    businessId,
    brandProfile,
    sources: completedSources,
    heuristic,
  });
  return mergeKnowledgeProfiles(heuristic, refined);
}

export async function getWorkspaceKnowledge(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<WorkspaceKnowledgeResponse> {
  await requireBusinessMembership(principal, businessId);

  const [sources, profile] = await Promise.all([
    loadWorkspaceKnowledgeSourcesInternal(businessId),
    loadWorkspaceKnowledgeProfileRecord(businessId),
  ]);

  return {
    profile,
    sources,
  };
}

export async function createWorkspaceKnowledgeSource(
  principal: AuthenticatedPrincipal,
  input: CreateWorkspaceKnowledgeSourceRequest,
): Promise<CreateWorkspaceKnowledgeSourceResponse> {
  await requireBusinessMembership(principal, input.businessId);

  const sourceType = input.sourceType;
  const normalizedTitle = normalizeOptionalString(input.title);
  const normalizedUrl = normalizeOptionalString(input.sourceUrl);
  const normalizedRawText = normalizeOptionalString(input.rawText) ?? "";

  if (sourceType === "website" && !normalizedUrl) {
    throw new HttpError(400, "bad_request", "A website URL is required for website knowledge sources.");
  }

  if (sourceType === "note" && normalizedRawText === "") {
    throw new HttpError(400, "bad_request", "Add a note before saving it as workspace knowledge.");
  }

  const source = await withDbTransaction(async (client) => {
    const insertResult = await client.query<WorkspaceKnowledgeSourceRow>(
      `
        insert into workspace_knowledge_sources (
          business_id,
          created_by,
          source_type,
          title,
          source_url,
          raw_text,
          metadata_json,
          processing_status
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          '{}'::jsonb,
          'queued'
        )
        on conflict (business_id, source_url)
        where source_url is not null
        do update set
          title = coalesce(excluded.title, workspace_knowledge_sources.title),
          raw_text = case
            when excluded.raw_text <> '' then excluded.raw_text
            else workspace_knowledge_sources.raw_text
          end,
          processing_status = 'queued',
          processing_error = null,
          updated_at = now()
        returning
          id,
          business_id,
          created_by,
          source_type,
          title,
          source_url,
          raw_text,
          extracted_text,
          metadata_json,
          processing_status,
          processing_error,
          processing_job_id,
          created_at,
          updated_at
      `,
      [
        input.businessId,
        principal.userId ?? null,
        sourceType,
        normalizedTitle ?? null,
        normalizedUrl ?? null,
        normalizedRawText,
      ],
    );
    const insertedSource = insertResult.rows[0];
    const queuedJob = await createJob<KnowledgeProcessJobPayload>({
      businessId: input.businessId,
      jobKey: `knowledge_process:${insertedSource.id}`,
      type: "knowledge_process",
      priority: resolveKnowledgeProcessingPriority(),
      payload: {
        businessId: input.businessId,
        sourceId: insertedSource.id,
      },
      client,
    });

    const sourceCountResult = await client.query<{ source_count: string }>(
      `
        select count(*)::text as source_count
        from workspace_knowledge_sources
        where business_id = $1::uuid
      `,
      [input.businessId],
    );

    await client.query(
      `
        update workspace_knowledge_sources
        set
          processing_job_id = $2::uuid,
          updated_at = now()
        where id = $1::uuid
      `,
      [insertedSource.id, queuedJob.id],
    );

    await upsertWorkspaceKnowledgeProfile(
      input.businessId,
      {
        sourceCount: toNumber(sourceCountResult.rows[0]?.source_count),
        processingStatus: "queued",
        processingError: undefined,
      },
      client,
    );

    const refreshedSource = await client.query<WorkspaceKnowledgeSourceRow>(
      `
        select
          id,
          business_id,
          created_by,
          source_type,
          title,
          source_url,
          raw_text,
          extracted_text,
          metadata_json,
          processing_status,
          processing_error,
          processing_job_id,
          created_at,
          updated_at
        from workspace_knowledge_sources
        where id = $1::uuid
        limit 1
      `,
      [insertedSource.id],
    );

    return mapWorkspaceKnowledgeSource(refreshedSource.rows[0]);
  });

  const snapshot = await getWorkspaceKnowledge(principal, input.businessId);
  return {
    ...snapshot,
    source,
  };
}

export async function refreshWorkspaceKnowledge(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<RefreshWorkspaceKnowledgeResponse> {
  await requireBusinessMembership(principal, businessId);

  await withDbTransaction(async (client) => {
    const sourceResult = await client.query<WorkspaceKnowledgeSourceRow>(
      `
        update workspace_knowledge_sources
        set
          processing_status = 'queued',
          processing_error = null,
          updated_at = now()
        where business_id = $1::uuid
        returning
          id,
          business_id,
          created_by,
          source_type,
          title,
          source_url,
          raw_text,
          extracted_text,
          metadata_json,
          processing_status,
          processing_error,
          processing_job_id,
          created_at,
          updated_at
      `,
      [businessId],
    );

    for (const row of sourceResult.rows) {
      const job = await createJob<KnowledgeProcessJobPayload>({
        businessId,
        jobKey: `knowledge_process:${row.id}`,
        type: "knowledge_process",
        priority: resolveKnowledgeProcessingPriority(),
        payload: {
          businessId,
          sourceId: row.id,
        },
        client,
      });

      await client.query(
        `
          update workspace_knowledge_sources
          set
            processing_job_id = $2::uuid,
            updated_at = now()
          where id = $1::uuid
        `,
        [row.id, job.id],
      );
    }

    await upsertWorkspaceKnowledgeProfile(
      businessId,
      {
        processingStatus: "queued",
        processingError: undefined,
      },
      client,
    );
  });

  return getWorkspaceKnowledge(principal, businessId);
}

export async function updateWorkspaceKnowledgeProfile(
  principal: AuthenticatedPrincipal,
  input: UpdateWorkspaceKnowledgeProfileRequest,
): Promise<UpdateWorkspaceKnowledgeProfileResponse> {
  const businessId = input.businessId.trim();

  await requireBusinessMembership(principal, businessId);

  const [sources, existingProfile] = await Promise.all([
    loadWorkspaceKnowledgeSourcesInternal(businessId),
    loadWorkspaceKnowledgeProfileRecord(businessId),
  ]);

  const profile = await upsertWorkspaceKnowledgeProfile(businessId, {
    voiceSummary:
      typeof input.voiceSummary === "string"
        ? input.voiceSummary.trim()
        : existingProfile?.voiceSummary,
    audienceSummary:
      typeof input.audienceSummary === "string"
        ? input.audienceSummary.trim()
        : existingProfile?.audienceSummary,
    positioningSummary:
      typeof input.positioningSummary === "string"
        ? input.positioningSummary.trim()
        : existingProfile?.positioningSummary,
    beliefs:
      input.beliefs !== undefined
        ? uniqueValues(input.beliefs)
        : existingProfile?.beliefs,
    topicClusters:
      input.topicClusters !== undefined
        ? uniqueValues(input.topicClusters)
        : existingProfile?.topicClusters,
    sourceCount: sources.length,
    processingStatus: "completed",
    processingError: undefined,
    touchProcessedAt: true,
  });

  return {
    profile,
    sources,
  };
}

export async function loadWorkspaceKnowledgeProfileForBusiness(
  businessId: string | undefined,
): Promise<WorkspaceKnowledgeProfile | undefined> {
  const normalizedBusinessId = normalizeOptionalString(businessId);

  if (!normalizedBusinessId) {
    return undefined;
  }

  try {
    return await loadWorkspaceKnowledgeProfileRecord(normalizedBusinessId);
  } catch (error) {
    logWarn("Skipping workspace knowledge prompt enrichment.", {
      businessId: normalizedBusinessId,
      message: error instanceof Error ? error.message : "Unknown workspace knowledge lookup error.",
    });
    return undefined;
  }
}

export async function loadWorkspaceKnowledgeSnapshotForBusiness(
  businessId: string | undefined,
): Promise<WorkspaceKnowledgeResponse | undefined> {
  const normalizedBusinessId = normalizeOptionalString(businessId);

  if (!normalizedBusinessId) {
    return undefined;
  }

  try {
    const [sources, profile] = await Promise.all([
      loadWorkspaceKnowledgeSourcesInternal(normalizedBusinessId),
      loadWorkspaceKnowledgeProfileRecord(normalizedBusinessId),
    ]);

    return {
      profile: profile ?? undefined,
      sources,
    };
  } catch (error) {
    logWarn("Skipping workspace knowledge snapshot lookup.", {
      businessId: normalizedBusinessId,
      message: error instanceof Error ? error.message : "Unknown workspace knowledge lookup error.",
    });
    return undefined;
  }
}

export async function processQueuedWorkspaceKnowledgeJobs(): Promise<{
  jobsClaimed: number;
  jobsCompleted: number;
  jobsFailed: number;
  sourcesProcessed: number;
  profilesUpdated: number;
}> {
  const jobs = await claimQueuedJobs<KnowledgeProcessJobPayload>({
    types: ["knowledge_process"],
    batchSize: resolveKnowledgeProcessingBatchSize(),
    lockedBy: `workspace-knowledge:${process.pid}`,
  });

  let jobsCompleted = 0;
  let jobsFailed = 0;
  let sourcesProcessed = 0;
  let profilesUpdated = 0;

  for (const job of jobs) {
    const businessId = normalizeOptionalString(job.payload.businessId) ?? normalizeOptionalString(job.businessId);
    const sourceId = normalizeOptionalString(job.payload.sourceId);

    if (!businessId || !sourceId) {
      await markJobTerminalFailed(job.id, "Workspace knowledge job is missing required context.");
      jobsFailed += 1;
      continue;
    }

    try {
      const sources = await loadWorkspaceKnowledgeSourcesInternal(businessId);
      const source = sources.find((entry) => entry.id === sourceId);

      if (!source) {
        await markJobTerminalFailed(job.id, "Workspace knowledge source no longer exists.");
        jobsFailed += 1;
        continue;
      }

      await updateSourceProcessingState(source.id, {
        processingStatus: "processing",
        processingError: undefined,
      });
      await upsertWorkspaceKnowledgeProfile(businessId, {
        processingStatus: "processing",
        processingError: undefined,
      });

      const resolved = await resolveProcessedSource(source);
      await updateSourceProcessingState(source.id, {
        processingStatus: "completed",
        processingError: undefined,
        extractedText: resolved.extractedText,
        metadata: resolved.metadata,
        title: resolved.title,
      });
      sourcesProcessed += 1;

      const refreshedSources = await loadWorkspaceKnowledgeSourcesInternal(businessId);
      const completedSources = refreshedSources.filter((entry) => entry.processingStatus === "completed");
      const extractedProfile = await deriveWorkspaceKnowledgeProfile(businessId, completedSources);

      await upsertWorkspaceKnowledgeProfile(businessId, {
        voiceSummary: extractedProfile.voiceSummary,
        audienceSummary: extractedProfile.audienceSummary,
        positioningSummary: extractedProfile.positioningSummary,
        beliefs: extractedProfile.beliefs,
        topicClusters: extractedProfile.topicClusters,
        sourceCount: completedSources.length,
        processingStatus: "completed",
        processingError: undefined,
        touchProcessedAt: true,
      });
      profilesUpdated += 1;

      await markJobCompleted(job.id);
      jobsCompleted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workspace knowledge processing failed.";
      await updateSourceProcessingState(sourceId, {
        processingStatus: "failed",
        processingError: message,
      });
      await upsertWorkspaceKnowledgeProfile(businessId, {
        processingStatus: "failed",
        processingError: message,
      });
      await markJobFailed(job.id, message);
      jobsFailed += 1;
    }
  }

  return {
    jobsClaimed: jobs.length,
    jobsCompleted,
    jobsFailed,
    sourcesProcessed,
    profilesUpdated,
  };
}
