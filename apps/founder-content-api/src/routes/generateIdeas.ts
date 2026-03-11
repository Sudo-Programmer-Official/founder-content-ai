import { Router } from "express";
import { generateIdeas } from "../controllers/ideaController.ts";

export const generateIdeasRoute = Router();

generateIdeasRoute.post("/api/generate-ideas", generateIdeas);
