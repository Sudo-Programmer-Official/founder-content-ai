import { Router } from "express";
import {
  getScheduledPosts,
  publishPost,
  schedulePost,
} from "../controllers/scheduledPostController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const scheduledPostsRoute = Router();

scheduledPostsRoute.post("/api/publish-post", requireAuth(), publishPost);
scheduledPostsRoute.post("/api/schedule-post", requireAuth(), schedulePost);
scheduledPostsRoute.get("/api/scheduled-posts", requireAuth(), getScheduledPosts);
