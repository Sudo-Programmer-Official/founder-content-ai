import type { BrandCompetitorReference, BrandProfile } from "./onboarding.ts";

export interface BrandPromptContext {
  tone?: string;
  writingStyle?: string;
  visualStyle?: string;
  goals?: string[];
  topics?: string[];
  patterns?: string[];
  marketReferences?: string[];
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
  suggestedCompetitors: BrandCompetitorReference[];
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
  selectedCompetitors?: BrandCompetitorReference[];
  refreshFromSignals?: boolean;
}

export interface UpdateBrandProfileResponse extends BrandProfileResponse {}
