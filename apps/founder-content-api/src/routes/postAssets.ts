import { Router } from "express";
import {
  createPromoVisualPostAssetController,
  createPostAssetController,
  deletePostAssetController,
  generateMotionPostAssetController,
  getMediaUploadUrl,
  getPostAssetController,
  getPostAssetDownloadController,
  getPostAssets,
  reorderPostAssetsController,
} from "../controllers/postAssetController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const postAssetsRoute = Router();

postAssetsRoute.options("/api/media/upload-url", (_request, response) => {
  response.sendStatus(204);
});
postAssetsRoute.post("/api/media/upload-url", requireAuth(), getMediaUploadUrl);

postAssetsRoute.options("/api/post-assets", (_request, response) => {
  response.sendStatus(204);
});
postAssetsRoute.post("/api/post-assets", requireAuth(), createPostAssetController);
postAssetsRoute.options("/api/post-assets/order", (_request, response) => {
  response.sendStatus(204);
});
postAssetsRoute.patch("/api/post-assets/order", requireAuth(), reorderPostAssetsController);

postAssetsRoute.options("/api/post-assets/motion-lite", (_request, response) => {
  response.sendStatus(204);
});
postAssetsRoute.post("/api/post-assets/motion-lite", requireAuth(), generateMotionPostAssetController);

postAssetsRoute.options("/api/post-assets/promo-visual", (_request, response) => {
  response.sendStatus(204);
});
postAssetsRoute.post("/api/post-assets/promo-visual", requireAuth(), createPromoVisualPostAssetController);

postAssetsRoute.get("/api/post-assets", requireAuth(), getPostAssets);

postAssetsRoute.options("/api/post-assets/:assetId", (_request, response) => {
  response.sendStatus(204);
});
postAssetsRoute.get("/api/post-assets/:assetId", requireAuth(), getPostAssetController);

postAssetsRoute.options("/api/post-assets/:assetId/download", (_request, response) => {
  response.sendStatus(204);
});
postAssetsRoute.get("/api/post-assets/:assetId/download", requireAuth(), getPostAssetDownloadController);
postAssetsRoute.delete("/api/post-assets/:assetId", requireAuth(), deletePostAssetController);
