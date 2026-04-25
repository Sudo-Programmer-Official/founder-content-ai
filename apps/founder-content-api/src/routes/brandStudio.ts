import { Router } from "express";
import {
  getBrandStudioHistoryController,
  postBrandGenerateAssetController,
  postBrandStudioGenerationController,
} from "../controllers/brandStudioController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const brandStudioRoute = Router();

brandStudioRoute.get("/api/brand/history", requireAuth(), getBrandStudioHistoryController);
brandStudioRoute.post("/api/brand/generate-asset", requireAuth(), postBrandGenerateAssetController);
brandStudioRoute.get("/api/brand-studio/history", requireAuth(), getBrandStudioHistoryController);
brandStudioRoute.post("/api/brand-studio/generate", requireAuth(), postBrandStudioGenerationController);
