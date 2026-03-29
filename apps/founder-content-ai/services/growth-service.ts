import type {
  CreateGrowthLeadRequest,
  CreateGrowthLeadResponse,
  GrowthAutomationFlowListResponse,
  GrowthLeadEventListResponse,
  GrowthLeadListResponse,
  GrowthLeadStatus,
  UpdateGrowthLeadStatusRequest,
  UpdateGrowthLeadStatusResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPatch, apiPost } from "./api-client";

export async function requestGrowthLeads(businessId: string): Promise<GrowthLeadListResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<GrowthLeadListResponse>(`/growth/leads?businessId=${encodedBusinessId}`);
}

export async function requestGrowthLeadEvents(
  businessId: string,
  leadId: string,
): Promise<GrowthLeadEventListResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedLeadId = encodeURIComponent(leadId);
  return apiGet<GrowthLeadEventListResponse>(
    `/growth/leads/${encodedLeadId}/events?businessId=${encodedBusinessId}`,
  );
}

export async function requestGrowthFlows(
  businessId: string,
): Promise<GrowthAutomationFlowListResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<GrowthAutomationFlowListResponse>(`/growth/flows?businessId=${encodedBusinessId}`);
}

export async function requestCreateGrowthLead(
  payload: CreateGrowthLeadRequest,
): Promise<CreateGrowthLeadResponse> {
  return apiPost<CreateGrowthLeadRequest, CreateGrowthLeadResponse>("/growth/leads", payload);
}

export async function requestUpdateGrowthLeadStatus(
  leadId: string,
  payload: UpdateGrowthLeadStatusRequest,
): Promise<UpdateGrowthLeadStatusResponse> {
  const encodedLeadId = encodeURIComponent(leadId);
  return apiPatch<UpdateGrowthLeadStatusRequest, UpdateGrowthLeadStatusResponse>(
    `/growth/leads/${encodedLeadId}/status`,
    payload,
  );
}

export const growthLeadStatusOptions: GrowthLeadStatus[] = [
  "new",
  "engaged",
  "trial",
  "converted",
  "churned",
];
