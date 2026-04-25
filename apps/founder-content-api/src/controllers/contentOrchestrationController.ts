import type {
  ApproveContentPlanRequest,
  ApproveContentPlanResponse,
  ApiError,
  ConfirmContentBatchRequest,
  ConfirmContentBatchResponse,
  GenerateContentPlanRequest,
  GenerateContentPlanResponse,
  GenerateContentBatchRequest,
  GenerateContentBatchResponse,
  GetContentPlanResponse,
  GetContentBatchResponse,
  SocialContentPlanDuration,
  SocialContentPlanPlatform,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  confirmContentBatch,
  generateContentBatch,
  getContentBatch,
} from "../services/contentOrchestrationService.ts";
import {
  approveSocialContentPlan,
  generateSocialContentPlan,
  getSocialContentPlan,
} from "../services/socialContentPlanService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

function parsePlanDuration(value: unknown): SocialContentPlanDuration | undefined {
  return value === "14_days" || value === "30_days" || value === "7_days" ? value : undefined;
}

function parsePlanPlatforms(value: unknown): SocialContentPlanPlatform[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is SocialContentPlanPlatform =>
        entry === "linkedin" || entry === "instagram" || entry === "facebook"
      )
    : [];
}

export async function postGenerateContentBatch(
  request: Request<unknown, GenerateContentBatchResponse | ApiError, Partial<GenerateContentBatchRequest>>,
  response: Response<GenerateContentBatchResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  try {
    response.status(201).json(
      await generateContentBatch(request.auth, {
        businessId,
        lane: request.body?.lane ?? "social",
        primaryChannel: request.body?.primaryChannel ?? "linkedin",
        days: Number(request.body?.days ?? 0),
        title: request.body?.title?.trim(),
        prompt: request.body?.prompt?.trim() ?? "",
        tone: request.body?.tone?.trim(),
        length: request.body?.length?.trim(),
        audienceTimezone: request.body?.audienceTimezone?.trim(),
        defaultScheduledTime: request.body?.defaultScheduledTime?.trim(),
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "content_batch_generation_failed",
      message: "Unable to generate content batch.",
      logMessage: "Failed to generate content batch.",
    });
  }
}

export async function getContentBatchController(
  request: Request<{ batchId: string }, GetContentBatchResponse | ApiError, unknown, { businessId?: string }>,
  response: Response<GetContentBatchResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.query.businessId?.trim();
  const batchId = request.params.batchId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  if (!batchId) {
    sendApiError(response, 400, "bad_request", "batchId is required.");
    return;
  }

  try {
    response.json(await getContentBatch(request.auth, businessId, batchId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "content_batch_lookup_failed",
      message: "Unable to load content batch.",
      logMessage: "Failed to load content batch.",
    });
  }
}

export async function postConfirmContentBatch(
  request: Request<{ batchId: string }, ConfirmContentBatchResponse | ApiError, Partial<ConfirmContentBatchRequest>>,
  response: Response<ConfirmContentBatchResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const batchId = request.params.batchId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  if (!batchId) {
    sendApiError(response, 400, "bad_request", "batchId is required.");
    return;
  }

  try {
    response.json(
      await confirmContentBatch(request.auth, {
        businessId,
        batchId,
        startDate: request.body?.startDate?.trim() ?? "",
        defaultScheduledTime: request.body?.defaultScheduledTime?.trim() ?? "",
        audienceTimezone: request.body?.audienceTimezone?.trim(),
        spacing: request.body?.spacing,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "content_batch_confirm_failed",
      message: "Unable to confirm content batch.",
      logMessage: "Failed to confirm content batch.",
    });
  }
}

export async function postGenerateContentPlan(
  request: Request<unknown, GenerateContentPlanResponse | ApiError, Partial<GenerateContentPlanRequest>>,
  response: Response<GenerateContentPlanResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  try {
    response.status(201).json(
      await generateSocialContentPlan(request.auth, {
        businessId,
        duration: parsePlanDuration(request.body?.duration) ?? "7_days",
        goal: request.body?.goal?.trim() ?? "",
        platforms: parsePlanPlatforms(request.body?.platforms),
        title: request.body?.title?.trim(),
        tone: request.body?.tone?.trim(),
        audienceTimezone: request.body?.audienceTimezone?.trim(),
        defaultScheduledTime: request.body?.defaultScheduledTime?.trim(),
        startDate: request.body?.startDate?.trim(),
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "content_plan_generation_failed",
      message: "Unable to generate social content plan.",
      logMessage: "Failed to generate social content plan.",
    });
  }
}

export async function getContentPlanController(
  request: Request<{ batchId: string }, GetContentPlanResponse | ApiError, unknown, {
    businessId?: string;
    goal?: string;
    platforms?: string;
    startDate?: string;
    defaultScheduledTime?: string;
  }>,
  response: Response<GetContentPlanResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.query.businessId?.trim();
  const batchId = request.params.batchId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  if (!batchId) {
    sendApiError(response, 400, "bad_request", "batchId is required.");
    return;
  }

  try {
    response.json(
      await getSocialContentPlan(request.auth, {
        businessId,
        batchId,
        goal: request.query.goal?.trim(),
        platforms: parsePlanPlatforms(
          request.query.platforms?.split(",").map((value) => value.trim()).filter(Boolean),
        ),
        startDate: request.query.startDate?.trim(),
        defaultScheduledTime: request.query.defaultScheduledTime?.trim(),
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "content_plan_lookup_failed",
      message: "Unable to load social content plan.",
      logMessage: "Failed to load social content plan.",
    });
  }
}

export async function postApproveContentPlan(
  request: Request<{ batchId: string }, ApproveContentPlanResponse | ApiError, Partial<ApproveContentPlanRequest>>,
  response: Response<ApproveContentPlanResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const batchId = request.params.batchId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  if (!batchId) {
    sendApiError(response, 400, "bad_request", "batchId is required.");
    return;
  }

  try {
    response.json(
      await approveSocialContentPlan(request.auth, {
        businessId,
        batchId,
        startDate: request.body?.startDate?.trim() ?? "",
        defaultScheduledTime: request.body?.defaultScheduledTime?.trim() ?? "",
        audienceTimezone: request.body?.audienceTimezone?.trim(),
        spacing: request.body?.spacing,
        platforms: parsePlanPlatforms(request.body?.platforms),
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "content_plan_approve_failed",
      message: "Unable to approve social content plan.",
      logMessage: "Failed to approve social content plan.",
    });
  }
}
