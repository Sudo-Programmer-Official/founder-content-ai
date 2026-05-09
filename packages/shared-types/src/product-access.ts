import type { AdminWorkspaceAccessState } from "./admin-control.ts";

export type ProductFeatureKey =
  | "content_generation"
  | "capture_remix"
  | "visual_generation"
  | "scheduler"
  | "control_dashboard"
  | "brand_intelligence"
  | "outreach"
  | "email_campaigns"
  | "blog_publishing"
  | "system_read_only";

export type ProductFeatureMap = Record<ProductFeatureKey, boolean>;

export interface ProductAccessLimits {
  generationDailyLimit: number;
  generationDailyUsed: number;
  generationDailyRemaining: number;
  generationMonthlyLimit: number | null;
  generationMonthlyUsed: number;
  generationMonthlyRemaining: number | null;
  postsLimit: number;
  postsUsed: number;
  postsRemaining: number;
  scheduledQueueLimit: number | null;
  scheduledQueueUsed: number;
  scheduledQueueRemaining: number | null;
  emailsLimit: number;
  emailsUsed: number;
  emailsRemaining: number;
  outreachLimit: number;
  outreachUsed: number;
  outreachRemaining: number;
}

export interface ProductAccessState extends AdminWorkspaceAccessState {
  readOnly: boolean;
}

export interface MyFeaturesQuery {
  businessId?: string;
}

export interface MyFeaturesResponse {
  businessId: string | null;
  activeBusinessId: string | null;
  isPlatformAdmin: boolean;
  features: ProductFeatureMap;
  limits?: ProductAccessLimits;
  access?: ProductAccessState;
}
