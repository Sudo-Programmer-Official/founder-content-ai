import { Router } from "express";
import {
  disconnectSocialAccountController,
  getSocialAccounts,
  linkedInOAuthCallback,
  metaOAuthCallback,
  getMetaAuthSessionController,
  selectMetaPageController,
  selectSocialAccountIdentityController,
  startLinkedInSocialAuth,
  startMetaSocialAuth,
} from "../controllers/socialAuthController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const socialAuthRoute = Router();

socialAuthRoute.post("/api/social-auth/linkedin/start", requireAuth(), startLinkedInSocialAuth);
socialAuthRoute.get("/api/social-auth/linkedin/callback", linkedInOAuthCallback);
socialAuthRoute.post("/api/social-auth/meta/start", requireAuth(), startMetaSocialAuth);
socialAuthRoute.get("/api/social-auth/meta/callback", metaOAuthCallback);
socialAuthRoute.get("/api/social-auth/meta/session", requireAuth(), getMetaAuthSessionController);
socialAuthRoute.post("/api/social-auth/meta/select-page", requireAuth(), selectMetaPageController);
socialAuthRoute.get("/api/social-accounts", requireAuth(), getSocialAccounts);
socialAuthRoute.post(
  "/api/social-accounts/:accountId/disconnect",
  requireAuth(),
  disconnectSocialAccountController,
);
socialAuthRoute.post(
  "/api/social-accounts/:accountId/select-identity",
  requireAuth(),
  selectSocialAccountIdentityController,
);
