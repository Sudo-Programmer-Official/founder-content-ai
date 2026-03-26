import crypto from "node:crypto";
import type {
  BusinessEmailSettings,
  CreateEmailCampaignRequest,
  CreateEmailCampaignResponse,
  CreateEmailDomainRequest,
  CreateEmailDomainResponse,
  EmailCampaign,
  EmailCampaignListResponse,
  EmailCampaignRecipient,
  EmailCampaignStats,
  EmailCampaignStatsResponse,
  EmailContact,
  EmailContactStatus,
  EmailDnsRecord,
  EmailList,
  EmailListListResponse,
  ImportEmailContactsRequest,
  ImportEmailContactsResponse,
  SendEmailCampaignResponse,
  UnsubscribeEmailResponse,
  VerifyEmailDomainResponse,
} from "../../../../../packages/shared-types/index.ts";
import type { PoolClient, QueryResultRow } from "pg";
import { incrementBusinessDailyUsage } from "../adminControlService.ts";
import { safeLogEvent } from "../analytics/eventLoggingService.ts";
import { queryDb, withDbTransaction } from "../db/client.ts";
import { sendPlatformEmail } from "./emailTransportService.ts";
import { HttpError } from "../../utils/http.ts";
import { safeCreateSystemErrorLog } from "../systemErrorLogService.ts";

interface EmailSettingsRow extends QueryResultRow {
  id: string;
  business_id: string;
  from_name: string | null;
  from_email: string | null;
  reply_to_email: string | null;
  provider: string;
  ses_identity: string | null;
  domain_name: string | null;
  domain_status: string;
  dkim_status: string;
  spf_status: string;
  dns_records_json: unknown;
  verified_at: Date | string | null;
  last_checked_at: Date | string | null;
  updated_at: Date | string;
}

interface EmailListRow extends QueryResultRow {
  id: string;
  business_id: string;
  name: string;
  created_by_user_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  contact_count?: string | number;
}

interface EmailContactRow extends QueryResultRow {
  id: string;
  business_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  tags_json: unknown;
  status: EmailContactStatus;
  unsubscribe_token: string;
  unsubscribed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface EmailUnsubscribeRow extends QueryResultRow {
  id: string;
  business_id: string;
  email: string;
  reason: string | null;
  source: "campaign" | "manual" | "system" | "bounce" | "complaint";
  source_campaign_id: string | null;
  created_at: Date | string;
}

interface EmailCampaignRow extends QueryResultRow {
  id: string;
  business_id: string;
  list_id: string | null;
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  status: EmailCampaign["status"];
  reply_to_email: string | null;
  created_by_user_id: string | null;
  scheduled_at: Date | string | null;
  send_started_at: Date | string | null;
  send_completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  recipient_count?: string | number;
  sent_count?: string | number;
  delivered_count?: string | number;
  failed_count?: string | number;
  unsubscribed_count?: string | number;
}

interface EmailCampaignRecipientRow extends QueryResultRow {
  id: string;
  campaign_id: string;
  contact_id: string;
  personalized_subject: string;
  personalized_body_html: string;
  personalized_body_text: string;
  status: EmailCampaignRecipient["status"];
  ses_message_id: string | null;
  sent_at: Date | string | null;
  delivered_at: Date | string | null;
  failed_at: Date | string | null;
  failure_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  contact_email?: string;
  contact_status?: EmailContactStatus;
  first_name?: string | null;
  last_name?: string | null;
  unsubscribe_token?: string;
}

interface CountRow extends QueryResultRow {
  total: string | number;
}

const DOMAIN_STATUS_VERIFIED = "verified";

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function mapEmailSettings(row: EmailSettingsRow): BusinessEmailSettings {
  return {
    id: row.id,
    businessId: row.business_id,
    provider: row.provider,
    fromName: row.from_name ?? undefined,
    fromEmail: row.from_email ?? undefined,
    replyToEmail: row.reply_to_email ?? undefined,
    domainName: row.domain_name ?? undefined,
    domainStatus: row.domain_status,
    dkimStatus: row.dkim_status,
    spfStatus: row.spf_status,
    sesIdentity: row.ses_identity ?? undefined,
    dnsRecords: parseJsonArray<EmailDnsRecord>(row.dns_records_json),
    verifiedAt: toIsoString(row.verified_at),
    lastCheckedAt: toIsoString(row.last_checked_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapEmailList(row: EmailListRow): EmailList {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    createdByUserId: row.created_by_user_id ?? undefined,
    contactCount: toNumber(row.contact_count),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapEmailContact(row: EmailContactRow): EmailContact {
  return {
    id: row.id,
    businessId: row.business_id,
    email: row.email,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    tags: parseJsonArray<string>(row.tags_json),
    status: row.status,
    unsubscribedAt: toIsoString(row.unsubscribed_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapEmailCampaign(row: EmailCampaignRow): EmailCampaign {
  return {
    id: row.id,
    businessId: row.business_id,
    listId: row.list_id ?? undefined,
    name: row.name,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    status: row.status,
    replyToEmail: row.reply_to_email ?? undefined,
    createdByUserId: row.created_by_user_id ?? undefined,
    scheduledAt: toIsoString(row.scheduled_at),
    sendStartedAt: toIsoString(row.send_started_at),
    sendCompletedAt: toIsoString(row.send_completed_at),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: toIsoString(row.updated_at),
    recipientCount: toNumber(row.recipient_count),
    sentCount: toNumber(row.sent_count),
    deliveredCount: toNumber(row.delivered_count),
    failedCount: toNumber(row.failed_count),
    unsubscribedCount: toNumber(row.unsubscribed_count),
  };
}

function mapEmailRecipient(row: EmailCampaignRecipientRow): EmailCampaignRecipient {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    contactId: row.contact_id,
    personalizedSubject: row.personalized_subject,
    personalizedBodyHtml: row.personalized_body_html,
    personalizedBodyText: row.personalized_body_text,
    status: row.status,
    sesMessageId: row.ses_message_id ?? undefined,
    sentAt: toIsoString(row.sent_at),
    deliveredAt: toIsoString(row.delivered_at),
    failedAt: toIsoString(row.failed_at),
    failureReason: row.failure_reason ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: toIsoString(row.updated_at),
  };
}

async function executeQuery<TRow extends QueryResultRow>(
  text: string,
  values: unknown[],
  client?: PoolClient,
): Promise<{ rows: TRow[] }> {
  if (client) {
    return client.query<TRow>(text, values);
  }

  return queryDb<TRow>(text, values);
}

async function findEmailUnsubscribe(
  businessId: string,
  email: string,
  client?: PoolClient,
): Promise<EmailUnsubscribeRow | null> {
  const result = await executeQuery<EmailUnsubscribeRow>(
    `
      select
        id,
        business_id,
        email,
        reason,
        source,
        source_campaign_id,
        created_at
      from email_unsubscribes
      where business_id = $1::uuid
        and lower(email) = lower($2)
      limit 1
    `,
    [businessId, normalizeEmail(email)],
    client,
  );

  return result.rows[0] ?? null;
}

async function isEmailUnsubscribed(
  businessId: string,
  email: string,
  client?: PoolClient,
): Promise<boolean> {
  const result = await executeQuery<CountRow>(
    `
      select count(*)::int as total
      from email_unsubscribes
      where business_id = $1::uuid
        and lower(email) = lower($2)
    `,
    [businessId, normalizeEmail(email)],
    client,
  );

  return toNumber(result.rows[0]?.total) > 0;
}

async function recordBusinessUnsubscribe(input: {
  businessId: string;
  email: string;
  reason?: string;
  source: EmailUnsubscribeRow["source"];
  sourceCampaignId?: string | null;
}, client?: PoolClient): Promise<void> {
  await executeQuery(
    `
      insert into email_unsubscribes (
        business_id,
        email,
        reason,
        source,
        source_campaign_id
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5::uuid
      )
      on conflict do nothing
    `,
    [
      input.businessId,
      normalizeEmail(input.email),
      input.reason?.trim() || null,
      input.source,
      input.sourceCampaignId ?? null,
    ],
    client,
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function personalizeTemplate(template: string, contact: Pick<EmailContact, "firstName" | "lastName" | "email">): string {
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return template
    .replace(/{{\s*name\s*}}/gi, fullName || contact.firstName || contact.email)
    .replace(/{{\s*first_name\s*}}/gi, contact.firstName || contact.email)
    .replace(/{{\s*last_name\s*}}/gi, contact.lastName || "");
}

function resolveApiBaseUrl(): string {
  return (
    process.env.API_PUBLIC_BASE_URL?.trim() ||
    `http://localhost:${process.env.PORT?.trim() || "3001"}/api`
  ).replace(/\/$/, "");
}

function appendUnsubscribeFooter(html: string, text: string, unsubscribeUrl: string): {
  html: string;
  text: string;
} {
  return {
    html: `${html}<p style="margin-top:24px;font-size:12px;color:#6b7280;">If you no longer want these emails, <a href="${unsubscribeUrl}">unsubscribe here</a>.</p>`,
    text: `${text}\n\nIf you no longer want these emails, unsubscribe here: ${unsubscribeUrl}`,
  };
}

function buildDnsRecords(domainName: string): EmailDnsRecord[] {
  const token = crypto.randomUUID().replace(/-/g, "");
  return [
    {
      type: "TXT",
      name: domainName,
      value: `amazonses-verification=${token}`,
    },
    {
      type: "CNAME",
      name: `${token.slice(0, 12)}._domainkey.${domainName}`,
      value: `${token.slice(12)}.dkim.amazonses.com`,
    },
  ];
}

function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentCell = "";
  let currentRow: string[] = [];
  let insideQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    const nextCharacter = csvText[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === "," && !insideQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !insideQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      currentRow.push(currentCell.trim());
      currentCell = "";
      if (currentRow.some((cell) => cell !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  if (currentCell !== "" || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell !== "")) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function parseContactsFromCsv(csvText: string): Array<{
  email: string;
  firstName?: string;
  lastName?: string;
  tags: string[];
}> {
  const rows = parseCsvRows(csvText);

  if (rows.length === 0) {
    throw new HttpError(400, "contacts_csv_empty", "CSV input is empty.");
  }

  const normalizedHeader = rows[0].map((cell) => cell.toLowerCase());
  const hasHeader = normalizedHeader.includes("email");
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const columnIndex = {
    email: hasHeader ? normalizedHeader.indexOf("email") : 0,
    firstName: hasHeader
      ? Math.max(normalizedHeader.indexOf("first_name"), normalizedHeader.indexOf("firstname"))
      : -1,
    lastName: hasHeader
      ? Math.max(normalizedHeader.indexOf("last_name"), normalizedHeader.indexOf("lastname"))
      : -1,
    name: hasHeader ? normalizedHeader.indexOf("name") : 1,
    tags: hasHeader ? normalizedHeader.indexOf("tags") : -1,
  };

  const contacts = dataRows
    .map((row) => {
      const email = row[columnIndex.email]?.trim().toLowerCase() || "";
      const nameValue = columnIndex.name >= 0 ? row[columnIndex.name]?.trim() || "" : "";
      const firstName = columnIndex.firstName >= 0 ? row[columnIndex.firstName]?.trim() || "" : "";
      const lastName = columnIndex.lastName >= 0 ? row[columnIndex.lastName]?.trim() || "" : "";
      const [fallbackFirstName, ...fallbackRest] = nameValue.split(/\s+/).filter(Boolean);
      return {
        email,
        firstName: firstName || fallbackFirstName || undefined,
        lastName: lastName || (fallbackRest.length > 0 ? fallbackRest.join(" ") : undefined),
        tags:
          columnIndex.tags >= 0
            ? (row[columnIndex.tags] ?? "")
                .split("|")
                .map((tag) => tag.trim())
                .filter(Boolean)
            : [],
      };
    })
    .filter((contact) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email));

  if (contacts.length === 0) {
    throw new HttpError(400, "contacts_csv_invalid", "CSV must include at least one valid email.");
  }

  return contacts;
}

async function ensureEmailSettingsRow(
  businessId: string,
  client?: PoolClient,
): Promise<EmailSettingsRow> {
  await executeQuery(
    `
      insert into business_email_settings (
        business_id,
        provider,
        from_email
      ) values (
        $1::uuid,
        'ses',
        $2
      )
      on conflict (business_id) do nothing
    `,
    [businessId, process.env.SYSTEM_FROM_EMAIL?.trim() || null],
    client,
  );

  const result = await executeQuery<EmailSettingsRow>(
    `
      select
        id,
        business_id,
        from_name,
        from_email,
        reply_to_email,
        provider,
        ses_identity,
        domain_name,
        domain_status,
        dkim_status,
        spf_status,
        dns_records_json,
        verified_at,
        last_checked_at,
        updated_at
      from business_email_settings
      where business_id = $1::uuid
      limit 1
    `,
    [businessId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(500, "email_settings_missing", "Email settings could not be initialized.");
  }

  return row;
}

async function upsertContact(
  businessId: string,
  input: {
    email: string;
    firstName?: string;
    lastName?: string;
    tags: string[];
  },
  client: PoolClient,
): Promise<EmailContactRow> {
  const normalizedEmail = normalizeEmail(input.email);
  const isSuppressed = await isEmailUnsubscribed(businessId, normalizedEmail, client);
  const existingResult = await executeQuery<EmailContactRow>(
    `
      select
        id,
        business_id,
        email,
        first_name,
        last_name,
        tags_json,
        status,
        unsubscribe_token,
        unsubscribed_at,
        created_at,
        updated_at
      from email_contacts
      where business_id = $1::uuid
        and lower(email) = lower($2)
      limit 1
    `,
    [businessId, normalizedEmail],
    client,
  );

  const tagJson = JSON.stringify(input.tags);

  if (existingResult.rows[0]) {
    const updateResult = await executeQuery<EmailContactRow>(
      `
        update email_contacts
        set
          first_name = coalesce($3, first_name),
          last_name = coalesce($4, last_name),
          status = case
            when $6 then 'unsubscribed'
            else status
          end,
          unsubscribed_at = case
            when $6 and unsubscribed_at is null then now()
            else unsubscribed_at
          end,
          tags_json = case
            when jsonb_array_length($5::jsonb) > 0 then $5::jsonb
            else tags_json
          end,
          updated_at = now()
        where id = $1::uuid
        returning
          id,
          business_id,
          email,
          first_name,
          last_name,
          tags_json,
          status,
          unsubscribe_token,
          unsubscribed_at,
          created_at,
          updated_at
      `,
      [
        existingResult.rows[0].id,
        input.firstName ?? null,
        input.lastName ?? null,
        tagJson,
        isSuppressed,
      ],
      client,
    );

    return updateResult.rows[0];
  }

  const insertResult = await executeQuery<EmailContactRow>(
    `
      insert into email_contacts (
        business_id,
        email,
        first_name,
        last_name,
        tags_json,
        status,
        unsubscribed_at
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        $5::jsonb,
        $6,
        $7::timestamptz
      )
      returning
        id,
        business_id,
        email,
        first_name,
        last_name,
        tags_json,
        status,
        unsubscribe_token,
        unsubscribed_at,
        created_at,
        updated_at
    `,
    [
      businessId,
      normalizedEmail,
      input.firstName ?? null,
      input.lastName ?? null,
      tagJson,
      isSuppressed ? "unsubscribed" : "active",
      isSuppressed ? new Date().toISOString() : null,
    ],
    client,
  );

  return insertResult.rows[0];
}

async function loadEmailCampaignOrThrow(
  businessId: string,
  campaignId: string,
  client?: PoolClient,
): Promise<EmailCampaignRow> {
  const result = await executeQuery<EmailCampaignRow>(
    `
      select
        c.id,
        c.business_id,
        c.list_id,
        c.name,
        c.subject,
        c.body_html,
        c.body_text,
        c.status,
        c.reply_to_email,
        c.created_by_user_id,
        c.scheduled_at,
        c.send_started_at,
        c.send_completed_at,
        c.created_at,
        c.updated_at,
        count(r.id)::int as recipient_count,
        count(r.id) filter (where r.status in ('sent', 'delivered'))::int as sent_count,
        count(r.id) filter (where r.status = 'delivered')::int as delivered_count,
        count(r.id) filter (where r.status = 'failed')::int as failed_count,
        count(r.id) filter (where r.status = 'unsubscribed')::int as unsubscribed_count
      from email_campaigns c
      left join email_campaign_recipients r on r.campaign_id = c.id
      where c.business_id = $1::uuid
        and c.id = $2::uuid
      group by c.id
      limit 1
    `,
    [businessId, campaignId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "email_campaign_not_found", "Email campaign not found.");
  }

  return row;
}

async function loadEmailListOrThrow(
  businessId: string,
  listId: string,
  client?: PoolClient,
): Promise<EmailListRow> {
  const result = await executeQuery<EmailListRow>(
    `
      select
        l.id,
        l.business_id,
        l.name,
        l.created_by_user_id,
        l.created_at,
        l.updated_at,
        count(m.id)::int as contact_count
      from email_lists l
      left join email_list_members m on m.list_id = l.id
      where l.business_id = $1::uuid
        and l.id = $2::uuid
      group by l.id
      limit 1
    `,
    [businessId, listId],
    client,
  );

  const row = result.rows[0];

  if (!row) {
    throw new HttpError(404, "email_list_not_found", "Email list not found.");
  }

  return row;
}

async function loadCampaignContacts(
  businessId: string,
  campaignId: string,
  client?: PoolClient,
): Promise<Array<EmailContact & { unsubscribeToken: string }>> {
  const result = await executeQuery<
    EmailContactRow & { campaign_id: string | null }
  >(
    `
      select
        c.id,
        c.business_id,
        c.email,
        c.first_name,
        c.last_name,
        c.tags_json,
        c.status,
        c.unsubscribe_token,
        c.unsubscribed_at,
        c.created_at,
        c.updated_at
      from email_campaigns ec
      inner join email_list_members lm on lm.list_id = ec.list_id
      inner join email_contacts c on c.id = lm.contact_id
      left join email_unsubscribes eu
        on eu.business_id = c.business_id
       and lower(eu.email) = lower(c.email)
      where ec.business_id = $1::uuid
        and ec.id = $2::uuid
        and c.status = 'active'
        and eu.id is null
      order by c.created_at asc
    `,
    [businessId, campaignId],
    client,
  );

  return result.rows.map((row) => ({
    ...mapEmailContact(row),
    unsubscribeToken: row.unsubscribe_token,
  }));
}

async function upsertCampaignRecipients(
  campaign: EmailCampaignRow,
  contacts: Array<EmailContact & { unsubscribeToken: string }>,
  client: PoolClient,
): Promise<void> {
  const apiBaseUrl = resolveApiBaseUrl();

  for (const contact of contacts) {
    const subject = personalizeTemplate(campaign.subject, contact);
    const htmlBody = personalizeTemplate(campaign.body_html, contact);
    const textBody = personalizeTemplate(campaign.body_text || stripHtml(campaign.body_html), contact);
    const footer = appendUnsubscribeFooter(
      htmlBody,
      textBody,
      `${apiBaseUrl}/email/unsubscribe/${contact.unsubscribeToken}`,
    );

    await executeQuery(
      `
        insert into email_campaign_recipients (
          campaign_id,
          contact_id,
          personalized_subject,
          personalized_body_html,
          personalized_body_text,
          status
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          'queued'
        )
        on conflict (campaign_id, contact_id)
        do update set
          personalized_subject = excluded.personalized_subject,
          personalized_body_html = excluded.personalized_body_html,
          personalized_body_text = excluded.personalized_body_text,
          status = 'queued',
          updated_at = now()
      `,
      [campaign.id, contact.id, subject, footer.html, footer.text],
      client,
    );
  }
}

async function getCampaignStats(
  businessId: string,
  campaignId: string,
  client?: PoolClient,
): Promise<EmailCampaignStats> {
  const result = await executeQuery<{
    total: string | number;
    sent_total: string | number;
    delivered_total: string | number;
    failed_total: string | number;
    unsubscribed_total: string | number;
  }>(
    `
      select
        count(*)::int as total,
        count(*) filter (where status in ('sent', 'delivered'))::int as sent_total,
        count(*) filter (where status = 'delivered')::int as delivered_total,
        count(*) filter (where status = 'failed')::int as failed_total,
        count(*) filter (where status = 'unsubscribed')::int as unsubscribed_total
      from email_campaign_recipients r
      inner join email_campaigns c on c.id = r.campaign_id
      where c.business_id = $1::uuid
        and c.id = $2::uuid
    `,
    [businessId, campaignId],
    client,
  );

  const row = result.rows[0];

  return {
    campaignId,
    recipientCount: toNumber(row?.total),
    sentCount: toNumber(row?.sent_total),
    deliveredCount: toNumber(row?.delivered_total),
    failedCount: toNumber(row?.failed_total),
    unsubscribedCount: toNumber(row?.unsubscribed_total),
  };
}

export async function importEmailContacts(
  businessId: string,
  actorUserId: string | undefined,
  input: ImportEmailContactsRequest,
): Promise<ImportEmailContactsResponse> {
  const listName = input.listName.trim();

  if (listName === "") {
    throw new HttpError(400, "email_list_name_required", "List name is required.");
  }

  const contacts = parseContactsFromCsv(input.csvText);

  return withDbTransaction(async (client) => {
    const listResult = await executeQuery<EmailListRow>(
      `
        insert into email_lists (
          business_id,
          name,
          created_by_user_id
        ) values (
          $1::uuid,
          $2,
          $3::uuid
        )
        returning
          id,
          business_id,
          name,
          created_by_user_id,
          created_at,
          updated_at,
          0::int as contact_count
      `,
      [businessId, listName, actorUserId ?? null],
      client,
    );

    const importedContacts: EmailContact[] = [];

    for (const contact of contacts) {
      const contactRow = await upsertContact(businessId, contact, client);
      await executeQuery(
        `
          insert into email_list_members (
            list_id,
            contact_id
          ) values (
            $1::uuid,
            $2::uuid
          )
          on conflict (list_id, contact_id) do nothing
        `,
        [listResult.rows[0].id, contactRow.id],
        client,
      );
      importedContacts.push(mapEmailContact(contactRow));
    }

    const hydratedList = await loadEmailListOrThrow(businessId, listResult.rows[0].id, client);
    return {
      list: mapEmailList(hydratedList),
      contacts: importedContacts,
      importedCount: importedContacts.length,
    };
  });
}

export async function createEmailCampaign(
  businessId: string,
  actorUserId: string | undefined,
  input: CreateEmailCampaignRequest,
): Promise<CreateEmailCampaignResponse> {
  if (input.subject.trim() === "" || input.bodyHtml.trim() === "") {
    throw new HttpError(400, "email_campaign_invalid", "Subject and email body are required.");
  }

  return withDbTransaction(async (client) => {
    await loadEmailListOrThrow(businessId, input.listId, client);
    await ensureEmailSettingsRow(businessId, client);

    const result = await executeQuery<EmailCampaignRow>(
      `
        insert into email_campaigns (
          business_id,
          list_id,
          name,
          subject,
          body_html,
          body_text,
          reply_to_email,
          created_by_user_id,
          status
        ) values (
          $1::uuid,
          $2::uuid,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::uuid,
          'draft'
        )
        returning
          id,
          business_id,
          list_id,
          name,
          subject,
          body_html,
          body_text,
          status,
          reply_to_email,
          created_by_user_id,
          scheduled_at,
          send_started_at,
          send_completed_at,
          created_at,
          updated_at,
          0::int as recipient_count,
          0::int as sent_count,
          0::int as delivered_count,
          0::int as failed_count,
          0::int as unsubscribed_count
      `,
      [
        businessId,
        input.listId,
        input.name.trim() || input.subject.trim(),
        input.subject.trim(),
        input.bodyHtml.trim(),
        input.bodyText?.trim() || stripHtml(input.bodyHtml),
        input.replyToEmail?.trim() || null,
        actorUserId ?? null,
      ],
      client,
    );

    return {
      campaign: mapEmailCampaign(result.rows[0]),
    };
  });
}

export async function listEmailLists(businessId: string): Promise<EmailListListResponse> {
  const result = await executeQuery<EmailListRow>(
    `
      select
        l.id,
        l.business_id,
        l.name,
        l.created_by_user_id,
        l.created_at,
        l.updated_at,
        count(m.id)::int as contact_count
      from email_lists l
      left join email_list_members m on m.list_id = l.id
      where l.business_id = $1::uuid
      group by l.id
      order by l.created_at desc
    `,
    [businessId],
  );

  return {
    lists: result.rows.map(mapEmailList),
  };
}

export async function listEmailCampaigns(businessId: string): Promise<EmailCampaignListResponse> {
  const result = await executeQuery<EmailCampaignRow>(
    `
      select
        c.id,
        c.business_id,
        c.list_id,
        c.name,
        c.subject,
        c.body_html,
        c.body_text,
        c.status,
        c.reply_to_email,
        c.created_by_user_id,
        c.scheduled_at,
        c.send_started_at,
        c.send_completed_at,
        c.created_at,
        c.updated_at,
        count(r.id)::int as recipient_count,
        count(r.id) filter (where r.status in ('sent', 'delivered'))::int as sent_count,
        count(r.id) filter (where r.status = 'delivered')::int as delivered_count,
        count(r.id) filter (where r.status = 'failed')::int as failed_count,
        count(r.id) filter (where r.status = 'unsubscribed')::int as unsubscribed_count
      from email_campaigns c
      left join email_campaign_recipients r on r.campaign_id = c.id
      where c.business_id = $1::uuid
      group by c.id
      order by c.created_at desc
    `,
    [businessId],
  );

  return {
    campaigns: result.rows.map(mapEmailCampaign),
  };
}

export async function getEmailCampaignStatsResponse(
  businessId: string,
  campaignId: string,
): Promise<EmailCampaignStatsResponse> {
  await loadEmailCampaignOrThrow(businessId, campaignId);
  return {
    stats: await getCampaignStats(businessId, campaignId),
  };
}

export async function processQueuedEmailCampaigns(options: {
  businessId?: string;
  campaignId?: string;
} = {}): Promise<void> {
  const campaignResult = await executeQuery<EmailCampaignRow>(
    `
      select
        c.id,
        c.business_id,
        c.list_id,
        c.name,
        c.subject,
        c.body_html,
        c.body_text,
        c.status,
        c.reply_to_email,
        c.created_by_user_id,
        c.scheduled_at,
        c.send_started_at,
        c.send_completed_at,
        c.created_at,
        c.updated_at,
        count(r.id)::int as recipient_count,
        count(r.id) filter (where r.status in ('sent', 'delivered'))::int as sent_count,
        count(r.id) filter (where r.status = 'delivered')::int as delivered_count,
        count(r.id) filter (where r.status = 'failed')::int as failed_count,
        count(r.id) filter (where r.status = 'unsubscribed')::int as unsubscribed_count
      from email_campaigns c
      left join email_campaign_recipients r on r.campaign_id = c.id
      where c.status in ('queued', 'sending')
        and ($1::uuid is null or c.business_id = $1::uuid)
        and ($2::uuid is null or c.id = $2::uuid)
      group by c.id
      order by c.created_at asc
    `,
    [options.businessId ?? null, options.campaignId ?? null],
  );

  for (const campaign of campaignResult.rows) {
    await withDbTransaction(async (client) => {
      const settings = mapEmailSettings(await ensureEmailSettingsRow(campaign.business_id, client));
      const fromEmail = settings.fromEmail || process.env.SYSTEM_FROM_EMAIL?.trim();

      if (!fromEmail) {
        throw new HttpError(500, "system_from_email_missing", "SYSTEM_FROM_EMAIL is not configured.");
      }

      await executeQuery(
        `
          update email_campaigns
          set
            status = 'sending',
            send_started_at = coalesce(send_started_at, now()),
            updated_at = now()
          where id = $1::uuid
        `,
        [campaign.id],
        client,
      );

      const recipientResult = await executeQuery<EmailCampaignRecipientRow>(
        `
          select
            r.id,
            r.campaign_id,
            r.contact_id,
            r.personalized_subject,
            r.personalized_body_html,
            r.personalized_body_text,
            r.status,
            r.ses_message_id,
            r.sent_at,
            r.delivered_at,
            r.failed_at,
            r.failure_reason,
            r.created_at,
            r.updated_at,
            c.email as contact_email,
            c.status as contact_status,
            c.first_name,
            c.last_name,
            c.unsubscribe_token
          from email_campaign_recipients r
          inner join email_contacts c on c.id = r.contact_id
          where r.campaign_id = $1::uuid
            and r.status = 'queued'
          order by r.created_at asc
        `,
        [campaign.id],
        client,
      );

      let failedCount = 0;

      for (const recipientRow of recipientResult.rows) {
        const contactEmail = recipientRow.contact_email ?? "";
        const suppressedByBusinessUnsubscribe = contactEmail
          ? await isEmailUnsubscribed(campaign.business_id, contactEmail, client)
          : false;

        if (
          recipientRow.contact_status === "unsubscribed" ||
          suppressedByBusinessUnsubscribe
        ) {
          await executeQuery(
            `
              update email_campaign_recipients
              set
                status = 'unsubscribed',
                updated_at = now()
              where id = $1::uuid
            `,
            [recipientRow.id],
            client,
          );

          await executeQuery(
            `
              insert into email_events (
                campaign_recipient_id,
                event_type,
                payload_json,
                occurred_at
              ) values (
                $1::uuid,
                'unsubscribe',
                $2::jsonb,
                now()
              )
            `,
            [
              recipientRow.id,
              JSON.stringify({
                source: suppressedByBusinessUnsubscribe ? "business_unsubscribe" : "contact_status",
              }),
            ],
            client,
          );
          continue;
        }

        if (recipientRow.contact_status === "bounced" || recipientRow.contact_status === "complained") {
          failedCount += 1;
          const failureMessage = `Contact is suppressed (${recipientRow.contact_status}).`;

          await executeQuery(
            `
              update email_campaign_recipients
              set
                status = 'failed',
                failed_at = now(),
                failure_reason = $2,
                updated_at = now()
              where id = $1::uuid
            `,
            [recipientRow.id, failureMessage],
            client,
          );

          await executeQuery(
            `
              insert into email_events (
                campaign_recipient_id,
                event_type,
                payload_json,
                occurred_at
              ) values (
                $1::uuid,
                'failed',
                $2::jsonb,
                now()
              )
            `,
            [
              recipientRow.id,
              JSON.stringify({
                message: failureMessage,
              }),
            ],
            client,
          );
          continue;
        }

        try {
          const sent = await sendPlatformEmail({
            fromEmail,
            fromName: settings.fromName,
            replyToEmail: campaign.reply_to_email || settings.replyToEmail,
            toEmail: contactEmail,
            subject: recipientRow.personalized_subject,
            htmlBody: recipientRow.personalized_body_html,
            textBody: recipientRow.personalized_body_text,
            tags: {
              campaign_id: campaign.id,
              business_id: campaign.business_id,
            },
          });

          await executeQuery(
            `
              update email_campaign_recipients
              set
                status = 'sent',
                ses_message_id = $2,
                sent_at = $3::timestamptz,
                updated_at = now()
              where id = $1::uuid
            `,
            [recipientRow.id, sent.messageId, sent.sentAt],
            client,
          );

          await executeQuery(
            `
              insert into email_events (
                campaign_recipient_id,
                event_type,
                provider_message_id,
                payload_json,
                occurred_at
              ) values (
                $1::uuid,
                'sent',
                $2,
                $3::jsonb,
                $4::timestamptz
              )
            `,
            [
              recipientRow.id,
              sent.messageId,
              JSON.stringify({ provider: sent.provider }),
              sent.sentAt,
            ],
            client,
          );
        } catch (error) {
          failedCount += 1;
          const failureMessage = error instanceof Error ? error.message : "Unknown email send failure.";

          await executeQuery(
            `
              update email_campaign_recipients
              set
                status = 'failed',
                failed_at = now(),
                failure_reason = $2,
                updated_at = now()
              where id = $1::uuid
            `,
            [recipientRow.id, failureMessage],
            client,
          );

          await executeQuery(
            `
              insert into email_events (
                campaign_recipient_id,
                event_type,
                payload_json,
                occurred_at
              ) values (
                $1::uuid,
                'failed',
                $2::jsonb,
                now()
              )
            `,
            [
              recipientRow.id,
              JSON.stringify({
                message: failureMessage,
              }),
            ],
            client,
          );

          void safeCreateSystemErrorLog({
            route: "/api/businesses/:id/email/campaigns/:campaignId/send",
            businessId: campaign.business_id,
            code: "email_send_failed",
            message: failureMessage,
            metadata: {
              campaignId: campaign.id,
              recipientId: recipientRow.id,
            },
          });
        }
      }

      await executeQuery(
        `
          update email_campaigns
          set
            status = case when $2::int > 0 then 'failed' else 'sent' end,
            send_completed_at = now(),
            updated_at = now()
          where id = $1::uuid
        `,
        [campaign.id, failedCount],
        client,
      );
    });
  }
}

export async function sendEmailCampaign(
  businessId: string,
  campaignId: string,
  actorUserId?: string,
): Promise<SendEmailCampaignResponse> {
  await withDbTransaction(async (client) => {
    const campaign = await loadEmailCampaignOrThrow(businessId, campaignId, client);
    const contacts = await loadCampaignContacts(businessId, campaign.id, client);

    if (contacts.length === 0) {
      throw new HttpError(400, "email_campaign_no_contacts", "This campaign has no active contacts.");
    }

    await incrementBusinessDailyUsage(businessId, "emails", contacts.length);
    await ensureEmailSettingsRow(businessId, client);
    await upsertCampaignRecipients(campaign, contacts, client);
    await executeQuery(
      `
        update email_campaigns
        set
          status = 'queued',
          updated_at = now()
        where id = $1::uuid
      `,
      [campaignId],
      client,
    );
  });

  await processQueuedEmailCampaigns({
    businessId,
    campaignId,
  });

  void safeLogEvent("content_selected", actorUserId, businessId, {
    source: "email_campaign",
    campaignId,
  });

  const campaign = mapEmailCampaign(await loadEmailCampaignOrThrow(businessId, campaignId));
  const stats = await getCampaignStats(businessId, campaignId);

  return {
    campaign,
    stats,
  };
}

export async function createEmailDomain(
  businessId: string,
  input: CreateEmailDomainRequest,
): Promise<CreateEmailDomainResponse> {
  const domainName = input.domainName.trim().toLowerCase();

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domainName)) {
    throw new HttpError(400, "email_domain_invalid", "A valid domain is required.");
  }

  const dnsRecords = buildDnsRecords(domainName);

  const result = await executeQuery<EmailSettingsRow>(
    `
      insert into business_email_settings (
        business_id,
        from_name,
        from_email,
        reply_to_email,
        provider,
        domain_name,
        domain_status,
        dkim_status,
        spf_status,
        ses_identity,
        dns_records_json
      ) values (
        $1::uuid,
        $2,
        $3,
        $4,
        'ses',
        $5,
        'pending',
        'pending',
        'pending',
        $6,
        $7::jsonb
      )
      on conflict (business_id)
      do update set
        from_name = excluded.from_name,
        from_email = excluded.from_email,
        reply_to_email = excluded.reply_to_email,
        domain_name = excluded.domain_name,
        domain_status = 'pending',
        dkim_status = 'pending',
        spf_status = 'pending',
        ses_identity = excluded.ses_identity,
        dns_records_json = excluded.dns_records_json,
        last_checked_at = null,
        verified_at = null,
        updated_at = now()
      returning
        id,
        business_id,
        from_name,
        from_email,
        reply_to_email,
        provider,
        ses_identity,
        domain_name,
        domain_status,
        dkim_status,
        spf_status,
        dns_records_json,
        verified_at,
        last_checked_at,
        updated_at
    `,
    [
      businessId,
      input.fromName?.trim() || null,
      input.fromEmail?.trim() || null,
      input.replyToEmail?.trim() || null,
      domainName,
      domainName,
      JSON.stringify(dnsRecords),
    ],
  );

  return {
    settings: mapEmailSettings(result.rows[0]),
  };
}

export async function verifyEmailDomain(
  businessId: string,
  domainId: string,
): Promise<VerifyEmailDomainResponse> {
  const settings = await ensureEmailSettingsRow(businessId);
  const settingsRow = await executeQuery<EmailSettingsRow>(
    `
      select
        id,
        business_id,
        from_name,
        from_email,
        reply_to_email,
        provider,
        ses_identity,
        domain_name,
        domain_status,
        dkim_status,
        spf_status,
        dns_records_json,
        verified_at,
        last_checked_at,
        updated_at
      from business_email_settings
      where business_id = $1::uuid
      limit 1
    `,
    [businessId],
  );

  const row = settingsRow.rows[0];

  if (!row || row.id !== domainId) {
    throw new HttpError(404, "email_domain_not_found", "Email domain configuration not found.");
  }

  const autoVerify = /^(1|true|yes)$/i.test(process.env.EMAIL_DOMAIN_AUTO_VERIFY ?? "");
  const updatedResult = await executeQuery<EmailSettingsRow>(
    `
      update business_email_settings
      set
        domain_status = case when $2 then '${DOMAIN_STATUS_VERIFIED}' else domain_status end,
        dkim_status = case when $2 then '${DOMAIN_STATUS_VERIFIED}' else dkim_status end,
        spf_status = case when $2 then '${DOMAIN_STATUS_VERIFIED}' else spf_status end,
        verified_at = case when $2 then now() else verified_at end,
        last_checked_at = now(),
        updated_at = now()
      where business_id = $1::uuid
      returning
        id,
        business_id,
        from_name,
        from_email,
        reply_to_email,
        provider,
        ses_identity,
        domain_name,
        domain_status,
        dkim_status,
        spf_status,
        dns_records_json,
        verified_at,
        last_checked_at,
        updated_at
    `,
    [settings.businessId, autoVerify],
  );

  return {
    settings: mapEmailSettings(updatedResult.rows[0]),
  };
}

export async function unsubscribeEmail(token: string): Promise<UnsubscribeEmailResponse> {
  return withDbTransaction(async (client) => {
    const contactResult = await executeQuery<EmailContactRow>(
      `
        select
          id,
          business_id,
          email,
          first_name,
          last_name,
          tags_json,
          status,
          unsubscribe_token,
          unsubscribed_at,
          created_at,
          updated_at
        from email_contacts
        where unsubscribe_token = $1
        limit 1
      `,
      [token],
      client,
    );

    const row = contactResult.rows[0];

    if (!row) {
      throw new HttpError(404, "unsubscribe_token_not_found", "Unsubscribe token not found.");
    }

    const sourceCampaignResult = await executeQuery<{ campaign_id: string | null }>(
      `
        select r.campaign_id
        from email_campaign_recipients r
        where r.contact_id = $1::uuid
        order by r.created_at desc
        limit 1
      `,
      [row.id],
      client,
    );

    await recordBusinessUnsubscribe(
      {
        businessId: row.business_id,
        email: row.email,
        reason: "Recipient clicked the unsubscribe link.",
        source: "campaign",
        sourceCampaignId: sourceCampaignResult.rows[0]?.campaign_id ?? null,
      },
      client,
    );

    await executeQuery(
      `
        update email_contacts
        set
          status = 'unsubscribed',
          unsubscribed_at = coalesce(unsubscribed_at, now()),
          updated_at = now()
        where id = $1::uuid
      `,
      [row.id],
      client,
    );

    const updatedRecipients = await executeQuery<{ id: string }>(
      `
        update email_campaign_recipients
        set
          status = 'unsubscribed',
          updated_at = now()
        where contact_id = $1::uuid
          and status in ('queued', 'sent', 'delivered')
        returning id
      `,
      [row.id],
      client,
    );

    for (const recipient of updatedRecipients.rows) {
      await executeQuery(
        `
          insert into email_events (
            campaign_recipient_id,
            event_type,
            payload_json,
            occurred_at
          ) values (
            $1::uuid,
            'unsubscribe',
            $2::jsonb,
            now()
          )
        `,
        [
          recipient.id,
          JSON.stringify({
            source: "recipient_link",
          }),
        ],
        client,
      );
    }

    return {
      success: true,
      email: row.email,
    };
  });
}
