import type {
  RevenueAgentActionRequest,
  RevenueAgentActionResponse,
  RevenueAgentFeedRequest,
  RevenueAgentFeedConfigUpdateRequest,
  RevenueAgentFeedConfigUpdateResponse,
  RevenueAgentFeedResponse,
  RevenueAgentReplyAnalysisRequest,
  RevenueAgentReplyAnalysisResponse,
  RevenueAgentResearchResponse,
  RevenueAgentWorkflowResponse,
  RevenueAgentWorkspaceResponse,
  GoogleCalendarDisconnectResponse,
  StartSocialAuthResponse,
} from "../../../packages/shared-types";
import { apiGet, apiGetText, apiPatch, apiPost } from "./api-client";

function businessQueryString(businessId: string): string {
  return `?businessId=${encodeURIComponent(businessId)}`;
}

export async function requestRevenueAgentWorkspace(
  businessId: string,
): Promise<RevenueAgentWorkspaceResponse> {
  return apiGet<RevenueAgentWorkspaceResponse>(`/revenue-agent${businessQueryString(businessId)}`);
}

export async function requestGoogleCalendarAuthStart(input: {
  businessId: string;
  returnPath?: string;
}): Promise<StartSocialAuthResponse> {
  return apiPost<
    {
      businessId: string;
      returnPath?: string;
    },
    StartSocialAuthResponse
  >("/google-calendar/start", {
    businessId: input.businessId,
    returnPath: input.returnPath,
  });
}

export async function requestDisconnectGoogleCalendar(input: {
  businessId: string;
}): Promise<GoogleCalendarDisconnectResponse> {
  return apiPost<{ businessId: string }, GoogleCalendarDisconnectResponse>("/google-calendar/disconnect", input);
}

export async function requestRevenueAgentFeedConfigUpdate(
  payload: RevenueAgentFeedConfigUpdateRequest,
): Promise<RevenueAgentFeedConfigUpdateResponse> {
  return apiPatch<RevenueAgentFeedConfigUpdateRequest, RevenueAgentFeedConfigUpdateResponse>(
    "/revenue-agent/feed-config",
    payload,
  );
}

export async function requestRevenueAgentFeed(
  payload: RevenueAgentFeedRequest,
): Promise<RevenueAgentFeedResponse> {
  return apiPost<RevenueAgentFeedRequest, RevenueAgentFeedResponse>("/revenue-agent/feed", payload);
}

export async function requestRevenueAgentAction(
  prospectId: string,
  payload: RevenueAgentActionRequest,
): Promise<RevenueAgentActionResponse> {
  const encodedProspectId = encodeURIComponent(prospectId);
  return apiPatch<RevenueAgentActionRequest, RevenueAgentActionResponse>(
    `/revenue-agent/prospects/${encodedProspectId}`,
    payload,
  );
}

export async function requestRevenueAgentResearchRegenerate(
  prospectId: string,
  payload: { businessId: string },
): Promise<RevenueAgentResearchResponse> {
  const encodedProspectId = encodeURIComponent(prospectId);
  return apiPost<{ businessId: string }, RevenueAgentResearchResponse>(
    `/revenue-agent/prospects/${encodedProspectId}/research`,
    payload,
  );
}

export async function requestRevenueAgentReplyAnalysis(
  prospectId: string,
  payload: RevenueAgentReplyAnalysisRequest,
): Promise<RevenueAgentReplyAnalysisResponse> {
  const encodedProspectId = encodeURIComponent(prospectId);
  return apiPost<RevenueAgentReplyAnalysisRequest, RevenueAgentReplyAnalysisResponse>(
    `/revenue-agent/prospects/${encodedProspectId}/reply-analysis`,
    payload,
  );
}

export async function requestRevenueAgentProspectExport(
  prospectId: string,
  businessId: string,
): Promise<string> {
  const encodedProspectId = encodeURIComponent(prospectId);
  return apiGetText(`/revenue-agent/prospects/${encodedProspectId}/export${businessQueryString(businessId)}`);
}

export async function requestRevenueAgentWorkflow(
  prospectId: string,
  businessId: string,
): Promise<RevenueAgentWorkflowResponse> {
  const encodedProspectId = encodeURIComponent(prospectId);
  return apiGet<RevenueAgentWorkflowResponse>(
    `/revenue-agent/prospects/${encodedProspectId}/workflow${businessQueryString(businessId)}`,
  );
}
