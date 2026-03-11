import type {
  HookGenerationRequest,
  HookGenerationResponse,
  IdeaGenerationRequest,
  IdeaGenerationResponse,
  IdeaOption,
  LinkedInPostGenerationRequest,
  LinkedInPostGenerationResponse,
  LinkedInPostVariation,
} from "../../../../packages/shared-types";
import { generateCompletion } from "../../../../packages/ai-core/src/generateCompletion";
import { loadPrompt } from "./promptLoader";

function buildPrompt(template: string, variables: Record<string, string | undefined>): string {
  const filteredVariables = Object.fromEntries(
    Object.entries(variables).filter(([, value]) => typeof value === "string" && value.trim() !== ""),
  );

  return [
    template.trim(),
    "",
    "USER INPUT",
    JSON.stringify(filteredVariables, null, 2),
    "",
    "RESPONSE RULES",
    "- Return only valid JSON.",
    "- Do not wrap the JSON in markdown code fences.",
  ].join("\n");
}

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseCompletionJson<T>(completion: string): T {
  const normalized = stripCodeFences(completion);
  return JSON.parse(normalized) as T;
}

function normalizeIdeas(ideas: unknown): IdeaOption[] {
  if (!Array.isArray(ideas)) {
    throw new Error("Idea generation returned an invalid ideas payload.");
  }

  return ideas.map((idea, index) => {
    const entry = (idea ?? {}) as { title?: unknown; angle?: unknown };

    return {
      title:
        typeof entry.title === "string" && entry.title.trim() !== ""
          ? entry.title.trim()
          : `Generated idea ${index + 1}`,
      angle:
        typeof entry.angle === "string" && entry.angle.trim() !== ""
          ? entry.angle.trim()
          : "Founder-specific content angle.",
    };
  });
}

function normalizeHooks(hooks: unknown): string[] {
  if (!Array.isArray(hooks)) {
    throw new Error("Hook generation returned an invalid hooks payload.");
  }

  return hooks
    .map((hook) => (typeof hook === "string" ? hook.trim() : ""))
    .filter((hook) => hook.length > 0);
}

function normalizeVariations(variations: unknown): LinkedInPostVariation[] {
  if (!Array.isArray(variations)) {
    throw new Error("Post generation returned an invalid variations payload.");
  }

  return variations.map((variation, index) => {
    const entry = (variation ?? {}) as { angle?: unknown; content?: unknown };
    const angle = typeof entry.angle === "string" ? entry.angle.trim() : "";
    const content = typeof entry.content === "string" ? entry.content.trim() : "";

    const normalizedAngle = angle === "story" || angle === "lesson" || angle === "build-in-public"
      ? angle
      : (index === 0 ? "story" : index === 1 ? "lesson" : "build-in-public");

    if (!content) {
      throw new Error("Post generation returned an empty content field.");
    }

    return {
      angle: normalizedAngle,
      content,
    };
  });
}

export async function generateIdeasWithAI(
  input: IdeaGenerationRequest,
): Promise<IdeaGenerationResponse> {
  const template = await loadPrompt("ideas");
  const prompt = buildPrompt(template, {
    industry: input.industry,
    stage: input.stage,
  });
  const completion = await generateCompletion(prompt);
  const parsed = parseCompletionJson<{ ideas: unknown }>(completion);

  return {
    ideas: normalizeIdeas(parsed.ideas),
  };
}

export async function generateHooksWithAI(
  input: HookGenerationRequest,
): Promise<HookGenerationResponse> {
  const template = await loadPrompt("hook");
  const prompt = buildPrompt(template, {
    topic: input.topic,
  });
  const completion = await generateCompletion(prompt);
  const parsed = parseCompletionJson<{ hooks: unknown }>(completion);

  return {
    hooks: normalizeHooks(parsed.hooks),
  };
}

export async function generatePostsWithAI(
  input: LinkedInPostGenerationRequest,
): Promise<LinkedInPostGenerationResponse> {
  const template = await loadPrompt("post");
  const prompt = buildPrompt(template, {
    topic: input.topic,
    tone: input.tone,
    length: input.length,
    selected_hook: input.selectedHook,
  });
  const completion = await generateCompletion(prompt);
  const parsed = parseCompletionJson<{ variations: unknown }>(completion);

  return {
    variations: normalizeVariations(parsed.variations),
  };
}
