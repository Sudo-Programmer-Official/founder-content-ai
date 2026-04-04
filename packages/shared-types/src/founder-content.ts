import type { ContentPovProfile, ContentQualityScore } from "./analytics.ts";
import type { CreatorGenerationIntent } from "./generation-intent.ts";
import type { RepurposeStrategy } from "./repurpose.ts";

export type CreatorContentType =
  | "text_post"
  | "image_post"
  | "carousel"
  | "quote_card"
  | "promo_post";

export type CreatorVisualStyle =
  | "realistic_photo"
  | "minimal_text_card"
  | "mixed_carousel"
  | "quote_style";

export type CreatorTextVariantKind =
  | "insight_post"
  | "story_version"
  | "authority_version"
  | "short_caption"
  | "promo_copy";

export type CreatorDistributionChannel =
  | "linkedin"
  | "instagram"
  | "facebook"
  | "email";

export interface CreatorTextVariant {
  id: string;
  kind: CreatorTextVariantKind;
  label: string;
  description: string;
  content: string;
  recommendedChannels: CreatorDistributionChannel[];
  length: "short" | "medium";
  ctaStyle: "soft" | "direct";
}

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
  generationIntent?: CreatorGenerationIntent;
  creatorContentType?: CreatorContentType;
  creatorVisualStyle?: CreatorVisualStyle;
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
  generationIntent?: CreatorGenerationIntent;
  creatorContentType?: CreatorContentType;
  creatorVisualStyle?: CreatorVisualStyle;
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
