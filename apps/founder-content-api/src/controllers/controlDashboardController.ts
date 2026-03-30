import type {
  ApiError,
  ControlDashboardQuery,
  ControlDashboardResponse,
  ConvertIdeaToContentRequest,
  ConvertIdeaToContentResponse,
  CreateContentPipelineItemRequest,
  CreateContentPipelineItemResponse,
  DeleteContentPipelineItemResponse,
  DuplicateContentPipelineItemResponse,
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
  createContentPipelineItem,
  createIdeaInboxItem,
  deleteContentPipelineItem,
  duplicateContentPipelineItem,
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
  const rawInput = request.body?.rawInput?.trim();
  const processedText = request.body?.processedText?.trim();

  if (!businessId || (!text && !rawInput && !processedText)) {
    sendApiError(
      response,
      400,
      "bad_request",
      "businessId and at least one capture input are required.",
    );
    return;
  }

  try {
    response.status(201).json(
      await createIdeaInboxItem(request.auth, {
        businessId,
        text,
        inputType: request.body?.inputType,
        rawInput,
        processedText,
        metadata: request.body?.metadata,
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

export async function createPipelineItem(
  request: Request<unknown, CreateContentPipelineItemResponse | ApiError, Partial<CreateContentPipelineItemRequest>>,
  response: Response<CreateContentPipelineItemResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const textContent = request.body?.textContent?.trim();

  if (!businessId || !textContent) {
    sendApiError(response, 400, "bad_request", "businessId and textContent are required.");
    return;
  }

  try {
    response.status(201).json(
      await createContentPipelineItem(request.auth, {
        businessId,
        title: request.body?.title,
        textContent,
        contentBody: request.body?.contentBody,
        sourceKind: request.body?.sourceKind,
      }),
    );
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "pipeline_create_failed",
      message: "Unable to save this draft to the workspace.",
      logMessage: "Failed to create pipeline item.",
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

export async function duplicatePipelineItem(
  request: Request<{ assetId: string }, DuplicateContentPipelineItemResponse | ApiError, Partial<{ businessId: string }>>,
  response: Response<DuplicateContentPipelineItemResponse | ApiError>,
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
    response.status(201).json(await duplicateContentPipelineItem(request.auth, businessId, assetId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "pipeline_duplicate_failed",
      message: "Unable to duplicate the pipeline item.",
      logMessage: "Failed to duplicate pipeline item.",
    });
  }
}

export async function deletePipelineItem(
  request: Request<{ assetId: string }, DeleteContentPipelineItemResponse | ApiError, unknown, Partial<{ businessId: string }>>,
  response: Response<DeleteContentPipelineItemResponse | ApiError>,
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
    response.json(await deleteContentPipelineItem(request.auth, businessId, assetId));
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "pipeline_delete_failed",
      message: "Unable to delete the pipeline item.",
      logMessage: "Failed to delete pipeline item.",
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
