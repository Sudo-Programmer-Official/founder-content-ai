import type {
  ApiError,
  LinkedInPostGenerationRequest,
  LinkedInPostGenerationResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { generatePostsWithAI } from "../services/aiService.ts";
import {
  safeCreateContentAsset,
  safeLogContentGeneration,
  safeLogEvent,
} from "../services/analytics/eventLoggingService.ts";
import { resolveContentGenerationTone } from "../services/contentGenerationToneService.ts";
import { enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";
import { handleApiError } from "../utils/http.ts";

export async function generatePost(
  request: Request<
    unknown,
    LinkedInPostGenerationResponse | ApiError,
    Partial<LinkedInPostGenerationRequest>
  >,
  response: Response<LinkedInPostGenerationResponse | ApiError>,
): Promise<void> {
  const topic = request.body?.topic?.trim();
  const businessId = request.body?.businessId?.trim();
  const tone = await resolveContentGenerationTone({
    requestedTone: request.body?.tone,
    businessId,
  });
  const length = request.body?.length?.trim() || "medium";
  const selectedHook = request.body?.selectedHook?.trim();
  const strategy = request.body?.strategy;
  const startedAt = Date.now();

  if (!topic) {
    response.status(400).json({
      ok: false,
      error: {
        code: "bad_request",
        message: "topic is required.",
      },
    });
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "content_generation",
      usageMetric: "generations",
    });

    const generatedPosts = await generatePostsWithAI({
      topic,
      tone,
      strategy,
      length,
      selectedHook,
      businessId,
    });
    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      safeLogEvent("post_generated", request.auth?.userId, businessId, {
        route: "/api/generate-post",
      }),
      safeLogContentGeneration({
        userId: request.auth?.userId,
        businessId,
        inputType: "idea",
        inputPayload: { topic, tone, strategy, length, selectedHook },
        outputPayload: generatedPosts,
        success: true,
        latencyMs,
      }),
      safeCreateContentAsset({
        businessId,
        userId: request.auth?.userId,
        contentType: "post",
        title: topic,
        contentBody: generatedPosts,
        sourceKind: "generated",
      }),
    ]);

    response.json(generatedPosts);
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      safeLogEvent("api_failed", request.auth?.userId, businessId, {
        route: "/api/generate-post",
        code: "post_generation_failed",
      }),
      safeCreateSystemErrorLog({
        route: request.originalUrl,
        userId: request.auth?.userId,
        businessId,
        code: "post_generation_failed",
        message: error instanceof Error ? error.message : "Post generation failed.",
      }),
      safeLogContentGeneration({
        userId: request.auth?.userId,
        businessId,
        inputType: "idea",
        inputPayload: { topic, tone, strategy, length, selectedHook },
        success: false,
        latencyMs,
      }),
    ]);

    handleApiError(response, error, {
      statusCode: 500,
      code: "post_generation_failed",
      message: "Post generation failed.",
      logMessage: "Failed to generate post.",
    });
  }
}
