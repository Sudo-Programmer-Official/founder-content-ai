import type {
  ApiError,
  BillingOverviewQuery,
  BillingOverviewResponse,
  CreateBillingCheckoutSessionRequest,
  CreateBillingCheckoutSessionResponse,
  CreateBillingPortalSessionRequest,
  CreateBillingPortalSessionResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  createBillingCheckoutSession,
  createBillingPortalSession,
  getBillingOverview,
  handleStripeWebhook,
} from "../services/billing/billingService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getBillingOverviewController(
  request: Request<unknown, BillingOverviewResponse | ApiError, unknown, Partial<BillingOverviewQuery>>,
  response: Response<BillingOverviewResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    response.json(await getBillingOverview(request.auth, request.query.businessId ?? ""));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "billing_overview_failed",
      message: "Unable to load billing overview.",
      logMessage: "Failed to load billing overview.",
    });
  }
}

export async function createBillingCheckoutSessionController(
  request: Request<unknown, CreateBillingCheckoutSessionResponse | ApiError, Partial<CreateBillingCheckoutSessionRequest>>,
  response: Response<CreateBillingCheckoutSessionResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    response.json(
      await createBillingCheckoutSession(request.auth, {
        businessId: request.body.businessId ?? "",
        priceId: request.body.priceId ?? "",
        returnPath: request.body.returnPath,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "billing_checkout_failed",
      message: "Unable to start billing checkout.",
      logMessage: "Failed to create billing checkout session.",
    });
  }
}

export async function createBillingPortalSessionController(
  request: Request<unknown, CreateBillingPortalSessionResponse | ApiError, Partial<CreateBillingPortalSessionRequest>>,
  response: Response<CreateBillingPortalSessionResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  try {
    response.json(
      await createBillingPortalSession(request.auth, {
        businessId: request.body.businessId ?? "",
        returnPath: request.body.returnPath,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "billing_portal_failed",
      message: "Unable to open billing management.",
      logMessage: "Failed to create billing portal session.",
    });
  }
}

export async function handleStripeWebhookController(
  request: Request,
  response: Response<{ received: true } | ApiError>,
): Promise<void> {
  const rawBody = Buffer.isBuffer(request.body)
    ? request.body
    : Buffer.from(typeof request.body === "string" ? request.body : "");

  try {
    await handleStripeWebhook(rawBody, request.header("Stripe-Signature") ?? undefined);
    response.json({ received: true });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "stripe_webhook_failed",
      message: "Unable to process Stripe webhook.",
      logMessage: "Failed to process Stripe webhook.",
    });
  }
}
