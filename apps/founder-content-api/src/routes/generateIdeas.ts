import { Router } from "express";
import { generateIdeas } from "../controllers/ideaController";

export const generateIdeasRoute = Router();

generateIdeasRoute.post("/api/generate-ideas", generateIdeas);
