import type {
  CaptureContentResponse,
  HookGenerationRequest,
  HookGenerationResponse,
  IdeaGenerationRequest,
  LinkedInPostGenerationRequest,
  LinkedInPostGenerationResponse,
  IdeaGenerationResponse,
  RemixContentResponse,
  StructuredContentGenerationRequest,
} from "../../../../packages/shared-types/index.ts";
import {
  generateContent,
} from "../../../../packages/content-engine/src/index.ts";
import { getBrandPromptContextForBusiness } from "./brandIntelligence/brandProfileService.ts";

export async function generateIdeasWithAI(
  input: IdeaGenerationRequest,
): Promise<IdeaGenerationResponse> {
  const brandContext = await getBrandPromptContextForBusiness(input.businessId);
  return generateContent({
    input,
    channel: "linkedin",
    brandContext,
    format: "ideas",
  });
}

export async function generateHooksWithAI(
  input: HookGenerationRequest,
): Promise<HookGenerationResponse> {
  const brandContext = await getBrandPromptContextForBusiness(input.businessId);
  return generateContent({
    input,
    channel: "linkedin",
    brandContext,
    format: "hooks",
  });
}

export async function generatePostsWithAI(
  input: LinkedInPostGenerationRequest,
): Promise<LinkedInPostGenerationResponse> {
  const brandContext = await getBrandPromptContextForBusiness(input.businessId);
  return generateContent({
    input,
    channel: "linkedin",
    tone: input.tone,
    brandContext,
    format: "post",
  });
}

export async function generateCapturedContentWithAI(
  input: StructuredContentGenerationRequest,
): Promise<CaptureContentResponse> {
  const brandContext = await getBrandPromptContextForBusiness(input.businessId);
  return generateContent({
    input,
    channel: "linkedin",
    tone: input.tone,
    brandContext,
    intent: "POST_GENERATION",
    format: "content",
  });
}

export async function generateRemixedContentWithAI(
  input: StructuredContentGenerationRequest,
): Promise<RemixContentResponse> {
  const brandContext = await getBrandPromptContextForBusiness(input.businessId);
  return generateContent({
    input,
    channel: "linkedin",
    tone: input.tone,
    brandContext,
    intent: "REMIX",
    format: "content",
  });
}
