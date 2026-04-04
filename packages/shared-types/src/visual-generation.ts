import type { ContentNarrative, ContentNarrativeSlide, ContentNarrativeType } from "./content-narrative.ts";

export type BrandKitBackgroundStyle = "dark" | "light" | "gradient";
export type BrandKitFontStyle = "modern" | "bold" | "elegant";
export type BrandKitTone = "professional" | "bold" | "friendly";
export type BrandKitVisualStyle = "minimal" | "luxury" | "playful";
export type BrandKitAccentStyle = "highlight_box" | "underline" | "bold";
export type BrandKitBrandPlacement = "top_left" | "bottom_right" | "side_label";
export type VisualTemplateType = "quote" | "insight" | "contrarian" | "carousel";
export type VisualGenerationProvider = "openai" | "svg_fallback";
export type VisualWatermarkMode = "auto" | "on" | "off";
export type CarouselNarrativeType = ContentNarrativeType;

export interface BrandKitInput {
  primaryColor?: string;
  secondaryColor?: string;
  backgroundStyle?: BrandKitBackgroundStyle;
  fontStyle?: BrandKitFontStyle;
  visualStyle?: BrandKitVisualStyle;
  tone?: BrandKitTone;
  accentStyle?: BrandKitAccentStyle;
  brandPlacement?: BrandKitBrandPlacement;
  logoUrl?: string;
}

export interface BrandKit extends BrandKitInput {
  id: string;
  businessId: string;
  primaryColor: string;
  secondaryColor: string;
  backgroundStyle: BrandKitBackgroundStyle;
  fontStyle: BrandKitFontStyle;
  visualStyle: BrandKitVisualStyle;
  tone: BrandKitTone;
  accentStyle: BrandKitAccentStyle;
  brandPlacement: BrandKitBrandPlacement;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrandKitQuery {
  businessId: string;
}

export interface BrandKitResponse {
  brandKit: BrandKit;
}

export interface UpdateBrandKitRequest {
  businessId: string;
  brandKit: BrandKitInput;
}

export interface UpdateBrandKitResponse extends BrandKitResponse {}

export interface VisualPromptContent {
  headline: string;
  supportingText?: string;
  bulletPoints?: string[];
  sceneDescription?: string;
  highlightText?: string;
  eyebrowText?: string;
  footerText?: string;
  closingText?: string;
}

export interface CarouselSlideContent extends VisualPromptContent {
  narrativeRole?: ContentNarrativeSlide["role"];
}

export interface CarouselGenerationInput {
  narrativeType?: CarouselNarrativeType;
  slideCount?: number;
  sourceText?: string;
  title?: string;
  subtitle?: string;
  slides?: CarouselSlideContent[];
}

export interface GenerateVisualRequest {
  businessId?: string;
  templateType: VisualTemplateType;
  content: VisualPromptContent;
  narrative?: ContentNarrative;
  carousel?: CarouselGenerationInput;
  brandKit?: BrandKitInput;
  watermarkMode?: VisualWatermarkMode;
  captionFooterCredit?: string;
  mediaPresetId?: string;
  promptTemplateId?: string;
  generatedMediaType?: import("./media-intelligence.ts").MediaSuggestionType;
  contentAssetId?: string;
  sourceAssetIds?: string[];
}

export interface GeneratedVisualSlide {
  index: number;
  prompt: string;
  provider: VisualGenerationProvider;
  imageDataUrl: string;
  mimeType: string;
  content: CarouselSlideContent;
}

export type VisualBrandConsistencyTone = "strong" | "review";
export type VisualBrandConsistencyCheckStatus = "pass" | "warn";

export interface VisualBrandConsistencyCheck {
  key: "contrast" | "brand_visibility" | "highlight_balance" | "spacing";
  label: string;
  status: VisualBrandConsistencyCheckStatus;
  score: number;
  message: string;
}

export interface VisualBrandConsistency {
  overallScore: number;
  tone: VisualBrandConsistencyTone;
  summary: string;
  checks: VisualBrandConsistencyCheck[];
}

export interface GenerateVisualResponse {
  templateType: VisualTemplateType;
  prompt: string;
  provider: VisualGenerationProvider;
  imageDataUrl: string;
  mimeType: string;
  brandKit: BrandKit;
  brandConsistency: VisualBrandConsistency;
  watermarkApplied: boolean;
  watermarkText?: string;
  captionFooterCredit?: string;
  narrative?: ContentNarrative;
  carousel?: {
    narrativeType: CarouselNarrativeType;
    slides: GeneratedVisualSlide[];
  };
}
