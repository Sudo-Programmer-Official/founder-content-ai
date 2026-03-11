import type {
  ApiError,
  IdeaGenerationRequest,
  IdeaGenerationResponse,
} from "../../../../packages/shared-types";
import type { Request, Response } from "express";
import { generateIdeasWithAI } from "../services/aiService";

export async function generateIdeas(
  request: Request<unknown, IdeaGenerationResponse | ApiError, Partial<IdeaGenerationRequest>>,
  response: Response<IdeaGenerationResponse | ApiError>,
): Promise<void> {
  const industry = request.body?.industry?.trim();
  const stage = request.body?.stage?.trim();

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
    const generatedIdeas = await generateIdeasWithAI({ industry, stage });
    response.json(generatedIdeas);
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: {
        code: "idea_generation_failed",
        message: error instanceof Error ? error.message : "Idea generation failed.",
      },
    });
  }
}
