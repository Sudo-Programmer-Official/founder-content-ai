import type {
  ReelProjectListResponse,
  ReelProjectResponse,
  ReelProjectSettings,
  ReelSceneRegenerateRequest,
  ReelStoryboard,
  ReelStoryboardCreateRequest,
  ReelStoryboardUpdateRequest,
  ReelYouTubeConnection,
  ReelYouTubePublishRequest,
  ReelYouTubePublishResponse,
  ReelYouTubeVisibility,
  ReelWorkflowActionRequest,
} from "../../../packages/shared-types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api-client";

// Storyboard generation can take a couple of LLM round-trips.
const STORYBOARD_TIMEOUT_MS = 90_000;

function businessQueryString(businessId: string): string {
  return `?businessId=${encodeURIComponent(businessId)}`;
}

function projectPath(projectId: string): string {
  return `/reel-studio/projects/${encodeURIComponent(projectId)}`;
}

export async function requestReelProjects(businessId: string): Promise<ReelProjectListResponse> {
  return apiGet<ReelProjectListResponse>(`/reel-studio/projects${businessQueryString(businessId)}`);
}

export async function requestReelProject(businessId: string, projectId: string): Promise<ReelProjectResponse> {
  return apiGet<ReelProjectResponse>(`${projectPath(projectId)}${businessQueryString(businessId)}`);
}

export async function requestReelStoryboard(payload: ReelStoryboardCreateRequest): Promise<ReelProjectResponse> {
  return apiPost<ReelStoryboardCreateRequest, ReelProjectResponse>("/reel-studio/projects", payload, {
    timeoutMs: STORYBOARD_TIMEOUT_MS,
  });
}

export async function requestReelStoryboardUpdate(
  projectId: string,
  input: { businessId: string; storyboard: ReelStoryboard; settings?: Partial<ReelProjectSettings> },
): Promise<ReelProjectResponse> {
  return apiPatch<ReelStoryboardUpdateRequest, ReelProjectResponse>(projectPath(projectId), input);
}

export async function requestReelSceneRegenerate(
  projectId: string,
  sceneId: string,
  payload: ReelSceneRegenerateRequest,
): Promise<ReelProjectResponse> {
  return apiPost<ReelSceneRegenerateRequest, ReelProjectResponse>(
    `${projectPath(projectId)}/scenes/${encodeURIComponent(sceneId)}/regenerate`,
    payload,
    { timeoutMs: STORYBOARD_TIMEOUT_MS },
  );
}

export async function requestReelRender(businessId: string, projectId: string): Promise<ReelProjectResponse> {
  return apiPost<{ businessId: string }, ReelProjectResponse>(`${projectPath(projectId)}/render`, { businessId });
}

export async function requestReelApproval(
  projectId: string,
  input: ReelWorkflowActionRequest,
): Promise<ReelProjectResponse> {
  return apiPost<ReelWorkflowActionRequest, ReelProjectResponse>(`${projectPath(projectId)}/approve`, input);
}

export async function requestReelReview(
  projectId: string,
  input: ReelWorkflowActionRequest,
): Promise<ReelProjectResponse> {
  return apiPost<ReelWorkflowActionRequest, ReelProjectResponse>(`${projectPath(projectId)}/review`, input);
}

export async function requestReelYouTubeConnection(businessId: string): Promise<ReelYouTubeConnection> {
  return apiGet<ReelYouTubeConnection>(`/reel-studio/youtube/status${businessQueryString(businessId)}`);
}

export async function requestReelYouTubeAuth(input: {
  businessId: string;
  returnPath?: string;
}): Promise<{ authorizationUrl: string }> {
  return apiPost<typeof input, { authorizationUrl: string }>("/reel-studio/youtube/start", input);
}

export async function requestReelYouTubePublish(
  projectId: string,
  input: { businessId: string; visibility: ReelYouTubeVisibility },
): Promise<ReelYouTubePublishResponse> {
  return apiPost<ReelYouTubePublishRequest, ReelYouTubePublishResponse>(
    `${projectPath(projectId)}/youtube/publish`,
    input,
  );
}

export async function requestReelProjectDelete(businessId: string, projectId: string): Promise<void> {
  await apiDelete<{ deleted: true }>(`${projectPath(projectId)}${businessQueryString(businessId)}`);
}
