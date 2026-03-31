import type { VisualTemplateType } from "./visual-generation.ts";

export type BusinessMediaProfileType = "general" | "saas" | "daycare" | "fitness";
export type MediaRecommendationGoal = "authority" | "engagement" | "conversion";
export type MediaRecommendationContentType = "post" | "email";
export type MediaSuggestionActionType = "use_existing_asset" | "generate_visual" | "skip";
export type MediaPerformanceConfidenceBand = "low" | "medium" | "high";
export type MediaSuggestionType =
  | "quote_card"
  | "stat_card"
  | "photo_overlay"
  | "framework_card"
  | "screenshot_highlight";

export interface BusinessMediaProfile {
  businessId: string;
  businessType: BusinessMediaProfileType;
  preferExistingAssets: boolean;
  preferTextVisuals: boolean;
  allowGeneratedIllustrations: boolean;
  avoidRealisticPeople: boolean;
  allowScreenshotHighlights: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MediaPresetSummary {
  id: string;
  slug: string;
  name: string;
  description?: string;
  supportedBusinessTypes: BusinessMediaProfileType[];
  supportedContentTypes: MediaRecommendationContentType[];
  supportedGoals: MediaRecommendationGoal[];
  mediaTypes: MediaSuggestionType[];
  fallbackOrder: MediaSuggestionType[];
  uiLabel?: string;
  priority: number;
  isActive: boolean;
  isEnabledForWorkspace: boolean;
  customPromptTemplateId?: string;
  customSettings: Record<string, unknown>;
}

export interface PromptTemplateSummary {
  id: string;
  slug: string;
  name: string;
  category: string;
  variables: string[];
  notes?: string;
  version: number;
  isActive: boolean;
}

export interface DecisionRuleSummary {
  id: string;
  ruleName: string;
  ruleScope: "global" | "business_type" | "workspace";
  businessType?: BusinessMediaProfileType;
  businessId?: string;
  conditions: Record<string, unknown>;
  outputs: Record<string, unknown>;
  priority: number;
  isActive: boolean;
}

export interface MediaPresetPerformanceSummary {
  mediaPresetId: string;
  mediaPresetName?: string;
  mediaPresetSlug?: string;
  surface: MediaRecommendationContentType | "visual_generation";
  sampleCount: number;
  impressions: number;
  clicks: number;
  engagements: number;
  conversions: number;
  avgScore: number;
  performanceWeight: number;
  confidenceBand: MediaPerformanceConfidenceBand;
  lastRecordedAt?: string;
}

export interface MediaTypePerformanceSummary {
  mediaType: MediaSuggestionType;
  surface: MediaRecommendationContentType | "visual_generation";
  sampleCount: number;
  impressions: number;
  clicks: number;
  engagements: number;
  conversions: number;
  avgScore: number;
  performanceWeight: number;
  confidenceBand: MediaPerformanceConfidenceBand;
  lastRecordedAt?: string;
}

export interface WorkspaceMediaOptimizationSurfaceSummary {
  surface: MediaRecommendationContentType;
  topPreset?: MediaPresetPerformanceSummary;
  topMediaType?: MediaTypePerformanceSummary;
  strongPresets: MediaPresetPerformanceSummary[];
  weakPresets: MediaPresetPerformanceSummary[];
  strongMediaTypes: MediaTypePerformanceSummary[];
  weakMediaTypes: MediaTypePerformanceSummary[];
}

export interface WorkspaceMediaIntelligenceResponse {
  profile: BusinessMediaProfile;
  presets: MediaPresetSummary[];
  promptTemplates: PromptTemplateSummary[];
  decisionRules: DecisionRuleSummary[];
  optimizationSummaries: WorkspaceMediaOptimizationSurfaceSummary[];
}

export interface UpdateBusinessMediaProfileRequest {
  businessId: string;
  businessType: BusinessMediaProfileType;
  preferExistingAssets: boolean;
  preferTextVisuals: boolean;
  allowGeneratedIllustrations: boolean;
  avoidRealisticPeople: boolean;
  allowScreenshotHighlights: boolean;
}

export interface UpdateBusinessMediaProfileResponse {
  profile: BusinessMediaProfile;
}

export interface UpdateWorkspaceMediaOverrideRequest {
  businessId: string;
  mediaPresetId: string;
  isEnabled: boolean;
  customPromptTemplateId?: string;
  customSettings?: Record<string, unknown>;
}

export interface UpdateWorkspaceMediaOverrideResponse {
  preset: MediaPresetSummary;
}

export interface MediaRecommendationsRequest {
  businessId: string;
  contentText: string;
  contentType: MediaRecommendationContentType;
  goal?: MediaRecommendationGoal;
  sourceAssetIds?: string[];
}

export interface MediaRecommendationSuggestion {
  id: string;
  actionType: MediaSuggestionActionType;
  title: string;
  description: string;
  reason: string;
  suggestedMediaType?: MediaSuggestionType;
  visualTemplateType?: VisualTemplateType;
  mediaPresetId?: string;
  mediaPresetSlug?: string;
  promptTemplateId?: string;
  recommendedAssetIds: string[];
}

export interface MediaRecommendationsResponse {
  profile: BusinessMediaProfile;
  suggestions: MediaRecommendationSuggestion[];
  availableAssetCount: number;
}

export interface ResolvedPromptTemplateSelection {
  mediaType: MediaSuggestionType;
  promptTemplateId?: string;
  promptTemplateSlug?: string;
  promptTemplateName?: string;
  source: "default" | "workspace_override";
}

export interface MediaRuleMatchSummary {
  id: string;
  ruleName: string;
  ruleScope: "global" | "business_type" | "workspace";
  priority: number;
  recommendedAction?: string;
  recommendedMediaTypes: MediaSuggestionType[];
  disallowedMediaTypes: MediaSuggestionType[];
}

export interface WorkspaceMediaResolutionRequest {
  businessId: string;
  contentType: MediaRecommendationContentType;
  goal?: MediaRecommendationGoal;
  hasUploadedAssets?: boolean;
}

export interface WorkspaceMediaResolutionResponse {
  profile: BusinessMediaProfile;
  availableAssetCount: number;
  hasUploadedAssets: boolean;
  preferredAction?: string;
  selectedPreset?: MediaPresetSummary;
  matchingPresets: MediaPresetSummary[];
  orderedMediaTypes: MediaSuggestionType[];
  disallowedMediaTypes: MediaSuggestionType[];
  matchedRules: MediaRuleMatchSummary[];
  promptSelections: ResolvedPromptTemplateSelection[];
  selectedPresetPerformance?: MediaPresetPerformanceSummary;
  mediaTypePerformance: MediaTypePerformanceSummary[];
  boostedMediaTypes: MediaSuggestionType[];
  deprioritizedMediaTypes: MediaSuggestionType[];
  optimizationSummary?: WorkspaceMediaOptimizationSurfaceSummary;
}

export interface RecordMediaPerformanceStatRequest {
  businessId: string;
  mediaPresetId?: string;
  mediaType: MediaSuggestionType;
  surface: MediaRecommendationContentType | "visual_generation";
  impressions?: number;
  clicks?: number;
  engagements?: number;
  conversions?: number;
}

export interface RecordMediaPerformanceStatResponse {
  score: number;
}
