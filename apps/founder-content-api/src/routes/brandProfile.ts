import { Router } from "express";
import {
  getBrandProfileController,
  updateBrandProfileController,
} from "../controllers/brandProfileController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const brandProfileRoute = Router();

brandProfileRoute.get("/api/brand-profile", requireAuth(), getBrandProfileController);
brandProfileRoute.post("/api/brand-profile/update", requireAuth(), updateBrandProfileController);
