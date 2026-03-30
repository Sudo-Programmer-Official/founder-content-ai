import type { QueryResultRow } from "pg";
import { queryDb } from "./db/client.ts";
import { sendPlatformEmail } from "./email/emailTransportService.ts";
import { logInfo, logWarn } from "../utils/logger.ts";

interface PublishedPostNotificationRow extends QueryResultRow {
  business_id: string;
  business_name: string;
  business_timezone: string;
  owner_user_id: string;
  owner_email: string;
  owner_full_name: string;
  notify_post_published: boolean;
  scheduled_post_id: string;
  content_text: string;
  published_at: Date | string | null;
  external_post_url: string | null;
}

interface NextScheduledPostRow extends QueryResultRow {
  id: string;
  content_text: string;
  scheduled_at: Date | string;
  audience_timezone: string;
}

function getPrimaryFrontendOrigin(): string | null {
  const origins = (process.env.FRONTEND_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  return origins[0] ?? null;
}

function excerptContent(content: string, maxLength = 120): string {
  const firstNonEmptyLine =
    content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "Untitled post";

  if (firstNonEmptyLine.length <= maxLength) {
    return firstNonEmptyLine;
  }

  return `${firstNonEmptyLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
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

function buildHtmlBody(input: {
  ownerFirstName: string;
  publishedTitle: string;
  publishedAtLabel: string;
  externalPostUrl?: string | null;
  nextScheduledAtLabel?: string;
  nextScheduledPreview?: string;
  plannerUrl?: string | null;
}): string {
  const viewPostMarkup = input.externalPostUrl
    ? `<p><a href="${escapeHtml(input.externalPostUrl)}">View post on LinkedIn</a></p>`
    : "";
  const nextScheduledMarkup =
    input.nextScheduledAtLabel && input.nextScheduledPreview
      ? `
        <hr style="border:0;border-top:1px solid #e7ddd3;margin:24px 0;" />
        <p style="margin:0 0 8px;"><strong>Next scheduled post</strong></p>
        <p style="margin:0 0 4px;">${escapeHtml(input.nextScheduledAtLabel)}</p>
        <p style="margin:0;color:#62584f;">${escapeHtml(input.nextScheduledPreview)}</p>
      `
      : `
        <hr style="border:0;border-top:1px solid #e7ddd3;margin:24px 0;" />
        <p style="margin:0 0 8px;"><strong>No upcoming posts scheduled</strong></p>
        <p style="margin:0;color:#62584f;">Open the planner and line up the next draft while momentum is high.</p>
      `;
  const plannerMarkup = input.plannerUrl
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(input.plannerUrl)}">Open planner</a></p>`
    : "";

  return `
    <div style="font-family:Inter,Arial,sans-serif;color:#241d19;line-height:1.6;">
      <p>Hey ${escapeHtml(input.ownerFirstName)},</p>
      <p>Your LinkedIn post is now live.</p>
      <p><strong>Post</strong><br />${escapeHtml(input.publishedTitle)}</p>
      <p><strong>Published at</strong><br />${escapeHtml(input.publishedAtLabel)}</p>
      ${viewPostMarkup}
      ${nextScheduledMarkup}
      ${plannerMarkup}
      <p style="margin:24px 0 0;">You're building consistency. Keep going.</p>
      <p style="margin:8px 0 0;color:#62584f;">FounderContent</p>
    </div>
  `.trim();
}

function buildTextBody(input: {
  ownerFirstName: string;
  publishedTitle: string;
  publishedAtLabel: string;
  externalPostUrl?: string | null;
  nextScheduledAtLabel?: string;
  nextScheduledPreview?: string;
  plannerUrl?: string | null;
}): string {
  const lines = [
    `Hey ${input.ownerFirstName},`,
    "",
    "Your LinkedIn post is now live.",
    "",
    `Post: ${input.publishedTitle}`,
    `Published at: ${input.publishedAtLabel}`,
  ];

  if (input.externalPostUrl) {
    lines.push(`View post: ${input.externalPostUrl}`);
  }

  lines.push("", "Next scheduled post:");

  if (input.nextScheduledAtLabel && input.nextScheduledPreview) {
    lines.push(input.nextScheduledAtLabel, input.nextScheduledPreview);
  } else {
    lines.push("No upcoming posts scheduled.");
  }

  if (input.plannerUrl) {
    lines.push("", `Open planner: ${input.plannerUrl}`);
  }

  lines.push("", "You're building consistency. Keep going.", "", "- FounderContent");
  return lines.join("\n");
}

export async function sendScheduledPostPublishedNotification(
  scheduledPostId: string,
): Promise<void> {
  const publishedResult = await queryDb<PublishedPostNotificationRow>(
    `
      select
        sp.id as scheduled_post_id,
        sp.business_id,
        sp.content_text,
        sp.published_at,
        sp.external_post_url,
        b.name as business_name,
        b.timezone as business_timezone,
        u.id as owner_user_id,
        u.email as owner_email,
        u.full_name as owner_full_name,
        coalesce(up.notify_post_published, true) as notify_post_published
      from scheduled_posts sp
      join businesses b on b.id = sp.business_id
      join users u on u.id = b.owner_user_id
      left join user_preferences up on up.user_id = u.id
      where sp.id = $1
        and sp.status = 'published'
      limit 1
    `,
    [scheduledPostId],
  );

  const publishedPost = publishedResult.rows[0];

  if (!publishedPost) {
    logWarn("Skipped post-published notification because the scheduled post was not found.", {
      scheduledPostId,
    });
    return;
  }

  if (!publishedPost.notify_post_published) {
    logInfo("Skipped post-published notification because the user opted out.", {
      scheduledPostId,
      userId: publishedPost.owner_user_id,
    });
    return;
  }

  const nextPostResult = await queryDb<NextScheduledPostRow>(
    `
      select
        id,
        content_text,
        scheduled_at,
        audience_timezone
      from scheduled_posts
      where business_id = $1
        and status = 'scheduled'
        and scheduled_at > now()
      order by scheduled_at asc
      limit 1
    `,
    [publishedPost.business_id],
  );

  const nextPost = nextPostResult.rows[0];
  const displayTimeZone = publishedPost.business_timezone?.trim() || "UTC";
  const plannerUrl = getPrimaryFrontendOrigin()
    ? `${getPrimaryFrontendOrigin()}/app/planner`
    : null;
  const ownerFirstName =
    publishedPost.owner_full_name.trim().split(/\s+/).find((segment) => segment !== "") ?? "there";
  const publishedTitle = excerptContent(publishedPost.content_text);
  const publishedAtLabel = formatDateTime(
    publishedPost.published_at ?? new Date().toISOString(),
    displayTimeZone,
  );
  const nextScheduledAtLabel = nextPost
    ? formatDateTime(nextPost.scheduled_at, nextPost.audience_timezone || displayTimeZone)
    : undefined;
  const nextScheduledPreview = nextPost ? excerptContent(nextPost.content_text, 96) : undefined;

  await sendPlatformEmail({
    fromEmail: process.env.SYSTEM_FROM_EMAIL?.trim() || "notifications@foundercontent.ai",
    fromName: "FounderContent",
    toEmail: publishedPost.owner_email,
    subject: "Your LinkedIn post is live",
    htmlBody: buildHtmlBody({
      ownerFirstName,
      publishedTitle,
      publishedAtLabel,
      externalPostUrl: publishedPost.external_post_url,
      nextScheduledAtLabel,
      nextScheduledPreview,
      plannerUrl,
    }),
    textBody: buildTextBody({
      ownerFirstName,
      publishedTitle,
      publishedAtLabel,
      externalPostUrl: publishedPost.external_post_url,
      nextScheduledAtLabel,
      nextScheduledPreview,
      plannerUrl,
    }),
    tags: {
      notification_type: "post_published",
      business_id: publishedPost.business_id,
      scheduled_post_id: publishedPost.scheduled_post_id,
    },
  });

  logInfo("Sent post-published notification email.", {
    scheduledPostId: publishedPost.scheduled_post_id,
    userId: publishedPost.owner_user_id,
    nextScheduledPostId: nextPost?.id ?? null,
  });
}
