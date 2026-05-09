import { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";
import {
  getWorkspaceBlogsController,
  postWorkspaceBlogUnpublishController,
  postWorkspaceBlogsPublishController,
} from "../controllers/workspaceBlogController.ts";

export const workspaceBlogsRoute = Router();

workspaceBlogsRoute.get("/api/workspace/blogs", requireAuth(), getWorkspaceBlogsController);
workspaceBlogsRoute.post("/api/workspace/blogs/publish", requireAuth(), postWorkspaceBlogsPublishController);
workspaceBlogsRoute.post("/api/workspace/blogs/:slug/unpublish", requireAuth(), postWorkspaceBlogUnpublishController);
