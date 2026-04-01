import { Router } from "express";
import {
  getBrandKitController,
  updateBrandKitController,
} from "../controllers/brandKitController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const brandKitRoute = Router();

brandKitRoute.get("/api/brand-kit", requireAuth(), getBrandKitController);
brandKitRoute.post("/api/brand-kit/update", requireAuth(), updateBrandKitController);
