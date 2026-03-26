import type {
  CreateEmailCampaignRequest,
  CreateEmailCampaignResponse,
  CreateEmailDomainRequest,
  CreateEmailDomainResponse,
  EmailCampaignListResponse,
  EmailCampaignStatsResponse,
  EmailDomainSettingsResponse,
  EmailListListResponse,
  ImportEmailContactsRequest,
  ImportEmailContactsResponse,
  SendEmailCampaignResponse,
  VerifyEmailDomainResponse,
} from "../../../packages/shared-types";
import { apiGet, apiPost } from "./api-client";

export async function requestEmailLists(businessId: string): Promise<EmailListListResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<EmailListListResponse>(`/businesses/${encodedBusinessId}/email/lists`);
}

export async function requestEmailContactsImport(
  businessId: string,
  payload: ImportEmailContactsRequest,
): Promise<ImportEmailContactsResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiPost<ImportEmailContactsRequest, ImportEmailContactsResponse>(
    `/businesses/${encodedBusinessId}/email/contacts/import`,
    payload,
  );
}

export async function requestEmailCampaignCreate(
  businessId: string,
  payload: CreateEmailCampaignRequest,
): Promise<CreateEmailCampaignResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiPost<CreateEmailCampaignRequest, CreateEmailCampaignResponse>(
    `/businesses/${encodedBusinessId}/email/campaigns`,
    payload,
  );
}

export async function requestEmailCampaignSend(
  businessId: string,
  campaignId: string,
): Promise<SendEmailCampaignResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedCampaignId = encodeURIComponent(campaignId);
  return apiPost<{ businessId: string }, SendEmailCampaignResponse>(
    `/businesses/${encodedBusinessId}/email/campaigns/${encodedCampaignId}/send`,
    { businessId },
  );
}

export async function requestEmailCampaigns(
  businessId: string,
): Promise<EmailCampaignListResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<EmailCampaignListResponse>(`/businesses/${encodedBusinessId}/email/campaigns`);
}

export async function requestEmailCampaignStats(
  businessId: string,
  campaignId: string,
): Promise<EmailCampaignStatsResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedCampaignId = encodeURIComponent(campaignId);
  return apiGet<EmailCampaignStatsResponse>(
    `/businesses/${encodedBusinessId}/email/campaigns/${encodedCampaignId}/stats`,
  );
}

export async function requestEmailDomainCreate(
  businessId: string,
  payload: CreateEmailDomainRequest,
): Promise<CreateEmailDomainResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiPost<CreateEmailDomainRequest, CreateEmailDomainResponse>(
    `/businesses/${encodedBusinessId}/email/domains`,
    payload,
  );
}

export async function requestEmailDomainSettings(
  businessId: string,
): Promise<EmailDomainSettingsResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<EmailDomainSettingsResponse>(`/businesses/${encodedBusinessId}/email/settings`);
}

export async function requestEmailDomainVerify(
  businessId: string,
  domainId: string,
): Promise<VerifyEmailDomainResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedDomainId = encodeURIComponent(domainId);
  return apiPost<Record<string, never>, VerifyEmailDomainResponse>(
    `/businesses/${encodedBusinessId}/email/domains/${encodedDomainId}/verify`,
    {},
  );
}
