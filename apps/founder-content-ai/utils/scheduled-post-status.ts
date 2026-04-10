import type { ScheduledPost, ScheduledPostStatus } from "../../../packages/shared-types";
import { formatTimeWithZone } from "./timezone";

export function resolveScheduledPostStatusLabel(status: ScheduledPostStatus): string {
  switch (status) {
    case "published":
      return "Posted";
    case "processing":
      return "Publishing";
    case "paused":
      return "Paused";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return "Queued";
  }
}

export function formatDispatchWindowRange(
  earliestDispatchAt: string,
  latestDispatchAt: string,
  timezone: string,
): string {
  const startLabel = formatTimeWithZone(earliestDispatchAt, timezone);
  const endLabel = formatTimeWithZone(latestDispatchAt, timezone);

  if (startLabel === endLabel) {
    const spreadSeconds = Math.max(
      0,
      Math.round((new Date(latestDispatchAt).getTime() - new Date(earliestDispatchAt).getTime()) / 1000),
    );

    return spreadSeconds > 0
      ? `around ${startLabel}, spread across ~${spreadSeconds} sec`
      : `around ${startLabel}`;
  }

  return `${startLabel} - ${endLabel}`;
}

export function formatScheduledPostDispatchWindow(post: ScheduledPost): string {
  return formatDispatchWindowRange(post.earliestDispatchAt, post.latestDispatchAt, post.audienceTimezone);
}

export function resolveScheduledPostStatusSummary(post: ScheduledPost): string {
  switch (post.status) {
    case "processing":
      return "The worker is publishing this slot now.";
    case "paused":
      return `Dispatch is paused. It will stay frozen until you resume it.`;
    case "failed":
      return "Dispatch stopped before publish. Review the failure, reconnect if needed, then retry.";
    case "canceled":
      return "This slot was canceled. It will not be sent unless you schedule it again.";
    case "published":
      return `Published on LinkedIn at ${formatTimeWithZone(
        post.publishedAt || post.scheduledAt,
        post.audienceTimezone,
      )}.`;
    default:
      return `Queued for dispatch inside ${formatScheduledPostDispatchWindow(post)}.`;
  }
}
