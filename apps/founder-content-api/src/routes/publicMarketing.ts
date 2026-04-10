import { Router } from "express";
import {
  getPublicSocialProof,
  postPublicMarketingInquiry,
} from "../controllers/publicMarketingController.ts";

export const publicMarketingRoute = Router();

publicMarketingRoute.get("/api/public/social-proof", getPublicSocialProof);
publicMarketingRoute.post("/api/public/assistant-inquiries", postPublicMarketingInquiry);
