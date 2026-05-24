import type { BrandKit, BrandKitInput } from "./visual-generation.ts";

export type BrandStudioIndustryTemplate =
  | "daycare"
  | "salon"
  | "fitness"
  | "restaurant"
  | "custom";

export type BrandAssetType =
  | "hero_banner"
  | "feature_section"
  | "cta_banner"
  | "icon_set"
  | "social_post"
  | "email_header";

export type BrandStudioAssetKind =
  | "homepage_hero"
  | "feature_section"
  | "cta_banner"
  | "icon_set"
  | "social_media"
  | "email_header";

export type BrandStudioConsistencyMode = "standard" | "match_previous_style";
export type BrandStudioGenerationMode = "standard" | "creative_composition";
export type CreativeCompositionTemplate =
  | "cinematic_saas"
  | "dashboard_campaign"
  | "layered_promo_scene"
  | "social_ad_composition"
  | "premium_hero_artwork";
export type CreativeCompositionPreset =
  | "balanced_story"
  | "product_focus"
  | "analytics_focus"
  | "cta_focus"
  | "device_showcase";

export interface CreativeCompositionInput {
  template?: CreativeCompositionTemplate;
  campaignGoal?: string;
  scenePreset?: CreativeCompositionPreset;
  brandAwareOverlays?: boolean;
  uiStyleElements?: boolean;
  analyticsMockCards?: boolean;
  deviceMockups?: boolean;
  ctaEmphasisBlocks?: boolean;
}

export interface BrandStudioHistoryQuery {
  businessId: string;
  limit?: number;
}

export interface BrandStudioAssetReference {
  workspaceAssetId?: string;
  previewUrl: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  title: string;
}

export interface BrandStudioGeneration {
  id: string;
  businessId: string;
  assetKind: BrandStudioAssetKind;
  templateKey: BrandStudioIndustryTemplate;
  consistencyMode: BrandStudioConsistencyMode;
  title: string;
  prompt: string;
  goal?: string;
  context?: string;
  layout?: string;
  extraInstructions?: string;
  iconLabels: string[];
  referenceGenerationId?: string;
  asset: BrandStudioAssetReference;
  brandKit: BrandKit;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BrandStudioHistoryResponse {
  brandKit: BrandKit;
  generations: BrandStudioGeneration[];
}

export interface GenerateBrandStudioAssetRequest {
  businessId: string;
  assetKind: BrandStudioAssetKind;
  generationMode?: BrandStudioGenerationMode;
  goal?: string;
  context?: string;
  layout?: string;
  extraInstructions?: string;
  iconLabels?: string[];
  creativeComposition?: CreativeCompositionInput;
  brandKit?: BrandKitInput;
  referenceGenerationId?: string;
  matchPreviousStyle?: boolean;
}

export interface GenerateBrandStudioAssetResponse {
  generation: BrandStudioGeneration;
}

export interface GenerateBrandAssetRequest {
  businessId: string;
  assetType: BrandAssetType;
  generationMode?: BrandStudioGenerationMode;
  goal?: string;
  context?: string;
  layout?: string;
  extraInstructions?: string;
  iconLabels?: string[];
  creativeComposition?: CreativeCompositionInput;
  brandKit?: BrandKitInput;
  referenceGenerationId?: string;
  matchPreviousStyle?: boolean;
}

export interface GenerateBrandAssetResponse extends GenerateBrandStudioAssetResponse {}
