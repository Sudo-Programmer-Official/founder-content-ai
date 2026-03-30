import express from "express";
import {
  getContentBatchController,
  postConfirmContentBatch,
  postGenerateContentBatch,
} from "../controllers/contentOrchestrationController.ts";
import { requireAuth } from "../middleware/auth.ts";

export const contentOrchestrationRoute = express.Router();

contentOrchestrationRoute.post("/api/content/batches/generate", requireAuth(), postGenerateContentBatch);
contentOrchestrationRoute.get("/api/content/batches/:batchId", requireAuth(), getContentBatchController);
contentOrchestrationRoute.post("/api/content/batches/:batchId/confirm", requireAuth(), postConfirmContentBatch);
