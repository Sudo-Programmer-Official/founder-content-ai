import type {
  BusinessGenerationRequest,
  BusinessGenerationResponse,
  CaptureContentRequest,
  CaptureContentResponse,
  GenerateVisualRequest,
  GenerateVisualResponse,
  HookGenerationRequest,
  HookGenerationResponse,
  IdeaGenerationRequest,
  IdeaGenerationResponse,
  LinkedInPostGenerationRequest,
  LinkedInPostGenerationResponse,
  PreviewContentIngestionRequest,
  PreviewContentIngestionResponse,
  ListSavedContentSourcesResponse,
  RepurposeContentRequest,
  RepurposeContentResponse,
  RemixContentRequest,
  RemixContentResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPost } from "./api-client";

const API_ENDPOINTS = {
  capture: "/capture",
  ideas: "/generate-ideas",
  hook: "/generate-hook",
  ingestPreview: "/content/ingest-preview",
  ingestSources: "/content/sources",
  post: "/generate-post",
  repurpose: "/repurpose",
  visual: "/generate-visual",
  remix: "/remix",
  businessGenerate: "/business/generate",
} as const;

export async function requestIdeaGeneration(
  input: IdeaGenerationRequest,
): Promise<IdeaGenerationResponse> {
  return apiPost<IdeaGenerationRequest, IdeaGenerationResponse>(API_ENDPOINTS.ideas, input);
}

export async function requestHookGeneration(
  input: HookGenerationRequest,
): Promise<HookGenerationResponse> {
  return apiPost<HookGenerationRequest, HookGenerationResponse>(API_ENDPOINTS.hook, input);
}

export async function requestLinkedInPostGeneration(
  input: LinkedInPostGenerationRequest,
): Promise<LinkedInPostGenerationResponse> {
  return apiPost<LinkedInPostGenerationRequest, LinkedInPostGenerationResponse>(
    API_ENDPOINTS.post,
    input,
  );
}

export async function requestCaptureContent(
  input: CaptureContentRequest,
): Promise<CaptureContentResponse> {
  return apiPost<CaptureContentRequest, CaptureContentResponse>(API_ENDPOINTS.capture, input);
}

export async function requestVisualGeneration(
  input: GenerateVisualRequest,
): Promise<GenerateVisualResponse> {
  return apiPost<GenerateVisualRequest, GenerateVisualResponse>(API_ENDPOINTS.visual, input);
}

export async function requestRepurposeContent(
  input: RepurposeContentRequest,
): Promise<RepurposeContentResponse> {
  return apiPost<RepurposeContentRequest, RepurposeContentResponse>(API_ENDPOINTS.repurpose, input);
}

export async function requestContentIngestionPreview(
  input: PreviewContentIngestionRequest,
): Promise<PreviewContentIngestionResponse> {
  return apiPost<PreviewContentIngestionRequest, PreviewContentIngestionResponse>(
    API_ENDPOINTS.ingestPreview,
    input,
  );
}

export async function requestSavedContentSources(
  businessId: string,
): Promise<ListSavedContentSourcesResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<ListSavedContentSourcesResponse>(`${API_ENDPOINTS.ingestSources}?businessId=${encodedBusinessId}`);
}

export async function requestRemixContent(
  input: RemixContentRequest,
): Promise<RemixContentResponse> {
  return apiPost<RemixContentRequest, RemixContentResponse>(API_ENDPOINTS.remix, input);
}

export async function requestBusinessGeneration(
  input: BusinessGenerationRequest,
): Promise<BusinessGenerationResponse> {
  return apiPost<BusinessGenerationRequest, BusinessGenerationResponse>(
    API_ENDPOINTS.businessGenerate,
    input,
  );
}
