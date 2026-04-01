import type {
  CarouselDraft,
  ContentNarrative,
  ContentAsset,
  RepurposeContentRequest,
  RepurposeContentResponse,
  RepurposeIntent,
  RepurposeInputType,
} from "../../../../packages/shared-types/index.ts";
import {
  DEFAULT_REPURPOSE_STRATEGY,
  normalizeRepurposeStrategy,
} from "../../../../packages/shared-types/index.ts";
import { generateNarrative } from "../../../../packages/content-engine/src/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { generateCapturedContentWithAI, generatePostsWithAI, generateRemixedContentWithAI } from "./aiService.ts";
import { getBrandPromptContextForBusiness } from "./brandIntelligence/brandProfileService.ts";
import {
  createContentAssetRecord,
  safeLogContentGeneration,
  safeLogEvent,
} from "./analytics/eventLoggingService.ts";
import { appendCaptionFooterCredit, resolveBrandingPolicy } from "./brandingService.ts";
import { resolveContentGenerationTone } from "./contentGenerationToneService.ts";
import { previewContentIngestion } from "./content/ingestionService.ts";
import { isDatabaseConfigured, queryDb } from "./db/client.ts";
import {
  safeRecordContentGenerationSuggestionEdited,
  safeRecordContentGenerationSuggestionSelection,
} from "./contentGenerationFeedbackService.ts";
import { HttpError } from "../utils/http.ts";
import { logError } from "../utils/logger.ts";
import { recordStyleSignal } from "./styleProfileService.ts";
import {
  buildContentAssetIntelligenceFromText,
  resolveStoredContentAssetIntelligence,
} from "./contentIntelligenceService.ts";

interface ContentAssetRow {
  id: string;
  business_id: string | null;
  user_id: string | null;
  content_type: ContentAsset["contentType"];
  title: string | null;
  content_body: unknown;
  status: ContentAsset["status"];
  pipeline_stage: NonNullable<ContentAsset["pipelineStage"]> | null;
  source_kind: NonNullable<ContentAsset["sourceKind"]> | null;
  source_idea_id: string | null;
  content_metadata: unknown;
  created_at: Date | string;
  updated_at: Date | string;
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

function normalizeSelectedSuggestion(
  value: RepurposeContentRequest["selectedSuggestion"],
): RepurposeContentRequest["selectedSuggestion"] | undefined {
  if (!value) {
    return undefined;
  }

  const suggestionId = value.suggestionId?.trim();
  const sourceAssetId = value.sourceAssetId?.trim();

  if (!suggestionId || !sourceAssetId) {
    return undefined;
  }

  return {
    suggestionId,
    sourceAssetId,
    origin: value.origin ?? "generate_for_me",
  };
}

async function resolveSourceText(input: RepurposeContentRequest): Promise<{
  sourceText: string;
  inputType: RepurposeInputType;
  sourceCount: number;
}> {
  if (input.inputType === "url") {
    const ingestion = await previewContentIngestion({
      businessId: input.businessId,
      contextText: input.text,
      sourceUrls:
        input.sourceUrls && input.sourceUrls.length > 0
          ? input.sourceUrls
          : input.url?.trim()
            ? [{ url: input.url.trim() }]
            : [],
    });

    return {
      sourceText: ingestion.combinedText,
      inputType: "url",
      sourceCount: ingestion.items.length,
    };
  }

  if (input.inputType === "voice") {
    const voiceTranscript = input.voiceTranscript?.trim();

    if (!voiceTranscript) {
      throw new HttpError(
        400,
        "bad_request",
        "voiceTranscript is required when inputType is voice.",
      );
    }

    return {
      sourceText: truncateText(voiceTranscript, 3200),
      inputType: "voice",
      sourceCount: 1,
    };
  }

  const text = input.text?.trim();

  if (!text) {
    throw new HttpError(400, "bad_request", "text is required when inputType is text.");
  }

  return {
    sourceText: truncateText(text, 3200),
    inputType: "text",
    sourceCount: 1,
  };
}

function toGenerationInputType(inputType: RepurposeInputType): "idea" | "link" | "voice" {
  if (inputType === "url") {
    return "link";
  }

  if (inputType === "voice") {
    return "voice";
  }

  return "idea";
}

function buildCarouselDraft(
  narrative: ContentNarrative,
): CarouselDraft {
  const slides = narrative.slides.map((slide) => ({
    headline: truncateText(slide.headline, 72),
    supportingText: truncateText(slide.supportingText || narrative.subtitle, 120),
    bulletPoints: (slide.bulletPoints ?? []).map((point) => truncateText(point, 72)).slice(0, 3),
    narrativeRole: slide.role,
  }));

  return {
    title: narrative.title,
    subtitle: narrative.subtitle,
    narrativeType: narrative.type,
    slides,
  };
}

function resolveQuickSignals(
  inputType: RepurposeInputType,
  carouselDraft: CarouselDraft,
  sourceCount = 1,
): RepurposeContentResponse["quickSignals"] {
  return {
    readyLabel: "Ready to post",
    formatLabel:
      inputType === "url"
        ? `High-performing format: ${sourceCount > 1 ? "multi-source feed remix" : "reference remix"} + ${carouselDraft.slides.length}-slide carousel`
        : `High-performing format: insight post + ${carouselDraft.slides.length}-slide carousel`,
  };
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
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

async function persistRepurposedAsset(input: {
  assetId?: string;
  businessId: string;
  userId: string;
  title: string;
  contentBody: Record<string, unknown>;
  sourceKind: NonNullable<ContentAsset["sourceKind"]>;
}): Promise<ContentAsset> {
  const normalizedAssetId = input.assetId?.trim();

  if (!normalizedAssetId) {
    return createContentAssetRecord({
      businessId: input.businessId,
      userId: input.userId,
      contentType: "post",
      title: input.title,
      contentBody: input.contentBody,
      sourceKind: input.sourceKind,
    });
  }

  const existingResult = await queryDb<ContentAssetRow>(
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
    [normalizedAssetId, input.businessId],
  );

  const existing = existingResult.rows[0];

  if (!existing) {
    throw new HttpError(404, "content_asset_not_found", "Post was not found for this workspace.");
  }

  const updatedResult = await queryDb<ContentAssetRow>(
    `
      update content_assets
      set
        title = $3,
        content_body = $4::jsonb,
        source_kind = $5,
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
    [
      normalizedAssetId,
      input.businessId,
      input.title,
      JSON.stringify(input.contentBody),
      input.sourceKind,
      JSON.stringify(buildContentAssetIntelligenceFromText(extractTextContent(input.contentBody) ?? input.title) ?? {}),
    ],
  );

  return mapContentAsset(updatedResult.rows[0]);
}

export async function repurposeContent(
  input: RepurposeContentRequest,
  principal?: AuthenticatedPrincipal,
): Promise<RepurposeContentResponse> {
  const businessId = input.businessId?.trim() || undefined;
  const selectedSuggestion = normalizeSelectedSuggestion(input.selectedSuggestion);
  const [tone, brandContext] = await Promise.all([
    resolveContentGenerationTone({
      requestedTone: input.tone,
      businessId,
    }),
    getBrandPromptContextForBusiness(businessId),
  ]);
  const strategy = normalizeRepurposeStrategy(input.strategy) ?? DEFAULT_REPURPOSE_STRATEGY;
  const intent: RepurposeIntent =
    input.intent ?? (input.inputType === "url" ? "reference" : "capture");
  const { sourceText, inputType, sourceCount } = await resolveSourceText(input);
  const brandingPolicy = resolveBrandingPolicy({
    principal,
    businessId,
  });
  const startedAt = Date.now();

  const structuredContent =
    intent === "reference"
      ? await generateRemixedContentWithAI({
          rawInputText: sourceText,
          tone,
          strategy,
          businessId,
        })
      : await generateCapturedContentWithAI({
          rawInputText: sourceText,
          tone,
          strategy,
          businessId,
        });

  const variations = await generatePostsWithAI({
    topic: structuredContent.idea.title,
    tone,
    strategy,
    length: "medium",
    selectedHook: structuredContent.hooks[0],
    businessId,
  });

  const visualNarrative = generateNarrative({
    sourceText: variations.variations[0]?.content || structuredContent.post,
    title: structuredContent.idea.title,
    subtitle: structuredContent.idea.angle,
    narrativePattern: brandContext?.patterns,
  });
  const carouselDraft = buildCarouselDraft(visualNarrative);
  const quickSignals = resolveQuickSignals(inputType, carouselDraft, sourceCount);
  const responseBase: Omit<RepurposeContentResponse, "asset"> = {
    inputType,
    intent,
    strategy,
    sourceText,
    idea: structuredContent.idea,
    hooks: structuredContent.hooks.slice(0, 5),
    post: structuredContent.post,
    variations: variations.variations,
    visualNarrative,
    carouselDraft,
    quickSignals,
    captionFooterCredit: brandingPolicy.captionFooterCredit,
  };

  const latencyMs = Date.now() - startedAt;

  await Promise.all([
    safeLogEvent(intent === "reference" ? "remix_used" : "capture_used", principal?.userId, businessId, {
      route: "/api/repurpose",
        inputType,
        intent,
        strategy,
        sourceCount,
      }),
    selectedSuggestion
      ? safeLogEvent("content_selected", principal?.userId, businessId, {
          route: "/api/repurpose",
          source: selectedSuggestion.origin ?? "generate_for_me",
          suggestionId: selectedSuggestion.suggestionId,
          sourceAssetId: selectedSuggestion.sourceAssetId,
          strategy,
        })
      : Promise.resolve(null),
    safeLogEvent("post_generated", principal?.userId, businessId, {
      route: "/api/repurpose",
        inputType,
        intent,
        strategy,
        sourceCount,
      }),
    safeLogContentGeneration({
      userId: principal?.userId,
      businessId,
      inputType: toGenerationInputType(inputType),
        inputPayload: {
          inputType,
          intent,
          tone,
          strategy,
          sourceText,
          sourceCount,
        },
      outputPayload: responseBase,
      success: true,
      latencyMs,
    }),
    recordStyleSignal({
      userId: principal?.userId,
      businessId,
      tone,
      contentType: "post",
    }),
    input.assetId?.trim()
      ? safeLogEvent("content_edited", principal?.userId, businessId, {
          route: "/api/repurpose",
          assetId: input.assetId.trim(),
          intent,
          strategy,
          inputType,
        })
      : Promise.resolve(null),
  ]);

  if (!principal?.userId || !businessId || !isDatabaseConfigured()) {
    return responseBase;
  }

  try {
    const asset = await persistRepurposedAsset({
      assetId: input.assetId,
      businessId,
      userId: principal.userId,
      title: structuredContent.idea.title,
      contentBody: {
        ...responseBase,
        shareCaption: appendCaptionFooterCredit(
          variations.variations[0]?.content ?? structuredContent.post,
          brandingPolicy.captionFooterCredit,
        ),
      },
      sourceKind: intent === "reference" ? "remix" : "capture",
    });

    await Promise.all([
      selectedSuggestion
        ? safeRecordContentGenerationSuggestionSelection({
            businessId,
            userId: principal.userId,
            generatedAssetId: asset.id,
            sourceAssetId: selectedSuggestion.sourceAssetId,
            suggestionId: selectedSuggestion.suggestionId,
            strategy,
            origin: selectedSuggestion.origin,
          })
        : Promise.resolve(),
      input.assetId?.trim()
        ? safeRecordContentGenerationSuggestionEdited({
            businessId,
            assetId: input.assetId.trim(),
          })
        : Promise.resolve(),
    ]);

    return {
      ...responseBase,
      asset,
    };
  } catch (error) {
    logError("Failed to persist repurpose content asset.", {
      businessId,
      userId: principal.userId,
      intent,
      inputType,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    return responseBase;
  }
}
