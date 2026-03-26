import { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";
import {
  convertIdeaInboxEntry,
  createIdeaInboxEntry,
  getDashboardLoop,
  updatePipelineItem,
} from "../controllers/controlDashboardController.ts";

export const controlDashboardRoute = Router();

controlDashboardRoute.get("/api/control-dashboard", requireAuth(), getDashboardLoop);
controlDashboardRoute.post("/api/idea-inbox", requireAuth(), createIdeaInboxEntry);
controlDashboardRoute.post("/api/idea-inbox/:ideaId/convert", requireAuth(), convertIdeaInboxEntry);
controlDashboardRoute.patch("/api/content-pipeline/:assetId", requireAuth(), updatePipelineItem);
