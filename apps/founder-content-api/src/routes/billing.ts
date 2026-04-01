import express, { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";
import {
  createBillingCheckoutSessionController,
  createBillingPortalSessionController,
  getBillingOverviewController,
  handleStripeWebhookController,
} from "../controllers/billingController.ts";

export const billingRoute = Router();

billingRoute.post(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json", limit: "1mb" }),
  handleStripeWebhookController,
);

billingRoute.use("/api/billing", express.json({ limit: "32kb" }));

billingRoute.get("/api/billing/overview", requireAuth(), getBillingOverviewController);
billingRoute.post(
  "/api/billing/create-checkout-session",
  requireAuth(),
  createBillingCheckoutSessionController,
);
billingRoute.post(
  "/api/billing/portal",
  requireAuth(),
  createBillingPortalSessionController,
);
