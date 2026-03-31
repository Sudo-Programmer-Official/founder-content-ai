import { Router } from "express";
import {
  deleteWorkspaceAssetController,
  getWorkspaceAssetsController,
  postWorkspaceAssetController,
  postWorkspaceAssetUploadUrlController,
  postWorkspaceAssetUsageController,
} from "../controllers/workspaceAssetController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const workspaceAssetsRoute = Router();

workspaceAssetsRoute.get("/api/workspace-assets", requireAuth(), getWorkspaceAssetsController);
workspaceAssetsRoute.post("/api/workspace-assets/upload-url", requireAuth(), postWorkspaceAssetUploadUrlController);
workspaceAssetsRoute.post("/api/workspace-assets", requireAuth(), postWorkspaceAssetController);
workspaceAssetsRoute.post("/api/workspace-assets/:assetId/usage", requireAuth(), postWorkspaceAssetUsageController);
workspaceAssetsRoute.delete("/api/workspace-assets/:assetId", requireAuth(), deleteWorkspaceAssetController);
