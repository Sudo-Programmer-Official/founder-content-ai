export type GenerationMode = "creator" | "business";

export type CreatorGenerationIntent =
  | "post_idea"
  | "grow_audience"
  | "weekly_plan"
  | "promote_offer";

export type BusinessGenerationIntent =
  | "get_leads"
  | "get_bookings"
  | "weekly_plan"
  | "promote_offer";

export type GenerationIntent = CreatorGenerationIntent | BusinessGenerationIntent;
