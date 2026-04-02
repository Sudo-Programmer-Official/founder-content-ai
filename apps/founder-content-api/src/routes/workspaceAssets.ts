import { Router } from "express";
import {
  deleteWorkspaceAssetController,
  getWorkspaceAssetController,
  getWorkspaceAssetDownloadController,
  getWorkspaceAssetsController,
  postWorkspaceAssetController,
  postWorkspaceAssetUploadUrlController,
  postWorkspaceAssetUsageController,
} from "../controllers/workspaceAssetController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const workspaceAssetsRoute = Router();

workspaceAssetsRoute.get("/api/workspace-assets", requireAuth(), getWorkspaceAssetsController);
workspaceAssetsRoute.get("/api/workspace-assets/:assetId", requireAuth(), getWorkspaceAssetController);
workspaceAssetsRoute.get("/api/workspace-assets/:assetId/download", requireAuth(), getWorkspaceAssetDownloadController);
workspaceAssetsRoute.post("/api/workspace-assets/upload-url", requireAuth(), postWorkspaceAssetUploadUrlController);
workspaceAssetsRoute.post("/api/workspace-assets", requireAuth(), postWorkspaceAssetController);
workspaceAssetsRoute.post("/api/workspace-assets/:assetId/usage", requireAuth(), postWorkspaceAssetUsageController);
workspaceAssetsRoute.delete("/api/workspace-assets/:assetId", requireAuth(), deleteWorkspaceAssetController);
