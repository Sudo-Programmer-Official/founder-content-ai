import type { BusinessGenerationIntent } from "./generation-intent.ts";

export type WorkspaceMode = "founder" | "business";

export type BusinessGenerationGoal = "leads" | "bookings" | "traffic" | "awareness";
export type BusinessGenerationType = "daycare" | "salon" | "fitness" | "general";
export type BusinessGenerationTone = "friendly" | "premium" | "urgent";
export type BusinessGenerationChannel = "instagram" | "facebook" | "email";

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

export interface BusinessGenerationResponse {
  output: BusinessContentOutput;
}
