import type { WorkspaceInsightsResponse } from "../../../packages/shared-types";
import { apiGet } from "./api-client";

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
}

function normalizeWorkspaceInsightsResponse(
  businessId: string,
  response: WorkspaceInsightsResponse | Record<string, unknown> | null | undefined,
): WorkspaceInsightsResponse {
  const candidate =
    response && typeof response === "object" && !Array.isArray(response)
      ? response as Record<string, unknown>
      : {};
  const summary =
    candidate.summary && typeof candidate.summary === "object" && !Array.isArray(candidate.summary)
      ? candidate.summary as Record<string, unknown>
      : {};
  const channelPerformance =
    candidate.channelPerformance
      && typeof candidate.channelPerformance === "object"
      && !Array.isArray(candidate.channelPerformance)
      ? candidate.channelPerformance as Record<string, unknown>
      : {};
  const email =
    channelPerformance.email && typeof channelPerformance.email === "object" && !Array.isArray(channelPerformance.email)
      ? channelPerformance.email as Record<string, unknown>
      : {};
  const social =
    channelPerformance.social
      && typeof channelPerformance.social === "object"
      && !Array.isArray(channelPerformance.social)
      ? channelPerformance.social as Record<string, unknown>
      : {};

  return {
    businessId:
      typeof candidate.businessId === "string" && candidate.businessId.trim() !== ""
        ? candidate.businessId
        : businessId,
    generatedAt:
      typeof candidate.generatedAt === "string" && candidate.generatedAt.trim() !== ""
        ? candidate.generatedAt
        : new Date().toISOString(),
    summary: {
      topTopicLabel: typeof summary.topTopicLabel === "string" ? summary.topTopicLabel : undefined,
      topTopicKey: typeof summary.topTopicKey === "string" ? summary.topTopicKey : undefined,
      crossChannelTopicLabel:
        typeof summary.crossChannelTopicLabel === "string" ? summary.crossChannelTopicLabel : undefined,
      weakTopicLabel: typeof summary.weakTopicLabel === "string" ? summary.weakTopicLabel : undefined,
      bestAngleLabel: typeof summary.bestAngleLabel === "string" ? summary.bestAngleLabel : undefined,
      bestFormatLabel: typeof summary.bestFormatLabel === "string" ? summary.bestFormatLabel : undefined,
      bestSendWindowLabel:
        typeof summary.bestSendWindowLabel === "string" ? summary.bestSendWindowLabel : undefined,
    },
    channelPerformance: {
      email: {
        campaigns: toNumber(email.campaigns),
        sent: toNumber(email.sent),
        delivered: toNumber(email.delivered),
        opens: toNumber(email.opens),
        clicks: toNumber(email.clicks),
        avgOpenRate: toNumber(email.avgOpenRate),
        avgClickRate: toNumber(email.avgClickRate),
      },
      social: {
        trackedPosts: toNumber(social.trackedPosts),
        publishedPosts: toNumber(social.publishedPosts),
        highSignalPosts: toNumber(social.highSignalPosts),
        mediumSignalPosts: toNumber(social.mediumSignalPosts),
        lowSignalPosts: toNumber(social.lowSignalPosts),
        avgEngagementScore: toNumber(social.avgEngagementScore),
      },
    },
    learningInsights: toStringArray(candidate.learningInsights),
    topContentTags: toStringArray(candidate.topContentTags),
    topics: Array.isArray(candidate.topics) ? candidate.topics as WorkspaceInsightsResponse["topics"] : [],
    patterns: Array.isArray(candidate.patterns) ? candidate.patterns as WorkspaceInsightsResponse["patterns"] : [],
    suggestions: Array.isArray(candidate.suggestions)
      ? candidate.suggestions as WorkspaceInsightsResponse["suggestions"]
      : [],
  };
}

export async function requestWorkspaceInsights(
  businessId: string,
): Promise<WorkspaceInsightsResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  const response = await apiGet<WorkspaceInsightsResponse>(`/workspace-insights?businessId=${encodedBusinessId}`);
  return normalizeWorkspaceInsightsResponse(businessId, response);
}
