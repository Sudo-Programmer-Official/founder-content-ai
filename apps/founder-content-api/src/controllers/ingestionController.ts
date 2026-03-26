import type {
  ApiError,
  PreviewContentIngestionRequest,
  PreviewContentIngestionResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { enforceWorkspaceReadAccess } from "../services/governanceService.ts";
import { previewContentIngestion } from "../services/content/ingestionService.ts";
import { handleApiError } from "../utils/http.ts";

export async function previewContentIngestionController(
  request: Request<unknown, PreviewContentIngestionResponse | ApiError, Partial<PreviewContentIngestionRequest>>,
  response: Response<PreviewContentIngestionResponse | ApiError>,
): Promise<void> {
  try {
    await enforceWorkspaceReadAccess(
      request.auth,
      request.body?.businessId?.trim() || undefined,
      "capture_remix",
    );

    response.json(
      await previewContentIngestion({
        businessId: request.body?.businessId?.trim() || undefined,
        contextText: request.body?.contextText,
        sourceUrls: request.body?.sourceUrls ?? [],
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "content_ingestion_preview_failed",
      message: "Unable to preview content sources right now.",
      logMessage: "Failed to preview content ingestion.",
    });
  }
}
