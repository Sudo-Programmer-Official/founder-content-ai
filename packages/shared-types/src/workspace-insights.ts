export type WorkspaceInsightPatternType = "angle" | "format" | "send_window" | "tag";
export type WorkspaceInsightAngleType = "contrarian" | "story" | "tactical";
export type WorkspaceInsightSuggestionKind =
  | "double_down"
  | "missing_angle"
  | "reuse"
  | "timing"
  | "watchout";

export interface WorkspaceTopicInsight {
  topicKey: string;
  topicLabel: string;
  ideaCount: number;
  postCount: number;
  publishedCount: number;
  highSignalCount: number;
  mediumSignalCount: number;
  lowSignalCount: number;
  avgEngagementScore: number;
  emailSupportScore: number;
  reuseScore: number;
  exploredAngles: WorkspaceInsightAngleType[];
  missingAngles: WorkspaceInsightAngleType[];
  lastUsedAt?: string;
}

export interface WorkspaceContentPatternRollup {
  patternType: WorkspaceInsightPatternType;
  patternKey: string;
  label: string;
  supportCount: number;
  publishedCount: number;
  highSignalCount: number;
  lowSignalCount: number;
  avgEngagementScore: number;
  performanceScore: number;
}

export interface WorkspaceInsightSuggestion {
  id: string;
  kind: WorkspaceInsightSuggestionKind;
  title: string;
  description: string;
  reason: string;
  cta: string;
  ideaId?: string;
  topicKey?: string;
  topicLabel?: string;
  angleType?: WorkspaceInsightAngleType;
  patternType?: WorkspaceInsightPatternType;
  patternKey?: string;
}

export interface WorkspaceInsightSummary {
  topTopicLabel?: string;
  topTopicKey?: string;
  crossChannelTopicLabel?: string;
  weakTopicLabel?: string;
  bestAngleLabel?: string;
  bestFormatLabel?: string;
  bestSendWindowLabel?: string;
}

export interface WorkspaceEmailChannelPerformance {
  campaigns: number;
  sent: number;
  delivered: number;
  opens: number;
  clicks: number;
  avgOpenRate: number;
  avgClickRate: number;
}

export interface WorkspaceSocialChannelPerformance {
  trackedPosts: number;
  publishedPosts: number;
  highSignalPosts: number;
  mediumSignalPosts: number;
  lowSignalPosts: number;
  avgEngagementScore: number;
}

export interface WorkspaceChannelPerformance {
  email: WorkspaceEmailChannelPerformance;
  social: WorkspaceSocialChannelPerformance;
}

export interface WorkspaceInsightsResponse {
  businessId: string;
  generatedAt: string;
  summary: WorkspaceInsightSummary;
  channelPerformance: WorkspaceChannelPerformance;
  learningInsights: string[];
  topContentTags: string[];
  topics: WorkspaceTopicInsight[];
  patterns: WorkspaceContentPatternRollup[];
  suggestions: WorkspaceInsightSuggestion[];
}

export interface WorkspaceInsightsQuery {
  businessId: string;
}
