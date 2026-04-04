import type { BusinessGenerationIntent } from "./generation-intent.ts";

export type WorkspaceMode = "founder" | "business";

export type BusinessGenerationGoal = "leads" | "bookings" | "traffic" | "awareness";
export type BusinessGenerationType = "daycare" | "salon" | "fitness" | "general";
export type BusinessGenerationTone = "friendly" | "premium" | "urgent";
export type BusinessGenerationChannel = "instagram" | "facebook" | "email";
export type BusinessCampaignGenerationIntent = Exclude<BusinessGenerationIntent, "weekly_plan">;

export interface BusinessGenerationRequest {
  businessId?: string;
  goal: BusinessGenerationGoal;
  generationIntent?: BusinessGenerationIntent;
  businessType: BusinessGenerationType;
  location?: string;
  offer?: string;
  sourceIdea?: string;
  tone?: BusinessGenerationTone;
  channels: BusinessGenerationChannel[];
}

export interface BusinessContentOutput {
  visual: {
    headline: string;
    subheadline?: string;
    imagePrompt: string;
  };
  captions: {
    instagram?: string;
    facebook?: string;
  };
  cta: {
    label: string;
    url: string;
  };
  email?: {
    subject: string;
    body: string;
  };
}

export interface BusinessWeeklyPlanDay {
  dayNumber: number;
  theme: "offer" | "problem" | "proof" | "local" | "reminder" | "educational";
  headline: string;
  summary: string;
  cta?: string;
}

export interface BusinessCampaignGenerationOutput {
  kind: "business_campaign";
  intent: BusinessCampaignGenerationIntent;
  goal: BusinessGenerationGoal;
  channels: BusinessGenerationChannel[];
  content: BusinessContentOutput;
}

export interface BusinessWeeklyPlanGenerationOutput {
  kind: "weekly_plan";
  intent: "weekly_plan";
  goal: BusinessGenerationGoal;
  channels: BusinessGenerationChannel[];
  days: BusinessWeeklyPlanDay[];
}

export type BusinessGenerationOutput =
  | BusinessCampaignGenerationOutput
  | BusinessWeeklyPlanGenerationOutput;

export type BusinessGenerationResponse = BusinessGenerationOutput;
export type BusinessGenerationOutputKind = BusinessGenerationResponse["kind"];

export function resolveBusinessGenerationGoal(
  intent: BusinessGenerationIntent | undefined,
  fallbackGoal: BusinessGenerationGoal = "awareness",
): BusinessGenerationGoal {
  if (intent === "get_leads") {
    return "leads";
  }

  if (intent === "get_bookings") {
    return "bookings";
  }

  if (intent === "weekly_plan") {
    return "traffic";
  }

  if (intent === "promote_offer" && (fallbackGoal === "traffic" || fallbackGoal === "awareness")) {
    return fallbackGoal;
  }

  return fallbackGoal;
}

export function resolveBusinessGenerationOutputKind(
  intent: BusinessGenerationIntent | undefined,
): BusinessGenerationOutputKind {
  return intent === "weekly_plan" ? "weekly_plan" : "business_campaign";
}

export function isBusinessGoalCompatibleWithIntent(
  intent: BusinessGenerationIntent | undefined,
  goal: BusinessGenerationGoal,
): boolean {
  if (!intent) {
    return true;
  }

  if (intent === "promote_offer") {
    return goal === "traffic" || goal === "awareness";
  }

  return resolveBusinessGenerationGoal(intent, goal) === goal;
}
