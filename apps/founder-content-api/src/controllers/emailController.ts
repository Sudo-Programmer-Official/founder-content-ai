import type {
  ApiError,
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
  UnsubscribeEmailResponse,
  VerifyEmailDomainResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import { ensureCurrentUser } from "../services/authBusinessService.ts";
import { enforceWorkspaceReadAccess, enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import {
  createEmailCampaign,
  createEmailDomain,
  getEmailDomainSettings,
  getEmailCampaignStatsResponse,
  listEmailLists,
  importEmailContacts,
  listEmailCampaigns,
  sendEmailCampaign,
  unsubscribeEmail,
  verifyEmailDomain,
} from "../services/email/emailService.ts";
import { processSesWebhookNotification } from "../services/email/emailProviderEventService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

function readBusinessId(request: Request<{ businessId: string }>): string | undefined {
  return request.params.businessId?.trim() || undefined;
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
