import type {
  ApiError,
  ConfirmContentBatchRequest,
  ConfirmContentBatchResponse,
  GenerateContentBatchRequest,
  GenerateContentBatchResponse,
  GetContentBatchResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  confirmContentBatch,
  generateContentBatch,
  getContentBatch,
} from "../services/contentOrchestrationService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

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
