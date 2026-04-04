import type {
  CarouselDraft,
  ContentNarrative,
  ContentAsset,
  CreatorContentType,
  CreatorGenerationIntent,
  CreatorTextVariant,
  CreatorVisualStyle,
  CreatorWeeklyPlanGenerationOutput,
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

function resolveCreatorGenerationIntent(
  intent: CreatorGenerationIntent | undefined,
): CreatorGenerationIntent {
  return intent ?? "post_idea";
}

function resolveCreatorContentType(
  contentType: CreatorContentType | undefined,
): CreatorContentType {
  return contentType ?? "text_post";
}

function resolveCreatorVisualStyle(
  visualStyle: CreatorVisualStyle | undefined,
  contentType: CreatorContentType,
): CreatorVisualStyle {
  if (visualStyle) {
    return visualStyle;
  }

  if (contentType === "image_post" || contentType === "promo_post") {
    return "realistic_photo";
  }

  if (contentType === "carousel") {
    return "mixed_carousel";
  }

  if (contentType === "quote_card") {
    return "quote_style";
  }

  return "minimal_text_card";
}

function splitCreatorParagraphs(value: string): string[] {
  return value
    .split(/\n{2,}|\n+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function joinCreatorParagraphs(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join("\n\n");
}

function resolveCreatorVariantSource(
  variations: RepurposeContentResponse["variations"],
  angle: "story" | "lesson" | "build-in-public",
  fallback: string,
): string {
  return variations.find((variation) => variation.angle === angle)?.content?.trim() || fallback;
}

function buildShortCaptionContent(input: {
  sourceText: string;
  fallbackHook?: string;
  contentType: CreatorContentType;
}): string {
  const parts = splitCreatorParagraphs(input.sourceText);
  const selectedParts = parts.slice(0, input.contentType === "promo_post" ? 2 : 3);
  const normalized = selectedParts.map((part, index) =>
    truncateText(normalizeWhitespace(part), index === 0 ? 110 : 140),
  );

  if (normalized.length > 0) {
    return joinCreatorParagraphs(normalized);
  }

  return truncateText(normalizeWhitespace(input.fallbackHook || input.sourceText), 160);
}

function buildPromoCopyContent(input: {
  baseText: string;
  ideaTitle: string;
  ideaAngle: string;
  hooks: string[];
  intent: CreatorGenerationIntent;
  contentType: CreatorContentType;
}): string {
  const parts = splitCreatorParagraphs(input.baseText);
  const opener = truncateText(
    normalizeWhitespace(input.hooks[0] || parts[0] || input.ideaTitle || "Make the next move obvious."),
    110,
  );
  const support = truncateText(
    normalizeWhitespace(parts[1] || input.ideaAngle || parts[0] || input.ideaTitle),
    150,
  );
  const close = truncateText(
    normalizeWhitespace(
      input.intent === "promote_offer" || input.contentType === "promo_post"
        ? `If this direction matters, make the offer obvious and give people a clear next step toward ${input.ideaTitle || "it"}.`
        : `Use the attention this idea earns to point people toward the next clear action.`,
    ),
    150,
  );

  return joinCreatorParagraphs([opener, support, close]);
}

function orderCreatorVariants(
  variants: CreatorTextVariant[],
  contentType: CreatorContentType,
): CreatorTextVariant[] {
  const priorityByKind: Record<CreatorTextVariant["kind"], number> =
    contentType === "image_post"
      ? {
          short_caption: 0,
          insight_post: 1,
          story_version: 2,
          authority_version: 3,
          promo_copy: 4,
        }
      : contentType === "promo_post"
        ? {
            promo_copy: 0,
            authority_version: 1,
            short_caption: 2,
            insight_post: 3,
            story_version: 4,
          }
        : {
            insight_post: 0,
            story_version: 1,
            authority_version: 2,
            short_caption: 3,
            promo_copy: 4,
          };

  return [...variants].sort((left, right) => priorityByKind[left.kind] - priorityByKind[right.kind]);
}

function buildCreatorTextVariants(input: {
  variations: RepurposeContentResponse["variations"];
  basePost: string;
  hooks: string[];
  intent: CreatorGenerationIntent;
  contentType: CreatorContentType;
  ideaTitle: string;
  ideaAngle: string;
}): CreatorTextVariant[] {
  const insightPost = resolveCreatorVariantSource(input.variations, "lesson", input.basePost);
  const storyVersion = resolveCreatorVariantSource(input.variations, "story", input.basePost);
  const authorityVersion = resolveCreatorVariantSource(input.variations, "build-in-public", input.basePost);
  const shortCaption = buildShortCaptionContent({
    sourceText: input.contentType === "image_post" ? storyVersion : insightPost,
    fallbackHook: input.hooks[0],
    contentType: input.contentType,
  });
  const promoCopy = buildPromoCopyContent({
    baseText: input.contentType === "promo_post" ? authorityVersion : insightPost,
    ideaTitle: input.ideaTitle,
    ideaAngle: input.ideaAngle,
    hooks: input.hooks,
    intent: input.intent,
    contentType: input.contentType,
  });

  return orderCreatorVariants(
    [
      {
        id: "insight-post",
        kind: "insight_post",
        label: "Insight post",
        description: "Clear authority-building version with one strong lesson and clean pacing.",
        content: insightPost,
        recommendedChannels: ["linkedin", "facebook"],
        length: "medium",
        ctaStyle: "soft",
      },
      {
        id: "story-version",
        kind: "story_version",
        label: "Story version",
        description: "Narrative-led version that feels more personal and trust-building.",
        content: storyVersion,
        recommendedChannels: ["linkedin", "email"],
        length: "medium",
        ctaStyle: "soft",
      },
      {
        id: "authority-version",
        kind: "authority_version",
        label: "Authority version",
        description: "Sharper point-of-view version that sounds more decisive and expert-led.",
        content: authorityVersion,
        recommendedChannels: ["linkedin", "facebook"],
        length: "medium",
        ctaStyle: "soft",
      },
      {
        id: "short-caption",
        kind: "short_caption",
        label: "Short caption",
        description: "Compact version for faster posting, image-led content, or lighter-distribution days.",
        content: shortCaption,
        recommendedChannels: ["linkedin", "instagram", "facebook"],
        length: "short",
        ctaStyle: "soft",
      },
      {
        id: "promo-copy",
        kind: "promo_copy",
        label: "Promo copy",
        description: "Offer-aware version that moves readers toward the next step without sounding like an ad.",
        content: promoCopy,
        recommendedChannels: ["linkedin", "facebook", "email"],
        length: "short",
        ctaStyle: "direct",
      },
    ],
    input.contentType,
  );
}

function buildCreatorWeeklyPlanOutput(input: {
  ideaTitle: string;
  sourceText: string;
}): CreatorWeeklyPlanGenerationOutput {
  const focus = truncateText(input.ideaTitle || normalizeWhitespace(input.sourceText) || "Weekly focus", 72);
  const themes: CreatorWeeklyPlanGenerationOutput["days"][number]["theme"][] = [
    "opinion",
    "story",
    "tactical",
    "proof",
    "offer",
    "tactical",
    "recap",
  ];

  return {
    kind: "weekly_plan",
    intent: "weekly_plan",
    primaryChannel: "linkedin",
    days: themes.map((theme, index) => ({
      dayNumber: index + 1,
      theme,
      headline:
        theme === "story"
          ? `The story behind ${focus.toLowerCase()}`
          : theme === "tactical"
            ? `How to make ${focus.toLowerCase()} practical`
            : theme === "proof"
              ? `Proof that ${focus.toLowerCase()} works`
              : theme === "offer"
                ? `What ${focus.toLowerCase()} should lead people toward`
                : theme === "recap"
                  ? `What this week taught me about ${focus.toLowerCase()}`
                  : `${focus} is probably misunderstood`,
      summary:
        theme === "story"
          ? "Tell a short story that makes the point concrete, then land one clear lesson."
          : theme === "tactical"
            ? "Turn the idea into a practical framework, checklist, or repeatable move."
            : theme === "proof"
              ? "Use proof, results, or observations to make the point harder to dismiss."
              : theme === "offer"
                ? "Bridge the audience from the insight to the offer without sounding like a pitch deck."
                : theme === "recap"
                  ? "Wrap the week with a summary of what changed, what mattered, and what comes next."
                  : "Lead with a sharper point of view and make the audience pick a side.",
    })),
  };
}

function buildCreatorGenerationOutput(input: {
  generationIntent: CreatorGenerationIntent | undefined;
  creatorContentType: CreatorContentType | undefined;
  creatorVisualStyle: CreatorVisualStyle | undefined;
  post: string;
  hooks: string[];
  variations: RepurposeContentResponse["variations"];
  visualNarrative: ContentNarrative;
  carouselDraft: CarouselDraft;
  quickSignals: RepurposeContentResponse["quickSignals"];
  ideaTitle: string;
  ideaAngle: string;
  sourceText: string;
}): RepurposeContentResponse["generationOutput"] {
  const normalizedIntent = resolveCreatorGenerationIntent(input.generationIntent);
  const contentType = resolveCreatorContentType(input.creatorContentType);
  const visualStyle = resolveCreatorVisualStyle(input.creatorVisualStyle, contentType);

  if (normalizedIntent === "weekly_plan") {
    return buildCreatorWeeklyPlanOutput({
      ideaTitle: input.ideaTitle,
      sourceText: input.sourceText,
    });
  }

  const variants = buildCreatorTextVariants({
    variations: input.variations,
    basePost: input.post,
    hooks: input.hooks,
    intent: normalizedIntent,
    contentType,
    ideaTitle: input.ideaTitle,
    ideaAngle: input.ideaAngle,
  });

  return {
    kind: "creator_post",
    intent: normalizedIntent,
    primaryChannel: "linkedin",
    contentType,
    visualStyle,
    post: input.post,
    hooks: input.hooks,
    variants,
    variations: input.variations,
    visualNarrative: input.visualNarrative,
    carouselDraft: input.carouselDraft,
    quickSignals: input.quickSignals,
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
          generationIntent: input.generationIntent,
          creatorContentType: input.creatorContentType,
          creatorVisualStyle: input.creatorVisualStyle,
          businessId,
        })
      : await generateCapturedContentWithAI({
          rawInputText: sourceText,
          tone,
          strategy,
          generationIntent: input.generationIntent,
          creatorContentType: input.creatorContentType,
          creatorVisualStyle: input.creatorVisualStyle,
          businessId,
        });

  const variations = await generatePostsWithAI({
    topic: structuredContent.idea.title,
    tone,
    strategy,
    generationIntent: input.generationIntent,
    creatorContentType: input.creatorContentType,
    creatorVisualStyle: input.creatorVisualStyle,
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
  const generationOutput = buildCreatorGenerationOutput({
    generationIntent: input.generationIntent,
    creatorContentType: input.creatorContentType,
    creatorVisualStyle: input.creatorVisualStyle,
    post: structuredContent.post,
    hooks: structuredContent.hooks.slice(0, 5),
    variations: variations.variations,
    visualNarrative,
    carouselDraft,
    quickSignals,
    ideaTitle: structuredContent.idea.title,
    ideaAngle: structuredContent.idea.angle,
    sourceText,
  });
  const responseBase: Omit<RepurposeContentResponse, "asset"> = {
    inputType,
    intent,
    strategy,
    generationIntent: input.generationIntent,
    generationOutput,
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
