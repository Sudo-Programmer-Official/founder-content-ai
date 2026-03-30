import type { BrandProfile } from "./onboarding.ts";

export interface BrandPromptContext {
  tone?: string;
  writingStyle?: string;
  visualStyle?: string;
  topics?: string[];
  patterns?: string[];
}

export interface BrandSignalSummary {
  competitorAnalyses: number;
  trendSignals: number;
  contentAssets: number;
}

export interface BrandProfileQuery {
  businessId: string;
  refreshFromSignals?: string | boolean;
}

export interface BrandProfileResponse {
  brandProfile: BrandProfile;
  visualPromptTemplate: string;
  signalSummary: BrandSignalSummary;
}

export interface UpdateBrandProfileRequest {
  businessId: string;
  linkedinUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  tone?: string;
  writingStyle?: string;
  visualStyle?: string;
  topics?: string[];
  patterns?: string[];
  refreshFromSignals?: boolean;
}

export interface UpdateBrandProfileResponse extends BrandProfileResponse {}
