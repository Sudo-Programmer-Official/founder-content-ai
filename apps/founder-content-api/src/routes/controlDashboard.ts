import { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";
import {
  convertIdeaInboxEntry,
  createPipelineItem,
  createIdeaInboxEntry,
  deletePipelineItem,
  duplicatePipelineItem,
  getDashboardLoop,
  getPipelineItem,
  previewPipelineAiEdit,
  updatePipelineItem,
} from "../controllers/controlDashboardController.ts";

export const controlDashboardRoute = Router();

controlDashboardRoute.get("/api/control-dashboard", requireAuth(), getDashboardLoop);
controlDashboardRoute.get("/api/content-pipeline/:assetId", requireAuth(), getPipelineItem);
controlDashboardRoute.post("/api/content-pipeline", requireAuth(), createPipelineItem);
controlDashboardRoute.post("/api/content-pipeline/:assetId/duplicate", requireAuth(), duplicatePipelineItem);
controlDashboardRoute.post("/api/idea-inbox", requireAuth(), createIdeaInboxEntry);
controlDashboardRoute.post("/api/idea-inbox/:ideaId/convert", requireAuth(), convertIdeaInboxEntry);
controlDashboardRoute.post("/api/content-ai-edit-preview", requireAuth(), previewPipelineAiEdit);
controlDashboardRoute.patch("/api/content-pipeline/:assetId", requireAuth(), updatePipelineItem);
controlDashboardRoute.delete("/api/content-pipeline/:assetId", requireAuth(), deletePipelineItem);
