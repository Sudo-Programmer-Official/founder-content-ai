import express, { Router } from "express";
import {
  deleteEmailCampaignController,
  deleteEmailContactController,
  getEmailCampaignAnalytics,
  getEmailCampaignLinks,
  getEmailCampaignStats,
  getEmailCampaigns,
  getEmailClickTracking,
  getEmailContacts,
  getEmailContactImportJobController,
  getEmailContactImportJobsController,
  getEmailDomainSettingsController,
  getEmailLists,
  getEmailOpenTracking,
  getEmailUnsubscribe,
  patchEmailCampaign,
  patchEmailContactController,
  postEmailCampaignAutopilot,
  postEmailCampaign,
  postEmailCampaignPreview,
  postEmailResubscribe,
  postEmailCampaignSend,
  postEmailCampaignTestSend,
  postEmailContactsImport,
  postEmailContactsImportJob,
  postEmailContactsImportPreview,
  postEmailDeliveredEvent,
  postEmailDomain,
  postEmailDomainVerify,
  postEmailClickTracking,
  postEmailOpenTracking,
  postEmailUnsubscribe,
  postSesWebhook,
} from "../controllers/emailController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const emailRoute = Router();

emailRoute.post("/api/email/webhooks/ses", express.text({ type: "*/*", limit: "1mb" }), postSesWebhook);
emailRoute.post("/api/businesses/:businessId/email/contacts/import/preview", requireAuth(), postEmailContactsImportPreview);
emailRoute.post("/api/businesses/:businessId/email/contacts/import", requireAuth(), postEmailContactsImport);
emailRoute.post("/api/businesses/:businessId/email/import-jobs", requireAuth(), postEmailContactsImportJob);
emailRoute.get("/api/businesses/:businessId/email/import-jobs", requireAuth(), getEmailContactImportJobsController);
emailRoute.get("/api/businesses/:businessId/email/import-jobs/:jobId", requireAuth(), getEmailContactImportJobController);
emailRoute.get("/api/businesses/:businessId/email/contacts", requireAuth(), getEmailContacts);
emailRoute.patch("/api/businesses/:businessId/email/contacts/:contactId", requireAuth(), patchEmailContactController);
emailRoute.delete("/api/businesses/:businessId/email/contacts/:contactId", requireAuth(), deleteEmailContactController);
emailRoute.get("/api/businesses/:businessId/email/lists", requireAuth(), getEmailLists);
emailRoute.get("/api/businesses/:businessId/email/settings", requireAuth(), getEmailDomainSettingsController);
emailRoute.post("/api/businesses/:businessId/email/preview", requireAuth(), postEmailCampaignPreview);
emailRoute.post("/api/businesses/:businessId/email/campaigns", requireAuth(), postEmailCampaign);
emailRoute.post("/api/businesses/:businessId/email/test-send", requireAuth(), postEmailCampaignTestSend);
emailRoute.patch("/api/businesses/:businessId/email/campaigns/:campaignId", requireAuth(), patchEmailCampaign);
emailRoute.delete("/api/businesses/:businessId/email/campaigns/:campaignId", requireAuth(), deleteEmailCampaignController);
emailRoute.post("/api/businesses/:businessId/email/campaigns/:campaignId/send", requireAuth(), postEmailCampaignSend);
emailRoute.post("/api/businesses/:businessId/email/campaigns/autopilot", requireAuth(), postEmailCampaignAutopilot);
emailRoute.get("/api/businesses/:businessId/email/campaigns", requireAuth(), getEmailCampaigns);
emailRoute.get("/api/businesses/:businessId/email/campaigns/:campaignId/stats", requireAuth(), getEmailCampaignStats);
emailRoute.get("/api/businesses/:businessId/email/campaigns/:campaignId/analytics", requireAuth(), getEmailCampaignAnalytics);
emailRoute.get("/api/businesses/:businessId/email/campaigns/:campaignId/links", requireAuth(), getEmailCampaignLinks);
emailRoute.post("/api/email/campaigns/autopilot", requireAuth(), postEmailCampaignAutopilot);
emailRoute.get("/api/email/campaigns/:campaignId/analytics", requireAuth(), getEmailCampaignAnalytics);
emailRoute.post("/api/businesses/:businessId/email/domains", requireAuth(), postEmailDomain);
emailRoute.post("/api/businesses/:businessId/email/domains/:domainId/verify", requireAuth(), postEmailDomainVerify);
emailRoute.get("/api/email/track/open", getEmailOpenTracking);
emailRoute.get("/api/email/track/click", getEmailClickTracking);
emailRoute.get("/api/email/events/open", getEmailOpenTracking);
emailRoute.post("/api/email/events/open", postEmailOpenTracking);
emailRoute.get("/api/email/events/click", getEmailClickTracking);
emailRoute.post("/api/email/events/click", postEmailClickTracking);
emailRoute.post("/api/email/events/delivered", requireAuth(), postEmailDeliveredEvent);
emailRoute.get("/api/email/unsubscribe/:token", getEmailUnsubscribe);
emailRoute.post("/api/email/unsubscribe/:token", express.urlencoded({ extended: false }), postEmailUnsubscribe);
emailRoute.post("/api/email/resubscribe/:token", express.urlencoded({ extended: false }), postEmailResubscribe);
