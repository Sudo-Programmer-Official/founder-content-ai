import { Router } from "express";
import {
  deleteAdminUser,
  getAdminMediaRegistry,
  getAdminErrors,
  getAdminFeatureFlags,
  getAdminOverview,
  getAdminOpsOverview,
  getAdminUsage,
  getAdminUsers,
  getAdminWorkspaces,
  patchAdminMediaGenerationSettings,
  patchAdminWorkspaceAccess,
  postAdminDecisionRule,
  postAdminFeatureFlag,
  postAdminFeatureFlagTarget,
  postAdminMediaPreset,
  postAdminPromptTemplate,
} from "../controllers/adminController.ts";
import { requireAuth } from "../middleware/auth.ts";
import { requireSuperAdmin } from "../middleware/admin.ts";

export const adminRoute = Router();

adminRoute.get("/api/admin/overview", requireAuth(), requireSuperAdmin(), getAdminOverview);
adminRoute.get("/api/admin/ops/overview", requireAuth(), requireSuperAdmin(), getAdminOpsOverview);
adminRoute.get("/api/admin/errors", requireAuth(), requireSuperAdmin(), getAdminErrors);
adminRoute.get("/api/admin/users", requireAuth(), requireSuperAdmin(), getAdminUsers);
adminRoute.delete("/api/admin/users/:userId", requireAuth(), requireSuperAdmin(), deleteAdminUser);
adminRoute.get("/api/admin/workspaces", requireAuth(), requireSuperAdmin(), getAdminWorkspaces);
adminRoute.patch("/api/admin/workspaces/:workspaceId/access", requireAuth(), requireSuperAdmin(), patchAdminWorkspaceAccess);
adminRoute.get("/api/admin/feature-flags", requireAuth(), requireSuperAdmin(), getAdminFeatureFlags);
adminRoute.post("/api/admin/feature-flags", requireAuth(), requireSuperAdmin(), postAdminFeatureFlag);
adminRoute.post("/api/admin/feature-flags/targets", requireAuth(), requireSuperAdmin(), postAdminFeatureFlagTarget);
adminRoute.get("/api/admin/media-registry", requireAuth(), requireSuperAdmin(), getAdminMediaRegistry);
adminRoute.patch("/api/admin/media-registry/generation-settings", requireAuth(), requireSuperAdmin(), patchAdminMediaGenerationSettings);
adminRoute.post("/api/admin/media-registry/presets", requireAuth(), requireSuperAdmin(), postAdminMediaPreset);
adminRoute.post("/api/admin/media-registry/prompt-templates", requireAuth(), requireSuperAdmin(), postAdminPromptTemplate);
adminRoute.post("/api/admin/media-registry/decision-rules", requireAuth(), requireSuperAdmin(), postAdminDecisionRule);
adminRoute.get("/api/admin/usage", requireAuth(), requireSuperAdmin(), getAdminUsage);
