import type {
  ApiError,
  CaptureContentRequest,
  CaptureContentResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { generateCapturedContentWithAI } from "../services/aiService.ts";
import {
  safeCreateContentAsset,
  safeLogContentGeneration,
  safeLogEvent,
} from "../services/analytics/eventLoggingService.ts";
import { resolveContentGenerationTone } from "../services/contentGenerationToneService.ts";
import { enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";

function extractTextFromImagePlaceholder(image: string): string {
  const normalizedImage = image.trim();

  if (normalizedImage === "") {
    return "";
  }

  if (/^data:image\//i.test(normalizedImage)) {
    return "OCR placeholder extracted from an uploaded founder screenshot or image.";
  }

  return normalizedImage;
}

function normalizeCaptureInput(body: Partial<CaptureContentRequest>): string {
  const text = body.text?.trim() ?? "";
  const imageText = body.image ? extractTextFromImagePlaceholder(body.image) : "";

  return [text, imageText].filter((segment) => segment !== "").join("\n\n");
}

export async function captureContent(
  request: Request<unknown, CaptureContentResponse | ApiError, Partial<CaptureContentRequest>>,
  response: Response<CaptureContentResponse | ApiError>,
): Promise<void> {
  const rawInputText = normalizeCaptureInput(request.body ?? {});
  const businessId = request.body?.businessId?.trim();
  const tone = await resolveContentGenerationTone({
    requestedTone: request.body?.tone,
    businessId,
  });
  const strategy = request.body?.strategy;
  const inputType =
    request.body?.source === "voice" ? "voice" : request.body?.image ? "upload" : "idea";
  const startedAt = Date.now();

  if (!rawInputText) {
    response.status(400).json({
      ok: false,
      error: {
        code: "bad_request",
        message: "text or image is required.",
      },
    });
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "capture_remix",
      usageMetric: "posts",
    });

    const generatedContent = await generateCapturedContentWithAI({
      rawInputText,
      tone,
      strategy,
      businessId,
    });
    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      safeLogEvent("capture_used", request.auth?.userId, businessId, {
        route: "/api/capture",
        source: request.body?.source ?? "text",
      }),
      safeLogEvent("post_generated", request.auth?.userId, businessId, {
        route: "/api/capture",
        source: request.body?.source ?? "capture",
      }),
      safeLogContentGeneration({
        userId: request.auth?.userId,
        businessId,
        inputType,
        inputPayload: { rawInputText, tone, strategy, source: request.body?.source ?? "text" },
        outputPayload: generatedContent,
        success: true,
        latencyMs,
      }),
      safeCreateContentAsset({
        businessId,
        userId: request.auth?.userId,
        contentType: "post",
        contentBody: generatedContent,
      }),
    ]);

    response.json(generatedContent);
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      safeLogEvent("api_failed", request.auth?.userId, businessId, {
        route: "/api/capture",
        code: "capture_generation_failed",
      }),
      safeCreateSystemErrorLog({
        route: request.originalUrl,
        userId: request.auth?.userId,
        businessId,
        code: "capture_generation_failed",
        message: error instanceof Error ? error.message : "Capture generation failed.",
      }),
      safeLogContentGeneration({
        userId: request.auth?.userId,
        businessId,
        inputType,
        inputPayload: { rawInputText, tone, strategy, source: request.body?.source ?? "text" },
        success: false,
        latencyMs,
      }),
    ]);

    response.status(500).json({
      ok: false,
      error: {
        code: "capture_generation_failed",
        message: error instanceof Error ? error.message : "Capture generation failed.",
      },
    });
  }
}
