import { generateCompletion } from "../../ai-core/src/generateCompletion.ts";
import type {
  ContentFormat,
  ContentResultMap,
  GenerateContentRequest,
} from "./types.ts";
import {
  resolveContentDefinition,
  resolveContentPromptPath,
} from "./content-definitions.ts";
import { loadPromptFile } from "./prompt-loader.ts";
import type {
  HookGenerationRequest,
  HookGenerationResponse,
  IdeaGenerationRequest,
  IdeaGenerationResponse,
  LinkedInPostGenerationRequest,
  LinkedInPostGenerationResponse,
  StructuredContentGenerationRequest,
  StructuredContentResponse,
} from "../../shared-types/index.ts";

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

function extractJsonObject(value: string): string {
  const firstObjectIndex = value.indexOf("{");
  const lastObjectIndex = value.lastIndexOf("}");

  if (firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex) {
    return value.slice(firstObjectIndex, lastObjectIndex + 1);
  }

  return value;
}

function parseCompletionJson<T>(completion: string): T {
  const stripped = stripCodeFences(completion);

  try {
    return JSON.parse(stripped) as T;
  } catch (error) {
    const extracted = extractJsonObject(stripped);

    if (extracted !== stripped) {
      return JSON.parse(extracted) as T;
    }

    throw error;
  }
}

async function generateStructuredCompletion(prompt: string): Promise<Record<string, unknown>> {
  const completion = await generateCompletion(prompt, {
    jsonMode: true,
  });

  try {
    return parseCompletionJson<Record<string, unknown>>(completion);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    const retryPrompt = [
      prompt.trim(),
      "",
      "The previous response was invalid JSON.",
      `Parsing error: ${error.message}`,
      "Return the same response again as one valid JSON object only.",
      "Do not include markdown, comments, trailing text, or partial arrays.",
    ].join("\n");

    const retryCompletion = await generateCompletion(retryPrompt, {
      jsonMode: true,
    });

    return parseCompletionJson<Record<string, unknown>>(retryCompletion);
  }
}

export async function generateContent<TFormat extends ContentFormat>(
  request: GenerateContentRequest<TFormat>,
): Promise<ContentResultMap[TFormat]> {
  const definition = resolveContentDefinition(request.channel, request.format);
  const template = await loadPromptFile(resolveContentPromptPath(definition, request));
  const prompt = buildPrompt(template, definition.buildVariables(request));
  const parsed = definition.validate(await generateStructuredCompletion(prompt));

  return definition.normalize(parsed);
}

export async function generateLinkedInIdeas(
  input: IdeaGenerationRequest,
): Promise<IdeaGenerationResponse> {
  return generateContent({
    input,
    channel: "linkedin",
    format: "ideas",
  });
}

export async function generateLinkedInHooks(
  input: HookGenerationRequest,
): Promise<HookGenerationResponse> {
  return generateContent({
    input,
    channel: "linkedin",
    format: "hooks",
  });
}

export async function generateLinkedInPost(
  input: LinkedInPostGenerationRequest,
): Promise<LinkedInPostGenerationResponse> {
  return generateContent({
    input,
    channel: "linkedin",
    tone: input.tone,
    format: "post",
  });
}

export async function generateLinkedInCapturedContent(
  input: StructuredContentGenerationRequest,
): Promise<StructuredContentResponse> {
  return generateContent({
    input,
    channel: "linkedin",
    tone: input.tone,
    intent: "POST_GENERATION",
    format: "content",
  });
}

export async function generateLinkedInRemixedContent(
  input: StructuredContentGenerationRequest,
): Promise<StructuredContentResponse> {
  return generateContent({
    input,
    channel: "linkedin",
    tone: input.tone,
    intent: "REMIX",
    format: "content",
  });
}
