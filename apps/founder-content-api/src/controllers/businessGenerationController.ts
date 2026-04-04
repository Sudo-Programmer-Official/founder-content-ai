import type {
  ApiError,
  BusinessGenerationRequest,
  BusinessGenerationResponse,
} from "../../../../packages/shared-types/index.ts";
import {
  isBusinessGoalCompatibleWithIntent,
  resolveBusinessGenerationGoal,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { generateBusinessContent } from "../services/businessGenerationService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

function isValidGoal(value: unknown): value is BusinessGenerationRequest["goal"] {
  return value === "leads" || value === "bookings" || value === "traffic" || value === "awareness";
}

function isValidBusinessType(value: unknown): value is BusinessGenerationRequest["businessType"] {
  return value === "daycare" || value === "salon" || value === "fitness" || value === "general";
}

function isValidTone(value: unknown): value is NonNullable<BusinessGenerationRequest["tone"]> {
  return value === "friendly" || value === "premium" || value === "urgent";
}

function isValidGenerationIntent(
  value: unknown,
): value is NonNullable<BusinessGenerationRequest["generationIntent"]> {
  return value === "get_leads" || value === "get_bookings" || value === "weekly_plan" || value === "promote_offer";
}

function sanitizeChannels(value: unknown): BusinessGenerationRequest["channels"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (channel): channel is BusinessGenerationRequest["channels"][number] =>
      channel === "instagram" || channel === "facebook" || channel === "email",
  );
}

export async function generateBusinessContentController(
  request: Request<unknown, BusinessGenerationResponse | ApiError, Partial<BusinessGenerationRequest>>,
  response: Response<BusinessGenerationResponse | ApiError>,
): Promise<void> {
  const businessId = request.body?.businessId?.trim();
  const generationIntent = isValidGenerationIntent(request.body?.generationIntent)
    ? request.body.generationIntent
    : undefined;
  const requestedGoal = request.body?.goal;

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  if (!generationIntent && !isValidGoal(requestedGoal)) {
    sendApiError(response, 400, "bad_request", "goal must be one of: leads, bookings, traffic, awareness.");
    return;
  }

  if (!isValidBusinessType(request.body?.businessType)) {
    sendApiError(response, 400, "bad_request", "businessType must be one of: daycare, salon, fitness, general.");
    return;
  }

  const channels = sanitizeChannels(request.body?.channels);

  if (channels.length === 0) {
    sendApiError(response, 400, "bad_request", "Select at least one channel.");
    return;
  }

  const normalizedGoal = resolveBusinessGenerationGoal(
    generationIntent,
    isValidGoal(requestedGoal) ? requestedGoal : "awareness",
  );

  if (generationIntent && isValidGoal(requestedGoal) && !isBusinessGoalCompatibleWithIntent(generationIntent, requestedGoal)) {
    sendApiError(
      response,
      400,
      "bad_request",
      "goal does not match the selected generation intent.",
    );
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "content_generation",
      usageMetric: "generations",
    });

    response.json(
      await generateBusinessContent({
        businessId,
        goal: normalizedGoal,
        generationIntent,
        businessType: request.body.businessType,
        location: request.body.location?.trim(),
        offer: request.body.offer?.trim(),
        sourceIdea: request.body.sourceIdea?.trim(),
        tone: isValidTone(request.body?.tone) ? request.body.tone : undefined,
        channels,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "business_generation_failed",
      message: "Unable to generate business content right now.",
      logMessage: "Failed to generate business content.",
    });
  }
}
