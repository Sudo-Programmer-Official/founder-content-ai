import type {
  BrandPromptContext,
  CaptureContentResponse,
  HookGenerationRequest,
  HookGenerationResponse,
  IdeaGenerationRequest,
  IdeaGenerationResponse,
  LinkedInPostGenerationRequest,
  LinkedInPostGenerationResponse,
  LinkedInPostVariation,
  RemixContentResponse,
  StructuredContentGenerationRequest,
  StructuredContentResponse,
} from "../../../../packages/shared-types/index.ts";
import {
  generateContent,
} from "../../../../packages/content-engine/src/index.ts";
import { getBrandPromptContextForBusiness } from "./brandIntelligence/brandProfileService.ts";
import { buildSavedSourceMemoryContext } from "./content/brandSourceMemoryService.ts";
import { buildContentAssetIntelligenceFromText } from "./contentIntelligenceService.ts";
import { getLinkedInGenerationContextForBusiness } from "./socialAuthService.ts";
import { logWarn } from "../utils/logger.ts";

function appendSavedSourceContext(inputText: string, sourceContext: string | undefined): string {
  const normalizedInput = inputText.trim();

  if (!sourceContext) {
    return normalizedInput;
  }

  return `${normalizedInput}\n\n${sourceContext}`;
}

function buildWorkspaceAlignmentContext(brandContext: BrandPromptContext | undefined): string | undefined {
  if (!brandContext) {
    return undefined;
  }

  const goals = (brandContext.goals ?? []).filter((item) => item.trim() !== "");
  const topics = (brandContext.topics ?? []).filter((item) => item.trim() !== "");
  const beliefs = (brandContext.beliefs ?? []).filter((item) => item.trim() !== "");
  const performanceInsights = (brandContext.performanceInsights ?? []).filter((item) => item.trim() !== "");

  const lines = [
    "Alignment requirements:",
    "Treat this workspace as the source of truth. Keep content specific to this business, its offer, and its audience.",
    brandContext.audience ? `Primary audience to serve: ${brandContext.audience}` : undefined,
    brandContext.positioning ? `Positioning to reinforce: ${brandContext.positioning}` : undefined,
    goals.length > 0 ? `Business goals to support: ${goals.join(", ")}` : undefined,
    topics.length > 0 ? `Allowed topic lanes: ${topics.join(", ")}` : undefined,
    beliefs.length > 0 ? `Brand beliefs to preserve: ${beliefs.join(" | ")}` : undefined,
    performanceInsights.length > 0
      ? `Performance signals to respect: ${performanceInsights.join(" | ")}`
      : undefined,
    "Do not produce generic startup content disconnected from the workspace domain.",
    "If key details are missing, infer from the provided workspace context and keep claims realistic.",
  ].filter((line): line is string => Boolean(line));

  return lines.length > 0 ? lines.join("\n") : undefined;
}

function mergeGenerationContext(
  platformContext: string | undefined,
  alignmentContext: string | undefined,
): string | undefined {
  const chunks = [platformContext?.trim(), alignmentContext?.trim()].filter(
    (chunk): chunk is string => Boolean(chunk && chunk.length > 0),
  );

  return chunks.length > 0 ? chunks.join("\n\n") : undefined;
}

function tokenize(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
}

function buildAlignmentLexicon(brandContext: BrandPromptContext | undefined): Set<string> {
  const tokens = [
    ...tokenize(brandContext?.audience),
    ...tokenize(brandContext?.positioning),
    ...(brandContext?.topics ?? []).flatMap((topic) => tokenize(topic)),
    ...(brandContext?.goals ?? []).flatMap((goal) => tokenize(goal)),
    ...(brandContext?.beliefs ?? []).flatMap((belief) => tokenize(belief)),
  ];

  return new Set(tokens);
}

function computeAlignmentScore(text: string, brandContext: BrandPromptContext | undefined): number {
  const lexicon = buildAlignmentLexicon(brandContext);
  if (lexicon.size === 0) {
    return 1;
  }

  const textTokens = tokenize(text);
  if (textTokens.length === 0) {
    return 0;
  }

  let matches = 0;
  for (const token of textTokens) {
    if (lexicon.has(token)) {
      matches += 1;
    }
  }

  return matches / textTokens.length;
}

function shouldRetryForAlignment(score: number): boolean {
  return score < 0.08;
}

function buildStrictAlignmentContext(baseContext: string | undefined): string | undefined {
  const strictBlock = [
    "Hard alignment rule:",
    "Anchor every paragraph to this workspace's exact business domain, customer problem, and offer.",
    "Reject generic founder advice that could apply to any company.",
  ].join("\n");

  return mergeGenerationContext(baseContext, strictBlock);
}

function enrichVariation(
  variation: LinkedInPostVariation,
  brandContext: Awaited<ReturnType<typeof getBrandPromptContextForBusiness>> | undefined,
): LinkedInPostVariation {
  const intelligence = buildContentAssetIntelligenceFromText(variation.content, brandContext);

  return {
    ...variation,
    quality: intelligence?.quality,
    pov: intelligence?.pov,
  };
}

function enrichStructuredResponse<TResponse extends StructuredContentResponse>(
  response: TResponse,
  brandContext: Awaited<ReturnType<typeof getBrandPromptContextForBusiness>> | undefined,
): TResponse {
  const intelligence = buildContentAssetIntelligenceFromText(response.post, brandContext);

  return {
    ...response,
    quality: intelligence?.quality,
    pov: intelligence?.pov,
  };
}

export async function generateIdeasWithAI(
  input: IdeaGenerationRequest,
): Promise<IdeaGenerationResponse> {
  const [brandContext, platformContext] = await Promise.all([
    getBrandPromptContextForBusiness(input.businessId),
    getLinkedInGenerationContextForBusiness(input.businessId),
  ]);
  const enrichedPlatformContext = mergeGenerationContext(
    platformContext,
    buildWorkspaceAlignmentContext(brandContext),
  );

  return generateContent({
    input,
    channel: "linkedin",
    brandContext,
    platformContext: enrichedPlatformContext,
    format: "ideas",
  });
}

export async function generateHooksWithAI(
  input: HookGenerationRequest,
): Promise<HookGenerationResponse> {
  const [brandContext, platformContext] = await Promise.all([
    getBrandPromptContextForBusiness(input.businessId),
    getLinkedInGenerationContextForBusiness(input.businessId),
  ]);
  const enrichedPlatformContext = mergeGenerationContext(
    platformContext,
    buildWorkspaceAlignmentContext(brandContext),
  );

  return generateContent({
    input,
    channel: "linkedin",
    brandContext,
    platformContext: enrichedPlatformContext,
    format: "hooks",
  });
}

export async function generatePostsWithAI(
  input: LinkedInPostGenerationRequest,
): Promise<LinkedInPostGenerationResponse> {
  const [brandContext, platformContext] = await Promise.all([
    getBrandPromptContextForBusiness(input.businessId),
    getLinkedInGenerationContextForBusiness(input.businessId),
  ]);
  const enrichedPlatformContext = mergeGenerationContext(
    platformContext,
    buildWorkspaceAlignmentContext(brandContext),
  );

  const response = await generateContent({
    input,
    channel: "linkedin",
    tone: input.tone,
    brandContext,
    platformContext: enrichedPlatformContext,
    format: "post",
  });

  const initialVariations = response.variations.map((variation) => enrichVariation(variation, brandContext));
  const avgScore =
    initialVariations.reduce((sum, variation) => sum + computeAlignmentScore(variation.content, brandContext), 0) /
    Math.max(1, initialVariations.length);

  if (!shouldRetryForAlignment(avgScore)) {
    return { variations: initialVariations };
  }

  try {
    const retryResponse = await generateContent({
      input,
      channel: "linkedin",
      tone: input.tone,
      brandContext,
      platformContext: buildStrictAlignmentContext(enrichedPlatformContext),
      format: "post",
    });

    const retriedVariations = retryResponse.variations.map((variation) => enrichVariation(variation, brandContext));
    const retriedScore =
      retriedVariations.reduce((sum, variation) => sum + computeAlignmentScore(variation.content, brandContext), 0) /
      Math.max(1, retriedVariations.length);

    return retriedScore >= avgScore ? { variations: retriedVariations } : { variations: initialVariations };
  } catch (error) {
    logWarn("Post generation alignment retry failed; using initial response.", {
      businessId: input.businessId,
      message: error instanceof Error ? error.message : "Unknown retry error.",
    });
    return { variations: initialVariations };
  }
}

export async function generateCapturedContentWithAI(
  input: StructuredContentGenerationRequest,
): Promise<CaptureContentResponse> {
  const [brandContext, savedSourceContext, platformContext] = await Promise.all([
    getBrandPromptContextForBusiness(input.businessId),
    buildSavedSourceMemoryContext(input.businessId),
    getLinkedInGenerationContextForBusiness(input.businessId),
  ]);
  const enrichedPlatformContext = mergeGenerationContext(
    platformContext,
    buildWorkspaceAlignmentContext(brandContext),
  );

  const response = await generateContent({
    input: {
      ...input,
      rawInputText: appendSavedSourceContext(input.rawInputText, savedSourceContext),
    },
    channel: "linkedin",
    tone: input.tone,
    brandContext,
    platformContext: enrichedPlatformContext,
    intent: "POST_GENERATION",
    format: "content",
  });

  const enriched = enrichStructuredResponse(response, brandContext);
  const initialScore = computeAlignmentScore(enriched.post, brandContext);

  if (!shouldRetryForAlignment(initialScore)) {
    return enriched;
  }

  try {
    const retryResponse = await generateContent({
      input: {
        ...input,
        rawInputText: appendSavedSourceContext(input.rawInputText, savedSourceContext),
      },
      channel: "linkedin",
      tone: input.tone,
      brandContext,
      platformContext: buildStrictAlignmentContext(enrichedPlatformContext),
      intent: "POST_GENERATION",
      format: "content",
    });

    const retried = enrichStructuredResponse(retryResponse, brandContext);
    const retriedScore = computeAlignmentScore(retried.post, brandContext);
    return retriedScore >= initialScore ? retried : enriched;
  } catch (error) {
    logWarn("Capture content alignment retry failed; using initial response.", {
      businessId: input.businessId,
      message: error instanceof Error ? error.message : "Unknown retry error.",
    });
    return enriched;
  }
}

export async function generateRemixedContentWithAI(
  input: StructuredContentGenerationRequest,
): Promise<RemixContentResponse> {
  const [brandContext, savedSourceContext, platformContext] = await Promise.all([
    getBrandPromptContextForBusiness(input.businessId),
    buildSavedSourceMemoryContext(input.businessId),
    getLinkedInGenerationContextForBusiness(input.businessId),
  ]);
  const enrichedPlatformContext = mergeGenerationContext(
    platformContext,
    buildWorkspaceAlignmentContext(brandContext),
  );

  const response = await generateContent({
    input: {
      ...input,
      rawInputText: appendSavedSourceContext(input.rawInputText, savedSourceContext),
    },
    channel: "linkedin",
    tone: input.tone,
    brandContext,
    platformContext: enrichedPlatformContext,
    intent: "REMIX",
    format: "content",
  });

  const enriched = enrichStructuredResponse(response, brandContext);
  const initialScore = computeAlignmentScore(enriched.post, brandContext);

  if (!shouldRetryForAlignment(initialScore)) {
    return enriched;
  }

  try {
    const retryResponse = await generateContent({
      input: {
        ...input,
        rawInputText: appendSavedSourceContext(input.rawInputText, savedSourceContext),
      },
      channel: "linkedin",
      tone: input.tone,
      brandContext,
      platformContext: buildStrictAlignmentContext(enrichedPlatformContext),
      intent: "REMIX",
      format: "content",
    });

    const retried = enrichStructuredResponse(retryResponse, brandContext);
    const retriedScore = computeAlignmentScore(retried.post, brandContext);
    return retriedScore >= initialScore ? retried : enriched;
  } catch (error) {
    logWarn("Remix content alignment retry failed; using initial response.", {
      businessId: input.businessId,
      message: error instanceof Error ? error.message : "Unknown retry error.",
    });
    return enriched;
  }
}
