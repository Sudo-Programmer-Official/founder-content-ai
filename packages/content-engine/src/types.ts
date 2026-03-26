import type {
  BrandPromptContext,
  StructuredContentGenerationRequest,
  StructuredContentResponse,
  HookGenerationRequest,
  HookGenerationResponse,
  IdeaGenerationRequest,
  IdeaGenerationResponse,
  LinkedInPostGenerationRequest,
  LinkedInPostGenerationResponse,
} from "../../shared-types/index.ts";

export type ContentChannel = "linkedin";
export type ContentFormat = "ideas" | "hooks" | "post" | "content";
export type ContentIntent = "POST_GENERATION" | "REMIX";
export type ContentVariables = Record<string, string | undefined>;

export interface ContentRequestMap {
  ideas: IdeaGenerationRequest;
  hooks: HookGenerationRequest;
  post: LinkedInPostGenerationRequest;
  content: StructuredContentGenerationRequest;
}

export interface ContentResultMap {
  ideas: IdeaGenerationResponse;
  hooks: HookGenerationResponse;
  post: LinkedInPostGenerationResponse;
  content: StructuredContentResponse;
}

export type ContentInput = string | ContentRequestMap[ContentFormat] | Record<string, unknown>;

export interface GenerateContentRequest<TFormat extends ContentFormat = ContentFormat> {
  input: ContentInput;
  channel: ContentChannel;
  tone?: string;
  brandContext?: BrandPromptContext;
  platformContext?: string;
  intent?: ContentIntent;
  format: TFormat;
}
