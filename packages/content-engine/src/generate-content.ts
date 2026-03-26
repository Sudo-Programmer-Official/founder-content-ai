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

function parseCompletionJson<T>(completion: string): T {
  return JSON.parse(stripCodeFences(completion)) as T;
}

export async function generateContent<TFormat extends ContentFormat>(
  request: GenerateContentRequest<TFormat>,
): Promise<ContentResultMap[TFormat]> {
  const definition = resolveContentDefinition(request.channel, request.format);
  const template = await loadPromptFile(resolveContentPromptPath(definition, request));
  const prompt = buildPrompt(template, definition.buildVariables(request));
  const completion = await generateCompletion(prompt);
  const parsed = parseCompletionJson<Record<string, unknown>>(completion);

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
