import type { EmailCampaignStats } from "../../../../../packages/shared-types/index.ts";
import type { QueryResultRow } from "pg";
import { queryDb } from "../db/client.ts";
import { logInfo, logWarn } from "../../utils/logger.ts";
import { sendPlatformEmail } from "./emailTransportService.ts";

type EmailCampaignNotificationEvent = "started" | "completed" | "failed";

interface EmailCampaignNotificationRow extends QueryResultRow {
  campaign_id: string;
  business_id: string;
  campaign_name: string;
  campaign_status: string;
  send_started_at: Date | string | null;
  send_completed_at: Date | string | null;
  updated_at: Date | string;
  business_name: string;
  business_timezone: string;
  owner_user_id: string;
  owner_email: string;
  owner_full_name: string;
  notify_email_campaign_updates: boolean;
}

interface EmailCampaignStatsRow extends QueryResultRow {
  total: string | number;
  pending_total: string | number;
  sent_total: string | number;
  delivered_total: string | number;
  failed_total: string | number;
  unsubscribed_total: string | number;
}

function getPrimaryFrontendOrigin(): string | null {
  const origins = (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  return origins[0] ?? null;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(value));
}

function getEventColumn(eventType: EmailCampaignNotificationEvent): string {
  switch (eventType) {
    case "started":
      return "start_notification_sent_at";
    case "completed":
      return "completion_notification_sent_at";
    case "failed":
      return "failure_notification_sent_at";
  }
}

function getEventSubject(eventType: EmailCampaignNotificationEvent): string {
  switch (eventType) {
    case "started":
      return "Your email campaign is now sending";
    case "completed":
      return "Your email campaign finished";
    case "failed":
      return "Your email campaign needs attention";
  }
}

function getEventIntro(eventType: EmailCampaignNotificationEvent): string {
  switch (eventType) {
    case "started":
      return "Your campaign is now sending.";
    case "completed":
      return "Your campaign finished sending.";
    case "failed":
      return "Your campaign finished with issues and needs attention.";
  }
}

function getEventTimestampLabel(eventType: EmailCampaignNotificationEvent): string {
  switch (eventType) {
    case "started":
      return "Started at";
    case "completed":
      return "Completed at";
    case "failed":
      return "Last updated at";
  }
}

function getEventTimestampValue(
  row: EmailCampaignNotificationRow,
  eventType: EmailCampaignNotificationEvent,
): Date | string {
  if (eventType === "started") {
    return row.send_started_at ?? row.updated_at;
  }

  if (eventType === "completed") {
    return row.send_completed_at ?? row.updated_at;
  }

  return row.updated_at;
}

function buildHtmlBody(input: {
  ownerFirstName: string;
  intro: string;
  campaignName: string;
  timestampLabel: string;
  timestampValue: string;
  stats: EmailCampaignStats;
  campaignsUrl?: string | null;
}): string {
  const campaignsMarkup = input.campaignsUrl
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(input.campaignsUrl)}">Open campaigns</a></p>`
    : "";

  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#241d19;line-height:1.6;">
      <p>Hey ${escapeHtml(input.ownerFirstName)},</p>
      <p>${escapeHtml(input.intro)}</p>
      <p><strong>Campaign</strong><br />${escapeHtml(input.campaignName)}</p>
      <p><strong>${escapeHtml(input.timestampLabel)}</strong><br />${escapeHtml(input.timestampValue)}</p>
      <hr style="border:0;border-top:1px solid #e7ddd3;margin:24px 0;" />
      <p style="margin:0 0 8px;"><strong>Current summary</strong></p>
      <p style="margin:0 0 4px;">Sent: ${input.stats.sentCount}</p>
      <p style="margin:0 0 4px;">Delivered: ${input.stats.deliveredCount}</p>
      <p style="margin:0 0 4px;">Failed: ${input.stats.failedCount}</p>
      <p style="margin:0 0 4px;">Pending: ${input.stats.pendingCount}</p>
      <p style="margin:0 0 4px;">Unsubscribed: ${input.stats.unsubscribedCount}</p>
      <p style="margin:16px 0 4px;">Opens: tracking not enabled yet</p>
      <p style="margin:0;">Clicks: tracking not enabled yet</p>
      ${campaignsMarkup}
      <p style="margin:24px 0 0;color:#62584f;">FounderContent</p>
    </div>
  `.trim();
}

function buildTextBody(input: {
  ownerFirstName: string;
  intro: string;
  campaignName: string;
  timestampLabel: string;
  timestampValue: string;
  stats: EmailCampaignStats;
  campaignsUrl?: string | null;
}): string {
  const lines = [
    `Hey ${input.ownerFirstName},`,
    "",
    input.intro,
    "",
    `Campaign: ${input.campaignName}`,
    `${input.timestampLabel}: ${input.timestampValue}`,
    "",
    "Current summary",
    `Sent: ${input.stats.sentCount}`,
    `Delivered: ${input.stats.deliveredCount}`,
    `Failed: ${input.stats.failedCount}`,
    `Pending: ${input.stats.pendingCount}`,
    `Unsubscribed: ${input.stats.unsubscribedCount}`,
    "Opens: tracking not enabled yet",
    "Clicks: tracking not enabled yet",
  ];

  if (input.campaignsUrl) {
    lines.push("", `Open campaigns: ${input.campaignsUrl}`);
  }

  lines.push("", "FounderContent");
  return lines.join("\n");
}

async function claimNotificationDispatch(
  campaignId: string,
  eventType: EmailCampaignNotificationEvent,
): Promise<boolean> {
  const column = getEventColumn(eventType);
  const result = await queryDb(
    `
      update email_campaigns
      set ${column} = now()
      where id = $1::uuid
        and ${column} is null
    `,
    [campaignId],
  );

  return (result.rowCount ?? 0) > 0;
}

async function releaseNotificationDispatch(
  campaignId: string,
  eventType: EmailCampaignNotificationEvent,
): Promise<void> {
  const column = getEventColumn(eventType);
  await queryDb(
    `
      update email_campaigns
      set ${column} = null,
          updated_at = now()
      where id = $1::uuid
    `,
    [campaignId],
  );
}

async function loadEmailCampaignNotificationRow(
  campaignId: string,
): Promise<EmailCampaignNotificationRow | null> {
  const result = await queryDb<EmailCampaignNotificationRow>(
    `
      select
        c.id as campaign_id,
        c.business_id,
        c.name as campaign_name,
        c.status as campaign_status,
        c.send_started_at,
        c.send_completed_at,
        c.updated_at,
        b.name as business_name,
        b.timezone as business_timezone,
        u.id as owner_user_id,
        u.email as owner_email,
        u.full_name as owner_full_name,
        coalesce(up.notify_email_campaign_updates, true) as notify_email_campaign_updates
      from email_campaigns c
      join businesses b on b.id = c.business_id
      join users u on u.id = b.owner_user_id
      left join user_preferences up on up.user_id = u.id
      where c.id = $1::uuid
      limit 1
    `,
    [campaignId],
  );

  return result.rows[0] ?? null;
}

async function loadEmailCampaignStats(campaignId: string): Promise<EmailCampaignStats> {
  const result = await queryDb<EmailCampaignStatsRow>(
    `
      select
        count(*)::int as total,
        count(*) filter (where status in ('queued', 'sending'))::int as pending_total,
        count(*) filter (where status in ('sent', 'delivered'))::int as sent_total,
        count(*) filter (where status = 'delivered')::int as delivered_total,
        count(*) filter (where status = 'failed')::int as failed_total,
        count(*) filter (where status = 'unsubscribed')::int as unsubscribed_total
      from email_campaign_recipients
      where campaign_id = $1::uuid
    `,
    [campaignId],
  );

  const row = result.rows[0];
  return {
    campaignId,
    recipientCount: toNumber(row?.total),
    pendingCount: toNumber(row?.pending_total),
    sentCount: toNumber(row?.sent_total),
    deliveredCount: toNumber(row?.delivered_total),
    failedCount: toNumber(row?.failed_total),
    unsubscribedCount: toNumber(row?.unsubscribed_total),
  };
}

export async function sendEmailCampaignLifecycleNotification(input: {
  campaignId: string;
  eventType: EmailCampaignNotificationEvent;
}): Promise<void> {
  const claimed = await claimNotificationDispatch(input.campaignId, input.eventType);

  if (!claimed) {
    return;
  }

  try {
    const campaign = await loadEmailCampaignNotificationRow(input.campaignId);

    if (!campaign) {
      logWarn("Skipped email campaign notification because the campaign was not found.", {
        campaignId: input.campaignId,
        eventType: input.eventType,
      });
      return;
    }

    if (!campaign.notify_email_campaign_updates) {
      logInfo("Skipped email campaign notification because the user opted out.", {
        campaignId: input.campaignId,
        eventType: input.eventType,
        userId: campaign.owner_user_id,
      });
      return;
    }

    const stats = await loadEmailCampaignStats(input.campaignId);
    const displayTimeZone = campaign.business_timezone?.trim() || "UTC";
    const campaignsUrl = getPrimaryFrontendOrigin()
      ? `${getPrimaryFrontendOrigin()}/app/email?tab=campaigns`
      : null;
    const ownerFirstName =
      campaign.owner_full_name.trim().split(/\s+/).find((segment) => segment !== "") ?? "there";
    const timestampLabel = getEventTimestampLabel(input.eventType);
    const timestampValue = formatDateTime(
      getEventTimestampValue(campaign, input.eventType),
      displayTimeZone,
    );
    const intro = getEventIntro(input.eventType);

    await sendPlatformEmail({
      fromEmail: process.env.SYSTEM_FROM_EMAIL?.trim() || "notifications@foundercontent.ai",
      fromName: "FounderContent",
      toEmail: campaign.owner_email,
      subject: getEventSubject(input.eventType),
      htmlBody: buildHtmlBody({
        ownerFirstName,
        intro,
        campaignName: campaign.campaign_name,
        timestampLabel,
        timestampValue,
        stats,
        campaignsUrl,
      }),
      textBody: buildTextBody({
        ownerFirstName,
        intro,
        campaignName: campaign.campaign_name,
        timestampLabel,
        timestampValue,
        stats,
        campaignsUrl,
      }),
      tags: {
        notification_type: `email_campaign_${input.eventType}`,
        business_id: campaign.business_id,
        campaign_id: campaign.campaign_id,
      },
    });
  } catch (error) {
    await releaseNotificationDispatch(input.campaignId, input.eventType);
    throw error;
  }
}
