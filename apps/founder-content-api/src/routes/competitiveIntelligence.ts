import { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";
import {
  createCompetitorSourceController,
  getCompetitorFeedController,
  getTrendsController,
} from "../controllers/competitiveIntelligenceController.ts";

export const competitiveIntelligenceRoute = Router();

competitiveIntelligenceRoute.post("/api/competitor-sources", requireAuth(), createCompetitorSourceController);
competitiveIntelligenceRoute.get("/api/competitor-feed", requireAuth(), getCompetitorFeedController);
competitiveIntelligenceRoute.get("/api/trends", requireAuth(), getTrendsController);
