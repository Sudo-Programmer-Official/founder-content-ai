import type { Business, BusinessMembership } from "./auth-business.ts";
import type { CompetitorSourceType } from "./competitive-intelligence.ts";

export type OnboardingUseCase = "personal_brand" | "business_marketing" | "agency_clients";
export type OnboardingChannel = "linkedin" | "instagram" | "facebook" | "email";
export type OnboardingGoal =
  | "get_clients"
  | "build_audience"
  | "stay_consistent"
  | "promote_product_service";
export type BrandTone = "professional" | "friendly" | "bold";
export type OnboardingStatus = "not_started" | "in_progress" | "completed";
export type OnboardingStep = "intent" | "workspace" | "generate" | "activate" | "completed";

export interface BrandCompetitorReference {
  id: string;
  label: string;
  url?: string;
  sourceType: Extract<CompetitorSourceType, "public_url" | "website_page">;
  rationale?: string;
  origin: "suggested" | "custom";
}

export interface OnboardingProfile {
  id: string;
  userId: string;
  businessId?: string;
  status: OnboardingStatus;
  currentStep: OnboardingStep;
  useCase?: OnboardingUseCase;
  targetChannels: OnboardingChannel[];
  goals: OnboardingGoal[];
  preferredTone?: BrandTone;
  firstContentGeneratedAt?: string;
  firstContentCopiedAt?: string;
  firstChannelConnectedAt?: string;
  firstContentScheduledAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrandProfile {
  id: string;
  businessId: string;
  industry?: string;
  preferredTone?: BrandTone;
  targetChannels: OnboardingChannel[];
  goals: OnboardingGoal[];
  linkedinUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  tone?: string;
  writingStyle?: string;
  visualStyle?: string;
  topics: string[];
  patterns: string[];
  selectedCompetitors: BrandCompetitorReference[];
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingRecommendation {
  title: string;
  description: string;
  nextStep: OnboardingStep | "dashboard";
}

export interface OnboardingStatusResponse {
  onboarding: OnboardingProfile;
  membership?: BusinessMembership;
  business?: Business;
  brandProfile?: BrandProfile;
  shouldShowOnboarding: boolean;
  suggestedRoute: string;
  recommendation: OnboardingRecommendation;
}

export interface StartOnboardingRequest {
  entryPoint?: string;
}

export interface StartOnboardingResponse {
  onboarding: OnboardingProfile;
}

export interface SaveOnboardingPreferencesRequest {
  useCase: OnboardingUseCase;
  targetChannels: OnboardingChannel[];
  goals: OnboardingGoal[];
  preferredTone?: BrandTone;
}

export interface SaveOnboardingPreferencesResponse {
  onboarding: OnboardingProfile;
}

export interface CreateOnboardingWorkspaceRequest {
  name: string;
  websiteUrl?: string;
  timezone?: string;
  industry?: string;
  tone?: BrandTone;
}

export interface CreateOnboardingWorkspaceResponse {
  onboarding: OnboardingProfile;
  brandProfile: BrandProfile;
  business: Business;
  membership: BusinessMembership;
}

export interface CompleteOnboardingRequest {
  businessId?: string;
  firstContentGenerated?: boolean;
  firstContentCopied?: boolean;
  connectedChannel?: OnboardingChannel;
  scheduledFor?: string;
}

export interface CompleteOnboardingResponse {
  onboarding: OnboardingProfile;
}
