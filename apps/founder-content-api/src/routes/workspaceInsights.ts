import { Router } from "express";
import { getWorkspaceInsightsController } from "../controllers/workspaceInsightsController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const workspaceInsightsRoute = Router();

workspaceInsightsRoute.get("/api/workspace-insights", requireAuth(), getWorkspaceInsightsController);
