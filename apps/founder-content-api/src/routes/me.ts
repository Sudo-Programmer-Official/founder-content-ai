import { Router } from "express";
import { requireAuth } from "../middleware/auth.ts";
import { getMe, getMyBusinesses, getMyFeatures } from "../controllers/meController.ts";

export const meRoute = Router();

meRoute.get("/api/me", requireAuth(), getMe);
meRoute.get("/api/me/features", requireAuth(), getMyFeatures);
meRoute.get("/api/me/businesses", requireAuth(), getMyBusinesses);
