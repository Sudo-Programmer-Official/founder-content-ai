import type { QueryResultRow } from "pg";
import type {
  ContentGenerationSuggestion,
  ContentAiEditPreview,
  ContentAsset,
  ContentAssetStatus,
  ControlDashboardResponse,
  CreateContentPipelineItemRequest,
  CreateContentPipelineItemResponse,
  DeleteContentPipelineItemResponse,
  DuplicateContentPipelineItemResponse,
  ConvertIdeaToContentRequest,
  ConvertIdeaToContentResponse,
  CreateIdeaInboxRequest,
  CreateIdeaInboxResponse,
  DashboardSuggestion,
  IdeaInboxItem,
  ListContentGenerationSuggestionsResponse,
  PreviewContentAiEditRequest,
  RepurposeStrategy,
  UpdateContentPipelineItemRequest,
  UpdateContentPipelineItemResponse,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { requireBusinessMembership } from "./authBusinessService.ts";
import { generatePostsWithAI } from "./aiService.ts";
import {
  createContentAssetRecord,
  logEvent,
} from "./analytics/eventLoggingService.ts";
import { syncRecentWorkspaceMetrics } from "./analytics/metricsAggregationService.ts";
import {
  buildContentAssetIntelligenceFromText,
  buildDashboardIntelligenceSummary,
  resolveStoredContentAssetIntelligence,
} from "./contentIntelligenceService.ts";
import {
  loadContentGenerationSuggestionFeedbackSummary,
  type ContentGenerationSuggestionFeedbackSummary,
  safeRecordContentGenerationSuggestionEdited,
  safeRecordContentGenerationSuggestionPublished,
} from "./contentGenerationFeedbackService.ts";
import { resolveContentGenerationTone } from "./contentGenerationToneService.ts";
import { previewContentIngestion } from "./content/ingestionService.ts";
import { getBrandPromptContextForBusiness } from "./brandIntelligence/brandProfileService.ts";
import { recommendPostTimes } from "./growthIntelligenceService.ts";
import {
  claimQueuedJobs,
  createJob,
  markJobCompleted,
  markJobFailed,
  markJobTerminalFailed,
} from "./jobQueueService.ts";
import { queryDb, withDbTransaction } from "./db/client.ts";
import {
  enforceWorkspaceReadAccess,
  enforceWorkspaceWriteAccess,
} from "./governanceService.ts";
import { generateContentAiEditPreview } from "./aiEditService.ts";
import { recordStyleSignal } from "./styleProfileService.ts";
import { HttpError } from "../utils/http.ts";
import { logError } from "../utils/logger.ts";

interface IdeaInboxRow extends QueryResultRow {
  id: string;
  business_id: string;
  user_id: string | null;
  body: string;
  input_type: IdeaInboxItem["inputType"];
  raw_input: string | null;
  processed_text: string | null;
  source_metadata: unknown;
  understanding_json: unknown | null;
  understanding_status: IdeaInboxItem["understandingStatus"];
  understanding_confidence_score: string | number | null;
  understanding_error: string | null;
  understanding_job_id: string | null;
  status: IdeaInboxItem["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface IdeaProcessingJobPayload {
  ideaId: string;
}

interface ContentAssetRow extends QueryResultRow {
  id: string;
  business_id: string | null;
  user_id: string | null;
  content_type: ContentAsset["contentType"];
  title: string | null;
  content_body: unknown;
  status: ContentAssetStatus;
  pipeline_stage: NonNullable<ContentAsset["pipelineStage"]> | null;
  source_kind: NonNullable<ContentAsset["sourceKind"]> | null;
  source_idea_id: string | null;
  content_metadata: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ActivityRow extends QueryResultRow {
  created_at: Date | string | null;
}

interface ActivityDateRow extends QueryResultRow {
  activity_date: Date | string;
}

interface PublishedPostRow extends QueryResultRow {
  published_at: Date | string;
}

interface PostPerformanceSignalRow extends QueryResultRow {
  scheduled_post_id: string;
  asset_group_id: string | null;
  performance_label: "low" | "medium" | "high" | null;
  engagement_score: string | number | null;
  published_at: Date | string | null;
}

interface WorkspaceMetricRow extends QueryResultRow {
  id: string;
  business_id: string;
  date: string;
  total_generations: string | number;
  total_copies: string | number;
  total_remixes: string | number;
  total_publishes: string | number;
  posts_created: string | number;
  posts_scheduled: string | number;
  posts_published: string | number;
  emails_sent: string | number;
  active_flag: boolean;
  last_active_at: Date | string | null;
  created_at: Date | string;
}

interface TimestampRow extends QueryResultRow {
  value_at: Date | string;
}

const PIPELINE_STAGES = [
  { stage: "draft", label: "Draft" },
  { stage: "review", label: "Review" },
  { stage: "scheduled", label: "Scheduled" },
  { stage: "posted", label: "Posted" },
] as const;
const IDEA_INPUT_TYPES = new Set<IdeaInboxItem["inputType"]>(["text", "voice", "image", "link"]);
const ZERO_INPUT_STRATEGIES: RepurposeStrategy[] = ["continue", "contrarian", "tactical"];

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeIdeaInputType(value: string | undefined): IdeaInboxItem["inputType"] {
  return value && IDEA_INPUT_TYPES.has(value as IdeaInboxItem["inputType"])
    ? (value as IdeaInboxItem["inputType"])
    : "text";
}

function normalizeIdeaMetadata(value: unknown): NonNullable<IdeaInboxItem["metadata"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const candidate = value as Record<string, unknown>;

  return {
    sourceUrl:
      typeof candidate.sourceUrl === "string" && candidate.sourceUrl.trim() !== ""
        ? candidate.sourceUrl.trim()
        : undefined,
    hostname:
      typeof candidate.hostname === "string" && candidate.hostname.trim() !== ""
        ? candidate.hostname.trim()
        : undefined,
    fileName:
      typeof candidate.fileName === "string" && candidate.fileName.trim() !== ""
        ? candidate.fileName.trim()
        : undefined,
    mimeType:
      typeof candidate.mimeType === "string" && candidate.mimeType.trim() !== ""
        ? candidate.mimeType.trim()
        : undefined,
    sizeBytes: Number.isFinite(Number(candidate.sizeBytes)) ? Number(candidate.sizeBytes) : undefined,
    width: Number.isFinite(Number(candidate.width)) ? Number(candidate.width) : undefined,
    height: Number.isFinite(Number(candidate.height)) ? Number(candidate.height) : undefined,
  };
}

function normalizeIdeaUnderstandingStatus(value: unknown): IdeaInboxItem["understandingStatus"] {
  return value === "processing" || value === "completed" || value === "failed"
    ? value
    : "queued";
}

function normalizeIdeaUnderstanding(value: unknown): IdeaInboxItem["understanding"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const topic = normalizeText(typeof candidate.topic === "string" ? candidate.topic : undefined);
  const businessAngle = normalizeText(
    typeof candidate.businessAngle === "string" ? candidate.businessAngle : undefined,
  );
  const povSummary = normalizeText(
    typeof candidate.povSummary === "string" ? candidate.povSummary : undefined,
  );

  if (!topic || !businessAngle || !povSummary) {
    return undefined;
  }

  const intent =
    candidate.intent === "educate"
    || candidate.intent === "story"
    || candidate.intent === "opinion"
    || candidate.intent === "proof"
      ? candidate.intent
      : "educate";
  const contentType =
    candidate.contentType === "insight"
    || candidate.contentType === "story"
    || candidate.contentType === "opinion"
    || candidate.contentType === "proof"
      ? candidate.contentType
      : "insight";

  return {
    topic,
    intent,
    contentType,
    businessGoal: normalizeText(
      typeof candidate.businessGoal === "string" ? candidate.businessGoal : undefined,
    ),
    businessAngle,
    povSummary,
    suggestedCta: normalizeText(
      typeof candidate.suggestedCta === "string" ? candidate.suggestedCta : undefined,
    ),
    confidenceScore: Number.isFinite(Number(candidate.confidenceScore ?? candidate.confidence_score))
      ? Number(candidate.confidenceScore ?? candidate.confidence_score)
      : undefined,
  };
}

function mergeIdeaMetadata(
  base: IdeaInboxItem["metadata"],
  additions: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(base ?? {}),
    ...additions,
  };
}

function deriveIdeaConfidenceScore(input: {
  inputType: IdeaInboxItem["inputType"];
  text: string;
}): number {
  const normalizedLength = input.text.trim().length;

  if (input.inputType === "image") {
    return 0.48;
  }

  if (input.inputType === "link") {
    return normalizedLength >= 80 ? 0.68 : 0.58;
  }

  if (input.inputType === "voice") {
    return normalizedLength >= 120 ? 0.82 : 0.74;
  }

  if (normalizedLength >= 180) {
    return 0.88;
  }

  if (normalizedLength >= 80) {
    return 0.78;
  }

  return 0.64;
}

function resolveIdeaPromptSeed(row: IdeaInboxRow): string {
  return normalizeText(row.processed_text ?? undefined)
    ?? normalizeText(row.body)
    ?? normalizeText(row.raw_input ?? undefined)
    ?? "";
}

function resolveIdeaLinkUrl(
  rawInput: string | null,
  metadata: IdeaInboxItem["metadata"],
): string | undefined {
  const directUrl = normalizeText(metadata?.sourceUrl) ?? normalizeText(rawInput ?? undefined);

  if (!directUrl) {
    return undefined;
  }

  try {
    return new URL(directUrl).toString();
  } catch {
    return undefined;
  }
}

function buildIdeaFallbackText(input: {
  inputType: IdeaInboxItem["inputType"];
  rawInput?: string;
  metadata?: IdeaInboxItem["metadata"];
}): string | undefined {
  if (input.inputType === "image") {
    const fileName = normalizeText(input.metadata?.fileName);
    return fileName
      ? `Screenshot capture from ${fileName.replace(/\.[a-z0-9]+$/i, "")}.`
      : "Screenshot capture shared by the workspace.";
  }

  if (input.inputType === "link") {
    const hostname = normalizeText(input.metadata?.hostname);
    const sourceUrl = normalizeText(input.metadata?.sourceUrl) ?? normalizeText(input.rawInput);

    if (hostname) {
      return `Link capture from ${hostname}.`;
    }

    if (sourceUrl) {
      return `Link capture from ${sourceUrl}.`;
    }
  }

  return normalizeText(input.rawInput);
}

function classifyIdeaIntent(
  text: string,
  inputType: IdeaInboxItem["inputType"],
): NonNullable<IdeaInboxItem["understanding"]>["intent"] {
  const lowered = text.toLowerCase();

  if (inputType === "image" || /\b(screenshot|revenue|growth|results|proof|launched|shipped|users|mrr)\b/.test(lowered)) {
    return "proof";
  }

  if (/\b(i |we |my |our |today |learned |realized |mistake |failed |struggled |story)\b/.test(lowered)) {
    return "story";
  }

  if (/\b(should|must|wrong|hot take|opinion|believe|stop|start)\b/.test(lowered)) {
    return "opinion";
  }

  return "educate";
}

function classifyIdeaContentType(
  intent: NonNullable<IdeaInboxItem["understanding"]>["intent"],
): NonNullable<IdeaInboxItem["understanding"]>["contentType"] {
  switch (intent) {
    case "story":
      return "story";
    case "opinion":
      return "opinion";
    case "proof":
      return "proof";
    default:
      return "insight";
  }
}

function summarizeIdeaTopic(text: string, brandTopics: string[]): string {
  const lowered = text.toLowerCase();
  const matchedTopic = brandTopics.find((topic) => lowered.includes(topic.toLowerCase()));

  if (matchedTopic) {
    return matchedTopic;
  }

  const firstSentence = text
    .split(/[\n.!?]/)
    .map((segment) => segment.trim())
    .find((segment) => segment.length > 0);

  if (!firstSentence) {
    return "Founder insight";
  }

  return firstSentence.length > 72 ? `${firstSentence.slice(0, 69).trim()}...` : firstSentence;
}

function selectPrimaryBusinessGoal(goals: string[]): string | undefined {
  return goals[0];
}

function humanizeBusinessGoal(goal: string | undefined): string | undefined {
  switch (goal) {
    case "get_clients":
      return "client acquisition";
    case "build_audience":
      return "audience growth";
    case "stay_consistent":
      return "consistency";
    case "promote_product_service":
      return "product positioning";
    default:
      return goal ? goal.replace(/_/g, " ") : undefined;
  }
}

function deriveBusinessAngle(input: {
  businessGoal?: string;
  inputType: IdeaInboxItem["inputType"];
  intent: NonNullable<IdeaInboxItem["understanding"]>["intent"];
  topic: string;
}): string {
  const goal = humanizeBusinessGoal(input.businessGoal);

  if (goal === "client acquisition") {
    return `Turn this into a trust-building founder post that makes the problem, credibility, and next step obvious.`;
  }

  if (goal === "audience growth") {
    return `Shape this into a sharp founder insight that earns attention fast and is easy to remember.`;
  }

  if (goal === "product positioning") {
    return `Use this idea to clarify why the product matters and what the audience should understand differently.`;
  }

  if (goal === "consistency") {
    return `Keep this practical and easy to ship so the workspace stays visible without sounding filler-heavy.`;
  }

  if (input.inputType === "image") {
    return "Use the screenshot as proof, then add the lesson or decision behind it.";
  }

  if (input.intent === "story") {
    return `Anchor the story in one lesson about ${input.topic} instead of retelling everything.`;
  }

  if (input.intent === "proof") {
    return `Lead with the result, then explain the lesson behind ${input.topic}.`;
  }

  return `Sharpen ${input.topic} into one clear founder point with a subtle business reason to care.`;
}

function deriveSuggestedCta(goal: string | undefined): string | undefined {
  switch (goal) {
    case "get_clients":
      return "Invite the right buyer to reply or ask for help.";
    case "build_audience":
      return "End with one thought that makes builders want to follow along.";
    case "promote_product_service":
      return "Land on what the product changes, not a hard sell.";
    case "stay_consistent":
      return "Keep the close simple so it is easy to post, not overworked.";
    default:
      return "Close with one clear takeaway or next thought.";
  }
}

function buildIdeaPovSummary(input: {
  intent: NonNullable<IdeaInboxItem["understanding"]>["intent"];
  businessGoal?: string;
  topic: string;
}): string {
  const goal = humanizeBusinessGoal(input.businessGoal);

  if (goal) {
    return `Use a ${input.intent} angle on ${input.topic} in service of ${goal}.`;
  }

  return `Use a ${input.intent} angle on ${input.topic} with a sharper founder point of view.`;
}

function deriveIdeaUnderstanding(input: {
  text: string;
  inputType: IdeaInboxItem["inputType"];
  brandContext?: { goals?: string[]; topics?: string[] };
}): NonNullable<IdeaInboxItem["understanding"]> {
  const topic = summarizeIdeaTopic(input.text, input.brandContext?.topics ?? []);
  const intent = classifyIdeaIntent(input.text, input.inputType);
  const contentType = classifyIdeaContentType(intent);
  const businessGoal = selectPrimaryBusinessGoal(input.brandContext?.goals ?? []);
  const businessAngle = deriveBusinessAngle({
    businessGoal,
    inputType: input.inputType,
    intent,
    topic,
  });

  return {
    topic,
    intent,
    contentType,
    businessGoal,
    businessAngle,
    povSummary: buildIdeaPovSummary({
      intent,
      businessGoal,
      topic,
    }),
    suggestedCta: deriveSuggestedCta(businessGoal),
    confidenceScore: deriveIdeaConfidenceScore({
      inputType: input.inputType,
      text: input.text,
    }),
  };
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return "";
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

  return "";
}

function mapIdeaInboxItem(row: IdeaInboxRow): IdeaInboxItem {
  const metadata = normalizeIdeaMetadata(row.source_metadata);
  const sourceMetadataRecord =
    row.source_metadata && typeof row.source_metadata === "object" && !Array.isArray(row.source_metadata)
      ? (row.source_metadata as Record<string, unknown>)
      : {};
  const understanding =
    normalizeIdeaUnderstanding(row.understanding_json)
    ?? normalizeIdeaUnderstanding(sourceMetadataRecord.understanding);
  const understandingConfidenceScore =
    Number.isFinite(Number(row.understanding_confidence_score))
      ? Number(row.understanding_confidence_score)
      : understanding?.confidenceScore;

  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id ?? undefined,
    inputType: normalizeIdeaInputType(row.input_type),
    text: normalizeText(row.processed_text ?? undefined) ?? row.body,
    rawInput: row.raw_input ?? undefined,
    metadata,
    understanding,
    understandingStatus: normalizeIdeaUnderstandingStatus(row.understanding_status),
    understandingError: normalizeText(row.understanding_error ?? undefined),
    understandingConfidenceScore,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
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
    intelligence: resolveStoredContentAssetIntelligence(row.content_metadata, textContent),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  return (lastSpaceIndex > 80 ? truncated.slice(0, lastSpaceIndex) : truncated).trim();
}

function extractOpeningLine(text: string): string {
  return text
    .split("\n")
    .map((line) => normalizeText(line))
    .find((line): line is string => Boolean(line))
    ?? "";
}

function buildSuggestionTopicLabel(asset: ContentAsset): string {
  return normalizeText(asset.title)
    ?? truncateText(extractOpeningLine(asset.textContent ?? ""), 72)
    ?? "your recent post";
}

function buildSuggestionPreviewText(asset: ContentAsset): string {
  return truncateText(normalizeText(asset.textContent ?? "") ?? "", 180);
}

function buildTopicFingerprint(asset: ContentAsset): string {
  const source = `${buildSuggestionTopicLabel(asset)} ${extractOpeningLine(asset.textContent ?? "")}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/gi, " ");

  const tokens = source
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  return tokens.slice(0, 6).join(" ");
}

function stagePriority(stage: ContentAsset["pipelineStage"]): number {
  switch (stage) {
    case "posted":
      return 42;
    case "scheduled":
      return 32;
    case "review":
      return 24;
    case "draft":
      return 18;
    default:
      return 12;
  }
}

function performancePriority(label: PostPerformanceSignalRow["performance_label"] | undefined): number {
  switch (label) {
    case "high":
      return 36;
    case "medium":
      return 20;
    case "low":
      return 6;
    default:
      return 0;
  }
}

function clampLearningScore(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function learningPriority(input: {
  strategy: RepurposeStrategy;
  asset: ContentAsset;
  feedbackSummary: ContentGenerationSuggestionFeedbackSummary;
}): number {
  const strategyScore = clampLearningScore(
    input.feedbackSummary.strategyScores.get(input.strategy) ?? 0,
    -4,
    8,
  );
  const sourceScore = clampLearningScore(
    input.feedbackSummary.sourceAssetScores.get(input.asset.id) ?? 0,
    -5,
    9,
  );
  const sourceStrategyScore = clampLearningScore(
    input.feedbackSummary.sourceStrategyScores.get(`${input.asset.id}:${input.strategy}`) ?? 0,
    -6,
    10,
  );

  return strategyScore * 0.9 + sourceScore * 0.7 + sourceStrategyScore;
}

function strategyFitPriority(strategy: RepurposeStrategy, asset: ContentAsset): number {
  switch (strategy) {
    case "continue":
      return asset.pipelineStage === "posted" || asset.pipelineStage === "scheduled" ? 18 : 8;
    case "contrarian":
      return asset.intelligence?.pov?.boldness === "bold"
        ? 18
        : asset.intelligence?.hookType === "bold_statement"
          ? 15
          : 10;
    case "tactical":
      return asset.intelligence?.format === "list"
        ? 18
        : asset.intelligence?.format === "insight"
          ? 14
          : asset.intelligence?.length === "long"
            ? 12
            : 8;
    default:
      return 8;
  }
}

function buildSuggestionReason(input: {
  asset: ContentAsset;
  strategy: RepurposeStrategy;
  performanceLabel?: PostPerformanceSignalRow["performance_label"];
}): string {
  const stageLabel = input.asset.pipelineStage === "posted"
    ? "published"
    : input.asset.pipelineStage === "scheduled"
      ? "scheduled"
      : input.asset.pipelineStage === "review"
        ? "review-ready"
        : "draft";
  const performanceLabel = input.performanceLabel
    ? `${input.performanceLabel}-performing`
    : "recent";

  switch (input.strategy) {
    case "continue":
      return `Built from a ${performanceLabel} ${stageLabel} post so the narrative keeps compounding.`;
    case "contrarian":
      return `Uses a ${performanceLabel} ${stageLabel} idea and pushes it into a sharper point of view.`;
    case "tactical":
      return `Turns a ${performanceLabel} ${stageLabel} insight into something founders can apply immediately.`;
    default:
      return `Built from a ${performanceLabel} ${stageLabel} post.`;
  }
}

function buildGenerationSuggestion(input: {
  asset: ContentAsset;
  strategy: RepurposeStrategy;
  performanceLabel?: PostPerformanceSignalRow["performance_label"];
  recommended: boolean;
}): ContentGenerationSuggestion {
  const topicLabel = buildSuggestionTopicLabel(input.asset);
  const previewText = buildSuggestionPreviewText(input.asset);

  switch (input.strategy) {
    case "continue":
      return {
        id: `${input.asset.id}:continue`,
        title: `Continue the thread on ${topicLabel}`,
        description: "Keep the narrative moving with the next logical founder post.",
        rationale: buildSuggestionReason(input),
        strategy: input.strategy,
        sourceAssetId: input.asset.id,
        sourceTitle: topicLabel,
        sourceStage: input.asset.pipelineStage,
        sourceText: input.asset.textContent ?? "",
        previewText,
        recommended: input.recommended,
        performanceLabel: input.performanceLabel ?? undefined,
      };
    case "deepen":
      return {
        id: `${input.asset.id}:deepen`,
        title: `Go deeper on ${topicLabel}`,
        description: "Push the same topic into a sharper second-layer founder post.",
        rationale: buildSuggestionReason({
          ...input,
          strategy: "continue",
        }),
        strategy: input.strategy,
        sourceAssetId: input.asset.id,
        sourceTitle: topicLabel,
        sourceStage: input.asset.pipelineStage,
        sourceText: input.asset.textContent ?? "",
        previewText,
        recommended: input.recommended,
        performanceLabel: input.performanceLabel ?? undefined,
      };
    case "contrarian":
      return {
        id: `${input.asset.id}:contrarian`,
        title: `Take a sharper stance on ${topicLabel}`,
        description: "Turn the same theme into a stronger, more opinionated founder take.",
        rationale: buildSuggestionReason(input),
        strategy: input.strategy,
        sourceAssetId: input.asset.id,
        sourceTitle: topicLabel,
        sourceStage: input.asset.pipelineStage,
        sourceText: input.asset.textContent ?? "",
        previewText,
        recommended: input.recommended,
        performanceLabel: input.performanceLabel ?? undefined,
      };
    case "tactical":
      return {
        id: `${input.asset.id}:tactical`,
        title: `Make ${topicLabel} practical`,
        description: "Convert the insight into a useful post with clear decisions or actions.",
        rationale: buildSuggestionReason(input),
        strategy: input.strategy,
        sourceAssetId: input.asset.id,
        sourceTitle: topicLabel,
        sourceStage: input.asset.pipelineStage,
        sourceText: input.asset.textContent ?? "",
        previewText,
        recommended: input.recommended,
        performanceLabel: input.performanceLabel ?? undefined,
      };
    default:
      return {
        id: `${input.asset.id}:${input.strategy}`,
        title: `Continue the thread on ${topicLabel}`,
        description: "Keep the narrative moving with the next logical founder post.",
        rationale: buildSuggestionReason({
          ...input,
          strategy: "continue",
        }),
        strategy: input.strategy,
        sourceAssetId: input.asset.id,
        sourceTitle: topicLabel,
        sourceStage: input.asset.pipelineStage,
        sourceText: input.asset.textContent ?? "",
        previewText,
        recommended: input.recommended,
        performanceLabel: input.performanceLabel ?? undefined,
      };
  }
}

function buildDateLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date());
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildUtcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function listRecentDateKeys(days: number): string[] {
  const today = new Date();
  const keys: string[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const cursor = new Date(today);
    cursor.setUTCDate(today.getUTCDate() - offset);
    keys.push(buildUtcDateKey(cursor));
  }

  return keys;
}

async function loadPipelineItems(businessId: string): Promise<ContentAsset[]> {
  const result = await queryDb<ContentAssetRow>(
    `
      select
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
      from content_assets
      where business_id = $1
      order by updated_at desc, created_at desc
      limit 40
    `,
    [businessId],
  );

  return result.rows.map(mapContentAsset);
}

async function loadPipelineAssetRow(
  businessId: string,
  assetId: string,
): Promise<ContentAssetRow | null> {
  const result = await queryDb<ContentAssetRow>(
    `
      select
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
      from content_assets
      where id = $1
        and business_id = $2
      limit 1
    `,
    [assetId, businessId],
  );

  return result.rows[0] ?? null;
}

function buildDuplicateTitle(title: string | null, textContent: string): string {
  const normalizedTitle = normalizeText(title ?? undefined);
  const fallbackTitle = textContent.slice(0, 80).trim() || "Untitled draft";
  const baseTitle = normalizedTitle ?? fallbackTitle;
  return `${baseTitle} (Copy)`.slice(0, 120);
}

async function loadActiveScheduledPostCount(
  businessId: string,
  assetId: string,
): Promise<number> {
  const result = await queryDb<{ total: string | number }>(
    `
      select count(*)::int as total
      from scheduled_posts
      where business_id = $1
        and asset_group_id = $2
        and status in ('scheduled', 'processing', 'paused', 'failed')
    `,
    [businessId, assetId],
  );

  return Number(result.rows[0]?.total ?? 0);
}

async function loadIdeaInbox(businessId: string): Promise<IdeaInboxItem[]> {
  const result = await queryDb<IdeaInboxRow>(
    `
      select
        id,
        business_id,
        user_id,
        body,
        input_type,
        raw_input,
        processed_text,
        source_metadata,
        understanding_json,
        understanding_status,
        understanding_confidence_score,
        understanding_error,
        understanding_job_id,
        status,
        created_at,
        updated_at
      from idea_inbox_items
      where business_id = $1
        and status <> 'archived'
      order by created_at desc
      limit 12
    `,
    [businessId],
  );

  return result.rows.map(mapIdeaInboxItem);
}

async function loadLastActivityAt(businessId: string): Promise<string | undefined> {
  const result = await queryDb<ActivityRow>(
    `
      select max(activity_at) as created_at
      from (
        select max(created_at) as activity_at
        from usage_events
        where business_id = $1
        union all
        select max(created_at) as activity_at
        from content_assets
        where business_id = $1
        union all
        select max(created_at) as activity_at
        from scheduled_posts
        where business_id = $1
        union all
        select max(published_at) as activity_at
        from scheduled_posts
        where business_id = $1
          and published_at is not null
        union all
        select max(r.sent_at) as activity_at
        from email_campaign_recipients r
        inner join email_campaigns c on c.id = r.campaign_id
        where c.business_id = $1
          and r.sent_at is not null
      ) activity
      limit 1
    `,
    [businessId],
  );

  const createdAt = result.rows[0]?.created_at;
  return createdAt ? toIsoString(createdAt) : undefined;
}

async function buildIdeaConversionText(row: IdeaInboxRow): Promise<string> {
  const promptSeed = resolveIdeaPromptSeed(row);
  const metadata = normalizeIdeaMetadata(row.source_metadata);
  const sourceMetadataRecord =
    row.source_metadata && typeof row.source_metadata === "object" && !Array.isArray(row.source_metadata)
      ? (row.source_metadata as Record<string, unknown>)
      : {};
  const understanding =
    normalizeIdeaUnderstanding(row.understanding_json)
    ?? normalizeIdeaUnderstanding(sourceMetadataRecord.understanding);
  const brandContext = (await getBrandPromptContextForBusiness(row.business_id)) ?? {};
  const businessContextLines = [
    understanding?.topic ? `Topic: ${understanding.topic}` : undefined,
    understanding?.intent ? `Intent: ${understanding.intent}` : undefined,
    understanding?.contentType ? `Content type: ${understanding.contentType}` : undefined,
    understanding?.businessGoal ? `Business goal: ${humanizeBusinessGoal(understanding.businessGoal)}` : undefined,
    understanding?.businessAngle ? `Business angle: ${understanding.businessAngle}` : undefined,
    understanding?.povSummary ? `POV steer: ${understanding.povSummary}` : undefined,
    understanding?.suggestedCta ? `CTA steer: ${understanding.suggestedCta}` : undefined,
    brandContext.goals && brandContext.goals.length > 0 ? `Workspace goals: ${brandContext.goals.join(", ")}` : undefined,
    brandContext.topics && brandContext.topics.length > 0 ? `Workspace topics: ${brandContext.topics.join(", ")}` : undefined,
  ].filter((segment): segment is string => Boolean(segment));
  const appendedBusinessContext =
    businessContextLines.length > 0
      ? `${promptSeed}\n\nBusiness context\n${businessContextLines.join("\n")}`.trim()
      : promptSeed;

  if (normalizeIdeaInputType(row.input_type) === "link") {
    const sourceUrl = resolveIdeaLinkUrl(row.raw_input, metadata);

    if (sourceUrl) {
      try {
        const preview = await previewContentIngestion({
          contextText: appendedBusinessContext || undefined,
          sourceUrls: [{ url: sourceUrl, label: metadata.hostname ?? "Saved link" }],
        });

        if (preview.combinedText.trim() !== "") {
          return preview.combinedText.trim();
        }
      } catch {
        // Fall back to the saved link reference below if the source is unavailable.
      }
    }

    return [appendedBusinessContext, sourceUrl ? `Source link: ${sourceUrl}` : ""]
      .filter((segment) => segment.trim() !== "")
      .join("\n\n");
  }

  if (normalizeIdeaInputType(row.input_type) === "image") {
    return [
      appendedBusinessContext || "Screenshot capture shared by the workspace.",
      "Turn this screenshot or visual proof into a founder-style post with one clear takeaway.",
    ]
      .filter((segment) => segment.trim() !== "")
      .join("\n\n");
  }

  if (normalizeIdeaInputType(row.input_type) === "voice") {
    return appendedBusinessContext || "Voice note shared by the workspace.";
  }

  return appendedBusinessContext;
}

function resolveIdeaProcessingPriority(): number {
  const parsed = Number(process.env.IDEA_PROCESS_JOB_PRIORITY ?? 60);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 60;
}

function resolveIdeaProcessingBatchSize(): number {
  const parsed = Number(process.env.IDEA_PROCESS_BATCH_SIZE ?? 5);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
}

async function updateIdeaUnderstandingState(
  ideaId: string,
  input: {
    understandingStatus: IdeaInboxItem["understandingStatus"];
    understanding?: IdeaInboxItem["understanding"];
    understandingConfidenceScore?: number;
    understandingError?: string | null;
    understandingJobId?: string | null;
  },
): Promise<void> {
  await queryDb(
    `
      update idea_inbox_items
      set
        understanding_json = coalesce($2::jsonb, understanding_json),
        understanding_status = $3,
        understanding_confidence_score = coalesce($4::numeric, understanding_confidence_score),
        understanding_error = $5,
        understanding_job_id = coalesce($6::uuid, understanding_job_id),
        source_metadata = case
          when $2::jsonb is null then source_metadata
          else jsonb_set(coalesce(source_metadata, '{}'::jsonb), '{understanding}', $2::jsonb, true)
        end,
        updated_at = now()
      where id = $1::uuid
    `,
    [
      ideaId,
      input.understanding ? JSON.stringify(input.understanding) : null,
      input.understandingStatus,
      input.understandingConfidenceScore ?? null,
      input.understandingError ?? null,
      input.understandingJobId ?? null,
    ],
  );
}

export async function processQueuedIdeaUnderstandingJobs(): Promise<{
  jobsClaimed: number;
  jobsCompleted: number;
  jobsFailed: number;
}> {
  const queuedJobs = await claimQueuedJobs<IdeaProcessingJobPayload>({
    types: ["idea_process"],
    batchSize: resolveIdeaProcessingBatchSize(),
    lockedBy: process.env.RENDER_SERVICE_NAME?.trim() || `app-worker:${process.pid}`,
    staleAfterMinutes: 20,
  });

  let jobsCompleted = 0;
  let jobsFailed = 0;

  for (const job of queuedJobs) {
    const ideaId = job.payload.ideaId;

    if (!job.businessId || !ideaId) {
      await markJobTerminalFailed(job.id, "Idea processing job is missing required context.");
      jobsFailed += 1;
      continue;
    }

    try {
      const result = await queryDb<IdeaInboxRow>(
        `
          select
            id,
            business_id,
            user_id,
            body,
            input_type,
            raw_input,
            processed_text,
            source_metadata,
            understanding_json,
            understanding_status,
            understanding_confidence_score,
            understanding_error,
            understanding_job_id,
            status,
            created_at,
            updated_at
          from idea_inbox_items
          where id = $1::uuid
            and business_id = $2::uuid
          limit 1
        `,
        [ideaId, job.businessId],
      );

      const row = result.rows[0];

      if (!row) {
        await markJobTerminalFailed(job.id, "Idea inbox item no longer exists.");
        jobsFailed += 1;
        continue;
      }

      await updateIdeaUnderstandingState(row.id, {
        understandingStatus: "processing",
        understandingJobId: job.id,
        understandingError: null,
      });

      const brandContext = await getBrandPromptContextForBusiness(row.business_id);
      const text = normalizeText(row.processed_text ?? undefined) ?? row.body;
      const understanding = deriveIdeaUnderstanding({
        text,
        inputType: normalizeIdeaInputType(row.input_type),
        brandContext,
      });

      await updateIdeaUnderstandingState(row.id, {
        understandingStatus: "completed",
        understanding,
        understandingConfidenceScore: understanding.confidenceScore,
        understandingError: null,
        understandingJobId: job.id,
      });
      await markJobCompleted(job.id);
      jobsCompleted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Idea understanding failed.";
      const willRetry = job.attempts < job.maxAttempts;

      try {
        await updateIdeaUnderstandingState(ideaId, {
          understandingStatus: willRetry ? "queued" : "failed",
          understandingError: willRetry ? null : message,
          understandingJobId: job.id,
        });
      } catch (stateError) {
        logError("Failed to update idea understanding state after worker error.", {
          message: stateError instanceof Error ? stateError.message : "Unknown state update error",
          ideaId,
          jobId: job.id,
        });
      }

      await markJobFailed(job.id, message);
      if (!willRetry) {
        jobsFailed += 1;
      }
    }
  }

  return {
    jobsClaimed: queuedJobs.length,
    jobsCompleted,
    jobsFailed,
  };
}

async function loadActivityDates(businessId: string): Promise<string[]> {
  const result = await queryDb<ActivityDateRow>(
    `
      select date::timestamptz as activity_date
      from workspace_metrics_daily
      where business_id = $1
        and active_flag = true
      order by activity_date desc
      limit 30
    `,
    [businessId],
  );

  return result.rows.map((row) => new Date(row.activity_date).toISOString().slice(0, 10));
}

async function loadPublishedPostDates(businessId: string): Promise<string[]> {
  const result = await queryDb<PublishedPostRow>(
    `
      select published_at
      from scheduled_posts
      where business_id = $1
        and status = 'published'
        and published_at is not null
      order by published_at desc
      limit 180
    `,
    [businessId],
  );

  return result.rows.map((row) => toIsoString(row.published_at));
}

async function loadRecentWorkspaceMetrics(businessId: string): Promise<WorkspaceMetricRow[]> {
  const result = await queryDb<WorkspaceMetricRow>(
    `
      select
        id,
        business_id,
        date::text as date,
        total_generations,
        total_copies,
        total_remixes,
        total_publishes,
        posts_created,
        posts_scheduled,
        posts_published,
        emails_sent,
        active_flag,
        last_active_at,
        created_at
      from workspace_metrics_daily
      where business_id = $1
      order by date desc
      limit 14
    `,
    [businessId],
  );

  return result.rows;
}

async function loadLastPublishedPostAt(businessId: string): Promise<string | undefined> {
  const result = await queryDb<TimestampRow>(
    `
      select published_at as value_at
      from scheduled_posts
      where business_id = $1
        and status = 'published'
        and published_at is not null
      order by published_at desc
      limit 1
    `,
    [businessId],
  );

  return result.rows[0]?.value_at ? toIsoString(result.rows[0].value_at) : undefined;
}

async function loadLastCampaignCompletedAt(businessId: string): Promise<string | undefined> {
  const result = await queryDb<TimestampRow>(
    `
      select send_completed_at as value_at
      from email_campaigns
      where business_id = $1
        and status in ('sent', 'failed')
        and send_completed_at is not null
      order by send_completed_at desc
      limit 1
    `,
    [businessId],
  );

  return result.rows[0]?.value_at ? toIsoString(result.rows[0].value_at) : undefined;
}

async function loadNextScheduledPostAt(businessId: string): Promise<string | undefined> {
  const result = await queryDb<TimestampRow>(
    `
      select scheduled_at as value_at
      from scheduled_posts
      where business_id = $1
        and status in ('scheduled', 'processing', 'paused', 'failed')
        and scheduled_at >= now()
      order by scheduled_at asc
      limit 1
    `,
    [businessId],
  );

  return result.rows[0]?.value_at ? toIsoString(result.rows[0].value_at) : undefined;
}

async function loadRecentPostPerformanceSignals(
  businessId: string,
): Promise<PostPerformanceSignalRow[]> {
  const result = await queryDb<PostPerformanceSignalRow>(
    `
      select
        sp.id as scheduled_post_id,
        sp.asset_group_id,
        pm.performance_label,
        pm.engagement_score,
        sp.published_at
      from post_metrics pm
      inner join scheduled_posts sp on sp.id = pm.scheduled_post_id
      where sp.business_id = $1
        and sp.status = 'published'
      order by coalesce(sp.published_at, pm.updated_at) desc
      limit 5
    `,
    [businessId],
  );

  return result.rows;
}

function selectSuggestionSource(input: {
  strategy: RepurposeStrategy;
  candidates: ContentAsset[];
  performanceByAssetId: Map<string, PostPerformanceSignalRow>;
  feedbackSummary: ContentGenerationSuggestionFeedbackSummary;
  usedFingerprints: Set<string>;
}): ContentAsset | null {
  const ranked = [...input.candidates]
    .sort((left, right) => {
      const leftPerformance = input.performanceByAssetId.get(left.id)?.performance_label;
      const rightPerformance = input.performanceByAssetId.get(right.id)?.performance_label;
      const leftQuality = left.intelligence?.quality?.overall ?? 0;
      const rightQuality = right.intelligence?.quality?.overall ?? 0;
      const leftRank =
        stagePriority(left.pipelineStage)
        + performancePriority(leftPerformance)
        + strategyFitPriority(input.strategy, left)
        + learningPriority({
          strategy: input.strategy,
          asset: left,
          feedbackSummary: input.feedbackSummary,
        })
        + leftQuality * 0.1;
      const rightRank =
        stagePriority(right.pipelineStage)
        + performancePriority(rightPerformance)
        + strategyFitPriority(input.strategy, right)
        + learningPriority({
          strategy: input.strategy,
          asset: right,
          feedbackSummary: input.feedbackSummary,
        })
        + rightQuality * 0.1;

      return rightRank - leftRank;
    });

  const distinct = ranked.find((asset) => !input.usedFingerprints.has(buildTopicFingerprint(asset)));
  return distinct ?? ranked[0] ?? null;
}

function buildContentGenerationSuggestions(input: {
  pipelineItems: ContentAsset[];
  recentPerformanceSignals: PostPerformanceSignalRow[];
  feedbackSummary: ContentGenerationSuggestionFeedbackSummary;
}): ContentGenerationSuggestion[] {
  const candidates = input.pipelineItems.filter((asset) =>
    asset.contentType === "post" && (asset.textContent?.trim().length ?? 0) >= 80
  );

  if (candidates.length === 0) {
    return [];
  }

  const performanceByAssetId = new Map(
    input.recentPerformanceSignals
      .filter((signal) => Boolean(signal.asset_group_id))
      .map((signal) => [signal.asset_group_id as string, signal]),
  );
  const usedFingerprints = new Set<string>();

  return ZERO_INPUT_STRATEGIES.flatMap((strategy, index) => {
    const asset = selectSuggestionSource({
      strategy,
      candidates,
      performanceByAssetId,
      feedbackSummary: input.feedbackSummary,
      usedFingerprints,
    });

    if (!asset) {
      return [];
    }

    usedFingerprints.add(buildTopicFingerprint(asset));

    return [
      buildGenerationSuggestion({
        asset,
        strategy,
        performanceLabel: performanceByAssetId.get(asset.id)?.performance_label,
        recommended: index === 0,
      }),
    ];
  });
}

function calculateStreakDays(activityDates: string[]): number {
  if (activityDates.length === 0) {
    return 0;
  }

  const uniqueDates = [...new Set(activityDates)];
  const latestDate = uniqueDates[0];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const latest = new Date(`${latestDate}T00:00:00.000Z`);
  const daysFromToday = Math.round((today.getTime() - latest.getTime()) / (24 * 60 * 60 * 1000));

  if (daysFromToday > 1) {
    return 0;
  }

  let streakDays = 0;
  let cursor = latest;

  for (const activityDate of uniqueDates) {
    const normalizedActivityDate = new Date(`${activityDate}T00:00:00.000Z`);

    if (normalizedActivityDate.getTime() !== cursor.getTime()) {
      break;
    }

    streakDays += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }

  return streakDays;
}

function buildRetentionSummary(input: {
  metrics: WorkspaceMetricRow[];
  fallbackStreakDays: number;
  lastActivityAt?: string;
}): ControlDashboardResponse["retention"] {
  const metricsByDate = new Map(input.metrics.map((row) => [row.date, row]));
  const recent7Keys = listRecentDateKeys(7);
  const previous7Keys = listRecentDateKeys(14).slice(7);
  const recent7Rows = recent7Keys.map((dateKey) => metricsByDate.get(dateKey));
  const previous7Rows = previous7Keys.map((dateKey) => metricsByDate.get(dateKey));

  const sumMetric = (
    rows: Array<WorkspaceMetricRow | undefined>,
    key: "posts_created" | "posts_scheduled" | "posts_published" | "emails_sent",
  ) => rows.reduce((total, row) => total + toNumber(row?.[key]), 0);

  const activeDays7d = recent7Rows.filter((row) => Boolean(row?.active_flag)).length;
  const previousActiveDays7d = previous7Rows.filter((row) => Boolean(row?.active_flag)).length;
  const postsCreated7d = sumMetric(recent7Rows, "posts_created");
  const postsScheduled7d = sumMetric(recent7Rows, "posts_scheduled");
  const postsPublished7d = sumMetric(recent7Rows, "posts_published");
  const emailsSent7d = sumMetric(recent7Rows, "emails_sent");
  const consistencyScore = Math.min(100, Math.round((activeDays7d / 7) * 100));
  const previousConsistencyScore = Math.min(100, Math.round((previousActiveDays7d / 7) * 100));
  const consistencyDelta = consistencyScore - previousConsistencyScore;
  const bestDayRow = [...recent7Rows]
    .filter((row): row is WorkspaceMetricRow => Boolean(row))
    .sort((left, right) => {
      const publishedDiff = toNumber(right.posts_published) - toNumber(left.posts_published);

      if (publishedDiff !== 0) {
        return publishedDiff;
      }

      return Number(new Date(right.date)) - Number(new Date(left.date));
    })[0];
  const bestDayLabel =
    bestDayRow && (toNumber(bestDayRow.posts_published) > 0 || bestDayRow.active_flag)
      ? new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(
          new Date(`${bestDayRow.date}T00:00:00.000Z`),
        )
      : undefined;

  const inactivityDays = input.lastActivityAt
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(input.lastActivityAt).getTime()) / (24 * 60 * 60 * 1000)),
      )
    : 999;

  if (inactivityDays >= 3) {
    return {
      activeDays7d,
      postsCreated7d,
      postsScheduled7d,
      postsPublished7d,
      emailsSent7d,
      consistencyScore,
      previousConsistencyScore,
      consistencyDelta,
      currentStreakDays: input.fallbackStreakDays,
      inactivityDays,
      bestDayLabel,
      nudgeTitle: `You haven't posted in ${inactivityDays} days.`,
      nudgeMessage: "Want me to generate something quick so the loop starts moving again?",
      nudgeActionLabel: "Create quick post",
      nudgeActionTarget: "open_creator",
    };
  }

  if (postsScheduled7d > postsPublished7d) {
    const backlogCount = postsScheduled7d - postsPublished7d;

    return {
      activeDays7d,
      postsCreated7d,
      postsScheduled7d,
      postsPublished7d,
      emailsSent7d,
      consistencyScore,
      previousConsistencyScore,
      consistencyDelta,
      currentStreakDays: input.fallbackStreakDays,
      inactivityDays,
      bestDayLabel,
      nudgeTitle: `${backlogCount} scheduled item${backlogCount === 1 ? "" : "s"} still need attention.`,
      nudgeMessage: "Open the planner and push the next one across the line instead of generating more.",
      nudgeActionLabel: "Open planner",
      nudgeActionTarget: "open_planner",
    };
  }

  if (input.fallbackStreakDays >= 3) {
    return {
      activeDays7d,
      postsCreated7d,
      postsScheduled7d,
      postsPublished7d,
      emailsSent7d,
      consistencyScore,
      previousConsistencyScore,
      consistencyDelta,
      currentStreakDays: input.fallbackStreakDays,
      inactivityDays,
      bestDayLabel,
      nudgeTitle: `You're on a ${input.fallbackStreakDays}-day streak.`,
      nudgeMessage: "Lock tomorrow in now so the consistency loop keeps compounding.",
      nudgeActionLabel: "Plan tomorrow",
      nudgeActionTarget: "open_planner",
    };
  }

  if (previousConsistencyScore > consistencyScore) {
    return {
      activeDays7d,
      postsCreated7d,
      postsScheduled7d,
      postsPublished7d,
      emailsSent7d,
      consistencyScore,
      previousConsistencyScore,
      consistencyDelta,
      currentStreakDays: input.fallbackStreakDays,
      inactivityDays,
      bestDayLabel,
      nudgeTitle: "Consistency slipped from last week.",
      nudgeMessage: "Plan the next three posts now so the system carries the load instead of memory.",
      nudgeActionLabel: "Plan next 3",
      nudgeActionTarget: "open_planner",
    };
  }

  return {
    activeDays7d,
    postsCreated7d,
    postsScheduled7d,
    postsPublished7d,
    emailsSent7d,
    consistencyScore,
    previousConsistencyScore,
    consistencyDelta,
    currentStreakDays: input.fallbackStreakDays,
    inactivityDays,
    bestDayLabel,
    nudgeTitle: "The system is staying warm.",
    nudgeMessage: "Queue the next post before momentum cools off and the week stays on track.",
    nudgeActionLabel: "Schedule next",
    nudgeActionTarget: "schedule_ready",
  };
}

function buildDashboardNextAction(input: {
  pipelineItems: ContentAsset[];
  retention: ControlDashboardResponse["retention"];
  nextScheduledPostAt?: string;
  recentPerformanceSignals: PostPerformanceSignalRow[];
}): ControlDashboardResponse["nextAction"] {
  const reviewItem = input.pipelineItems.find((item) => item.pipelineStage === "review");
  const draftItem = input.pipelineItems.find((item) => (item.pipelineStage ?? "draft") === "draft");
  const nowMs = Date.now();
  const nextScheduledAtMs = input.nextScheduledPostAt ? new Date(input.nextScheduledPostAt).getTime() : null;
  const hasScheduledSoon =
    typeof nextScheduledAtMs === "number"
    && Number.isFinite(nextScheduledAtMs)
    && nextScheduledAtMs >= nowMs
    && nextScheduledAtMs - nowMs <= 24 * 60 * 60 * 1000;
  const recentSignals = input.recentPerformanceSignals.slice(0, 3);
  const lowSignalCount = recentSignals.filter((signal) => signal.performance_label === "low").length;
  const averageEngagementScore =
    recentSignals.length > 0
      ? recentSignals.reduce((total, signal) => total + toNumber(signal.engagement_score), 0) / recentSignals.length
      : null;
  const underperformingRecentPosts =
    recentSignals.length >= 3 && (lowSignalCount >= 2 || (averageEngagementScore !== null && averageEngagementScore <= 0.35));
  const improvementAssetId =
    recentSignals.find((signal) => signal.asset_group_id)?.asset_group_id ?? draftItem?.id;

  if (hasScheduledSoon) {
    return {
      type: "review",
      title: "You already have a post about to go live.",
      description: "Open the planner and review the next slot before it publishes so nothing feels accidental.",
      cta: "Review scheduled post",
      route: "/app/planner",
    };
  }

  if (reviewItem) {
    return {
      type: "schedule",
      title: "You already have a draft ready to ship.",
      description: `Move "${reviewItem.title ?? "this ready post"}" into the planner instead of generating another draft.`,
      cta: "Schedule ready draft",
      route: `/app/planner?draftId=${encodeURIComponent(reviewItem.id)}`,
    };
  }

  if (input.retention.inactivityDays >= 3) {
    return {
      type: "generate",
      title: `You haven't posted in ${input.retention.inactivityDays} days.`,
      description: "Restart the loop with one quick post. Momentum matters more than making the next draft perfect.",
      cta: "Generate a quick post",
      route: "/app/create",
    };
  }

  if (underperformingRecentPosts && improvementAssetId) {
    return {
      type: "improve",
      title: "Your recent posts need a stronger angle.",
      description: "The latest signals are soft. Tighten the hook and point of view before you push the next post live.",
      cta: "Try a stronger hook",
      route: `/app/create?postId=${encodeURIComponent(improvementAssetId)}`,
    };
  }

  if (draftItem) {
    return {
      type: "improve",
      title: "You already have a draft worth finishing.",
      description: `Sharpen "${draftItem.title ?? "this draft"}" and move it toward publish instead of starting from zero.`,
      cta: "Finish draft",
      route: `/app/create?postId=${encodeURIComponent(draftItem.id)}`,
    };
  }

  if (input.retention.currentStreakDays >= 3) {
    return {
      type: "schedule",
      title: `You're on a ${input.retention.currentStreakDays}-day streak.`,
      description: "Lock the next slot in now so consistency stays system-driven instead of memory-driven.",
      cta: "Keep it going",
      route: "/app/planner",
    };
  }

  return {
    type: "generate",
    title: "Today still needs one clear post.",
    description: "Capture or generate one draft and move it into the planner. That is the only job right now.",
    cta: "Create a post",
    route: "/app/create",
  };
}

function buildSuggestions(input: {
  pipelineItems: ContentAsset[];
  ideaInbox: IdeaInboxItem[];
  lastActivityAt?: string;
  bestTimeSlots: ControlDashboardResponse["today"]["bestTimeSlots"];
}): DashboardSuggestion[] {
  const suggestions: DashboardSuggestion[] = [];
  const nowMs = Date.now();
  const draftItems = input.pipelineItems.filter((item) => item.pipelineStage === "draft");
  const reviewItems = input.pipelineItems.filter((item) => item.pipelineStage === "review");
  const postedItems = input.pipelineItems.filter((item) => item.pipelineStage === "posted");

  if (!input.lastActivityAt || nowMs - new Date(input.lastActivityAt).getTime() > 72 * 60 * 60 * 1000) {
    suggestions.push({
      id: "activity-restart",
      type: "activity",
      title: "Activity has cooled off",
      description:
        "It has been a few days since the last content action. Capture one fresh idea or move one draft forward today.",
      actionLabel: "Process ideas",
      actionTarget: "idea-inbox",
    });
  }

  if (input.bestTimeSlots[0]) {
    suggestions.push({
      id: "timing-window",
      type: "timing",
      title: "Use the next strong posting window",
      description: `A solid next slot is ${input.bestTimeSlots[0].localLabel}. That keeps the workflow controlled without guessing.`,
      actionLabel: "Use suggestion",
      actionTarget: "today",
      metadata: {
        scheduledAt: input.bestTimeSlots[0].scheduledAt,
      },
    });
  }

  const draftToImprove = draftItems.find((item) => (item.textContent?.length ?? 0) < 280);

  if (draftToImprove) {
    suggestions.push({
      id: "quality-depth",
      type: "quality",
      title: "One draft needs more specificity",
      description:
        "The shortest draft in your pipeline would be stronger with one concrete example, lesson, or outcome.",
      actionLabel: "Edit draft",
      actionTarget: draftToImprove.id,
    });
  } else if (reviewItems.length > 0 && postedItems.length === 0) {
    suggestions.push({
      id: "move-review-forward",
      type: "quality",
      title: "Review is piling up",
      description:
        "You already have reviewed content. Move one item to scheduled or posted instead of generating more.",
      actionLabel: "Open review",
      actionTarget: reviewItems[0].id,
    });
  } else if (input.ideaInbox.length > 4) {
    suggestions.push({
      id: "inbox-triage",
      type: "quality",
      title: "Idea inbox is filling up",
      description:
        "Convert one saved idea into a draft before the inbox turns into another backlog.",
      actionLabel: "Convert idea",
      actionTarget: "idea-inbox",
    });
  }

  return suggestions.slice(0, 3);
}

export async function getControlDashboard(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<ControlDashboardResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);

  await syncRecentWorkspaceMetrics(businessId, 14);

  const [
    pipelineItems,
    ideaInbox,
    lastActivityAt,
    activityDates,
    publishedPostDates,
    recommendation,
    recentMetrics,
    lastPublishedPostAt,
    lastCampaignCompletedAt,
    nextScheduledPostAt,
    recentPerformanceSignals,
  ] = await Promise.all([
    loadPipelineItems(businessId),
    loadIdeaInbox(businessId),
    loadLastActivityAt(businessId),
    loadActivityDates(businessId),
    loadPublishedPostDates(businessId),
    recommendPostTimes({
      businessId,
      userId: principal.userId ?? "",
      contentType: "text",
    }),
    loadRecentWorkspaceMetrics(businessId),
    loadLastPublishedPostAt(businessId),
    loadLastCampaignCompletedAt(businessId),
    loadNextScheduledPostAt(businessId),
    loadRecentPostPerformanceSignals(businessId),
  ]);

  const streakDays = calculateStreakDays(activityDates);
  const retention = buildRetentionSummary({
    metrics: recentMetrics,
    fallbackStreakDays: streakDays,
    lastActivityAt,
  });

  const today = {
    businessId,
    dateLabel: buildDateLabel(),
    draftCount: pipelineItems.filter((item) => item.pipelineStage === "draft").length,
    reviewCount: pipelineItems.filter((item) => item.pipelineStage === "review").length,
    scheduledCount: pipelineItems.filter((item) => item.pipelineStage === "scheduled").length,
    postedCount: pipelineItems.filter((item) => item.pipelineStage === "posted").length,
    ideaInboxCount: ideaInbox.filter((item) => item.status === "new").length,
    streakDays,
    lastActivityAt,
    bestTimeSlots: recommendation.slots,
  };

  return {
    businessId,
    today,
    intelligence: buildDashboardIntelligenceSummary({
      publishedAts: publishedPostDates,
      bestTimeSlots: recommendation.slots,
      pipelineItems,
    }),
    retention,
    recentResults: {
      lastPublishedPostAt,
      lastCampaignCompletedAt,
      nextScheduledPostAt,
    },
    nextAction: buildDashboardNextAction({
      pipelineItems,
      retention,
      nextScheduledPostAt,
      recentPerformanceSignals,
    }),
    pipeline: PIPELINE_STAGES.map((stage) => ({
      stage: stage.stage,
      label: stage.label,
      items: pipelineItems.filter((item) => item.pipelineStage === stage.stage),
    })),
    ideaInbox,
    suggestions: buildSuggestions({
      pipelineItems,
      ideaInbox,
      lastActivityAt,
      bestTimeSlots: recommendation.slots,
    }),
  };
}

export async function getContentGenerationSuggestions(
  principal: AuthenticatedPrincipal,
  businessId: string,
): Promise<ListContentGenerationSuggestionsResponse> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);

  const [pipelineItems, recentPerformanceSignals, feedbackSummary] = await Promise.all([
    loadPipelineItems(businessId),
    loadRecentPostPerformanceSignals(businessId),
    loadContentGenerationSuggestionFeedbackSummary(businessId),
  ]);

  return {
    businessId,
    suggestions: buildContentGenerationSuggestions({
      pipelineItems,
      recentPerformanceSignals,
      feedbackSummary,
    }),
  };
}

export async function getContentPipelineItem(
  principal: AuthenticatedPrincipal,
  businessId: string,
  assetId: string,
): Promise<{ asset: ContentAsset }> {
  await enforceWorkspaceReadAccess(principal, businessId, "control_dashboard");
  await requireBusinessMembership(principal, businessId);

  const result = await queryDb<ContentAssetRow>(
    `
      select
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
      from content_assets
      where id = $1
        and business_id = $2
      limit 1
    `,
    [assetId, businessId],
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "content_asset_not_found", "Pipeline item was not found.");
  }

  return {
    asset: mapContentAsset(row),
  };
}

export async function createIdeaInboxItem(
  principal: AuthenticatedPrincipal,
  input: CreateIdeaInboxRequest,
): Promise<CreateIdeaInboxResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId: input.businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, input.businessId);
  const brandContext = await getBrandPromptContextForBusiness(input.businessId);
  const inputType = normalizeIdeaInputType(input.inputType);
  const metadata = normalizeIdeaMetadata(input.metadata);
  const rawInput = normalizeText(input.rawInput);
  const processedText =
    normalizeText(input.processedText)
    ?? normalizeText(input.text)
    ?? buildIdeaFallbackText({
      inputType,
      rawInput,
      metadata,
    });

  if (!processedText && !rawInput) {
    throw new HttpError(400, "bad_request", "Idea text, source text, or a capture input is required.");
  }

  const understanding = deriveIdeaUnderstanding({
    text: processedText ?? rawInput ?? "",
    inputType,
    brandContext,
  });
  const idea = await withDbTransaction(async (client) => {
    const provisionalUnderstandingJson = JSON.stringify(understanding);
    const insertResult = await client.query<IdeaInboxRow>(
      `
        insert into idea_inbox_items (
          business_id,
          user_id,
          body,
          input_type,
          raw_input,
          processed_text,
          source_metadata,
          understanding_json,
          understanding_status,
          understanding_confidence_score,
          status
        ) values (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7::jsonb,
          $8::jsonb,
          'queued',
          $9::numeric,
          'new'
        )
        returning
          id,
          business_id,
          user_id,
          body,
          input_type,
          raw_input,
          processed_text,
          source_metadata,
          understanding_json,
          understanding_status,
          understanding_confidence_score,
          understanding_error,
          understanding_job_id,
          status,
          created_at,
          updated_at
      `,
      [
        input.businessId,
        principal.userId ?? null,
        processedText ?? rawInput ?? "",
        inputType,
        rawInput ?? processedText ?? "",
        processedText ?? rawInput ?? "",
        JSON.stringify(
          mergeIdeaMetadata(metadata, {
            understanding,
          }),
        ),
        provisionalUnderstandingJson,
        understanding.confidenceScore ?? null,
      ],
    );

    const insertedIdea = insertResult.rows[0];
    const queuedJob = await createJob<IdeaProcessingJobPayload>({
      businessId: input.businessId,
      jobKey: `idea_process:${insertedIdea.id}`,
      type: "idea_process",
      priority: resolveIdeaProcessingPriority(),
      payload: {
        ideaId: insertedIdea.id,
      },
      client,
    });

    const updatedResult = await client.query<IdeaInboxRow>(
      `
        update idea_inbox_items
        set
          understanding_job_id = $2::uuid,
          updated_at = now()
        where id = $1::uuid
        returning
          id,
          business_id,
          user_id,
          body,
          input_type,
          raw_input,
          processed_text,
          source_metadata,
          understanding_json,
          understanding_status,
          understanding_confidence_score,
          understanding_error,
          understanding_job_id,
          status,
          created_at,
          updated_at
      `,
      [insertedIdea.id, queuedJob.id],
    );

    return mapIdeaInboxItem(updatedResult.rows[0]);
  });
  await logEvent("idea_saved", principal.userId, input.businessId, {
    ideaId: idea.id,
    inputType,
    length: (processedText ?? rawInput ?? "").length,
    intent: understanding.intent,
    contentType: understanding.contentType,
  });

  return { idea };
}

export async function convertIdeaInboxItemToContent(
  principal: AuthenticatedPrincipal,
  businessId: string,
  ideaId: string,
  input: ConvertIdeaToContentRequest,
): Promise<ConvertIdeaToContentResponse> {
  const tone = await resolveContentGenerationTone({
    requestedTone: input.tone,
    businessId,
  });

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
    usageMetric: "generations",
  });
  await requireBusinessMembership(principal, businessId);

  const result = await withDbTransaction(async (client) => {
    const ideaResult = await client.query<IdeaInboxRow>(
      `
        select
          id,
          business_id,
          user_id,
          body,
          input_type,
          raw_input,
          processed_text,
          source_metadata,
          understanding_json,
          understanding_status,
          understanding_confidence_score,
          understanding_error,
          understanding_job_id,
          status,
          created_at,
          updated_at
        from idea_inbox_items
        where id = $1
          and business_id = $2
        limit 1
      `,
      [ideaId, businessId],
    );

    const row = ideaResult.rows[0];

    if (!row) {
      throw new HttpError(404, "idea_not_found", "Idea inbox item was not found.");
    }

    const ideaPrompt = await buildIdeaConversionText(row);
    const generatedPosts = await generatePostsWithAI({
      topic: ideaPrompt,
      tone,
      length: normalizeText(input.length) ?? "medium",
      businessId,
    });

    const primaryVariation = generatedPosts.variations[0];
    const primaryContent = primaryVariation?.content ?? row.body;
    const title = primaryVariation?.angle
      ? `${primaryVariation.angle.replace(/(^|-)(\w)/g, (_value, dash, letter) => `${dash ? " " : ""}${String(letter).toUpperCase()}`)} draft`
      : row.body.slice(0, 64);

    const assetResult = await client.query<ContentAssetRow>(
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
          'post',
          $3,
          $4::jsonb,
          'draft',
          'draft',
          'idea',
          $5,
          $6::jsonb
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
        businessId,
        principal.userId ?? null,
        title,
        JSON.stringify({
          content: primaryContent,
          idea: row.body,
          ideaInputType: normalizeIdeaInputType(row.input_type),
          ideaRawInput: row.raw_input ?? undefined,
          ideaMetadata: normalizeIdeaMetadata(row.source_metadata),
          variations: generatedPosts.variations,
        }),
        row.id,
        JSON.stringify(buildContentAssetIntelligenceFromText(primaryContent) ?? {}),
      ],
    );

    const updatedIdeaResult = await client.query<IdeaInboxRow>(
      `
        update idea_inbox_items
        set
          status = 'converted',
          updated_at = now()
        where id = $1
        returning
          id,
          business_id,
          user_id,
          body,
          input_type,
          raw_input,
          processed_text,
          source_metadata,
          understanding_json,
          understanding_status,
          understanding_confidence_score,
          understanding_error,
          understanding_job_id,
          status,
          created_at,
          updated_at
      `,
      [row.id],
    );

    return {
      idea: mapIdeaInboxItem(updatedIdeaResult.rows[0]),
      asset: mapContentAsset(assetResult.rows[0]),
    };
  });

  await Promise.all([
    logEvent("idea_converted", principal.userId, businessId, {
      ideaId: result.idea.id,
      inputType: result.idea.inputType,
    }),
    logEvent("post_generated", principal.userId, businessId, {
      route: "idea_inbox_convert",
      ideaId: result.idea.id,
    }),
    logEvent("content_type_selected", principal.userId, businessId, {
      contentType: "post",
      source: "idea_inbox",
    }),
    recordStyleSignal({
      userId: principal.userId,
      businessId,
      tone,
      contentType: "post",
    }),
  ]);

  return result;
}

export async function updateContentPipelineItem(
  principal: AuthenticatedPrincipal,
  businessId: string,
  assetId: string,
  input: UpdateContentPipelineItemRequest,
): Promise<UpdateContentPipelineItemResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  const existing = await loadPipelineAssetRow(businessId, assetId);

  if (!existing) {
    throw new HttpError(404, "content_asset_not_found", "Pipeline item was not found.");
  }

  const nextTitle = normalizeText(input.title) ?? existing.title ?? null;
  const existingText = extractTextContent(existing.content_body);
  const nextText = normalizeText(input.textContent) ?? existingText;
  const nextStage = input.status ?? existing.pipeline_stage ?? "draft";
  const providedBody =
    input.contentBody && typeof input.contentBody === "object"
      ? input.contentBody
      : undefined;
  const nextBody = providedBody
    ? {
        ...providedBody,
        ...(nextText ? { post: nextText, content: nextText } : {}),
      }
    : nextText !== existingText || typeof existing.content_body !== "object" || !existing.content_body
      ? { content: nextText }
      : existing.content_body;
  const nextIntelligence = buildContentAssetIntelligenceFromText(nextText);

  const result = await queryDb<ContentAssetRow>(
    `
      update content_assets
      set
        title = $3,
        content_body = $4::jsonb,
        status = case when $5 = 'posted' then 'published' else content_assets.status end,
        pipeline_stage = $5,
        content_metadata = $6::jsonb,
        updated_at = now()
      where id = $1
        and business_id = $2
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
    [assetId, businessId, nextTitle, JSON.stringify(nextBody), nextStage, JSON.stringify(nextIntelligence ?? {})],
  );

  if (nextText !== existingText || nextTitle !== existing.title) {
    await Promise.all([
      logEvent("content_edited", principal.userId, businessId, {
        assetId,
        stage: nextStage,
      }),
      safeRecordContentGenerationSuggestionEdited({
        businessId,
        assetId,
      }),
      recordStyleSignal({
        userId: principal.userId,
        businessId,
        contentType: existing.content_type,
        edited: true,
      }),
    ]);
  }

  if (nextStage !== existing.pipeline_stage) {
    await logEvent("content_stage_changed", principal.userId, businessId, {
      assetId,
      from: existing.pipeline_stage ?? "draft",
      to: nextStage,
    });

    if (nextStage === "posted") {
      await Promise.all([
        logEvent("publish_marked", principal.userId, businessId, {
          assetId,
          source: "control_dashboard",
        }),
        safeRecordContentGenerationSuggestionPublished({
          businessId,
          assetId,
        }),
      ]);
    }
  }

  return {
    asset: mapContentAsset(result.rows[0]),
  };
}

export async function createContentPipelineItem(
  principal: AuthenticatedPrincipal,
  input: CreateContentPipelineItemRequest,
): Promise<CreateContentPipelineItemResponse> {
  const businessId = input.businessId.trim();
  const textContent = input.textContent.trim();

  if (!textContent) {
    throw new HttpError(400, "content_asset_text_required", "textContent is required.");
  }

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  const asset = await createContentAssetRecord({
    businessId,
    userId: principal.userId,
    contentType: "post",
    title: normalizeText(input.title) ?? textContent.slice(0, 80),
    contentBody:
      input.contentBody && typeof input.contentBody === "object"
        ? input.contentBody
        : { content: textContent },
    sourceKind: input.sourceKind ?? "generated",
  });

  await Promise.all([
    logEvent("content_selected", principal.userId, businessId, {
      assetId: asset.id,
      source: "result_page",
    }),
    recordStyleSignal({
      userId: principal.userId,
      businessId,
      contentType: "post",
      edited: false,
    }),
  ]);

  return {
    asset,
  };
}

export async function duplicateContentPipelineItem(
  principal: AuthenticatedPrincipal,
  businessId: string,
  assetId: string,
): Promise<DuplicateContentPipelineItemResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  const existing = await loadPipelineAssetRow(businessId, assetId);

  if (!existing) {
    throw new HttpError(404, "content_asset_not_found", "Pipeline item was not found.");
  }

  const duplicatedAsset = await withDbTransaction(async (client) => {
    const duplicatedResult = await client.query<ContentAssetRow>(
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
          'draft',
          'draft',
          $6,
          $7,
          $8::jsonb
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
        businessId,
        principal.userId,
        existing.content_type,
        buildDuplicateTitle(existing.title, extractTextContent(existing.content_body)),
        JSON.stringify(existing.content_body),
        existing.source_kind ?? "generated",
        existing.source_idea_id,
        JSON.stringify(existing.content_metadata ?? {}),
      ],
    );

    const duplicated = duplicatedResult.rows[0];

    await client.query(
      `
        insert into post_assets (
          post_id,
          business_id,
          type,
          source,
          storage_key,
          storage_url,
          mime_type,
          size_bytes,
          order_index,
          status,
          metadata_json
        )
        select
          $1,
          business_id,
          type,
          source,
          storage_key,
          storage_url,
          mime_type,
          size_bytes,
          order_index,
          status,
          metadata_json
        from post_assets
        where post_id = $2
      `,
      [duplicated.id, assetId],
    );

    return duplicated;
  });

  return {
    asset: mapContentAsset(duplicatedAsset),
  };
}

export async function deleteContentPipelineItem(
  principal: AuthenticatedPrincipal,
  businessId: string,
  assetId: string,
): Promise<DeleteContentPipelineItemResponse> {
  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "control_dashboard",
  });
  await requireBusinessMembership(principal, businessId);

  const existing = await loadPipelineAssetRow(businessId, assetId);

  if (!existing) {
    throw new HttpError(404, "content_asset_not_found", "Pipeline item was not found.");
  }

  const activeScheduledPostCount = await loadActiveScheduledPostCount(businessId, assetId);

  if (activeScheduledPostCount > 0) {
    throw new HttpError(
      409,
      "content_asset_has_active_schedule",
      "This draft is still linked to active scheduled posts. Cancel or resolve those slots first.",
    );
  }

  await queryDb(
    `
      delete from content_assets
      where id = $1
        and business_id = $2
    `,
    [assetId, businessId],
  );

  return {
    deletedAssetId: assetId,
  };
}

export async function previewContentPipelineAiEdit(
  principal: AuthenticatedPrincipal,
  input: PreviewContentAiEditRequest,
): Promise<{ preview: ContentAiEditPreview }> {
  const businessId = input.businessId.trim();
  const assetId = input.assetId?.trim();

  await enforceWorkspaceWriteAccess({
    principal,
    businessId,
    featureKey: "content_generation",
    usageMetric: "generations",
  });
  await requireBusinessMembership(principal, businessId);

  let textContent = normalizeText(input.textContent);

  if (assetId) {
    const assetRow = await loadPipelineAssetRow(businessId, assetId);

    if (!assetRow) {
      throw new HttpError(404, "content_asset_not_found", "Pipeline item was not found.");
    }

    textContent ||= extractTextContent(assetRow.content_body);
  }

  if (!textContent) {
    throw new HttpError(400, "bad_request", "textContent is required.");
  }

  return {
    preview: await generateContentAiEditPreview({
      businessId,
      assetId,
      instruction: input.instruction,
      textContent,
    }),
  };
}
