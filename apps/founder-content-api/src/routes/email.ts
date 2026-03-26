import express, { Router } from "express";
import {
  getEmailCampaignStats,
  getEmailCampaigns,
  getEmailDomainSettingsController,
  getEmailLists,
  getEmailUnsubscribe,
  postEmailCampaign,
  postEmailCampaignSend,
  postEmailContactsImport,
  postEmailDomain,
  postEmailDomainVerify,
  postSesWebhook,
} from "../controllers/emailController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const emailRoute = Router();

emailRoute.post("/api/email/webhooks/ses", express.text({ type: "*/*", limit: "1mb" }), postSesWebhook);
emailRoute.post("/api/businesses/:businessId/email/contacts/import", requireAuth(), postEmailContactsImport);
emailRoute.get("/api/businesses/:businessId/email/lists", requireAuth(), getEmailLists);
emailRoute.get("/api/businesses/:businessId/email/settings", requireAuth(), getEmailDomainSettingsController);
emailRoute.post("/api/businesses/:businessId/email/campaigns", requireAuth(), postEmailCampaign);
emailRoute.post("/api/businesses/:businessId/email/campaigns/:campaignId/send", requireAuth(), postEmailCampaignSend);
emailRoute.get("/api/businesses/:businessId/email/campaigns", requireAuth(), getEmailCampaigns);
emailRoute.get("/api/businesses/:businessId/email/campaigns/:campaignId/stats", requireAuth(), getEmailCampaignStats);
emailRoute.post("/api/businesses/:businessId/email/domains", requireAuth(), postEmailDomain);
emailRoute.post("/api/businesses/:businessId/email/domains/:domainId/verify", requireAuth(), postEmailDomainVerify);
emailRoute.get("/api/email/unsubscribe/:token", getEmailUnsubscribe);
