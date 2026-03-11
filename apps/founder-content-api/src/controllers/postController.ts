import type {
  ApiError,
  LinkedInPostGenerationRequest,
  LinkedInPostGenerationResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { generatePostsWithAI } from "../services/aiService.ts";

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
    const generatedPosts = await generatePostsWithAI({
      topic,
      tone,
      length,
      selectedHook,
    });
    response.json(generatedPosts);
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: {
        code: "post_generation_failed",
        message: error instanceof Error ? error.message : "Post generation failed.",
      },
    });
  }
}
