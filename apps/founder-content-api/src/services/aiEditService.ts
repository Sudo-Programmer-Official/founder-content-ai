import type {
  BrandPromptContext,
  ContentAiEditPreview,
  PreviewContentAiEditRequest,
} from "../../../../packages/shared-types/index.ts";
import { founderContentPromptFiles } from "../../../../packages/prompts/index.ts";
import { generateCompletion } from "../../../../packages/ai-core/src/generateCompletion.ts";
import { loadPromptFile } from "../../../../packages/content-engine/src/prompt-loader.ts";
import { getBrandPromptContextForBusiness } from "./brandIntelligence/brandProfileService.ts";
import { getLinkedInGenerationContextForBusiness } from "./socialAuthService.ts";

function serializeBrandContext(brandContext: BrandPromptContext | undefined): string | undefined {
  if (!brandContext) {
    return undefined;
  }

  const topics = (brandContext.topics ?? []).map((topic) => topic.trim()).filter(Boolean);
  const patterns = (brandContext.patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);
  const marketReferences = (brandContext.marketReferences ?? []).map((value) => value.trim()).filter(Boolean);
  const beliefs = (brandContext.beliefs ?? []).map((value) => value.trim()).filter(Boolean);
  const lines = [
    brandContext.tone ? `Tone: ${brandContext.tone}` : "",
    brandContext.writingStyle ? `Writing style: ${brandContext.writingStyle}` : "",
    brandContext.visualStyle ? `Visual style: ${brandContext.visualStyle}` : "",
    brandContext.voiceSummary ? `Voice summary: ${brandContext.voiceSummary}` : "",
    brandContext.audience ? `Audience: ${brandContext.audience}` : "",
    brandContext.positioning ? `Positioning: ${brandContext.positioning}` : "",
    topics.length > 0 ? `Topics: ${topics.join(", ")}` : "",
    patterns.length > 0 ? `Patterns: ${patterns.join(" | ")}` : "",
    beliefs.length > 0 ? `Core beliefs: ${beliefs.join(" | ")}` : "",
    marketReferences.length > 0 ? `Market references: ${marketReferences.join(" | ")}` : "",
  ].filter(Boolean);

  return lines.length > 0 ? lines.join("\n") : undefined;
}

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

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeActions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry !== "");
}

function buildFallbackExcerpt(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("\n\n")
    .slice(0, 320);
}

function validateEditPreview(
  parsed: Record<string, unknown>,
  instruction: string,
  originalText: string,
): ContentAiEditPreview {
  const suggestedText = normalizeString(parsed.suggestedText);

  if (!suggestedText) {
    throw new Error("AI edit preview did not return suggestedText.");
  }

  return {
    instruction,
    interpretedActions: normalizeActions(parsed.interpretedActions),
    summary:
      normalizeString(parsed.summary) ||
      "Suggested a scoped revision based on your instruction.",
    scopeHint:
      normalizeString(parsed.scopeHint) ||
      "Review the suggested draft before applying it.",
    originalText,
    suggestedText,
    beforeExcerpt:
      normalizeString(parsed.beforeExcerpt) || buildFallbackExcerpt(originalText),
    afterExcerpt:
      normalizeString(parsed.afterExcerpt) || buildFallbackExcerpt(suggestedText),
  };
}

export async function generateContentAiEditPreview(
  input: PreviewContentAiEditRequest,
): Promise<ContentAiEditPreview> {
  const originalText = input.textContent?.trim();

  if (!originalText) {
    throw new Error("textContent is required to generate an edit preview.");
  }

  const instruction = input.instruction.trim();

  if (!instruction) {
    throw new Error("instruction is required to generate an edit preview.");
  }

  const [template, brandContext, platformContext] = await Promise.all([
    loadPromptFile(founderContentPromptFiles.editorCommand),
    getBrandPromptContextForBusiness(input.businessId),
    getLinkedInGenerationContextForBusiness(input.businessId),
  ]);

  const prompt = buildPrompt(template, {
    instruction,
    original_post: originalText,
    brand_context: serializeBrandContext(brandContext),
    platform_context: platformContext?.trim() || undefined,
  });

  const parsed = await generateStructuredCompletion(prompt);
  return validateEditPreview(parsed, instruction, originalText);
}
