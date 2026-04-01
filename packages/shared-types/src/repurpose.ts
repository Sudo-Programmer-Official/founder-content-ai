import type { ContentAsset, ContentPovProfile, ContentQualityScore } from "./analytics.ts";
import type { ContentNarrative } from "./content-narrative.ts";
import type { IdeaOption, LinkedInPostVariation } from "./founder-content.ts";
import type { CarouselNarrativeType, CarouselSlideContent } from "./visual-generation.ts";

export type RepurposeInputType = "text" | "voice" | "url";
export type RepurposeIntent = "capture" | "reference";
export type RepurposeStrategy = "continue" | "deepen" | "contrarian" | "tactical";
export type RepurposeSuggestionSelectionOrigin = "generate_for_me";

export const DEFAULT_REPURPOSE_STRATEGY: RepurposeStrategy = "continue";

const REPURPOSE_STRATEGY_VALUES = new Set<RepurposeStrategy>([
  "continue",
  "deepen",
  "contrarian",
  "tactical",
]);

export function isRepurposeStrategy(value: unknown): value is RepurposeStrategy {
  return typeof value === "string" && REPURPOSE_STRATEGY_VALUES.has(value as RepurposeStrategy);
}

export function normalizeRepurposeStrategy(
  value: string | null | undefined,
): RepurposeStrategy | undefined {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  return isRepurposeStrategy(normalized) ? normalized : undefined;
}

export interface RepurposeSourceUrlInput {
  url: string;
  label?: string;
}

export interface CarouselDraftSlide extends CarouselSlideContent {
  supportingText: string;
  bulletPoints: string[];
}

export interface CarouselDraft {
  title: string;
  subtitle: string;
  narrativeType: CarouselNarrativeType;
  slides: CarouselDraftSlide[];
}

export interface RepurposeQuickSignals {
  readyLabel: string;
  formatLabel: string;
}

export interface RepurposeSuggestionSelection {
  suggestionId: string;
  sourceAssetId: string;
  origin?: RepurposeSuggestionSelectionOrigin;
}

export interface RepurposeContentRequest {
  inputType: RepurposeInputType;
  intent?: RepurposeIntent;
  strategy?: RepurposeStrategy;
  assetId?: string;
  selectedSuggestion?: RepurposeSuggestionSelection;
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
  strategy: RepurposeStrategy;
  sourceText: string;
  idea: IdeaOption;
  hooks: string[];
  post: string;
  quality?: ContentQualityScore;
  pov?: ContentPovProfile;
  variations: LinkedInPostVariation[];
  visualNarrative: ContentNarrative;
  carouselDraft: CarouselDraft;
  quickSignals: RepurposeQuickSignals;
  captionFooterCredit: string;
  asset?: ContentAsset;
}
