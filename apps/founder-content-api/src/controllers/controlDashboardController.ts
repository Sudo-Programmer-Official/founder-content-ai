import type {
  ApiError,
  ControlDashboardQuery,
  ControlDashboardResponse,
  ConvertIdeaToContentRequest,
  ConvertIdeaToContentResponse,
  CreateIdeaInboxRequest,
  CreateIdeaInboxResponse,
  GetContentPipelineItemQuery,
  GetContentPipelineItemResponse,
  PreviewContentAiEditRequest,
  PreviewContentAiEditResponse,
  UpdateContentPipelineItemRequest,
  UpdateContentPipelineItemResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  convertIdeaInboxItemToContent,
  createIdeaInboxItem,
  getContentPipelineItem,
  getControlDashboard,
  previewContentPipelineAiEdit,
  updateContentPipelineItem,
} from "../services/controlDashboardService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

export async function getDashboardLoop(
  request: Request<unknown, ControlDashboardResponse | ApiError, unknown, Partial<ControlDashboardQuery>>,
  response: Response<ControlDashboardResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.query.businessId?.trim();

  if (!businessId) {
    sendApiError(response, 400, "bad_request", "businessId is required.");
    return;
  }

  try {
    response.json(await getControlDashboard(request.auth, businessId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "control_dashboard_failed",
      message: "Unable to load the control dashboard.",
      logMessage: "Failed to load control dashboard.",
    });
  }
}

export async function createIdeaInboxEntry(
  request: Request<unknown, CreateIdeaInboxResponse | ApiError, Partial<CreateIdeaInboxRequest>>,
  response: Response<CreateIdeaInboxResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const text = request.body?.text?.trim();

  if (!businessId || !text) {
    sendApiError(response, 400, "bad_request", "businessId and text are required.");
    return;
  }

  try {
    response.status(201).json(
      await createIdeaInboxItem(request.auth, {
        businessId,
        text,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "idea_inbox_create_failed",
      message: "Unable to save the idea.",
      logMessage: "Failed to create idea inbox item.",
    });
  }
}

export async function convertIdeaInboxEntry(
  request: Request<{ ideaId: string }, ConvertIdeaToContentResponse | ApiError, Partial<ConvertIdeaToContentRequest & { businessId: string }>>,
  response: Response<ConvertIdeaToContentResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const ideaId = request.params.ideaId?.trim();

  if (!businessId || !ideaId) {
    sendApiError(response, 400, "bad_request", "businessId and ideaId are required.");
    return;
  }

  try {
    response.status(201).json(
      await convertIdeaInboxItemToContent(request.auth, businessId, ideaId, {
        tone: request.body?.tone,
        length: request.body?.length,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "idea_convert_failed",
      message: "Unable to convert the idea into content.",
      logMessage: "Failed to convert idea inbox item.",
    });
  }
}

export async function updatePipelineItem(
  request: Request<{ assetId: string }, UpdateContentPipelineItemResponse | ApiError, Partial<UpdateContentPipelineItemRequest & { businessId: string }>>,
  response: Response<UpdateContentPipelineItemResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const assetId = request.params.assetId?.trim();

  if (!businessId || !assetId) {
    sendApiError(response, 400, "bad_request", "businessId and assetId are required.");
    return;
  }

  try {
    response.json(
      await updateContentPipelineItem(request.auth, businessId, assetId, {
        title: request.body?.title,
        textContent: request.body?.textContent,
        status: request.body?.status,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "pipeline_update_failed",
      message: "Unable to update the pipeline item.",
      logMessage: "Failed to update pipeline item.",
    });
  }
}

export async function getPipelineItem(
  request: Request<{ assetId: string }, GetContentPipelineItemResponse | ApiError, unknown, Partial<GetContentPipelineItemQuery>>,
  response: Response<GetContentPipelineItemResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.query.businessId?.trim();
  const assetId = request.params.assetId?.trim();

  if (!businessId || !assetId) {
    sendApiError(response, 400, "bad_request", "businessId and assetId are required.");
    return;
  }

  try {
    response.json(await getContentPipelineItem(request.auth, businessId, assetId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "pipeline_item_lookup_failed",
      message: "Unable to load the pipeline item.",
      logMessage: "Failed to load pipeline item.",
    });
  }
}

export async function previewPipelineAiEdit(
  request: Request<unknown, PreviewContentAiEditResponse | ApiError, Partial<PreviewContentAiEditRequest>>,
  response: Response<PreviewContentAiEditResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const instruction = request.body?.instruction?.trim();

  if (!businessId || !instruction) {
    sendApiError(response, 400, "bad_request", "businessId and instruction are required.");
    return;
  }

  try {
    response.json(
      await previewContentPipelineAiEdit(request.auth, {
        businessId,
        assetId: request.body?.assetId,
        textContent: request.body?.textContent,
        instruction,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "pipeline_ai_edit_preview_failed",
      message: "Unable to preview AI edits right now.",
      logMessage: "Failed to preview AI edit for pipeline content.",
    });
  }
}
