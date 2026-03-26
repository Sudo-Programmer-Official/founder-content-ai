import { Router } from "express";
import {
  getAdminOutreachLeads,
  getAdminOutreachOverview,
  getWorkspaceOutreachLeadHistory,
  getWorkspaceOutreachLeads,
  patchAdminOutreachLeadStatus,
  postAdminOutreachFollowupDraft,
  postAdminOutreachMessageDraft,
  postAdminOutreachReplyDraft,
  postWorkspaceOutreachLeadImport,
  postWorkspaceOutreachMessage,
} from "../controllers/outreachController.ts";
import { requireAuth } from "../middleware/auth.ts";
import { requireSuperAdmin } from "../middleware/admin.ts";

export const outreachAdminRoute = Router();
export const outreachRoute = Router();

outreachAdminRoute.get("/api/admin/outreach/overview", requireAuth(), requireSuperAdmin(), getAdminOutreachOverview);
outreachAdminRoute.get("/api/admin/outreach/leads", requireAuth(), requireSuperAdmin(), getAdminOutreachLeads);
outreachAdminRoute.post("/api/admin/outreach/message-draft", requireAuth(), requireSuperAdmin(), postAdminOutreachMessageDraft);
outreachAdminRoute.post("/api/admin/outreach/followup-draft", requireAuth(), requireSuperAdmin(), postAdminOutreachFollowupDraft);
outreachAdminRoute.post("/api/admin/outreach/reply-draft", requireAuth(), requireSuperAdmin(), postAdminOutreachReplyDraft);
outreachAdminRoute.patch("/api/admin/outreach/leads/:leadId/status", requireAuth(), requireSuperAdmin(), patchAdminOutreachLeadStatus);

outreachRoute.get("/api/outreach/leads", requireAuth(), getWorkspaceOutreachLeads);
outreachRoute.post("/api/outreach/leads/import", requireAuth(), postWorkspaceOutreachLeadImport);
outreachRoute.post("/api/outreach/messages", requireAuth(), postWorkspaceOutreachMessage);
outreachRoute.get("/api/outreach/leads/:leadId/history", requireAuth(), getWorkspaceOutreachLeadHistory);
