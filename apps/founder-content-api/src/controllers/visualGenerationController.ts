import type {
  ApiError,
  GenerateVisualRequest,
  GenerateVisualResponse,
  VisualTemplateType,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { recordMediaGenerationLog } from "../services/mediaIntelligenceService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";
import { generateVisualAsset } from "../services/visualGenerationService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

const VALID_TEMPLATE_TYPES: VisualTemplateType[] = [
  "quote",
  "insight",
  "contrarian",
  "carousel",
];

function isValidTemplateType(value: string | undefined): value is VisualTemplateType {
  return VALID_TEMPLATE_TYPES.includes((value ?? "") as VisualTemplateType);
}

export async function generateVisualController(
  request: Request<unknown, GenerateVisualResponse | ApiError, Partial<GenerateVisualRequest>>,
  response: Response<GenerateVisualResponse | ApiError>,
): Promise<void> {
  const businessId = request.body?.businessId?.trim() || undefined;
  let accessGranted = false;

  if (!isValidTemplateType(request.body?.templateType)) {
    sendApiError(
      response,
      400,
      "bad_request",
      "templateType must be one of: quote, insight, contrarian, carousel.",
    );
    return;
  }

  if (!request.body?.content || typeof request.body.content !== "object") {
    sendApiError(response, 400, "bad_request", "content is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "visual_generation",
      usageMetric: "posts",
    });
    accessGranted = true;

    const generationInput: GenerateVisualRequest = {
      businessId,
      templateType: request.body.templateType,
      content: {
        headline: request.body.content.headline?.trim() ?? "",
        supportingText: request.body.content.supportingText?.trim() || undefined,
        bulletPoints: request.body.content.bulletPoints,
        highlightText: request.body.content.highlightText?.trim() || undefined,
        eyebrowText: request.body.content.eyebrowText?.trim() || undefined,
        footerText: request.body.content.footerText?.trim() || undefined,
        closingText: request.body.content.closingText?.trim() || undefined,
      },
      narrative: request.body.narrative
        ? {
            format: "carousel",
            type: request.body.narrative.type,
            title: request.body.narrative.title?.trim() ?? "",
            subtitle: request.body.narrative.subtitle?.trim() ?? "",
            sourceText: request.body.narrative.sourceText?.trim() || undefined,
            slides: Array.isArray(request.body.narrative.slides)
              ? request.body.narrative.slides
                .map((slide) => ({
                  role: slide.role?.trim() || "insight",
                  headline: slide.headline?.trim() ?? "",
                  supportingText: slide.supportingText?.trim() || undefined,
                  bulletPoints: Array.isArray(slide.bulletPoints) ? slide.bulletPoints : undefined,
                  highlightText: slide.highlightText?.trim() || undefined,
                  eyebrowText: slide.eyebrowText?.trim() || undefined,
                  footerText: slide.footerText?.trim() || undefined,
                  closingText: slide.closingText?.trim() || undefined,
                  assetId: slide.assetId?.trim() || undefined,
                  imageDataUrl: slide.imageDataUrl?.trim() || undefined,
                  mimeType: slide.mimeType?.trim() || undefined,
                }))
                .filter((slide) => slide.headline)
              : [],
          }
        : undefined,
      carousel: request.body.carousel
        ? {
            narrativeType: request.body.carousel.narrativeType,
            slideCount: request.body.carousel.slideCount,
            sourceText: request.body.carousel.sourceText?.trim() || undefined,
            title: request.body.carousel.title?.trim() || undefined,
            subtitle: request.body.carousel.subtitle?.trim() || undefined,
            slides: Array.isArray(request.body.carousel.slides)
              ? request.body.carousel.slides
                .map((slide) => ({
                  headline: slide.headline?.trim() ?? "",
                  supportingText: slide.supportingText?.trim() || undefined,
                  bulletPoints: Array.isArray(slide.bulletPoints) ? slide.bulletPoints : undefined,
                  highlightText: slide.highlightText?.trim() || undefined,
                  eyebrowText: slide.eyebrowText?.trim() || undefined,
                  footerText: slide.footerText?.trim() || undefined,
                  closingText: slide.closingText?.trim() || undefined,
                  narrativeRole: slide.narrativeRole?.trim() || undefined,
                }))
                .filter((slide) => slide.headline)
              : undefined,
          }
        : undefined,
      brandKit: request.body.brandKit
        ? {
            primaryColor: request.body.brandKit.primaryColor?.trim(),
            secondaryColor: request.body.brandKit.secondaryColor?.trim(),
            backgroundStyle: request.body.brandKit.backgroundStyle,
            fontStyle: request.body.brandKit.fontStyle,
            visualStyle: request.body.brandKit.visualStyle,
            tone: request.body.brandKit.tone,
            accentStyle: request.body.brandKit.accentStyle,
            brandPlacement: request.body.brandKit.brandPlacement,
            logoUrl: request.body.brandKit.logoUrl?.trim(),
          }
        : undefined,
      watermarkMode: request.body.watermarkMode,
      captionFooterCredit: request.body.captionFooterCredit?.trim() || undefined,
      mediaPresetId: request.body.mediaPresetId?.trim() || undefined,
      promptTemplateId: request.body.promptTemplateId?.trim() || undefined,
      generatedMediaType: request.body.generatedMediaType,
      contentAssetId: request.body.contentAssetId?.trim() || undefined,
      sourceAssetIds: Array.isArray(request.body.sourceAssetIds)
        ? request.body.sourceAssetIds.map((value) => value.trim()).filter(Boolean)
        : undefined,
    };

    const generatedAsset = await generateVisualAsset(generationInput, request.auth);

    if (businessId) {
      try {
        await recordMediaGenerationLog({
          businessId,
          contentAssetId: generationInput.contentAssetId,
          mediaPresetId: generationInput.mediaPresetId,
          promptTemplateId: generationInput.promptTemplateId,
          generatedMediaType: generationInput.generatedMediaType ?? generatedAsset.templateType,
          inputPayload: {
            templateType: generationInput.templateType,
            content: generationInput.content,
            sourceAssetIds: generationInput.sourceAssetIds ?? [],
          },
          outputPayload: {
            provider: generatedAsset.provider,
            mimeType: generatedAsset.mimeType,
            templateType: generatedAsset.templateType,
            watermarkApplied: generatedAsset.watermarkApplied,
            brandConsistency: generatedAsset.brandConsistency,
          },
          status: "completed",
        });
      } catch {
        // Logging should not break the generation response.
      }
    }

    response.json(generatedAsset);
  } catch (error) {
    if (businessId && accessGranted) {
      try {
        await recordMediaGenerationLog({
          businessId,
          contentAssetId: request.body.contentAssetId?.trim() || undefined,
          mediaPresetId: request.body.mediaPresetId?.trim() || undefined,
          promptTemplateId: request.body.promptTemplateId?.trim() || undefined,
          generatedMediaType: request.body.generatedMediaType ?? request.body.templateType ?? "quote",
          inputPayload: {
            templateType: request.body.templateType,
            content: request.body.content,
            sourceAssetIds: Array.isArray(request.body.sourceAssetIds)
              ? request.body.sourceAssetIds.map((value) => value.trim()).filter(Boolean)
              : [],
          },
          outputPayload: {},
          status: "failed",
          errorMessage: error instanceof Error ? error.message : "Unable to generate visual.",
        });
      } catch {
        // Logging should never mask the original failure.
      }
    }

    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth?.userId,
      businessId,
      code: "visual_generation_failed",
      message: error instanceof Error ? error.message : "Unable to generate visual.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "visual_generation_failed",
      message: "Unable to generate visual.",
      logMessage: "Failed to generate visual.",
    });
  }
}
