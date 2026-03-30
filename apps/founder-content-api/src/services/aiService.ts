import type {
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

function appendSavedSourceContext(inputText: string, sourceContext: string | undefined): string {
  const normalizedInput = inputText.trim();

  if (!sourceContext) {
    return normalizedInput;
  }

  return `${normalizedInput}\n\n${sourceContext}`;
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

  return generateContent({
    input,
    channel: "linkedin",
    brandContext,
    platformContext,
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

  return generateContent({
    input,
    channel: "linkedin",
    brandContext,
    platformContext,
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

  const response = await generateContent({
    input,
    channel: "linkedin",
    tone: input.tone,
    brandContext,
    platformContext,
    format: "post",
  });

  return {
    variations: response.variations.map((variation) => enrichVariation(variation, brandContext)),
  };
}

export async function generateCapturedContentWithAI(
  input: StructuredContentGenerationRequest,
): Promise<CaptureContentResponse> {
  const [brandContext, savedSourceContext, platformContext] = await Promise.all([
    getBrandPromptContextForBusiness(input.businessId),
    buildSavedSourceMemoryContext(input.businessId),
    getLinkedInGenerationContextForBusiness(input.businessId),
  ]);

  const response = await generateContent({
    input: {
      ...input,
      rawInputText: appendSavedSourceContext(input.rawInputText, savedSourceContext),
    },
    channel: "linkedin",
    tone: input.tone,
    brandContext,
    platformContext,
    intent: "POST_GENERATION",
    format: "content",
  });

  return enrichStructuredResponse(response, brandContext);
}

export async function generateRemixedContentWithAI(
  input: StructuredContentGenerationRequest,
): Promise<RemixContentResponse> {
  const [brandContext, savedSourceContext, platformContext] = await Promise.all([
    getBrandPromptContextForBusiness(input.businessId),
    buildSavedSourceMemoryContext(input.businessId),
    getLinkedInGenerationContextForBusiness(input.businessId),
  ]);

  const response = await generateContent({
    input: {
      ...input,
      rawInputText: appendSavedSourceContext(input.rawInputText, savedSourceContext),
    },
    channel: "linkedin",
    tone: input.tone,
    brandContext,
    platformContext,
    intent: "REMIX",
    format: "content",
  });

  return enrichStructuredResponse(response, brandContext);
}
