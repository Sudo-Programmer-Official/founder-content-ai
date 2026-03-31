import type {
  MediaRecommendationsRequest,
  MediaRecommendationsResponse,
  RecordMediaPerformanceStatRequest,
  RecordMediaPerformanceStatResponse,
  UpdateBusinessMediaProfileRequest,
  UpdateBusinessMediaProfileResponse,
  UpdateWorkspaceMediaOverrideRequest,
  UpdateWorkspaceMediaOverrideResponse,
  WorkspaceMediaResolutionRequest,
  WorkspaceMediaResolutionResponse,
  WorkspaceMediaIntelligenceResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPatch, apiPost } from "./api-client";

const API_ENDPOINTS = {
  intelligence: "/media-intelligence",
  profile: "/media-intelligence/profile",
  overrides: "/media-intelligence/overrides",
  resolve: "/media-intelligence/resolve",
  recommendations: "/media-intelligence/recommendations",
  performance: "/media-intelligence/performance",
} as const;

export async function requestWorkspaceMediaIntelligence(
  businessId: string,
): Promise<WorkspaceMediaIntelligenceResponse> {
  return apiGet<WorkspaceMediaIntelligenceResponse>(
    `${API_ENDPOINTS.intelligence}?businessId=${encodeURIComponent(businessId)}`,
  );
}

export async function requestUpdateBusinessMediaProfile(
  input: UpdateBusinessMediaProfileRequest,
): Promise<UpdateBusinessMediaProfileResponse> {
  return apiPatch<UpdateBusinessMediaProfileRequest, UpdateBusinessMediaProfileResponse>(
    API_ENDPOINTS.profile,
    input,
  );
}

export async function requestUpdateWorkspaceMediaOverride(
  input: UpdateWorkspaceMediaOverrideRequest,
): Promise<UpdateWorkspaceMediaOverrideResponse> {
  return apiPost<UpdateWorkspaceMediaOverrideRequest, UpdateWorkspaceMediaOverrideResponse>(
    API_ENDPOINTS.overrides,
    input,
  );
}

export async function requestWorkspaceMediaResolution(
  input: WorkspaceMediaResolutionRequest,
): Promise<WorkspaceMediaResolutionResponse> {
  return apiPost<WorkspaceMediaResolutionRequest, WorkspaceMediaResolutionResponse>(
    API_ENDPOINTS.resolve,
    input,
  );
}

export async function requestMediaRecommendations(
  input: MediaRecommendationsRequest,
): Promise<MediaRecommendationsResponse> {
  return apiPost<MediaRecommendationsRequest, MediaRecommendationsResponse>(
    API_ENDPOINTS.recommendations,
    input,
  );
}

export async function requestRecordMediaPerformanceStat(
  input: RecordMediaPerformanceStatRequest,
): Promise<RecordMediaPerformanceStatResponse> {
  return apiPost<RecordMediaPerformanceStatRequest, RecordMediaPerformanceStatResponse>(
    API_ENDPOINTS.performance,
    input,
  );
}
