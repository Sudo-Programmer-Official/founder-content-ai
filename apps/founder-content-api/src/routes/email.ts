import express, { Router } from "express";
import {
  deleteEmailCampaignController,
  deleteEmailContactController,
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
  postEmailCampaign,
  postEmailCampaignSend,
  postEmailContactsImport,
  postEmailContactsImportJob,
  postEmailContactsImportPreview,
  postEmailDomain,
  postEmailDomainVerify,
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
emailRoute.post("/api/businesses/:businessId/email/campaigns", requireAuth(), postEmailCampaign);
emailRoute.patch("/api/businesses/:businessId/email/campaigns/:campaignId", requireAuth(), patchEmailCampaign);
emailRoute.delete("/api/businesses/:businessId/email/campaigns/:campaignId", requireAuth(), deleteEmailCampaignController);
emailRoute.post("/api/businesses/:businessId/email/campaigns/:campaignId/send", requireAuth(), postEmailCampaignSend);
emailRoute.get("/api/businesses/:businessId/email/campaigns", requireAuth(), getEmailCampaigns);
emailRoute.get("/api/businesses/:businessId/email/campaigns/:campaignId/stats", requireAuth(), getEmailCampaignStats);
emailRoute.post("/api/businesses/:businessId/email/domains", requireAuth(), postEmailDomain);
emailRoute.post("/api/businesses/:businessId/email/domains/:domainId/verify", requireAuth(), postEmailDomainVerify);
emailRoute.get("/api/email/track/open", getEmailOpenTracking);
emailRoute.get("/api/email/track/click", getEmailClickTracking);
emailRoute.get("/api/email/unsubscribe/:token", getEmailUnsubscribe);
