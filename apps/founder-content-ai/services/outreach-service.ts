import type {
  CreateOutreachMessageRequest,
  CreateOutreachMessageResponse,
  ImportOutreachLeadsRequest,
  ImportOutreachLeadsResponse,
  OutreachLeadFilters,
  OutreachLeadHistoryResponse,
  OutreachLeadListResponse,
  OutreachMessageDraftRequest,
  OutreachMessageDraftResponse,
  OutreachOverviewResponse,
  OutreachReplyDraftRequest,
  OutreachReplyDraftResponse,
  UpdateOutreachLeadStatusRequest,
  UpdateOutreachLeadStatusResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPatch, apiPost } from "./api-client";

function toQueryString(filters: OutreachLeadFilters): string {
  const params = new URLSearchParams();

  if (filters.platform && filters.platform !== "all") {
    params.set("platform", filters.platform);
  }

  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status);
  }

  if (filters.priority && filters.priority !== "all") {
    params.set("priority", filters.priority);
  }

  if (filters.queue) {
    params.set("queue", filters.queue);
  }

  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export async function requestOutreachOverview(): Promise<OutreachOverviewResponse> {
  return apiGet<OutreachOverviewResponse>("/admin/outreach/overview");
}

export async function requestOutreachLeads(
  filters: OutreachLeadFilters,
): Promise<OutreachLeadListResponse> {
  return apiGet<OutreachLeadListResponse>(`/admin/outreach/leads${toQueryString(filters)}`);
}

export async function requestOutreachMessageDraft(
  payload: OutreachMessageDraftRequest,
): Promise<OutreachMessageDraftResponse> {
  return apiPost<OutreachMessageDraftRequest, OutreachMessageDraftResponse>(
    "/admin/outreach/message-draft",
    payload,
  );
}

export async function requestOutreachFollowupDraft(
  payload: OutreachMessageDraftRequest,
): Promise<OutreachMessageDraftResponse> {
  return apiPost<OutreachMessageDraftRequest, OutreachMessageDraftResponse>(
    "/admin/outreach/followup-draft",
    payload,
  );
}

export async function requestOutreachReplyDraft(
  payload: OutreachReplyDraftRequest,
): Promise<OutreachReplyDraftResponse> {
  return apiPost<OutreachReplyDraftRequest, OutreachReplyDraftResponse>(
    "/admin/outreach/reply-draft",
    payload,
  );
}

export async function requestOutreachLeadStatusUpdate(
  leadId: string,
  payload: UpdateOutreachLeadStatusRequest,
): Promise<UpdateOutreachLeadStatusResponse> {
  const encodedLeadId = encodeURIComponent(leadId);
  return apiPatch<UpdateOutreachLeadStatusRequest, UpdateOutreachLeadStatusResponse>(
    `/admin/outreach/leads/${encodedLeadId}/status`,
    payload,
  );
}

export async function requestWorkspaceOutreachLeads(
  filters: OutreachLeadFilters,
): Promise<OutreachLeadListResponse> {
  const params = new URLSearchParams();

  if (filters.businessId) {
    params.set("businessId", filters.businessId);
  }

  if (filters.platform && filters.platform !== "all") {
    params.set("platform", filters.platform);
  }

  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status);
  }

  if (filters.priority && filters.priority !== "all") {
    params.set("priority", filters.priority);
  }

  if (filters.queue) {
    params.set("queue", filters.queue);
  }

  return apiGet<OutreachLeadListResponse>(`/outreach/leads?${params.toString()}`);
}

export async function requestWorkspaceOutreachLeadImport(
  payload: ImportOutreachLeadsRequest,
): Promise<ImportOutreachLeadsResponse> {
  return apiPost<ImportOutreachLeadsRequest, ImportOutreachLeadsResponse>(
    "/outreach/leads/import",
    payload,
  );
}

export async function requestWorkspaceOutreachMessageCreate(
  payload: CreateOutreachMessageRequest,
): Promise<CreateOutreachMessageResponse> {
  return apiPost<CreateOutreachMessageRequest, CreateOutreachMessageResponse>(
    "/outreach/messages",
    payload,
  );
}

export async function requestWorkspaceOutreachLeadHistory(
  leadId: string,
  businessId: string,
): Promise<OutreachLeadHistoryResponse> {
  const encodedLeadId = encodeURIComponent(leadId);
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<OutreachLeadHistoryResponse>(
    `/outreach/leads/${encodedLeadId}/history?businessId=${encodedBusinessId}`,
  );
}
