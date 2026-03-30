import type {
  PreviewContentAiEditResponse,
  ControlDashboardResponse,
  ConvertIdeaToContentResponse,
  CreateIdeaInboxResponse,
  GetContentPipelineItemResponse,
  UpdateContentPipelineItemResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPatch, apiPost } from "./api-client";

export async function requestControlDashboard(
  businessId: string,
): Promise<ControlDashboardResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<ControlDashboardResponse>(`/control-dashboard?businessId=${encodedBusinessId}`);
}

export async function requestCreateIdeaInboxItem(input: {
  businessId: string;
  text: string;
}): Promise<CreateIdeaInboxResponse> {
  return apiPost<typeof input, CreateIdeaInboxResponse>("/idea-inbox", input);
}

export async function requestConvertIdeaToContent(input: {
  businessId: string;
  ideaId: string;
  tone?: string;
  length?: string;
}): Promise<ConvertIdeaToContentResponse> {
  return apiPost<
    { businessId: string; tone?: string; length?: string },
    ConvertIdeaToContentResponse
  >(`/idea-inbox/${encodeURIComponent(input.ideaId)}/convert`, {
    businessId: input.businessId,
    tone: input.tone,
    length: input.length,
  });
}

export async function requestUpdatePipelineItem(input: {
  businessId: string;
  assetId: string;
  title?: string;
  textContent?: string;
  status?: "draft" | "review" | "scheduled" | "posted";
}): Promise<UpdateContentPipelineItemResponse> {
  return apiPatch<
    {
      businessId: string;
      title?: string;
      textContent?: string;
      status?: "draft" | "review" | "scheduled" | "posted";
    },
    UpdateContentPipelineItemResponse
  >(`/content-pipeline/${encodeURIComponent(input.assetId)}`, {
    businessId: input.businessId,
    title: input.title,
    textContent: input.textContent,
    status: input.status,
  });
}

export async function requestPipelineItem(
  businessId: string,
  assetId: string,
): Promise<GetContentPipelineItemResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedAssetId = encodeURIComponent(assetId);
  return apiGet<GetContentPipelineItemResponse>(
    `/content-pipeline/${encodedAssetId}?businessId=${encodedBusinessId}`,
  );
}

export async function requestContentAiEditPreview(input: {
  businessId: string;
  assetId?: string;
  textContent?: string;
  instruction: string;
}): Promise<PreviewContentAiEditResponse> {
  return apiPost<typeof input, PreviewContentAiEditResponse>("/content-ai-edit-preview", input, {
    timeoutMs: 30000,
  });
}
