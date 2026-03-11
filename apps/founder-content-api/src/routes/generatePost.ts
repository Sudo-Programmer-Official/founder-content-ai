import { Router } from "express";
import { generatePost } from "../controllers/postController";

export const generatePostRoute = Router();

generatePostRoute.post("/api/generate-post", generatePost);
