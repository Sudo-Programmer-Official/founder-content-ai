import { Router } from "express";
import { generateHook } from "../controllers/hookController";

export const generateHookRoute = Router();

generateHookRoute.post("/api/generate-hook", generateHook);
