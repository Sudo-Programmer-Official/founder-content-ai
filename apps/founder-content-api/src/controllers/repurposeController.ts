import type {
  ApiError,
  RepurposeContentRequest,
  RepurposeContentResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { repurposeContent } from "../services/repurposeService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";
import { handleApiError } from "../utils/http.ts";

export async function repurposeContentController(
  request: Request<unknown, RepurposeContentResponse | ApiError, Partial<RepurposeContentRequest>>,
  response: Response<RepurposeContentResponse | ApiError>,
): Promise<void> {
  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId: request.body?.businessId?.trim() || undefined,
      featureKey: "capture_remix",
      usageMetric: "posts",
    });

    const repurposed = await repurposeContent(
      {
        inputType: request.body?.inputType ?? "text",
        intent: request.body?.intent,
        assetId: request.body?.assetId,
        text: request.body?.text,
        voiceTranscript: request.body?.voiceTranscript,
        url: request.body?.url,
        sourceUrls: request.body?.sourceUrls,
        tone: request.body?.tone,
        businessId: request.body?.businessId,
      },
      request.auth,
    );

    response.json(repurposed);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth?.userId,
      businessId: request.body?.businessId?.trim() || undefined,
      code: "repurpose_failed",
      message: error instanceof Error ? error.message : "Unable to repurpose this input right now.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "repurpose_failed",
      message: "Unable to repurpose this input right now.",
      logMessage: "Failed to repurpose content input.",
    });
  }
}
