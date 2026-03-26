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
import { enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";

export async function generatePost(
  request: Request<
    unknown,
    LinkedInPostGenerationResponse | ApiError,
    Partial<LinkedInPostGenerationRequest>
  >,
  response: Response<LinkedInPostGenerationResponse | ApiError>,
): Promise<void> {
  const topic = request.body?.topic?.trim();
  const tone = request.body?.tone?.trim() || "storytelling";
  const length = request.body?.length?.trim() || "medium";
  const selectedHook = request.body?.selectedHook?.trim();
  const businessId = request.body?.businessId?.trim();
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
      usageMetric: "posts",
    });

    const generatedPosts = await generatePostsWithAI({
      topic,
      tone,
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
        inputPayload: { topic, tone, length, selectedHook },
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
        inputPayload: { topic, tone, length, selectedHook },
        success: false,
        latencyMs,
      }),
    ]);

    response.status(500).json({
      ok: false,
      error: {
        code: "post_generation_failed",
        message: error instanceof Error ? error.message : "Post generation failed.",
      },
    });
  }
}
