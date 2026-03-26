import { Router } from "express";
import {
  listSavedContentSourcesController,
  previewContentIngestionController,
} from "../controllers/ingestionController.ts";
import { attachOptionalAuth } from "../middleware/auth.ts";

export const ingestionRoute = Router();

ingestionRoute.get("/api/content/sources", attachOptionalAuth(), listSavedContentSourcesController);
ingestionRoute.post("/api/content/ingest-preview", attachOptionalAuth(), previewContentIngestionController);
