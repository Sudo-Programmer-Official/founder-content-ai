export interface IdeaGenerationRequest {
  industry: string;
  stage: string;
}

export interface IdeaOption {
  title: string;
  angle: string;
}

export interface IdeaGenerationResponse {
  ideas: IdeaOption[];
}

export interface HookGenerationRequest {
  topic: string;
}

export interface HookGenerationResponse {
  hooks: string[];
}

export interface LinkedInPostGenerationRequest {
  topic: string;
  tone: string;
  length: string;
  selectedHook?: string;
}

export interface LinkedInPostVariation {
  angle: "story" | "lesson" | "build-in-public";
  content: string;
}

export interface LinkedInPostGenerationResponse {
  variations: LinkedInPostVariation[];
}
