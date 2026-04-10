import { Router } from "express";
import { getPublicSocialProof } from "../controllers/publicMarketingController.ts";

export const publicMarketingRoute = Router();

publicMarketingRoute.get("/api/public/social-proof", getPublicSocialProof);
