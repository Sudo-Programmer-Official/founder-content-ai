import type {
  ApiError,
  RemixContentRequest,
  RemixContentResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { generateRemixedContentWithAI } from "../services/aiService.ts";
import {
  safeCreateContentAsset,
  safeLogContentGeneration,
  safeLogEvent,
} from "../services/analytics/eventLoggingService.ts";
import { enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";

export async function remixContent(
  request: Request<unknown, RemixContentResponse | ApiError, Partial<RemixContentRequest>>,
  response: Response<RemixContentResponse | ApiError>,
): Promise<void> {
  const referenceText = request.body?.referenceText?.trim();
  const tone = request.body?.tone?.trim() || "storytelling";
  const businessId = request.body?.businessId?.trim();
  const startedAt = Date.now();

  if (!referenceText) {
    response.status(400).json({
      ok: false,
      error: {
        code: "bad_request",
        message: "referenceText is required.",
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

    const remixedContent = await generateRemixedContentWithAI({
      rawInputText: referenceText,
      tone,
      businessId,
    });
    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      safeLogEvent("remix_used", request.auth?.userId, businessId, {
        route: "/api/remix",
      }),
      safeLogEvent("post_generated", request.auth?.userId, businessId, {
        route: "/api/remix",
        source: "remix",
      }),
      safeLogContentGeneration({
        userId: request.auth?.userId,
        businessId,
        inputType: "link",
        inputPayload: { referenceText, tone },
        outputPayload: remixedContent,
        success: true,
        latencyMs,
      }),
      safeCreateContentAsset({
        businessId,
        userId: request.auth?.userId,
        contentType: "post",
        contentBody: remixedContent,
      }),
    ]);

    response.json(remixedContent);
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      safeLogEvent("api_failed", request.auth?.userId, businessId, {
        route: "/api/remix",
        code: "remix_generation_failed",
      }),
      safeCreateSystemErrorLog({
        route: request.originalUrl,
        userId: request.auth?.userId,
        businessId,
        code: "remix_generation_failed",
        message: error instanceof Error ? error.message : "Remix generation failed.",
      }),
      safeLogContentGeneration({
        userId: request.auth?.userId,
        businessId,
        inputType: "link",
        inputPayload: { referenceText, tone },
        success: false,
        latencyMs,
      }),
    ]);

    response.status(500).json({
      ok: false,
      error: {
        code: "remix_generation_failed",
        message: error instanceof Error ? error.message : "Remix generation failed.",
      },
    });
  }
}
