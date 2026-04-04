import type { ContentAsset, ContentPovProfile, ContentQualityScore } from "./analytics.ts";
import type {
  BusinessContentOutput,
  BusinessGenerationOutput,
  WorkspaceMode,
} from "./business-generation.ts";
import type { ContentNarrative } from "./content-narrative.ts";
import type { IdeaOption, LinkedInPostVariation } from "./founder-content.ts";
import type { CreatorGenerationIntent, GenerationIntent } from "./generation-intent.ts";
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

export type CreatorGenerationOutputKind = "creator_post" | "weekly_plan";

export interface CreatorWeeklyPlanDay {
  dayNumber: number;
  theme: "opinion" | "story" | "tactical" | "proof" | "offer" | "recap";
  headline: string;
  summary: string;
}

export interface CreatorPostGenerationOutput {
  kind: "creator_post";
  intent: Exclude<CreatorGenerationIntent, "weekly_plan">;
  primaryChannel: "linkedin";
  post: string;
  hooks: string[];
  variations: LinkedInPostVariation[];
  visualNarrative: ContentNarrative;
  carouselDraft: CarouselDraft;
  quickSignals: RepurposeQuickSignals;
}

export interface CreatorWeeklyPlanGenerationOutput {
  kind: "weekly_plan";
  intent: "weekly_plan";
  primaryChannel: "linkedin";
  days: CreatorWeeklyPlanDay[];
}

export type CreatorGenerationOutput =
  | CreatorPostGenerationOutput
  | CreatorWeeklyPlanGenerationOutput;

export type GenerationOutput = CreatorGenerationOutput | BusinessGenerationOutput;

export interface RepurposeContentRequest {
  inputType: RepurposeInputType;
  intent?: RepurposeIntent;
  strategy?: RepurposeStrategy;
  generationIntent?: CreatorGenerationIntent;
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
  generationIntent?: GenerationIntent;
  generationOutput: GenerationOutput;
  workspaceMode?: WorkspaceMode;
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
  businessOutput?: BusinessContentOutput;
  asset?: ContentAsset;
}
