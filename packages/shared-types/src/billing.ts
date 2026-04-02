import type { BusinessPlanCode } from "./admin-control.ts";
import type { ProductAccessLimits } from "./product-access.ts";

export interface BillingOverviewQuery {
  businessId: string;
}

export type BillingEmailAddonTierCode =
  | "none"
  | "starter_email"
  | "growth_email"
  | "scale_email"
  | "custom";

export type BillingEmailAddonSource = "bundled" | "addon" | "manual" | "custom";

export type BillingUsageState = "inactive" | "healthy" | "warning" | "over_limit";

export interface BillingPlanOption {
  planCode: BusinessPlanCode;
  label: string;
  description: string;
  priceMonthlyCents: number;
  priceDisplay: string;
  priceId?: string;
  ctaLabel: string;
  highlights: string[];
  current: boolean;
}

export interface BillingEmailPlanOption {
  tierCode: BillingEmailAddonTierCode;
  label: string;
  description: string;
  priceMonthlyCents: number;
  priceDisplay: string;
  priceId?: string;
  ctaLabel: string;
  highlights: string[];
  current: boolean;
}

export interface BillingSubscriptionSummary {
  provider: "stripe";
  status: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  portalAvailable: boolean;
}

export interface BillingEmailAddonSummary {
  tierCode: BillingEmailAddonTierCode;
  source: BillingEmailAddonSource;
  label: string;
  description: string;
  subscriberLimit: number | null;
  currentSubscriberCount: number;
  subscriberRemaining: number | null;
  monthlyEmailLimit: number | null;
  currentPeriodEmailUsage: number;
  monthlyEmailRemaining: number | null;
  fullListCampaignCapacity: number | null;
  usageState: BillingUsageState;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  subscriptionStatus?: string;
  cancelAtPeriodEnd: boolean;
  portalAvailable: boolean;
}

export interface BillingOverviewResponse {
  businessId: string;
  workspaceName: string;
  workspaceSlug: string;
  currentPlanCode: BusinessPlanCode;
  currentPlanLabel: string;
  usage: ProductAccessLimits | null;
  emailAddon?: BillingEmailAddonSummary;
  subscription?: BillingSubscriptionSummary;
  plans: BillingPlanOption[];
  emailPlans: BillingEmailPlanOption[];
}

export interface CreateBillingCheckoutSessionRequest {
  businessId: string;
  priceId: string;
  promotionCode?: string;
  returnPath?: string;
}

export interface CreateBillingCheckoutSessionResponse {
  url: string;
}

export interface CreateBillingPortalSessionRequest {
  businessId: string;
  returnPath?: string;
}

export interface CreateBillingPortalSessionResponse {
  url: string;
}
