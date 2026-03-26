import { Router } from "express";
import { createBusiness } from "../controllers/businessController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const businessesRoute = Router();

businessesRoute.post("/api/businesses", requireAuth(), createBusiness);
