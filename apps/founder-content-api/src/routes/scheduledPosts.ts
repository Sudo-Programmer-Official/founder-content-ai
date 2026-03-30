import { Router } from "express";
import {
  getScheduledPosts,
  patchScheduledPostPerformanceController,
  patchScheduledPost,
  publishPost,
  schedulePost,
} from "../controllers/scheduledPostController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const scheduledPostsRoute = Router();

scheduledPostsRoute.post("/api/publish-post", requireAuth(), publishPost);
scheduledPostsRoute.post("/api/schedule-post", requireAuth(), schedulePost);
scheduledPostsRoute.get("/api/scheduled-posts", requireAuth(), getScheduledPosts);
scheduledPostsRoute.patch("/api/scheduled-posts/:scheduledPostId", requireAuth(), patchScheduledPost);
scheduledPostsRoute.patch(
  "/api/scheduled-posts/:scheduledPostId/performance",
  requireAuth(),
  patchScheduledPostPerformanceController,
);
