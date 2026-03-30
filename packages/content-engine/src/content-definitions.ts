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
  validate: (parsed: Record<string, unknown>) => Record<string, unknown>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function validateIdeaEntry(
  idea: unknown,
  context: string,
): Record<string, unknown> {
  if (!isRecord(idea)) {
    throw new Error(`${context} must be an object.`);
  }

  const hasTitle = typeof idea.title === "string" && idea.title.trim() !== "";
  const hasAngle = typeof idea.angle === "string" && idea.angle.trim() !== "";

  if (!hasTitle && !hasAngle) {
    throw new Error(`${context} must include a title or angle.`);
  }

  return idea;
}

function requireArrayField(
  parsed: Record<string, unknown>,
  key: string,
  message: string,
): unknown[] {
  const value = parsed[key];

  if (!Array.isArray(value)) {
    throw new Error(message);
  }

  return value;
}

function requireRecordField(
  parsed: Record<string, unknown>,
  key: string,
  message: string,
): Record<string, unknown> {
  const value = parsed[key];

  if (!isRecord(value)) {
    throw new Error(message);
  }

  return value;
}

function validateIdeasPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  const ideas = requireArrayField(parsed, "ideas", "Idea generation must return an ideas array.");

  if (ideas.length === 0) {
    throw new Error("Idea generation returned an empty ideas array.");
  }

  ideas.forEach((idea, index) => {
    validateIdeaEntry(idea, `ideas[${index}]`);
  });

  return parsed;
}

function validateHooksPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  const hooks = requireArrayField(parsed, "hooks", "Hook generation must return a hooks array.");

  if (hooks.length === 0) {
    throw new Error("Hook generation returned an empty hooks array.");
  }

  hooks.forEach((hook, index) => {
    if (typeof hook !== "string" || hook.trim() === "") {
      throw new Error(`hooks[${index}] must be a non-empty string.`);
    }
  });

  return parsed;
}

function validateVariationsPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  const variations = requireArrayField(
    parsed,
    "variations",
    "Post generation must return a variations array.",
  );

  if (variations.length === 0) {
    throw new Error("Post generation returned an empty variations array.");
  }

  variations.forEach((variation, index) => {
    if (!isRecord(variation)) {
      throw new Error(`variations[${index}] must be an object.`);
    }

    if (typeof variation.content !== "string" || variation.content.trim() === "") {
      throw new Error(`variations[${index}].content must be a non-empty string.`);
    }
  });

  return parsed;
}

function validateStructuredContentPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  const idea = requireRecordField(
    parsed,
    "idea",
    "Structured content generation must return an idea object.",
  );
  validateIdeaEntry(idea, "idea");

  validateHooksPayload(parsed);

  const post = parsed.post;
  const hasStringPost = typeof post === "string" && post.trim() !== "";
  const hasObjectPost =
    isRecord(post) && typeof post.content === "string" && post.content.trim() !== "";

  if (!hasStringPost && !hasObjectPost) {
    throw new Error("Structured content generation must return a post string or post.content.");
  }

  return parsed;
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
  const marketReferences = (brandContext.marketReferences ?? []).filter((value) => value.trim() !== "");
  const lines = [
    brandContext.tone ? `Tone: ${brandContext.tone}` : undefined,
    brandContext.writingStyle ? `Writing style: ${brandContext.writingStyle}` : undefined,
    brandContext.visualStyle ? `Visual style: ${brandContext.visualStyle}` : undefined,
    brandContext.goals && brandContext.goals.length > 0
      ? `Business goals: ${brandContext.goals.join(", ")}`
      : undefined,
    topics.length > 0 ? `Topics: ${topics.join(", ")}` : undefined,
    patterns.length > 0 ? `Patterns: ${patterns.join(" | ")}` : undefined,
    marketReferences.length > 0 ? `Market references: ${marketReferences.join(" | ")}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function serializePlatformContext(platformContext: string | undefined): string | undefined {
  const normalized = platformContext?.trim();
  return normalized ? normalized : undefined;
}

function serializePovContext(input: {
  rawText: string;
  tone?: string;
  brandContext?: BrandPromptContext;
}): string | undefined {
  const normalizedText = input.rawText.trim();

  if (!normalizedText) {
    return undefined;
  }

  const goals = (input.brandContext?.goals ?? []).filter((goal) => goal.trim() !== "");
  const topics = (input.brandContext?.topics ?? []).filter((topic) => topic.trim() !== "");
  const tone = input.tone?.trim().toLowerCase() ?? "";
  const lines = [
    "Sharpen the point of view instead of summarizing the topic.",
    "Make the claim specific to a founder's lived reality, tradeoff, or mistake.",
    goals.length > 0 ? `Align the message to these business goals when natural: ${goals.join(", ")}.` : undefined,
    topics.length > 0 ? `Stay grounded in these recurring brand themes: ${topics.join(", ")}.` : undefined,
    tone.includes("bold") || tone.includes("contrarian")
      ? "Lean into contrast and tension. The stance can be more explicit."
      : "Keep the stance measured but clear. Do not drift into generic advice.",
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
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
          platform_context: serializePlatformContext(request.platformContext),
        };
      },
      validate: (parsed) => validateIdeasPayload(parsed),
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
          platform_context: serializePlatformContext(request.platformContext),
        };
      },
      validate: (parsed) => validateHooksPayload(parsed),
      normalize: (parsed) => ({
        hooks: normalizeHooks(parsed.hooks),
      }),
    },
    post: {
      promptPath: founderContentPromptFiles.linkedinPost,
      buildVariables: (request) => {
        const variables = normalizeInput(request.input);
        const selectedHook = variables.selectedHook ?? variables.selected_hook;
        const topic = requireField(variables, "topic", "topic is required.");
        const tone = request.tone?.trim() || variables.tone || "storytelling";

        return {
          topic,
          tone,
          length: variables.length || "medium",
          selected_hook: selectedHook,
          brand_context: serializeBrandContext(request.brandContext),
          platform_context: serializePlatformContext(request.platformContext),
          pov_context: serializePovContext({
            rawText: topic,
            tone,
            brandContext: request.brandContext,
          }),
        };
      },
      validate: (parsed) => validateVariationsPayload(parsed),
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
        const tone = request.tone?.trim() || variables.tone || "storytelling";

        return {
          raw_input_text: rawInputText,
          tone,
          intent: resolveIntent(request.intent),
          brand_context: serializeBrandContext(request.brandContext),
          platform_context: serializePlatformContext(request.platformContext),
          pov_context: serializePovContext({
            rawText: rawInputText,
            tone,
            brandContext: request.brandContext,
          }),
        };
      },
      validate: (parsed) => validateStructuredContentPayload(parsed),
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
