import type { ContentAsset, ContentAssetStatus } from "./analytics.ts";
import type { RecommendedPostTimeSlot } from "./social-publishing.ts";

export type IdeaInboxStatus = "new" | "converted" | "archived";
export type DashboardSuggestionType = "activity" | "timing" | "quality";
export type ContentPipelineStage = Exclude<ContentAssetStatus, "published">;

export interface IdeaInboxItem {
  id: string;
  businessId: string;
  userId?: string;
  text: string;
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

export interface ControlDashboardResponse {
  businessId: string;
  today: DashboardTodaySummary;
  pipeline: ContentPipelineColumn[];
  ideaInbox: IdeaInboxItem[];
  suggestions: DashboardSuggestion[];
}

export interface ControlDashboardQuery {
  businessId: string;
}

export interface CreateIdeaInboxRequest {
  businessId: string;
  text: string;
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
}

export interface UpdateContentPipelineItemResponse {
  asset: ContentAsset;
}
