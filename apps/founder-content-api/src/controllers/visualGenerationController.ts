import type {
  ApiError,
  GenerateVisualRequest,
  GenerateVisualResponse,
  VisualTemplateType,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";
import { generateVisualAsset } from "../services/visualGenerationService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

const VALID_TEMPLATE_TYPES: VisualTemplateType[] = [
  "quote",
  "insight",
  "contrarian",
  "carousel",
];

function isValidTemplateType(value: string | undefined): value is VisualTemplateType {
  return VALID_TEMPLATE_TYPES.includes((value ?? "") as VisualTemplateType);
}

export async function generateVisualController(
  request: Request<unknown, GenerateVisualResponse | ApiError, Partial<GenerateVisualRequest>>,
  response: Response<GenerateVisualResponse | ApiError>,
): Promise<void> {
  if (!isValidTemplateType(request.body?.templateType)) {
    sendApiError(
      response,
      400,
      "bad_request",
      "templateType must be one of: quote, insight, contrarian, carousel.",
    );
    return;
  }

  if (!request.body?.content || typeof request.body.content !== "object") {
    sendApiError(response, 400, "bad_request", "content is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId: request.body.businessId?.trim() || undefined,
      featureKey: "visual_generation",
      usageMetric: "posts",
    });

    response.json(
      await generateVisualAsset(
        {
          businessId: request.body.businessId?.trim() || undefined,
          templateType: request.body.templateType,
          content: {
            headline: request.body.content.headline?.trim() ?? "",
            supportingText: request.body.content.supportingText?.trim() || undefined,
            bulletPoints: request.body.content.bulletPoints,
          },
          brandKit: request.body.brandKit
            ? {
                primaryColor: request.body.brandKit.primaryColor?.trim(),
                secondaryColor: request.body.brandKit.secondaryColor?.trim(),
                backgroundStyle: request.body.brandKit.backgroundStyle,
                fontStyle: request.body.brandKit.fontStyle,
                visualStyle: request.body.brandKit.visualStyle,
                tone: request.body.brandKit.tone,
                logoUrl: request.body.brandKit.logoUrl?.trim(),
              }
            : undefined,
        },
        request.auth,
      ),
    );
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth?.userId,
      businessId: request.body.businessId?.trim() || undefined,
      code: "visual_generation_failed",
      message: error instanceof Error ? error.message : "Unable to generate visual.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "visual_generation_failed",
      message: "Unable to generate visual.",
      logMessage: "Failed to generate visual.",
    });
  }
}
