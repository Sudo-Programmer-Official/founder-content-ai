import { Router } from "express";
import {
  getRecommendedPostTimes,
  postGenerateHashtags,
} from "../controllers/growthIntelligenceController.ts";
import { attachOptionalAuth, requireAuth } from "../middleware/auth.ts";

export const growthIntelligenceRoute = Router();

growthIntelligenceRoute.get("/api/recommend-post-time", requireAuth(), getRecommendedPostTimes);
growthIntelligenceRoute.post("/api/generate-hashtags", attachOptionalAuth(), postGenerateHashtags);
