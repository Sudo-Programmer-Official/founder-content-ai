import { Router } from "express";
import { remixContent } from "../controllers/remixController.ts";
import { attachOptionalAuth } from "../middleware/auth.ts";

export const remixRoute = Router();

remixRoute.post("/api/remix", attachOptionalAuth(), remixContent);
