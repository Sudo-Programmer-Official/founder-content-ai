import { Router } from "express";
import {
  getWorkspaceKnowledgeController,
  postWorkspaceKnowledgeProfileController,
  postWorkspaceKnowledgeRefreshController,
  postWorkspaceKnowledgeSourceController,
} from "../controllers/workspaceKnowledgeController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const workspaceKnowledgeRoute = Router();

workspaceKnowledgeRoute.get("/api/workspace-knowledge", requireAuth(), getWorkspaceKnowledgeController);
workspaceKnowledgeRoute.post("/api/workspace-knowledge", requireAuth(), postWorkspaceKnowledgeSourceController);
workspaceKnowledgeRoute.post("/api/workspace-knowledge/profile", requireAuth(), postWorkspaceKnowledgeProfileController);
workspaceKnowledgeRoute.post("/api/workspace-knowledge/refresh", requireAuth(), postWorkspaceKnowledgeRefreshController);
