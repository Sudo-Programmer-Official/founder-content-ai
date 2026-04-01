import type {
  ContentAsset,
  ContentAssetFormat,
  ContentAssetHookType,
  ContentAssetLengthBucket,
  ContentAssetStatus,
} from "./analytics.ts";
import type { RepurposeStrategy } from "./repurpose.ts";
import type { PostPerformanceLabel, RecommendedPostTimeSlot } from "./social-publishing.ts";

export type IdeaInboxStatus = "new" | "converted" | "archived";
export type IdeaInboxInputType = "text" | "voice" | "image" | "link";
export type IdeaInboxUnderstandingStatus = "queued" | "processing" | "completed" | "failed";
export type DashboardSuggestionType = "activity" | "timing" | "quality";
export type ContentPipelineStage = Exclude<ContentAssetStatus, "published">;
export type DashboardNextActionType = "generate" | "schedule" | "review" | "improve";

export interface IdeaInboxMetadata {
  sourceUrl?: string;
  hostname?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
}

export interface IdeaInboxUnderstanding {
  topic: string;
  intent: "educate" | "story" | "opinion" | "proof";
  contentType: "insight" | "story" | "opinion" | "proof";
  businessGoal?: string;
  businessAngle: string;
  povSummary: string;
  suggestedCta?: string;
  confidenceScore?: number;
}

export interface IdeaInboxItem {
  id: string;
  businessId: string;
  userId?: string;
  inputType: IdeaInboxInputType;
  text: string;
  rawInput?: string;
  metadata?: IdeaInboxMetadata;
  understanding?: IdeaInboxUnderstanding;
  understandingStatus: IdeaInboxUnderstandingStatus;
  understandingError?: string;
  understandingConfidenceScore?: number;
  status: IdeaInboxStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSuggestion {
  id: string;
  type: DashboardSuggestionType;
  title: string;
  description: string;
  actionLabel?: string;
  actionTarget?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardTodaySummary {
  businessId: string;
  dateLabel: string;
  draftCount: number;
  reviewCount: number;
  scheduledCount: number;
  postedCount: number;
  ideaInboxCount: number;
  streakDays: number;
  lastActivityAt?: string;
  bestTimeSlots: RecommendedPostTimeSlot[];
}

export interface ContentPipelineColumn {
  stage: ContentPipelineStage;
  label: string;
  items: ContentAsset[];
}

export interface DashboardIntelligenceSummary {
  postsPublished7d: number;
  postedDays7d: number;
  bestWeekPostedDays: number;
  skippedDays7d: number;
  nextSuggestedPostLabel?: string;
  topFormat?: ContentAssetFormat;
  topHookType?: ContentAssetHookType;
  topLength?: ContentAssetLengthBucket;
}

export interface DashboardRetentionSummary {
  activeDays7d: number;
  postsCreated7d: number;
  postsScheduled7d: number;
  postsPublished7d: number;
  emailsSent7d: number;
  consistencyScore: number;
  previousConsistencyScore: number;
  consistencyDelta: number;
  currentStreakDays: number;
  inactivityDays: number;
  bestDayLabel?: string;
  nudgeTitle: string;
  nudgeMessage: string;
  nudgeActionLabel?: string;
  nudgeActionTarget?: string;
}

export interface DashboardRecentResultsSummary {
  lastPublishedPostAt?: string;
  lastCampaignCompletedAt?: string;
  nextScheduledPostAt?: string;
}

export interface DashboardNextAction {
  type: DashboardNextActionType;
  title: string;
  description: string;
  cta: string;
  route: string;
}

export interface ContentGenerationSuggestion {
  id: string;
  title: string;
  description: string;
  rationale: string;
  strategy: RepurposeStrategy;
  sourceAssetId: string;
  sourceTitle: string;
  sourceStage?: ContentPipelineStage;
  sourceText: string;
  previewText: string;
  recommended: boolean;
  performanceLabel?: PostPerformanceLabel;
}

export interface ListContentGenerationSuggestionsResponse {
  businessId: string;
  suggestions: ContentGenerationSuggestion[];
}

export interface ControlDashboardResponse {
  businessId: string;
  today: DashboardTodaySummary;
  intelligence: DashboardIntelligenceSummary;
  retention: DashboardRetentionSummary;
  recentResults: DashboardRecentResultsSummary;
  nextAction: DashboardNextAction;
  pipeline: ContentPipelineColumn[];
  ideaInbox: IdeaInboxItem[];
  suggestions: DashboardSuggestion[];
}

export interface ControlDashboardQuery {
  businessId: string;
}

export interface ListContentGenerationSuggestionsQuery {
  businessId: string;
}

export interface CreateIdeaInboxRequest {
  businessId: string;
  text?: string;
  inputType?: IdeaInboxInputType;
  rawInput?: string;
  processedText?: string;
  metadata?: IdeaInboxMetadata;
}

export interface CreateIdeaInboxResponse {
  idea: IdeaInboxItem;
}

export interface ConvertIdeaToContentRequest {
  tone?: string;
  length?: string;
}

export interface ConvertIdeaToContentResponse {
  idea: IdeaInboxItem;
  asset: ContentAsset;
}

export interface UpdateContentPipelineItemRequest {
  title?: string;
  textContent?: string;
  status?: ContentPipelineStage;
  contentBody?: Record<string, unknown>;
}

export interface UpdateContentPipelineItemResponse {
  asset: ContentAsset;
}

export interface DeleteContentPipelineItemResponse {
  deletedAssetId: string;
}

export interface CreateContentPipelineItemRequest {
  businessId: string;
  title?: string;
  textContent: string;
  contentBody?: Record<string, unknown>;
  sourceKind?: ContentAsset["sourceKind"];
}

export interface CreateContentPipelineItemResponse {
  asset: ContentAsset;
}

export interface DuplicateContentPipelineItemResponse {
  asset: ContentAsset;
}

export interface PreviewContentAiEditRequest {
  businessId: string;
  assetId?: string;
  textContent?: string;
  instruction: string;
}

export interface ContentAiEditPreview {
  instruction: string;
  interpretedActions: string[];
  summary: string;
  scopeHint: string;
  originalText: string;
  suggestedText: string;
  beforeExcerpt: string;
  afterExcerpt: string;
}

export interface PreviewContentAiEditResponse {
  preview: ContentAiEditPreview;
}

export interface GetContentPipelineItemQuery {
  businessId: string;
}

export interface GetContentPipelineItemResponse {
  asset: ContentAsset;
}
