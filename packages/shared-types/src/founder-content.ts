import type { ContentPovProfile, ContentQualityScore } from "./analytics.ts";
import type { RepurposeStrategy } from "./repurpose.ts";

export interface IdeaGenerationRequest {
  industry: string;
  stage: string;
  businessId?: string;
}

export interface IdeaOption {
  title: string;
  angle: string;
}

export interface IdeaGenerationResponse {
  ideas: IdeaOption[];
}

export interface StructuredContentGenerationRequest {
  rawInputText: string;
  tone?: string;
  strategy?: RepurposeStrategy;
  businessId?: string;
}

export interface StructuredContentResponse {
  idea: IdeaOption;
  hooks: string[];
  post: string;
  quality?: ContentQualityScore;
  pov?: ContentPovProfile;
}

export interface HookGenerationRequest {
  topic: string;
  businessId?: string;
}

export interface HookGenerationResponse {
  hooks: string[];
}

export interface LinkedInPostGenerationRequest {
  topic: string;
  tone?: string;
  strategy?: RepurposeStrategy;
  length: string;
  selectedHook?: string;
  businessId?: string;
}

export interface LinkedInPostVariation {
  angle: "story" | "lesson" | "build-in-public";
  content: string;
  quality?: ContentQualityScore;
  pov?: ContentPovProfile;
}

export interface LinkedInPostGenerationResponse {
  variations: LinkedInPostVariation[];
}

export interface CaptureContentRequest {
  text?: string;
  image?: string;
  source?: "text" | "image" | "voice";
  tone?: string;
  strategy?: RepurposeStrategy;
  businessId?: string;
}

export interface CaptureContentResponse extends StructuredContentResponse {}

export interface RemixContentRequest {
  referenceText: string;
  tone?: string;
  strategy?: RepurposeStrategy;
  businessId?: string;
}

export interface RemixContentResponse extends StructuredContentResponse {}
