import { Router } from "express";
import {
  createReelStoryboardController,
  approveReelProjectController,
  deleteReelProjectController,
  getReelMediaController,
  getReelProjectController,
  listReelProjectsController,
  markReelReviewedController,
  getReelYouTubeConnectionController,
  publishReelToYouTubeController,
  regenerateReelSceneController,
  renderReelController,
  reelYouTubeOAuthCallbackController,
  startReelYouTubeAuthController,
  updateReelStoryboardController,
} from "../controllers/reelStudioController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const reelStudioRoute = Router();

// Signed URL, no auth header: <video> and <img> tags load this directly.
reelStudioRoute.get("/api/reel-studio/media", getReelMediaController);
reelStudioRoute.get("/api/reel-studio/projects", requireAuth(), listReelProjectsController);
reelStudioRoute.post("/api/reel-studio/projects", requireAuth(), createReelStoryboardController);
reelStudioRoute.get("/api/reel-studio/projects/:projectId", requireAuth(), getReelProjectController);
reelStudioRoute.patch("/api/reel-studio/projects/:projectId", requireAuth(), updateReelStoryboardController);
reelStudioRoute.post("/api/reel-studio/projects/:projectId/approve", requireAuth(), approveReelProjectController);
reelStudioRoute.post("/api/reel-studio/projects/:projectId/review", requireAuth(), markReelReviewedController);
reelStudioRoute.post("/api/reel-studio/youtube/start", requireAuth(), startReelYouTubeAuthController);
reelStudioRoute.get("/api/reel-studio/youtube/callback", reelYouTubeOAuthCallbackController);
reelStudioRoute.get("/api/reel-studio/youtube/status", requireAuth(), getReelYouTubeConnectionController);
reelStudioRoute.post("/api/reel-studio/projects/:projectId/youtube/publish", requireAuth(), publishReelToYouTubeController);
reelStudioRoute.delete("/api/reel-studio/projects/:projectId", requireAuth(), deleteReelProjectController);
reelStudioRoute.post("/api/reel-studio/projects/:projectId/scenes/:sceneId/regenerate", requireAuth(), regenerateReelSceneController);
reelStudioRoute.post("/api/reel-studio/projects/:projectId/render", requireAuth(), renderReelController);
