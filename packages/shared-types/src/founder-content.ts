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
  businessId?: string;
}

export interface StructuredContentResponse {
  idea: IdeaOption;
  hooks: string[];
  post: string;
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
  tone: string;
  length: string;
  selectedHook?: string;
  businessId?: string;
}

export interface LinkedInPostVariation {
  angle: "story" | "lesson" | "build-in-public";
  content: string;
}

export interface LinkedInPostGenerationResponse {
  variations: LinkedInPostVariation[];
}

export interface CaptureContentRequest {
  text?: string;
  image?: string;
  source?: "text" | "image" | "voice";
  tone?: string;
  businessId?: string;
}

export interface CaptureContentResponse extends StructuredContentResponse {}

export interface RemixContentRequest {
  referenceText: string;
  tone?: string;
  businessId?: string;
}

export interface RemixContentResponse extends StructuredContentResponse {}
