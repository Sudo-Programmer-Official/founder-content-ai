export type ContentNarrativeFormat = "carousel";
export type ContentNarrativeType = "story" | "framework" | "contrarian";
export type ContentNarrativeSlideRole =
  | "hook"
  | "pattern_break"
  | "insight"
  | "lesson"
  | "cta"
  | "belief"
  | "challenge"
  | "reframe"
  | "proof"
  | "step_1"
  | "step_2"
  | "step_3";

export interface ContentNarrativeSlide {
  role: ContentNarrativeSlideRole | string;
  headline: string;
  supportingText?: string;
  bulletPoints?: string[];
  highlightText?: string;
  eyebrowText?: string;
  footerText?: string;
  closingText?: string;
  assetId?: string;
  imageDataUrl?: string;
  mimeType?: string;
}

export interface ContentNarrative {
  format: ContentNarrativeFormat;
  type: ContentNarrativeType;
  title: string;
  subtitle: string;
  sourceText?: string;
  slides: ContentNarrativeSlide[];
}
