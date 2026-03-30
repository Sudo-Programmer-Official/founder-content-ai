import { Router } from "express";
import {
  createPostAssetController,
  deletePostAssetController,
  getMediaUploadUrl,
  getPostAssets,
} from "../controllers/postAssetController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const postAssetsRoute = Router();

postAssetsRoute.post("/api/media/upload-url", requireAuth(), getMediaUploadUrl);
postAssetsRoute.post("/api/post-assets", requireAuth(), createPostAssetController);
postAssetsRoute.get("/api/post-assets", requireAuth(), getPostAssets);
postAssetsRoute.delete("/api/post-assets/:assetId", requireAuth(), deletePostAssetController);
