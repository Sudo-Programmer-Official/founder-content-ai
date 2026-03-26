import { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";
import { getPreferences, savePreferences } from "../controllers/userPreferencesController.ts";

export const userPreferencesRoute = Router();

userPreferencesRoute.get("/api/preferences", requireAuth(), getPreferences);
userPreferencesRoute.post("/api/preferences", requireAuth(), savePreferences);
