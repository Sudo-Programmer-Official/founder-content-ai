import { Router } from "express";
import {
  getAdminErrors,
  getAdminFeatureFlags,
  getAdminOverview,
  getAdminOpsOverview,
  getAdminUsage,
  getAdminUsers,
  getAdminWorkspaces,
  patchAdminWorkspaceAccess,
  postAdminFeatureFlag,
  postAdminFeatureFlagTarget,
} from "../controllers/adminController.ts";
import { requireAuth } from "../middleware/auth.ts";
import { requireSuperAdmin } from "../middleware/admin.ts";

export const adminRoute = Router();

adminRoute.get("/api/admin/overview", requireAuth(), requireSuperAdmin(), getAdminOverview);
adminRoute.get("/api/admin/ops/overview", requireAuth(), requireSuperAdmin(), getAdminOpsOverview);
adminRoute.get("/api/admin/errors", requireAuth(), requireSuperAdmin(), getAdminErrors);
adminRoute.get("/api/admin/users", requireAuth(), requireSuperAdmin(), getAdminUsers);
adminRoute.get("/api/admin/workspaces", requireAuth(), requireSuperAdmin(), getAdminWorkspaces);
adminRoute.patch("/api/admin/workspaces/:workspaceId/access", requireAuth(), requireSuperAdmin(), patchAdminWorkspaceAccess);
adminRoute.get("/api/admin/feature-flags", requireAuth(), requireSuperAdmin(), getAdminFeatureFlags);
adminRoute.post("/api/admin/feature-flags", requireAuth(), requireSuperAdmin(), postAdminFeatureFlag);
adminRoute.post("/api/admin/feature-flags/targets", requireAuth(), requireSuperAdmin(), postAdminFeatureFlagTarget);
adminRoute.get("/api/admin/usage", requireAuth(), requireSuperAdmin(), getAdminUsage);
