import { Router } from "express";
import {
  disconnectGoogleCalendarController,
  googleCalendarOAuthCallback,
  startGoogleCalendarAuthController,
} from "../controllers/googleCalendarController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const googleCalendarRoute = Router();

googleCalendarRoute.post("/api/google-calendar/start", requireAuth(), startGoogleCalendarAuthController);
googleCalendarRoute.get("/api/google-calendar/callback", googleCalendarOAuthCallback);
googleCalendarRoute.post("/api/google-calendar/disconnect", requireAuth(), disconnectGoogleCalendarController);
