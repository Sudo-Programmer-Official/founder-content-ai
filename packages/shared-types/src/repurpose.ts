import type { ContentAsset } from "./analytics.ts";
import type { IdeaOption, LinkedInPostVariation } from "./founder-content.ts";

export type RepurposeInputType = "text" | "voice" | "url";
export type RepurposeIntent = "capture" | "reference";

export interface RepurposeSourceUrlInput {
  url: string;
  label?: string;
}

export interface CarouselDraftSlide {
  headline: string;
  supportingText: string;
  bulletPoints: string[];
}

export interface CarouselDraft {
  title: string;
  subtitle: string;
  slides: CarouselDraftSlide[];
}

export interface RepurposeQuickSignals {
  readyLabel: string;
  formatLabel: string;
}

export interface RepurposeContentRequest {
  inputType: RepurposeInputType;
  intent?: RepurposeIntent;
  text?: string;
  voiceTranscript?: string;
  url?: string;
  sourceUrls?: RepurposeSourceUrlInput[];
  tone?: string;
  businessId?: string;
}

export interface RepurposeContentResponse {
  inputType: RepurposeInputType;
  intent: RepurposeIntent;
  sourceText: string;
  idea: IdeaOption;
  hooks: string[];
  post: string;
  variations: LinkedInPostVariation[];
  carouselDraft: CarouselDraft;
  quickSignals: RepurposeQuickSignals;
  captionFooterCredit: string;
  asset?: ContentAsset;
}
