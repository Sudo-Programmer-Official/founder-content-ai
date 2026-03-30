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

export function formatScheduledPostDispatchWindow(post: ScheduledPost): string {
  return `${formatTimeWithZone(post.earliestDispatchAt, post.audienceTimezone)} - ${formatTimeWithZone(
    post.latestDispatchAt,
    post.audienceTimezone,
  )}`;
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
