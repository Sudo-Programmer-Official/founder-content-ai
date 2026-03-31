import type {
  BrandProfileResponse,
  CreateWorkspaceKnowledgeSourceRequest,
  CreateWorkspaceKnowledgeSourceResponse,
  RefreshWorkspaceKnowledgeRequest,
  RefreshWorkspaceKnowledgeResponse,
  UpdateBrandProfileRequest,
  UpdateBrandProfileResponse,
  WorkspaceKnowledgeResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPost } from "./api-client";

const API_ENDPOINTS = {
  brandProfile: "/brand-profile",
  updateBrandProfile: "/brand-profile/update",
  workspaceKnowledge: "/workspace-knowledge",
  refreshWorkspaceKnowledge: "/workspace-knowledge/refresh",
} as const;

export async function requestBrandProfile(
  businessId: string,
  options?: {
    refreshFromSignals?: boolean;
  },
): Promise<BrandProfileResponse> {
  const query = new URLSearchParams({
    businessId,
  });

  if (options?.refreshFromSignals) {
    query.set("refreshFromSignals", "true");
  }

  return apiGet<BrandProfileResponse>(`${API_ENDPOINTS.brandProfile}?${query.toString()}`);
}

export async function requestUpdateBrandProfile(
  input: UpdateBrandProfileRequest,
): Promise<UpdateBrandProfileResponse> {
  return apiPost<UpdateBrandProfileRequest, UpdateBrandProfileResponse>(
    API_ENDPOINTS.updateBrandProfile,
    input,
  );
}

export async function requestWorkspaceKnowledge(
  businessId: string,
): Promise<WorkspaceKnowledgeResponse> {
  const query = new URLSearchParams({
    businessId,
  });

  return apiGet<WorkspaceKnowledgeResponse>(`${API_ENDPOINTS.workspaceKnowledge}?${query.toString()}`);
}

export async function requestCreateWorkspaceKnowledgeSource(
  input: CreateWorkspaceKnowledgeSourceRequest,
): Promise<CreateWorkspaceKnowledgeSourceResponse> {
  return apiPost<CreateWorkspaceKnowledgeSourceRequest, CreateWorkspaceKnowledgeSourceResponse>(
    API_ENDPOINTS.workspaceKnowledge,
    input,
  );
}

export async function requestRefreshWorkspaceKnowledge(
  input: RefreshWorkspaceKnowledgeRequest,
): Promise<RefreshWorkspaceKnowledgeResponse> {
  return apiPost<RefreshWorkspaceKnowledgeRequest, RefreshWorkspaceKnowledgeResponse>(
    API_ENDPOINTS.refreshWorkspaceKnowledge,
    input,
  );
}
