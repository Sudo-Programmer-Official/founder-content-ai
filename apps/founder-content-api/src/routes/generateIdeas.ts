import { Router } from "express";
import { generateIdeas } from "../controllers/ideaController.ts";
import { attachOptionalAuth } from "../middleware/auth.ts";

export const generateIdeasRoute = Router();

generateIdeasRoute.post("/api/generate-ideas", attachOptionalAuth(), generateIdeas);
