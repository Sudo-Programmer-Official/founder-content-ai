import { Router } from "express";
import { generateVisualController } from "../controllers/visualGenerationController.ts";
import { attachOptionalAuth } from "../middleware/auth.ts";

export const generateVisualRoute = Router();

generateVisualRoute.post("/api/generate-visual", attachOptionalAuth(), generateVisualController);
