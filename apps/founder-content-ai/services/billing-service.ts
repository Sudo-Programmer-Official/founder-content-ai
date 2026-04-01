import type {
  BillingOverviewResponse,
  CreateBillingCheckoutSessionRequest,
  CreateBillingCheckoutSessionResponse,
  CreateBillingPortalSessionRequest,
  CreateBillingPortalSessionResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPost } from "./api-client";

function buildOverviewEndpoint(businessId: string): string {
  const searchParams = new URLSearchParams({
    businessId,
  });

  return `/billing/overview?${searchParams.toString()}`;
}

export async function requestBillingOverview(
  businessId: string,
): Promise<BillingOverviewResponse> {
  return apiGet<BillingOverviewResponse>(buildOverviewEndpoint(businessId));
}

export async function requestCreateBillingCheckoutSession(
  payload: CreateBillingCheckoutSessionRequest,
): Promise<CreateBillingCheckoutSessionResponse> {
  return apiPost<CreateBillingCheckoutSessionRequest, CreateBillingCheckoutSessionResponse>(
    "/billing/create-checkout-session",
    payload,
  );
}

export async function requestCreateBillingPortalSession(
  payload: CreateBillingPortalSessionRequest,
): Promise<CreateBillingPortalSessionResponse> {
  return apiPost<CreateBillingPortalSessionRequest, CreateBillingPortalSessionResponse>(
    "/billing/portal",
    payload,
  );
}
