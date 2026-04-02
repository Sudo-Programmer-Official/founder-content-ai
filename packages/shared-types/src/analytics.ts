import type { AdminWorkspaceAccessState } from "./admin-control.ts";
import type { EmailDeliverabilityBand, EmailDeliverabilityIssue } from "./email.ts";

export type AnalyticsEventType =
  | "voice_transcribed"
  | "onboarding_started"
  | "workspace_created"
  | "onboarding_completed"
  | "first_content_generated"
  | "first_content_copied"
  | "first_channel_connected"
  | "first_content_scheduled"
  | "idea_generated"
  | "hook_generated"
  | "post_generated"
  | "capture_used"
  | "remix_used"
  | "idea_saved"
  | "idea_converted"
  | "output_copied"
  | "content_selected"
  | "content_edited"
  | "content_stage_changed"
  | "content_type_selected"
  | "publish_marked"
  | "api_failed";

export type AnalyticsInputType = "idea" | "link" | "upload" | "voice";
export type ContentAssetType = "post" | "hook" | "email";
export type ContentAssetStatus = "draft" | "review" | "scheduled" | "posted" | "published";
export type ContentAssetSourceKind = "generated" | "manual" | "idea" | "capture" | "remix";
export type ContentAssetFormat = "story" | "list" | "insight";
export type ContentAssetHookType = "question" | "bold_statement" | "curiosity" | "direct";
export type ContentAssetLengthBucket = "short" | "medium" | "long";
export type ContentPovBoldness = "measured" | "balanced" | "bold";
export type AdminAlertType = "api_failure" | "abuse" | "anomaly";
export type AdminAlertSeverity = "low" | "medium" | "high";

export interface UsageEvent {
  id: string;
  userId?: string;
  businessId?: string;
  eventType: AnalyticsEventType;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ContentGenerationLog {
  id: string;
  userId?: string;
  businessId?: string;
  inputType: AnalyticsInputType;
  tokensUsed: number;
  model: string;
  latencyMs: number;
  success: boolean;
  createdAt: string;
}

export interface ContentAssetIntelligence {
  format: ContentAssetFormat;
  hookType: ContentAssetHookType;
  length: ContentAssetLengthBucket;
  wordCount: number;
  characterCount: number;
  quality?: ContentQualityScore;
  pov?: ContentPovProfile;
}

export interface ContentQualityScore {
  overall: number;
  hookStrength: number;
  clarity: number;
  businessAlignment: number;
  opinionStrength: number;
}

export interface ContentPovProfile {
  summary: string;
  boldness: ContentPovBoldness;
}

export interface ContentAsset {
  id: string;
  businessId?: string;
  userId?: string;
  contentType: ContentAssetType;
  title?: string;
  contentBody: unknown;
  status: ContentAssetStatus;
  pipelineStage?: Exclude<ContentAssetStatus, "published">;
  sourceKind?: ContentAssetSourceKind;
  sourceIdeaId?: string;
  textContent?: string;
  intelligence?: ContentAssetIntelligence;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkspaceMetricDaily {
  id: string;
  businessId: string;
  date: string;
  totalGenerations: number;
  totalCopies: number;
  totalRemixes: number;
  totalPublishes: number;
  postsCreated: number;
  postsScheduled: number;
  postsPublished: number;
  emailsSent: number;
  active: boolean;
  lastActiveAt?: string;
  createdAt: string;
}

export interface PlatformMetricDaily {
  id: string;
  date: string;
  totalUsers: number;
  totalWorkspaces: number;
  totalGenerations: number;
  totalApiFailures: number;
  createdAt: string;
}

export interface AdminAlert {
  id: string;
  type: AdminAlertType;
  severity: AdminAlertSeverity;
  message: string;
  metadata: Record<string, unknown>;
  resolved: boolean;
  createdAt: string;
}

export interface AnalyticsSeriesPoint {
  date: string;
  value: number;
}

export interface EventBreakdownEntry {
  eventType: AnalyticsEventType;
  total: number;
}

export interface AICostSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokens: number;
  estimatedCostUsd: number;
  byModel: Array<{
    model: string;
    requests: number;
    tokensUsed: number;
    estimatedCostUsd: number;
  }>;
}

import type { BillingEmailAddonSummary } from "./billing.ts";

export interface PlatformOverview {
  totals: {
    totalUsers: number;
    totalWorkspaces: number;
    totalGenerations: number;
    totalApiFailures: number;
    unresolvedAlerts: number;
  };
  userGrowth: AnalyticsSeriesPoint[];
  workspaceGrowth: AnalyticsSeriesPoint[];
  usageTrend: AnalyticsSeriesPoint[];
  aiUsage: AICostSummary;
  alerts: AdminAlert[];
}

export interface AdminUserListItem {
  id: string;
  email: string;
  fullName: string;
  status: string;
  lastActiveAt?: string;
  createdAt: string;
  businessCount: number;
}

export interface AdminWorkspaceListItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  ownerEmail?: string;
  memberCount: number;
  lastActiveAt?: string;
  access: AdminWorkspaceAccessState;
  emailAddon?: BillingEmailAddonSummary;
}

export interface UsageSummary {
  recentEvents: UsageEvent[];
  eventBreakdown: EventBreakdownEntry[];
  recentGenerationLogs: ContentGenerationLog[];
  generationCount: number;
  failureCount: number;
}

export interface WorkspaceOverview {
  businessId: string;
  totals: {
    totalGenerations: number;
    totalCopies: number;
    totalRemixes: number;
    totalPublishes: number;
    totalAssets: number;
  };
  funnel: {
    generated: number;
    copied: number;
    published: number;
  };
  activityTimeline: UsageEvent[];
  dailyMetrics: WorkspaceMetricDaily[];
  topAssets: ContentAsset[];
}

export interface AdminOverviewResponse {
  overview: PlatformOverview;
}

export interface AdminUsersResponse {
  users: AdminUserListItem[];
  totalUsers: number;
}

export interface AdminWorkspacesResponse {
  workspaces: AdminWorkspaceListItem[];
  totalWorkspaces: number;
}

export interface AdminUsageResponse {
  usageSummary: UsageSummary;
  aiCostSummary: AICostSummary;
  alerts: AdminAlert[];
}

export interface AdminOpsOverview {
  aiCallsToday: number;
  outreachMessagesToday: number;
  emailSendsToday: number;
  failuresToday: number;
  activeUsersToday: number;
  riskyEmailDomains: AdminRiskyEmailDomain[];
  workerHealth: AdminWorkerHealth;
  jobQueue: AdminJobQueueOverview;
  postingReliability: AdminPostingReliabilityOverview;
}

export type AdminWorkerStatus = "healthy" | "stale" | "offline";

export interface AdminWorkerHealth {
  workerKey: string;
  workerType: string;
  serviceName?: string;
  status: AdminWorkerStatus;
  pollIntervalMs: number;
  lastHeartbeatAt?: string;
  lastSuccessfulPassAt?: string;
  lastWorkDetectedAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
}

export interface AdminJobQueueTypeOverview {
  type: string;
  queued: number;
  processing: number;
  failed: number;
  paused: number;
  stuckQueued: number;
  staleProcessing: number;
}

export type AdminProblemJobKind = "failed" | "stuck_queued" | "stale_processing";

export interface AdminProblemJob {
  id: string;
  businessId?: string;
  type: string;
  status: string;
  problemKind: AdminProblemJobKind;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminJobQueueOverview {
  queued: number;
  processing: number;
  failed: number;
  paused: number;
  stuckQueued: number;
  staleProcessing: number;
  byType: AdminJobQueueTypeOverview[];
  problemJobs: AdminProblemJob[];
}

export interface AdminPostingReliabilityOverview {
  scheduledLast7d: number;
  publishedLast7d: number;
  failedLast7d: number;
  missedDueCount: number;
  processingNow: number;
  averagePublishDelayMinutes: number;
}

export interface AdminRiskyEmailDomain {
  businessId: string;
  businessName: string;
  domainName: string;
  score: number;
  scoreBand: EmailDeliverabilityBand;
  bounceRate7d: number;
  complaintRate7d: number;
  blockers: EmailDeliverabilityIssue[];
  lastEvaluatedAt?: string;
}

export interface SystemErrorLogEntry {
  id: string;
  route: string;
  userId?: string;
  businessId?: string;
  code: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ErrorCodeSummaryEntry {
  code: string;
  total: number;
}

export interface AdminOpsOverviewResponse {
  overview: AdminOpsOverview;
}

export interface AdminErrorsResponse {
  errors: SystemErrorLogEntry[];
  topCodes: ErrorCodeSummaryEntry[];
}

export interface WorkspaceAnalyticsOverviewResponse {
  overview: WorkspaceOverview;
}

export interface WorkspaceAnalyticsOverviewQuery {
  businessId: string;
}

export interface TrackAnalyticsEventRequest {
  eventType: AnalyticsEventType;
  businessId?: string;
  metadata?: Record<string, unknown>;
}

export interface TrackAnalyticsEventResponse {
  event: UsageEvent;
}
