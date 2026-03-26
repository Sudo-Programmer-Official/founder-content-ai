import { Router } from "express";
import {
  complete,
  createWorkspace,
  getStatus,
  savePreferences,
  start,
} from "../controllers/onboardingController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const onboardingRoute = Router();

onboardingRoute.get("/api/onboarding/status", requireAuth(), getStatus);
onboardingRoute.post("/api/onboarding/start", requireAuth(), start);
onboardingRoute.post("/api/onboarding/preferences", requireAuth(), savePreferences);
onboardingRoute.post("/api/onboarding/workspace", requireAuth(), createWorkspace);
onboardingRoute.post("/api/onboarding/complete", requireAuth(), complete);
