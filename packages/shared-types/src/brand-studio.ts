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
  goal?: string;
  context?: string;
  layout?: string;
  extraInstructions?: string;
  iconLabels?: string[];
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
  goal?: string;
  context?: string;
  layout?: string;
  extraInstructions?: string;
  iconLabels?: string[];
  brandKit?: BrandKitInput;
  referenceGenerationId?: string;
  matchPreviousStyle?: boolean;
}

export interface GenerateBrandAssetResponse extends GenerateBrandStudioAssetResponse {}
