import { Router } from "express";
import { repurposeContentController } from "../controllers/repurposeController.ts";
import { attachOptionalAuth } from "../middleware/auth.ts";

export const repurposeRoute = Router();

repurposeRoute.post("/api/repurpose", attachOptionalAuth(), repurposeContentController);
