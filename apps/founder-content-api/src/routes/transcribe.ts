import { Router } from "express";
import { transcribeAudioInput } from "../controllers/transcriptionController.ts";
import { attachOptionalAuth } from "../middleware/auth.ts";

export const transcribeRoute = Router();

transcribeRoute.post("/api/transcribe", attachOptionalAuth(), transcribeAudioInput);
