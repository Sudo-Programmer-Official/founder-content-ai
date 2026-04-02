import { Router } from "express";
import {
  createPublishAttemptController,
  getPublishAttemptDetailController,
  getPublishAttemptsController,
  getScheduledPosts,
  patchScheduledPostPerformanceController,
  patchScheduledPost,
  publishPost,
  retryPublishAttemptController,
  schedulePost,
} from "../controllers/scheduledPostController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const scheduledPostsRoute = Router();

scheduledPostsRoute.post("/api/publish-post", requireAuth(), publishPost);
scheduledPostsRoute.post("/api/publish-attempts", requireAuth(), createPublishAttemptController);
scheduledPostsRoute.post("/api/schedule-post", requireAuth(), schedulePost);
scheduledPostsRoute.get("/api/publish-attempts", requireAuth(), getPublishAttemptsController);
scheduledPostsRoute.get(
  "/api/publish-attempts/:publishAttemptId",
  requireAuth(),
  getPublishAttemptDetailController,
);
scheduledPostsRoute.post(
  "/api/publish-attempts/:publishAttemptId/retry-failed",
  requireAuth(),
  retryPublishAttemptController,
);
scheduledPostsRoute.get("/api/scheduled-posts", requireAuth(), getScheduledPosts);
scheduledPostsRoute.patch("/api/scheduled-posts/:scheduledPostId", requireAuth(), patchScheduledPost);
scheduledPostsRoute.patch(
  "/api/scheduled-posts/:scheduledPostId/performance",
  requireAuth(),
  patchScheduledPostPerformanceController,
);
