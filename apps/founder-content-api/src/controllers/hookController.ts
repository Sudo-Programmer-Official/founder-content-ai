import type {
  ApiError,
  HookGenerationRequest,
  HookGenerationResponse,
} from "../../../../packages/shared-types";
import type { Request, Response } from "express";
import { generateHooksWithAI } from "../services/aiService";

export async function generateHook(
  request: Request<unknown, HookGenerationResponse | ApiError, Partial<HookGenerationRequest>>,
  response: Response<HookGenerationResponse | ApiError>,
): Promise<void> {
  const topic = request.body?.topic?.trim();

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
    const generatedHooks = await generateHooksWithAI({ topic });
    response.json(generatedHooks);
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: {
        code: "hook_generation_failed",
        message: error instanceof Error ? error.message : "Hook generation failed.",
      },
    });
  }
}
