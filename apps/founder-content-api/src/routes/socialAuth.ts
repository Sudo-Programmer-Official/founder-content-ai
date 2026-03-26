import { Router } from "express";
import {
  disconnectSocialAccountController,
  getSocialAccounts,
  linkedInOAuthCallback,
  startLinkedInSocialAuth,
} from "../controllers/socialAuthController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const socialAuthRoute = Router();

socialAuthRoute.post("/api/social-auth/linkedin/start", requireAuth(), startLinkedInSocialAuth);
socialAuthRoute.get("/api/social-auth/linkedin/callback", linkedInOAuthCallback);
socialAuthRoute.get("/api/social-accounts", requireAuth(), getSocialAccounts);
socialAuthRoute.post(
  "/api/social-accounts/:accountId/disconnect",
  requireAuth(),
  disconnectSocialAccountController,
);
