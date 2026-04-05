import type {
  ApiError,
  CreateEmailCampaignRequest,
  CreateEmailCampaignResponse,
  CreateEmailDomainRequest,
  CreateEmailDomainResponse,
  DeleteEmailCampaignResponse,
  DeleteEmailContactResponse,
  EmailCampaignListResponse,
  EmailCampaignStatsResponse,
  EmailContactListResponse,
  EmailContactStatus,
  EmailDomainSettingsResponse,
  EmailContactImportJobListResponse,
  EmailContactImportJobResponse,
  EmailListListResponse,
  ImportEmailContactsRequest,
  ImportEmailContactsPreviewRequest,
  ImportEmailContactsPreviewResponse,
  ImportEmailContactsResponse,
  QueueEmailContactsImportRequest,
  QueueEmailContactsImportResponse,
  SendEmailCampaignResponse,
  UnsubscribeEmailResponse,
  UpdateEmailContactRequest,
  UpdateEmailContactResponse,
  UpdateEmailCampaignRequest,
  UpdateEmailCampaignResponse,
  VerifyEmailDomainResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { ensureCurrentUser } from "../services/authBusinessService.ts";
import { enforceWorkspaceReadAccess, enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import {
  createEmailCampaign,
  deleteEmailCampaign,
  deleteEmailContact,
  createEmailDomain,
  getEmailContactImportJob,
  getEmailDomainSettings,
  getEmailCampaignStatsResponse,
  listEmailContactImportJobs,
  listEmailContacts,
  listEmailLists,
  importEmailContacts,
  listEmailCampaigns,
  previewEmailContactsImport,
  queueEmailContactsImport,
  sendEmailCampaign,
  unsubscribeEmail,
  updateEmailContact,
  updateEmailCampaign,
  verifyEmailDomain,
} from "../services/email/emailService.ts";
import {
  getEmailTrackingPixelBuffer,
  trackEmailClick,
  trackEmailOpen,
} from "../services/email/emailTrackingService.ts";
import { processSesWebhookNotification } from "../services/email/emailProviderEventService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";
import { handleApiError, isHttpError, sendApiError } from "../utils/http.ts";

function readBusinessId(request: Request<{ businessId: string }>): string | undefined {
  return request.params.businessId?.trim() || undefined;
}

function readEmailContactStatus(value: unknown): EmailContactStatus | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized === "active" ||
    normalized === "unsubscribed" ||
    normalized === "bounced" ||
    normalized === "complained" ||
    normalized === "suppressed"
    ? normalized
    : undefined;
}

function readEmailContactAttributeFilters(query: Request["query"]): Record<string, string> | undefined {
  const filters: Record<string, string> = {};

  for (const [key, value] of Object.entries(query)) {
    if (!key.startsWith("attribute.")) {
      continue;
    }

    const attributeKey = key.slice("attribute.".length).trim();
    const attributeValue = typeof value === "string" ? value.trim() : "";

    if (!attributeKey || !attributeValue) {
      continue;
    }

    filters[attributeKey] = attributeValue;
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}

function buildUnsubscribeHtml(input: {
  title: string;
  description: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${input.title}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f2ec;
        color: #241813;
      }
      main {
        display: grid;
        place-items: center;
        min-height: 100vh;
        padding: 24px;
      }
      section {
        width: min(100%, 560px);
        padding: 32px;
        border-radius: 24px;
        background: #fffaf5;
        border: 1px solid rgba(112, 84, 62, 0.16);
        box-shadow: 0 18px 50px rgba(36, 24, 19, 0.08);
      }
      p.eyebrow {
        margin: 0 0 10px;
        color: #70543e;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: 32px;
        line-height: 1.05;
      }
      p.description {
        margin: 16px 0 0;
        color: #6d5d53;
        line-height: 1.7;
      }
    </style>
  </head>
  <body>
    <main>
      <section>
        <p class="eyebrow">FounderContent AI</p>
        <h1>${input.title}</h1>
        <p class="description">${input.description}</p>
      </section>
    </main>
  </body>
</html>`;
}

function applyTrackingResponseHeaders(response: Response): void {
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
}

export async function postEmailContactsImport(
  request: Request<{ businessId: string }, unknown, ImportEmailContactsRequest>,
  response: Response<ImportEmailContactsResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    const actor = await ensureCurrentUser(request.auth);
    const result = await importEmailContacts(businessId, actor.id, request.body);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_contacts_import_failed",
      message: "Unable to import email contacts.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_contacts_import_failed",
      message: "Unable to import email contacts.",
      logMessage: "Failed to import email contacts.",
    });
  }
}

export async function postEmailContactsImportPreview(
  request: Request<{ businessId: string }, unknown, ImportEmailContactsPreviewRequest>,
  response: Response<ImportEmailContactsPreviewResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    const result = await previewEmailContactsImport(businessId, request.body);
    response.json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_contacts_preview_failed",
      message: "Unable to preview email contacts.",
      logMessage: "Failed to preview email contacts.",
    });
  }
}

export async function postEmailContactsImportJob(
  request: Request<{ businessId: string }, unknown, QueueEmailContactsImportRequest>,
  response: Response<QueueEmailContactsImportResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    const actor = await ensureCurrentUser(request.auth);
    const result = await queueEmailContactsImport(businessId, actor.id, request.body);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_contact_import_job_create_failed",
      message: "Unable to queue the email contact import.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_contact_import_job_create_failed",
      message: "Unable to queue the email contact import.",
      logMessage: "Failed to queue email contact import job.",
    });
  }
}

export async function postEmailCampaign(
  request: Request<{ businessId: string }, unknown, CreateEmailCampaignRequest>,
  response: Response<CreateEmailCampaignResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    const actor = await ensureCurrentUser(request.auth);
    const result = await createEmailCampaign(businessId, actor.id, request.body);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_campaign_create_failed",
      message: "Unable to create email campaign.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_campaign_create_failed",
      message: "Unable to create email campaign.",
      logMessage: "Failed to create email campaign.",
    });
  }
}

export async function patchEmailCampaign(
  request: Request<{ businessId: string; campaignId: string }, unknown, UpdateEmailCampaignRequest>,
  response: Response<UpdateEmailCampaignResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    const actor = await ensureCurrentUser(request.auth);
    const result = await updateEmailCampaign(businessId, request.params.campaignId, actor.id, request.body);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_campaign_update_failed",
      message: "Unable to update email campaign.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_campaign_update_failed",
      message: "Unable to update email campaign.",
      logMessage: "Failed to update email campaign.",
    });
  }
}

export async function deleteEmailCampaignController(
  request: Request<{ businessId: string; campaignId: string }>,
  response: Response<DeleteEmailCampaignResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    const result = await deleteEmailCampaign(businessId, request.params.campaignId);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_campaign_delete_failed",
      message: "Unable to delete email campaign.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_campaign_delete_failed",
      message: "Unable to delete email campaign.",
      logMessage: "Failed to delete email campaign.",
    });
  }
}

export async function postEmailCampaignSend(
  request: Request<{ businessId: string; campaignId: string }>,
  response: Response<SendEmailCampaignResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    const actor = await ensureCurrentUser(request.auth);
    const result = await sendEmailCampaign(businessId, request.params.campaignId, actor.id);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_campaign_send_failed",
      message: "Unable to send email campaign.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_campaign_send_failed",
      message: "Unable to send email campaign.",
      logMessage: "Failed to send email campaign.",
    });
  }
}

export async function getEmailCampaigns(
  request: Request<{ businessId: string }>,
  response: Response<EmailCampaignListResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    const result = await listEmailCampaigns(businessId);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_campaigns_load_failed",
      message: "Unable to load email campaigns.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_campaigns_load_failed",
      message: "Unable to load email campaigns.",
      logMessage: "Failed to load email campaigns.",
    });
  }
}

export async function getEmailLists(
  request: Request<{ businessId: string }>,
  response: Response<EmailListListResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    const result = await listEmailLists(businessId);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_lists_load_failed",
      message: "Unable to load email lists.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_lists_load_failed",
      message: "Unable to load email lists.",
      logMessage: "Failed to load email lists.",
    });
  }
}

export async function getEmailContacts(
  request: Request<{ businessId: string }>,
  response: Response<EmailContactListResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    const result = await listEmailContacts(businessId, {
      search: typeof request.query.search === "string" ? request.query.search : undefined,
      listId: typeof request.query.listId === "string" ? request.query.listId : undefined,
      status: readEmailContactStatus(request.query.status),
      attributeFilters: readEmailContactAttributeFilters(request.query),
      limit:
        typeof request.query.limit === "string"
          ? Number.parseInt(request.query.limit, 10)
          : undefined,
    });
    response.json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_contacts_load_failed",
      message: "Unable to load contacts.",
      logMessage: "Failed to load email contacts.",
    });
  }
}

export async function patchEmailContactController(
  request: Request<{ businessId: string; contactId: string }, unknown, UpdateEmailContactRequest>,
  response: Response<UpdateEmailContactResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    const result = await updateEmailContact(businessId, request.params.contactId, request.body);
    response.json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_contact_update_failed",
      message: "Unable to update contact.",
      logMessage: "Failed to update email contact.",
    });
  }
}

export async function deleteEmailContactController(
  request: Request<{ businessId: string; contactId: string }>,
  response: Response<DeleteEmailContactResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    const result = await deleteEmailContact(businessId, request.params.contactId);
    response.json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_contact_delete_failed",
      message: "Unable to delete contact.",
      logMessage: "Failed to delete email contact.",
    });
  }
}

export async function getEmailContactImportJobsController(
  request: Request<{ businessId: string }>,
  response: Response<EmailContactImportJobListResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    const result = await listEmailContactImportJobs(businessId);
    response.json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_contact_import_jobs_load_failed",
      message: "Unable to load import jobs.",
      logMessage: "Failed to load email contact import jobs.",
    });
  }
}

export async function getEmailContactImportJobController(
  request: Request<{ businessId: string; jobId: string }>,
  response: Response<EmailContactImportJobResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    const result = await getEmailContactImportJob(businessId, request.params.jobId);
    response.json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_contact_import_job_load_failed",
      message: "Unable to load the import job.",
      logMessage: "Failed to load email contact import job.",
    });
  }
}

export async function getEmailCampaignStats(
  request: Request<{ businessId: string; campaignId: string }>,
  response: Response<EmailCampaignStatsResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    const result = await getEmailCampaignStatsResponse(businessId, request.params.campaignId);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_campaign_stats_failed",
      message: "Unable to load email campaign stats.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_campaign_stats_failed",
      message: "Unable to load email campaign stats.",
      logMessage: "Failed to load email campaign stats.",
    });
  }
}

export async function getEmailDomainSettingsController(
  request: Request<{ businessId: string }>,
  response: Response<EmailDomainSettingsResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    const result = await getEmailDomainSettings(businessId);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_domain_settings_load_failed",
      message: "Unable to load email domain settings.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_domain_settings_load_failed",
      message: "Unable to load email domain settings.",
      logMessage: "Failed to load email domain settings.",
    });
  }
}

export async function postEmailDomain(
  request: Request<{ businessId: string }, unknown, CreateEmailDomainRequest>,
  response: Response<CreateEmailDomainResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    const result = await createEmailDomain(businessId, request.body);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_domain_create_failed",
      message: "Unable to save email domain settings.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_domain_create_failed",
      message: "Unable to save email domain settings.",
      logMessage: "Failed to save email domain settings.",
    });
  }
}

export async function postEmailDomainVerify(
  request: Request<{ businessId: string; domainId: string }>,
  response: Response<VerifyEmailDomainResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    const result = await verifyEmailDomain(businessId, request.params.domainId);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_domain_verify_failed",
      message: "Unable to verify email domain.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_domain_verify_failed",
      message: "Unable to verify email domain.",
      logMessage: "Failed to verify email domain.",
    });
  }
}

export async function postSesWebhook(
  request: Request<unknown, unknown, unknown>,
  response: Response<{ ok: true; result: Awaited<ReturnType<typeof processSesWebhookNotification>> } | ApiError>,
): Promise<void> {
  try {
    const result = await processSesWebhookNotification(request.body);
    response.json({
      ok: true,
      result,
    });
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "ses_webhook_failed",
      message: "Unable to process SES webhook payload.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "ses_webhook_failed",
      message: "Unable to process SES webhook payload.",
      logMessage: "Failed to process SES webhook payload.",
    });
  }
}

export async function getEmailUnsubscribe(
  request: Request<{ token: string }>,
  response: Response<UnsubscribeEmailResponse | ApiError | string>,
): Promise<void> {
  try {
    const result = await unsubscribeEmail(request.params.token);
    const acceptsHtml = request.accepts(["html", "json"]) === "html";

    if (acceptsHtml) {
      response
        .status(200)
        .type("html")
        .send(
          buildUnsubscribeHtml({
            title: "You've been unsubscribed.",
            description: `${result.email} will not receive future campaigns from this workspace unless they opt in again.`,
          }),
        );
      return;
    }

    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "email_unsubscribe_failed",
      message: "Unable to unsubscribe contact.",
    });
    if (request.accepts(["html", "json"]) === "html") {
      response
        .status(500)
        .type("html")
        .send(
          buildUnsubscribeHtml({
            title: "We couldn't complete that unsubscribe.",
            description: "Try again from the latest email or contact support if this keeps happening.",
          }),
        );
      return;
    }

    handleApiError(response, error, {
      statusCode: 500,
      code: "email_unsubscribe_failed",
      message: "Unable to unsubscribe this contact.",
      logMessage: "Failed to unsubscribe email contact.",
    });
  }
}

export async function getEmailOpenTracking(
  request: Request<unknown, unknown, unknown, { t?: string }>,
  response: Response,
): Promise<void> {
  try {
    await trackEmailOpen({
      token: typeof request.query.t === "string" ? request.query.t : "",
      userAgent: request.get("user-agent") ?? undefined,
      ipAddress: request.ip,
    });
  } catch {
    // Always return the tracking pixel so image rendering does not surface token errors.
  }

  applyTrackingResponseHeaders(response);
  response.status(200).type("gif").send(getEmailTrackingPixelBuffer());
}

export async function getEmailClickTracking(
  request: Request<unknown, unknown, unknown, { t?: string }>,
  response: Response<string>,
): Promise<void> {
  try {
    const result = await trackEmailClick({
      token: typeof request.query.t === "string" ? request.query.t : "",
      userAgent: request.get("user-agent") ?? undefined,
      ipAddress: request.ip,
    });

    applyTrackingResponseHeaders(response);
    response.redirect(302, result.redirectUrl);
  } catch (error) {
    if (isHttpError(error)) {
      applyTrackingResponseHeaders(response);
      response.status(error.statusCode).type("text/plain").send(error.message);
      return;
    }

    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "email_click_tracking_failed",
      message: "Unable to resolve tracked email click.",
    });
    applyTrackingResponseHeaders(response);
    response.status(500).type("text/plain").send("Unable to resolve this tracked email link.");
  }
}
