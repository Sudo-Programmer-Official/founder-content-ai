import { Router } from "express";
import { generateHook } from "../controllers/hookController.ts";
import { attachOptionalAuth } from "../middleware/auth.ts";

export const generateHookRoute = Router();

generateHookRoute.post("/api/generate-hook", attachOptionalAuth(), generateHook);
