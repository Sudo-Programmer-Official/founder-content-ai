import type { BrandCompetitorReference, BrandProfile } from "./onboarding.ts";

export interface BrandPromptContext {
  tone?: string;
  writingStyle?: string;
  visualStyle?: string;
  goals?: string[];
  topics?: string[];
  patterns?: string[];
  marketReferences?: string[];
  voiceSummary?: string;
  audience?: string;
  positioning?: string;
  beliefs?: string[];
}

export interface BrandSignalSummary {
  competitorAnalyses: number;
  trendSignals: number;
  contentAssets: number;
}

export type WorkspaceKnowledgeSourceType = "website" | "note";
export type WorkspaceKnowledgeProcessingStatus = "queued" | "processing" | "completed" | "failed";

export interface WorkspaceKnowledgeSource {
  id: string;
  businessId: string;
  createdBy?: string;
  sourceType: WorkspaceKnowledgeSourceType;
  title?: string;
  sourceUrl?: string;
  rawText: string;
  extractedText: string;
  metadata?: Record<string, unknown>;
  processingStatus: WorkspaceKnowledgeProcessingStatus;
  processingError?: string;
  processingJobId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceKnowledgeProfile {
  businessId: string;
  voiceSummary?: string;
  audienceSummary?: string;
  positioningSummary?: string;
  beliefs: string[];
  topicClusters: string[];
  sourceCount: number;
  processingStatus: WorkspaceKnowledgeProcessingStatus;
  processingError?: string;
  lastProcessedAt?: string;
  createdAt: string;
  updatedAt: string;
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

export interface WorkspaceKnowledgeQuery {
  businessId: string;
}

export interface WorkspaceKnowledgeResponse {
  profile?: WorkspaceKnowledgeProfile;
  sources: WorkspaceKnowledgeSource[];
}

export interface CreateWorkspaceKnowledgeSourceRequest {
  businessId: string;
  sourceType: WorkspaceKnowledgeSourceType;
  title?: string;
  sourceUrl?: string;
  rawText?: string;
}

export interface CreateWorkspaceKnowledgeSourceResponse extends WorkspaceKnowledgeResponse {
  source: WorkspaceKnowledgeSource;
}

export interface RefreshWorkspaceKnowledgeRequest {
  businessId: string;
}

export interface RefreshWorkspaceKnowledgeResponse extends WorkspaceKnowledgeResponse {}
