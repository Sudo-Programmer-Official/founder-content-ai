import { founderContentPromptFiles } from "../../prompts/index.ts";
import type {
  ContentChannel,
  ContentFormat,
  ContentIntent,
  ContentResultMap,
  ContentVariables,
  GenerateContentRequest,
} from "./types.ts";
import type {
  BrandPromptContext,
  IdeaOption,
  LinkedInPostVariation,
  StructuredContentResponse,
} from "../../shared-types/index.ts";

interface ContentDefinition<TFormat extends ContentFormat> {
  promptPath: string | ((request: GenerateContentRequest<TFormat>) => string);
  buildVariables: (request: GenerateContentRequest<TFormat>) => ContentVariables;
  normalize: (parsed: Record<string, unknown>) => ContentResultMap[TFormat];
}

type ChannelContentDefinitions = {
  [TFormat in ContentFormat]: ContentDefinition<TFormat>;
};

function normalizeInput(input: GenerateContentRequest["input"]): ContentVariables {
  if (typeof input === "string") {
    return {
      input: input.trim(),
    };
  }

  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, typeof value === "string" ? value.trim() : undefined]),
  );
}

function requireField(
  variables: ContentVariables,
  key: string,
  message: string,
): string {
  const value = variables[key];

  if (!value) {
    throw new Error(message);
  }

  return value;
}

function requireValue(value: string | undefined, message: string): string {
  if (!value || value.trim() === "") {
    throw new Error(message);
  }

  return value.trim();
}

function normalizeIdeaEntry(
  idea: unknown,
  fallbackTitle = "Generated idea",
): IdeaOption {
  const entry = (idea ?? {}) as { title?: unknown; angle?: unknown };

  return {
    title:
      typeof entry.title === "string" && entry.title.trim() !== ""
        ? entry.title.trim()
        : fallbackTitle,
    angle:
      typeof entry.angle === "string" && entry.angle.trim() !== ""
        ? entry.angle.trim()
        : "Founder-specific content angle.",
  };
}

function normalizeIdeas(ideas: unknown): IdeaOption[] {
  if (!Array.isArray(ideas)) {
    throw new Error("Idea generation returned an invalid ideas payload.");
  }

  return ideas.map((idea, index) => normalizeIdeaEntry(idea, `Generated idea ${index + 1}`));
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

  const fallbackAngles: LinkedInPostVariation["angle"][] = [
    "story",
    "lesson",
    "build-in-public",
  ];

  return variations.map((variation, index) => {
    const entry = (variation ?? {}) as { angle?: unknown; content?: unknown };
    const angle = typeof entry.angle === "string" ? entry.angle.trim() : "";
    const content = typeof entry.content === "string" ? entry.content.trim() : "";

    if (!content) {
      throw new Error("Post generation returned an empty content field.");
    }

    return {
      angle:
        angle === "story" || angle === "lesson" || angle === "build-in-public"
          ? angle
          : fallbackAngles[index] ?? "build-in-public",
      content,
    };
  });
}

function normalizePost(post: unknown): string {
  if (typeof post === "string" && post.trim() !== "") {
    return post.trim();
  }

  const entry = (post ?? {}) as { content?: unknown };

  if (typeof entry.content === "string" && entry.content.trim() !== "") {
    return entry.content.trim();
  }

  throw new Error("Structured content generation returned an invalid post payload.");
}

function resolveIntent(intent: ContentIntent | undefined): ContentIntent {
  return intent ?? "POST_GENERATION";
}

function serializeBrandContext(brandContext: BrandPromptContext | undefined): string | undefined {
  if (!brandContext) {
    return undefined;
  }

  const topics = (brandContext.topics ?? []).filter((topic) => topic.trim() !== "");
  const patterns = (brandContext.patterns ?? []).filter((pattern) => pattern.trim() !== "");
  const lines = [
    brandContext.tone ? `Tone: ${brandContext.tone}` : undefined,
    brandContext.writingStyle ? `Writing style: ${brandContext.writingStyle}` : undefined,
    brandContext.visualStyle ? `Visual style: ${brandContext.visualStyle}` : undefined,
    topics.length > 0 ? `Topics: ${topics.join(", ")}` : undefined,
    patterns.length > 0 ? `Patterns: ${patterns.join(" | ")}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function resolveRawInputText(variables: ContentVariables): string | undefined {
  return (
    variables.rawInputText ??
    variables.raw_input_text ??
    variables.referenceText ??
    variables.reference_text ??
    variables.text ??
    variables.input
  );
}

function normalizeStructuredContent(parsed: Record<string, unknown>): StructuredContentResponse {
  return {
    idea: normalizeIdeaEntry(parsed.idea, "Generated idea"),
    hooks: normalizeHooks(parsed.hooks).slice(0, 3),
    post: normalizePost(parsed.post),
  };
}

const contentDefinitions: Record<ContentChannel, ChannelContentDefinitions> = {
  linkedin: {
    ideas: {
      promptPath: founderContentPromptFiles.ideaGenerator,
      buildVariables: (request) => {
        const variables = normalizeInput(request.input);

        return {
          industry: requireField(variables, "industry", "industry is required."),
          stage: requireField(variables, "stage", "stage is required."),
          brand_context: serializeBrandContext(request.brandContext),
        };
      },
      normalize: (parsed) => ({
        ideas: normalizeIdeas(parsed.ideas),
      }),
    },
    hooks: {
      promptPath: founderContentPromptFiles.hookGenerator,
      buildVariables: (request) => {
        const variables = normalizeInput(request.input);

        return {
          topic: requireField(variables, "topic", "topic is required."),
          brand_context: serializeBrandContext(request.brandContext),
        };
      },
      normalize: (parsed) => ({
        hooks: normalizeHooks(parsed.hooks),
      }),
    },
    post: {
      promptPath: founderContentPromptFiles.linkedinPost,
      buildVariables: (request) => {
        const variables = normalizeInput(request.input);
        const selectedHook = variables.selectedHook ?? variables.selected_hook;

        return {
          topic: requireField(variables, "topic", "topic is required."),
          tone: request.tone?.trim() || variables.tone || "storytelling",
          length: variables.length || "medium",
          selected_hook: selectedHook,
          brand_context: serializeBrandContext(request.brandContext),
        };
      },
      normalize: (parsed) => ({
        variations: normalizeVariations(parsed.variations),
      }),
    },
    content: {
      promptPath: (request) =>
        resolveIntent(request.intent) === "REMIX"
          ? founderContentPromptFiles.remixGenerator
          : founderContentPromptFiles.captureGenerator,
      buildVariables: (request) => {
        const variables = normalizeInput(request.input);
        const rawInputText = requireValue(
          resolveRawInputText(variables),
          "raw input text is required.",
        );

        return {
          raw_input_text: rawInputText,
          tone: request.tone?.trim() || variables.tone || "storytelling",
          intent: resolveIntent(request.intent),
          brand_context: serializeBrandContext(request.brandContext),
        };
      },
      normalize: (parsed) => normalizeStructuredContent(parsed),
    },
  },
};

export function resolveContentDefinition<TFormat extends ContentFormat>(
  channel: ContentChannel,
  format: TFormat,
): ContentDefinition<TFormat> {
  return contentDefinitions[channel][format];
}

export function resolveContentPromptPath<TFormat extends ContentFormat>(
  definition: ContentDefinition<TFormat>,
  request: GenerateContentRequest<TFormat>,
): string {
  return typeof definition.promptPath === "function"
    ? definition.promptPath(request)
    : definition.promptPath;
}
