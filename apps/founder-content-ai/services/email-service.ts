import type {
  CreateEmailCampaignRequest,
  CreateEmailCampaignResponse,
  CreateEmailDomainRequest,
  CreateEmailDomainResponse,
  DeleteEmailCampaignResponse,
  DeleteEmailContactResponse,
  EmailCampaignListResponse,
  EmailCampaignStatsResponse,
  EmailContactImportJobListResponse,
  EmailContactImportJobResponse,
  EmailContactListResponse,
  EmailContactStatus,
  EmailDomainSettingsResponse,
  EmailListListResponse,
  ImportEmailContactsRequest,
  ImportEmailContactsPreviewRequest,
  ImportEmailContactsPreviewResponse,
  ImportEmailContactsResponse,
  QueueEmailContactsImportRequest,
  QueueEmailContactsImportResponse,
  SendEmailCampaignResponse,
  UpdateEmailContactRequest,
  UpdateEmailContactResponse,
  UpdateEmailCampaignRequest,
  UpdateEmailCampaignResponse,
  VerifyEmailDomainResponse,
} from "../../../packages/shared-types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api-client";

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

export async function requestEmailContactsImportJobCreate(
  businessId: string,
  payload: QueueEmailContactsImportRequest,
): Promise<QueueEmailContactsImportResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiPost<QueueEmailContactsImportRequest, QueueEmailContactsImportResponse>(
    `/businesses/${encodedBusinessId}/email/import-jobs`,
    payload,
  );
}

export async function requestEmailContactImportJobs(
  businessId: string,
): Promise<EmailContactImportJobListResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<EmailContactImportJobListResponse>(`/businesses/${encodedBusinessId}/email/import-jobs`);
}

export async function requestEmailContactImportJob(
  businessId: string,
  jobId: string,
): Promise<EmailContactImportJobResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedJobId = encodeURIComponent(jobId);
  return apiGet<EmailContactImportJobResponse>(
    `/businesses/${encodedBusinessId}/email/import-jobs/${encodedJobId}`,
  );
}

export async function requestEmailContacts(
  businessId: string,
  options: {
    search?: string;
    status?: EmailContactStatus;
    listId?: string;
    attributeFilters?: Record<string, string>;
    limit?: number;
  } = {},
): Promise<EmailContactListResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const params = new URLSearchParams();

  if (options.search?.trim()) {
    params.set("search", options.search.trim());
  }

  if (options.status) {
    params.set("status", options.status);
  }

  if (options.listId) {
    params.set("listId", options.listId);
  }

  if (options.attributeFilters) {
    for (const [key, value] of Object.entries(options.attributeFilters)) {
      const normalizedKey = key.trim();
      const normalizedValue = value.trim();

      if (!normalizedKey || !normalizedValue) {
        continue;
      }

      params.set(`attribute.${normalizedKey}`, normalizedValue);
    }
  }

  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }

  const query = params.toString();
  return apiGet<EmailContactListResponse>(
    `/businesses/${encodedBusinessId}/email/contacts${query ? `?${query}` : ""}`,
  );
}

export async function requestEmailContactUpdate(
  businessId: string,
  contactId: string,
  payload: UpdateEmailContactRequest,
): Promise<UpdateEmailContactResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedContactId = encodeURIComponent(contactId);
  return apiPatch<UpdateEmailContactRequest, UpdateEmailContactResponse>(
    `/businesses/${encodedBusinessId}/email/contacts/${encodedContactId}`,
    payload,
  );
}

export async function requestEmailContactDelete(
  businessId: string,
  contactId: string,
): Promise<DeleteEmailContactResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedContactId = encodeURIComponent(contactId);
  return apiDelete<DeleteEmailContactResponse>(
    `/businesses/${encodedBusinessId}/email/contacts/${encodedContactId}`,
  );
}

export async function requestEmailContactsImportPreview(
  businessId: string,
  payload: ImportEmailContactsPreviewRequest,
): Promise<ImportEmailContactsPreviewResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiPost<ImportEmailContactsPreviewRequest, ImportEmailContactsPreviewResponse>(
    `/businesses/${encodedBusinessId}/email/contacts/import/preview`,
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

export async function requestEmailCampaignUpdate(
  businessId: string,
  campaignId: string,
  payload: UpdateEmailCampaignRequest,
): Promise<UpdateEmailCampaignResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedCampaignId = encodeURIComponent(campaignId);
  return apiPatch<UpdateEmailCampaignRequest, UpdateEmailCampaignResponse>(
    `/businesses/${encodedBusinessId}/email/campaigns/${encodedCampaignId}`,
    payload,
  );
}

export async function requestEmailCampaignDelete(
  businessId: string,
  campaignId: string,
): Promise<DeleteEmailCampaignResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const encodedCampaignId = encodeURIComponent(campaignId);
  return apiDelete<DeleteEmailCampaignResponse>(
    `/businesses/${encodedBusinessId}/email/campaigns/${encodedCampaignId}`,
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
