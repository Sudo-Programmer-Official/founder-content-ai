export type BrandKitBackgroundStyle = "dark" | "light" | "gradient";
export type BrandKitFontStyle = "modern" | "bold" | "elegant";
export type BrandKitTone = "professional" | "bold" | "friendly";
export type BrandKitVisualStyle = "minimal" | "luxury" | "playful";
export type VisualTemplateType = "quote" | "insight" | "contrarian" | "carousel";
export type VisualGenerationProvider = "openai" | "svg_fallback";
export type VisualWatermarkMode = "auto" | "on" | "off";

export interface BrandKitInput {
  primaryColor?: string;
  secondaryColor?: string;
  backgroundStyle?: BrandKitBackgroundStyle;
  fontStyle?: BrandKitFontStyle;
  visualStyle?: BrandKitVisualStyle;
  tone?: BrandKitTone;
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
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VisualPromptContent {
  headline: string;
  supportingText?: string;
  bulletPoints?: string[];
}

export interface GenerateVisualRequest {
  businessId?: string;
  templateType: VisualTemplateType;
  content: VisualPromptContent;
  brandKit?: BrandKitInput;
  watermarkMode?: VisualWatermarkMode;
  captionFooterCredit?: string;
  mediaPresetId?: string;
  promptTemplateId?: string;
  generatedMediaType?: import("./media-intelligence.ts").MediaSuggestionType;
  contentAssetId?: string;
  sourceAssetIds?: string[];
}

export interface GenerateVisualResponse {
  templateType: VisualTemplateType;
  prompt: string;
  provider: VisualGenerationProvider;
  imageDataUrl: string;
  mimeType: string;
  brandKit: BrandKit;
  watermarkApplied: boolean;
  watermarkText?: string;
  captionFooterCredit?: string;
}
