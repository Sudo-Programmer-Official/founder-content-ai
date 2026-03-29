import { Router } from "express";
import {
  getGrowthFlowsController,
  getGrowthLeadEventsController,
  getGrowthLeadsController,
  patchGrowthLeadStatusController,
  postGrowthLeadController,
} from "../controllers/growthController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const growthRoute = Router();

growthRoute.get("/api/growth/leads", requireAuth(), getGrowthLeadsController);
growthRoute.get("/api/growth/leads/:leadId/events", requireAuth(), getGrowthLeadEventsController);
growthRoute.post("/api/growth/leads", requireAuth(), postGrowthLeadController);
growthRoute.patch("/api/growth/leads/:leadId/status", requireAuth(), patchGrowthLeadStatusController);
growthRoute.get("/api/growth/flows", requireAuth(), getGrowthFlowsController);
