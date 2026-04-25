import type {
  ApiError,
  CreateEmailCampaignRequest,
  CreateEmailCampaignResponse,
  CreateEmailDomainRequest,
  CreateEmailDomainResponse,
  DeleteEmailCampaignResponse,
  DeleteEmailContactResponse,
  EmailCampaignAnalyticsResponse,
  EmailCampaignAutopilotRequest,
  EmailCampaignAutopilotResponse,
  EmailCampaignListResponse,
  EmailCampaignLinkListResponse,
  EmailCampaignStatsResponse,
  EmailClickTrackingEventResponse,
  EmailContactListResponse,
  EmailContactStatus,
  EmailDomainSettingsResponse,
  EmailTrackingEventRequest,
  EmailTrackingEventResponse,
  EmailContactImportJobListResponse,
  EmailContactImportJobResponse,
  EmailListListResponse,
  ImportEmailContactsRequest,
  ImportEmailContactsPreviewRequest,
  ImportEmailContactsPreviewResponse,
  ImportEmailContactsResponse,
  PreviewEmailCampaignRequest,
  PreviewEmailCampaignResponse,
  QueueEmailContactsImportRequest,
  QueueEmailContactsImportResponse,
  RecordEmailDeliveredEventRequest,
  RecordEmailDeliveredEventResponse,
  ResubscribeEmailResponse,
  SendEmailCampaignResponse,
  SendTestEmailCampaignRequest,
  SendTestEmailCampaignResponse,
  UnsubscribeEmailRequest,
  EmailSubscriptionStatusResponse,
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
  getEmailCampaignAnalyticsResponse,
  listEmailCampaignLinksResponse,
  getEmailDomainSettings,
  getEmailCampaignStatsResponse,
  listEmailContactImportJobs,
  listEmailContacts,
  listEmailLists,
  importEmailContacts,
  listEmailCampaigns,
  previewEmailContactsImport,
  previewEmailCampaign,
  queueEmailContactsImport,
  resubscribeEmail,
  sendEmailCampaign,
  sendTestEmailCampaign,
  getEmailSubscriptionStatus,
  unsubscribeEmail,
  updateEmailContact,
  updateEmailCampaign,
  verifyEmailDomain,
} from "../services/email/emailService.ts";
import { runEmailCampaignAutopilot } from "../services/email/emailAutopilotService.ts";
import {
  getEmailTrackingPixelBuffer,
  trackEmailClick,
  trackEmailOpen,
} from "../services/email/emailTrackingService.ts";
import {
  processSesWebhookNotification,
  recordEmailDeliveredEvent,
} from "../services/email/emailProviderEventService.ts";
import { safeCreateSystemErrorLog } from "../services/systemErrorLogService.ts";
import { handleApiError, isHttpError, sendApiError } from "../utils/http.ts";

function readBusinessId(request: Request<{ businessId?: string }>): string | undefined {
  return request.params.businessId?.trim() || undefined;
}

function readBusinessIdFromQuery(query: Request["query"]): string | undefined {
  return typeof query.businessId === "string" && query.businessId.trim()
    ? query.businessId.trim()
    : undefined;
}

function readRequiredText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readAutopilotStrategy(value: unknown): EmailCampaignAutopilotRequest["strategy"] | undefined {
  return value === "conversion" || value === "engagement" || value === "awareness"
    ? value
    : undefined;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function prefersHtml(request: Request): boolean {
  return request.accepts(["html", "json"]) === "html";
}

function readOptionalFormText(value: unknown, maxLength = 280): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized;
}

function buildUnsubscribeHtml(input: {
  title: string;
  description: string;
  bodyHtml?: string;
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
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin-top: 26px;
      }
      .stack {
        display: grid;
        gap: 14px;
        margin-top: 26px;
      }
      label {
        display: grid;
        gap: 10px;
        font-size: 14px;
        color: #70543e;
        font-weight: 600;
      }
      textarea {
        min-height: 112px;
        padding: 14px 16px;
        border-radius: 18px;
        border: 1px solid rgba(112, 84, 62, 0.18);
        background: #ffffff;
        color: #241813;
        font: inherit;
        resize: vertical;
      }
      button,
      .button-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0 20px;
        border-radius: 999px;
        border: 1px solid rgba(112, 84, 62, 0.16);
        background: #fffaf5;
        color: #241813;
        font: inherit;
        font-weight: 700;
        text-decoration: none;
        cursor: pointer;
      }
      button.primary,
      .button-link.primary {
        border-color: #cc5b23;
        background: #cc5b23;
        color: #fffaf5;
      }
      p.note {
        margin: 0;
        color: #8a776b;
        font-size: 14px;
        line-height: 1.6;
      }
      @media (max-width: 640px) {
        section {
          padding: 26px 22px;
          border-radius: 22px;
        }
        h1 {
          font-size: 28px;
        }
        .actions,
        .stack {
          gap: 12px;
        }
        button,
        .button-link {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section>
        <p class="eyebrow">FounderContent AI</p>
        <h1>${escapeHtml(input.title)}</h1>
        <p class="description">${escapeHtml(input.description)}</p>
        ${input.bodyHtml ?? ""}
      </section>
    </main>
  </body>
</html>`;
}

function buildUnsubscribeConfirmationBody(token: string, status: EmailSubscriptionStatusResponse): string {
  return `
    <form class="stack" method="post" action="/api/email/unsubscribe/${encodeURIComponent(token)}">
      <label>
        Optional: tell us why you're unsubscribing
        <textarea
          name="reason"
          maxlength="280"
          placeholder="Too many emails, not relevant right now, signed up by mistake, or anything else."
        ></textarea>
      </label>
      <div class="actions">
        <button type="submit" class="primary">Unsubscribe ${escapeHtml(status.email)}</button>
      </div>
      <p class="note">You can re-subscribe later from the confirmation page if you change your mind.</p>
    </form>
  `.trim();
}

function buildUnsubscribedBody(token: string): string {
  return `
    <div class="stack">
      <div class="actions">
        <form method="post" action="/api/email/resubscribe/${encodeURIComponent(token)}">
          <button type="submit" class="primary">Re-subscribe</button>
        </form>
      </div>
      <p class="note">Changed your mind? This adds the address back for future campaigns from this workspace.</p>
    </div>
  `.trim();
}

function buildResubscribedBody(): string {
  return `
    <div class="stack">
      <p class="note">You're opted back in. Future campaigns from this workspace can reach you again.</p>
    </div>
  `.trim();
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

export async function postEmailCampaignPreview(
  request: Request<{ businessId: string }, unknown, PreviewEmailCampaignRequest>,
  response: Response<PreviewEmailCampaignResponse | ApiError>,
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
    const result = await previewEmailCampaign(businessId, request.body);
    response.json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_campaign_preview_failed",
      message: "Unable to render the email preview.",
      logMessage: "Failed to render email preview.",
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

export async function postEmailCampaignTestSend(
  request: Request<{ businessId: string }, unknown, SendTestEmailCampaignRequest>,
  response: Response<SendTestEmailCampaignResponse | ApiError>,
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
    const result = await sendTestEmailCampaign(businessId, request.body);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_campaign_test_send_failed",
      message: "Unable to send test email.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_campaign_test_send_failed",
      message: "Unable to send test email.",
      logMessage: "Failed to send test email.",
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

export async function postEmailCampaignAutopilot(
  request: Request<{ businessId?: string }, unknown, EmailCampaignAutopilotRequest>,
  response: Response<EmailCampaignAutopilotResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request) ?? readRequiredText(request.body?.businessId);
  const strategy = readAutopilotStrategy(request.body?.strategy);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  if (!strategy) {
    sendApiError(response, 400, "autopilot_strategy_invalid", "strategy is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "email_campaigns",
    });
    const actor = await ensureCurrentUser(request.auth);
    const result = await runEmailCampaignAutopilot({
      businessId,
      goal: readRequiredText(request.body?.goal) ?? "",
      audienceId: readRequiredText(request.body?.audienceId) ?? "",
      strategy,
    }, request.auth, actor.id);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_campaign_autopilot_failed",
      message: "Unable to launch email autopilot.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_campaign_autopilot_failed",
      message: "Unable to launch email autopilot.",
      logMessage: "Failed to launch email autopilot.",
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
      tag: typeof request.query.tag === "string" ? request.query.tag : undefined,
      status: readEmailContactStatus(request.query.status),
      attributeFilters: readEmailContactAttributeFilters(request.query),
      limit:
        typeof request.query.limit === "string"
          ? Number.parseInt(request.query.limit, 10)
          : undefined,
      offset:
        typeof request.query.offset === "string"
          ? Number.parseInt(request.query.offset, 10)
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

export async function getEmailCampaignAnalytics(
  request: Request<{ businessId?: string; campaignId: string }, unknown, unknown, { businessId?: string }>,
  response: Response<EmailCampaignAnalyticsResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readBusinessId(request) ?? readBusinessIdFromQuery(request.query);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "email_campaigns");
    const result = await getEmailCampaignAnalyticsResponse(businessId, request.params.campaignId);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_campaign_analytics_failed",
      message: "Unable to load email campaign analytics.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_campaign_analytics_failed",
      message: "Unable to load email campaign analytics.",
      logMessage: "Failed to load email campaign analytics.",
    });
  }
}

export async function getEmailCampaignLinks(
  request: Request<{ businessId: string; campaignId: string }>,
  response: Response<EmailCampaignLinkListResponse | ApiError>,
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
    const result = await listEmailCampaignLinksResponse(businessId, request.params.campaignId);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_campaign_links_failed",
      message: "Unable to load email campaign links.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_campaign_links_failed",
      message: "Unable to load email campaign links.",
      logMessage: "Failed to load email campaign links.",
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
    if (prefersHtml(request)) {
      const status = await getEmailSubscriptionStatus(request.params.token);
      applyTrackingResponseHeaders(response);
      response
        .status(200)
        .type("html")
        .send(
          buildUnsubscribeHtml({
            title: status.status === "unsubscribed" ? "You're already unsubscribed." : "Unsubscribe from these emails?",
            description: status.status === "unsubscribed"
              ? `${status.email} will not receive future campaigns from this workspace unless they opt in again.`
              : `We'll stop sending campaign emails from this workspace to ${status.email}.`,
            bodyHtml: status.status === "unsubscribed"
              ? buildUnsubscribedBody(request.params.token)
              : buildUnsubscribeConfirmationBody(request.params.token, status),
          }),
        );
      return;
    }

    const result = await unsubscribeEmail(request.params.token);
    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "email_unsubscribe_failed",
      message: "Unable to unsubscribe contact.",
    });
    if (prefersHtml(request)) {
      applyTrackingResponseHeaders(response);
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

export async function postEmailUnsubscribe(
  request: Request<{ token: string }, UnsubscribeEmailResponse | ApiError | string, UnsubscribeEmailRequest>,
  response: Response<UnsubscribeEmailResponse | ApiError | string>,
): Promise<void> {
  try {
    const result = await unsubscribeEmail(request.params.token, readOptionalFormText(request.body?.reason));

    if (prefersHtml(request)) {
      applyTrackingResponseHeaders(response);
      response
        .status(200)
        .type("html")
        .send(
          buildUnsubscribeHtml({
            title: "You've been unsubscribed.",
            description: `${result.email} will not receive future campaigns from this workspace unless they opt in again.`,
            bodyHtml: buildUnsubscribedBody(request.params.token),
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
    if (prefersHtml(request)) {
      applyTrackingResponseHeaders(response);
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

export async function postEmailResubscribe(
  request: Request<{ token: string }>,
  response: Response<ResubscribeEmailResponse | ApiError | string>,
): Promise<void> {
  try {
    const result = await resubscribeEmail(request.params.token);

    if (prefersHtml(request)) {
      applyTrackingResponseHeaders(response);
      response
        .status(200)
        .type("html")
        .send(
          buildUnsubscribeHtml({
            title: "You're subscribed again.",
            description: `${result.email} can receive future campaigns from this workspace again.`,
            bodyHtml: buildResubscribedBody(),
          }),
        );
      return;
    }

    response.json(result);
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      code: "email_resubscribe_failed",
      message: "Unable to re-subscribe contact.",
    });
    if (prefersHtml(request)) {
      applyTrackingResponseHeaders(response);
      response
        .status(500)
        .type("html")
        .send(
          buildUnsubscribeHtml({
            title: "We couldn't restore that subscription.",
            description: "Try again from the latest email or contact support if this keeps happening.",
          }),
        );
      return;
    }

    handleApiError(response, error, {
      statusCode: 500,
      code: "email_resubscribe_failed",
      message: "Unable to re-subscribe this contact.",
      logMessage: "Failed to re-subscribe email contact.",
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

export async function postEmailOpenTracking(
  request: Request<unknown, unknown, EmailTrackingEventRequest>,
  response: Response<EmailTrackingEventResponse | ApiError>,
): Promise<void> {
  try {
    await trackEmailOpen({
      token: readRequiredText(request.body?.token) ?? "",
      userAgent: request.get("user-agent") ?? undefined,
      ipAddress: request.ip,
    });
    response.json({ success: true });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_open_tracking_failed",
      message: "Unable to record this email open event.",
      logMessage: "Failed to record email open event.",
    });
  }
}

export async function postEmailClickTracking(
  request: Request<unknown, unknown, EmailTrackingEventRequest>,
  response: Response<EmailClickTrackingEventResponse | ApiError>,
): Promise<void> {
  try {
    const result = await trackEmailClick({
      token: readRequiredText(request.body?.token) ?? "",
      userAgent: request.get("user-agent") ?? undefined,
      ipAddress: request.ip,
    });
    response.json({
      success: true,
      redirectUrl: result.redirectUrl,
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_click_tracking_failed",
      message: "Unable to record this email click event.",
      logMessage: "Failed to record email click event.",
    });
  }
}

export async function postEmailDeliveredEvent(
  request: Request<unknown, unknown, RecordEmailDeliveredEventRequest>,
  response: Response<RecordEmailDeliveredEventResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    sendApiError(response, 401, "auth_required", "Authentication is required.");
    return;
  }

  const businessId = readRequiredText(request.body?.businessId);

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

    const result = await recordEmailDeliveredEvent({
      businessId,
      providerMessageId: readRequiredText(request.body?.providerMessageId) ?? "",
      campaignRecipientId: readRequiredText(request.body?.campaignRecipientId),
      recipientEmail: readRequiredText(request.body?.recipientEmail),
      domainName: readRequiredText(request.body?.domainName),
      occurredAt: readRequiredText(request.body?.occurredAt),
      metadata: request.body?.metadata,
    });

    response.json({
      success: true,
      eventRecorded: result.eventRecorded,
    });
  } catch (error) {
    void safeCreateSystemErrorLog({
      route: request.originalUrl,
      userId: request.auth.userId,
      businessId,
      code: "email_delivered_event_failed",
      message: "Unable to record this delivered email event.",
    });
    handleApiError(response, error, {
      statusCode: 500,
      code: "email_delivered_event_failed",
      message: "Unable to record this delivered email event.",
      logMessage: "Failed to record delivered email event.",
    });
  }
}
