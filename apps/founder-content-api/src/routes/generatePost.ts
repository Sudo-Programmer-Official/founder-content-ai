import { Router } from "express";
import { generatePost } from "../controllers/postController.ts";
import { attachOptionalAuth } from "../middleware/auth.ts";

export const generatePostRoute = Router();

generatePostRoute.post("/api/generate-post", attachOptionalAuth(), generatePost);
