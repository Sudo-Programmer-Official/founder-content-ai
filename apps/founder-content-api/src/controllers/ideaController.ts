import type {
  ApiError,
  IdeaGenerationRequest,
  IdeaGenerationResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { generateIdeasWithAI } from "../services/aiService.ts";
import {
  safeLogContentGeneration,
  safeLogEvent,
} from "../services/analytics/eventLoggingService.ts";
import { enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";

export async function generateIdeas(
  request: Request<unknown, IdeaGenerationResponse | ApiError, Partial<IdeaGenerationRequest>>,
  response: Response<IdeaGenerationResponse | ApiError>,
): Promise<void> {
  const industry = request.body?.industry?.trim();
  const stage = request.body?.stage?.trim();
  const businessId = request.body?.businessId?.trim();
  const startedAt = Date.now();

  if (!industry || !stage) {
    response.status(400).json({
      ok: false,
      error: {
        code: "bad_request",
        message: "industry and stage are required.",
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

    const generatedIdeas = await generateIdeasWithAI({ industry, stage, businessId });
    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      safeLogEvent("idea_generated", request.auth?.userId, businessId, {
        route: "/api/generate-ideas",
      }),
      safeLogContentGeneration({
        userId: request.auth?.userId,
        businessId,
        inputType: "idea",
        inputPayload: { industry, stage },
        outputPayload: generatedIdeas,
        success: true,
        latencyMs,
      }),
    ]);

    response.json(generatedIdeas);
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    await Promise.all([
      safeLogEvent("api_failed", request.auth?.userId, businessId, {
        route: "/api/generate-ideas",
        code: "idea_generation_failed",
      }),
      safeCreateSystemErrorLog({
        route: request.originalUrl,
        userId: request.auth?.userId,
        businessId,
        code: "idea_generation_failed",
        message: error instanceof Error ? error.message : "Idea generation failed.",
      }),
      safeLogContentGeneration({
        userId: request.auth?.userId,
        businessId,
        inputType: "idea",
        inputPayload: { industry, stage },
        success: false,
        latencyMs,
      }),
    ]);

    response.status(500).json({
      ok: false,
      error: {
        code: "idea_generation_failed",
        message: error instanceof Error ? error.message : "Idea generation failed.",
      },
    });
  }
}
