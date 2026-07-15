import { Router } from "express";
import {
  getRevenueAgentProspectExportController,
  getRevenueAgentProspectWorkflowController,
  getRevenueAgentWorkspaceController,
  postRevenueAgentContactsEnrichController,
  postRevenueAgentContactsGenerateDraftsController,
  postRevenueAgentContactsSendController,
  postRevenueAgentContactsVerifyController,
  postRevenueAgentReplyAnalysisController,
  patchRevenueAgentProspectController,
  patchRevenueAgentWorkspaceFeedConfigController,
  postRevenueAgentResearchController,
  postRevenueAgentFeedController,
} from "../controllers/revenueAgentController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const revenueAgentRoute = Router();

revenueAgentRoute.get("/api/revenue-agent", requireAuth(), getRevenueAgentWorkspaceController);
revenueAgentRoute.get("/api/revenue-agent/prospects/:prospectId/export", requireAuth(), getRevenueAgentProspectExportController);
revenueAgentRoute.get("/api/revenue-agent/prospects/:prospectId/workflow", requireAuth(), getRevenueAgentProspectWorkflowController);
revenueAgentRoute.post("/api/revenue-agent/feed", requireAuth(), postRevenueAgentFeedController);
revenueAgentRoute.patch("/api/revenue-agent/feed-config", requireAuth(), patchRevenueAgentWorkspaceFeedConfigController);
revenueAgentRoute.patch("/api/revenue-agent/prospects/:prospectId", requireAuth(), patchRevenueAgentProspectController);
revenueAgentRoute.post("/api/revenue-agent/prospects/:prospectId/research", requireAuth(), postRevenueAgentResearchController);
revenueAgentRoute.post("/api/revenue-agent/prospects/:prospectId/reply-analysis", requireAuth(), postRevenueAgentReplyAnalysisController);
revenueAgentRoute.post("/api/revenue-agent/contacts/enrich", requireAuth(), postRevenueAgentContactsEnrichController);
revenueAgentRoute.post("/api/revenue-agent/contacts/verify", requireAuth(), postRevenueAgentContactsVerifyController);
revenueAgentRoute.post("/api/revenue-agent/contacts/generate-drafts", requireAuth(), postRevenueAgentContactsGenerateDraftsController);
revenueAgentRoute.post("/api/revenue-agent/contacts/send", requireAuth(), postRevenueAgentContactsSendController);
