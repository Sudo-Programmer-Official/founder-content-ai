import type { BusinessPlanCode } from "./admin-control.ts";
import type { ProductAccessLimits } from "./product-access.ts";

export interface BillingOverviewQuery {
  businessId: string;
}

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

export interface BillingSubscriptionSummary {
  provider: "stripe";
  status: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
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
  subscription?: BillingSubscriptionSummary;
  plans: BillingPlanOption[];
}

export interface CreateBillingCheckoutSessionRequest {
  businessId: string;
  priceId: string;
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
