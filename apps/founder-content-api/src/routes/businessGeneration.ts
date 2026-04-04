import { Router } from "express";
import { generateBusinessContentController } from "../controllers/businessGenerationController.ts";
import { attachOptionalAuth } from "../middleware/auth.ts";

export const businessGenerationRoute = Router();

businessGenerationRoute.post("/api/business/generate", attachOptionalAuth(), generateBusinessContentController);
