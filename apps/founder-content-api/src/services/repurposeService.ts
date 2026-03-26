import type {
  CarouselDraft,
  CaptureContentResponse,
  LinkedInPostGenerationResponse,
  RepurposeContentRequest,
  RepurposeContentResponse,
  RepurposeIntent,
  RepurposeInputType,
} from "../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../middleware/auth.ts";
import { generateCapturedContentWithAI, generatePostsWithAI, generateRemixedContentWithAI } from "./aiService.ts";
import {
  createContentAssetRecord,
  safeLogContentGeneration,
  safeLogEvent,
} from "./analytics/eventLoggingService.ts";
import { appendCaptionFooterCredit, resolveBrandingPolicy } from "./brandingService.ts";
import { previewContentIngestion } from "./content/ingestionService.ts";
import { isDatabaseConfigured } from "./db/client.ts";
import { HttpError } from "../utils/http.ts";
import { logError } from "../utils/logger.ts";
import { recordStyleSignal } from "./styleProfileService.ts";

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
  source: CaptureContentResponse,
  variations: LinkedInPostGenerationResponse["variations"],
): CarouselDraft {
  const primaryVariation = variations[0]?.content || source.post;
  const paragraphs = primaryVariation
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line.replace(/^[-*•]\s*/, "")))
    .filter((line) => line.length > 0);

  const title = source.idea.title;
  const subtitle = source.idea.angle;
  const slides = [
    {
      headline: truncateText(source.hooks[0] ?? title, 72),
      supportingText: truncateText(subtitle, 120),
      bulletPoints: [],
    },
    ...paragraphs.slice(0, 4).map((paragraph) => ({
      headline: truncateText(paragraph, 72),
      supportingText: truncateText(paragraph, 120),
      bulletPoints: [],
    })),
  ].slice(0, 5);

  return {
    title,
    subtitle,
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

export async function repurposeContent(
  input: RepurposeContentRequest,
  principal?: AuthenticatedPrincipal,
): Promise<RepurposeContentResponse> {
  const businessId = input.businessId?.trim() || undefined;
  const tone = input.tone?.trim() || "storytelling";
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
          businessId,
        })
      : await generateCapturedContentWithAI({
          rawInputText: sourceText,
          tone,
          businessId,
        });

  const variations = await generatePostsWithAI({
    topic: structuredContent.idea.title,
    tone,
    length: "medium",
    selectedHook: structuredContent.hooks[0],
    businessId,
  });

  const carouselDraft = buildCarouselDraft(structuredContent, variations.variations);
  const quickSignals = resolveQuickSignals(inputType, carouselDraft, sourceCount);
  const responseBase: Omit<RepurposeContentResponse, "asset"> = {
    inputType,
    intent,
    sourceText,
    idea: structuredContent.idea,
    hooks: structuredContent.hooks.slice(0, 5),
    post: structuredContent.post,
    variations: variations.variations,
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
        sourceCount,
      }),
    safeLogEvent("post_generated", principal?.userId, businessId, {
      route: "/api/repurpose",
        inputType,
        intent,
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
  ]);

  if (!principal?.userId || !businessId || !isDatabaseConfigured()) {
    return responseBase;
  }

  try {
    const asset = await createContentAssetRecord({
      businessId,
      userId: principal.userId,
      contentType: "post",
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
