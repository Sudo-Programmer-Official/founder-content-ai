import type {
  ApiError,
  HookGenerationRequest,
  HookGenerationResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { generateHooksWithAI } from "../services/aiService.ts";
import {
  safeCreateContentAsset,
  safeLogContentGeneration,
  safeLogEvent,
} from "../services/analytics/eventLoggingService.ts";
import { enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";

export async function generateHook(
  request: Request<unknown, HookGenerationResponse | ApiError, Partial<HookGenerationRequest>>,
  response: Response<HookGenerationResponse | ApiError>,
): Promise<void> {
  const topic = request.body?.topic?.trim();
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

    const generatedHooks = await generateHooksWithAI({ topic, businessId });
    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      safeLogEvent("hook_generated", request.auth?.userId, businessId, {
        route: "/api/generate-hook",
      }),
      safeLogContentGeneration({
        userId: request.auth?.userId,
        businessId,
        inputType: "idea",
        inputPayload: { topic },
        outputPayload: generatedHooks,
        success: true,
        latencyMs,
      }),
      safeCreateContentAsset({
        businessId,
        userId: request.auth?.userId,
        contentType: "hook",
        title: topic,
        contentBody: generatedHooks,
        sourceKind: "generated",
      }),
    ]);

    response.json(generatedHooks);
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      safeLogEvent("api_failed", request.auth?.userId, businessId, {
        route: "/api/generate-hook",
        code: "hook_generation_failed",
      }),
      safeCreateSystemErrorLog({
        route: request.originalUrl,
        userId: request.auth?.userId,
        businessId,
        code: "hook_generation_failed",
        message: error instanceof Error ? error.message : "Hook generation failed.",
      }),
      safeLogContentGeneration({
        userId: request.auth?.userId,
        businessId,
        inputType: "idea",
        inputPayload: { topic },
        success: false,
        latencyMs,
      }),
    ]);

    response.status(500).json({
      ok: false,
      error: {
        code: "hook_generation_failed",
        message: error instanceof Error ? error.message : "Hook generation failed.",
      },
    });
  }
}
