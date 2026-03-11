import { Router } from "express";
import { generateHook } from "../controllers/hookController.ts";

export const generateHookRoute = Router();

generateHookRoute.post("/api/generate-hook", generateHook);
