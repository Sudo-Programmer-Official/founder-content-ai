import { Router } from "express";
import { captureContent } from "../controllers/captureController.ts";
import { attachOptionalAuth } from "../middleware/auth.ts";

export const captureRoute = Router();

captureRoute.post("/api/capture", attachOptionalAuth(), captureContent);
