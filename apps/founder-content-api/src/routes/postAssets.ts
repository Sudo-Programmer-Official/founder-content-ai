import { Router } from "express";
import {
  createPostAssetController,
  deletePostAssetController,
  generateMotionPostAssetController,
  getMediaUploadUrl,
  getPostAssetController,
  getPostAssetDownloadController,
  getPostAssets,
} from "../controllers/postAssetController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const postAssetsRoute = Router();

postAssetsRoute.post("/api/media/upload-url", requireAuth(), getMediaUploadUrl);
postAssetsRoute.post("/api/post-assets", requireAuth(), createPostAssetController);
postAssetsRoute.post("/api/post-assets/motion-lite", requireAuth(), generateMotionPostAssetController);
postAssetsRoute.get("/api/post-assets", requireAuth(), getPostAssets);
postAssetsRoute.get("/api/post-assets/:assetId", requireAuth(), getPostAssetController);
postAssetsRoute.get("/api/post-assets/:assetId/download", requireAuth(), getPostAssetDownloadController);
postAssetsRoute.delete("/api/post-assets/:assetId", requireAuth(), deletePostAssetController);
