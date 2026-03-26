import { Router } from "express";
import { previewContentIngestionController } from "../controllers/ingestionController.ts";
import { attachOptionalAuth } from "../middleware/auth.ts";

export const ingestionRoute = Router();

ingestionRoute.post("/api/content/ingest-preview", attachOptionalAuth(), previewContentIngestionController);
