import { Router } from "express";
import {
  getWorkspaceMediaIntelligenceController,
  patchBusinessMediaProfileController,
  postMediaPerformanceStatController,
  postMediaRecommendationsController,
  postWorkspaceMediaResolutionController,
  postWorkspaceMediaOverrideController,
} from "../controllers/mediaIntelligenceController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const mediaIntelligenceRoute = Router();

mediaIntelligenceRoute.get("/api/media-intelligence", requireAuth(), getWorkspaceMediaIntelligenceController);
mediaIntelligenceRoute.patch("/api/media-intelligence/profile", requireAuth(), patchBusinessMediaProfileController);
mediaIntelligenceRoute.post("/api/media-intelligence/overrides", requireAuth(), postWorkspaceMediaOverrideController);
mediaIntelligenceRoute.post("/api/media-intelligence/resolve", requireAuth(), postWorkspaceMediaResolutionController);
mediaIntelligenceRoute.post("/api/media-intelligence/recommendations", requireAuth(), postMediaRecommendationsController);
mediaIntelligenceRoute.post("/api/media-intelligence/performance", requireAuth(), postMediaPerformanceStatController);
