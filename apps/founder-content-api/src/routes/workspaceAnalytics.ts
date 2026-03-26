import { Router } from "express";
import {
  getWorkspaceAnalyticsOverview,
  trackWorkspaceAnalyticsEvent,
} from "../controllers/workspaceAnalyticsController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const workspaceAnalyticsRoute = Router();

workspaceAnalyticsRoute.get(
  "/api/workspace/analytics/overview",
  requireAuth(),
  getWorkspaceAnalyticsOverview,
);
workspaceAnalyticsRoute.post(
  "/api/workspace/analytics/events",
  requireAuth(),
  trackWorkspaceAnalyticsEvent,
);
