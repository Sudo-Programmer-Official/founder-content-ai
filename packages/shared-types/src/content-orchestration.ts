export type ContentChannel = "linkedin" | "instagram" | "facebook" | "email";
export type ContentExecutionLane = "social" | "email";
export type ContentBatchStatus = "draft" | "confirmed" | "scheduled" | "archived";
export type ContentBatchSpacing = "daily" | "weekdays";
export type ContentVariantStatus =
  | "draft"
  | "ready"
  | "scheduled"
  | "processing"
  | "published"
  | "failed"
  | "paused"
  | "canceled";
export type ContentVariantSource = "generated" | "manual" | "remix";
export type ScheduleItemStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "published"
  | "failed"
  | "paused"
  | "canceled";
export type ScheduleCollisionPolicy = "allow" | "warn" | "block";

export interface ContentBatch {
  id: string;
  businessId: string;
  userId?: string;
  lane: ContentExecutionLane;
  primaryChannel: ContentChannel;
  days: number;
  title?: string;
  status: ContentBatchStatus;
  defaultAudienceTimezone?: string;
  defaultScheduledTime?: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
}

export interface ContentItem {
  id: string;
  businessId: string;
  userId?: string;
  batchId?: string;
  sourceAssetId?: string;
  idea?: string;
  baseText?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContentVariantMedia {
  images: string[];
  videos: string[];
}

export interface ContentVariant {
  id: string;
  contentItemId: string;
  businessId: string;
  channel: ContentChannel;
  lane: ContentExecutionLane;
  title?: string;
  text: string;
  html?: string;
  media: ContentVariantMedia;
  status: ContentVariantStatus;
  source: ContentVariantSource;
  isCustomized: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleItem {
  id: string;
  businessId: string;
  contentItemId: string;
  variantId: string;
  channel: ContentChannel;
  lane: ContentExecutionLane;
  scheduledDate: string;
  scheduledTime: string;
  audienceTimezone?: string;
  scheduledAt?: string;
  status: ScheduleItemStatus;
  externalReferenceId?: string;
  externalReferenceUrl?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface PlannerDaySchedule {
  dateKey: string;
  items: ScheduleItem[];
}

export interface GenerateContentBatchRequest {
  businessId: string;
  lane: ContentExecutionLane;
  primaryChannel: ContentChannel;
  days: number;
  title?: string;
  prompt: string;
  tone?: string;
  length?: string;
  audienceTimezone?: string;
  defaultScheduledTime?: string;
}

export interface GenerateContentBatchResponse {
  batch: ContentBatch;
  items: ContentItem[];
  variants: ContentVariant[];
}

export interface GetContentBatchResponse {
  batch: ContentBatch;
  items: ContentItem[];
  variants: ContentVariant[];
  scheduleItems: ScheduleItem[];
}

export interface ConfirmContentBatchRequest {
  businessId: string;
  batchId: string;
  startDate: string;
  defaultScheduledTime: string;
  audienceTimezone?: string;
  spacing?: ContentBatchSpacing;
}

export interface ConfirmContentBatchResponse {
  batch: ContentBatch;
  scheduleItems: ScheduleItem[];
}

export interface ContentVariantGenerationRequest {
  businessId: string;
  contentItemId: string;
  channels: ContentChannel[];
  preserveCustomizedVariants?: boolean;
}

export interface ContentVariantGenerationResponse {
  contentItem: ContentItem;
  variants: ContentVariant[];
}

export interface CreateScheduleItemRequest {
  businessId: string;
  variantId: string;
  channel: ContentChannel;
  lane: ContentExecutionLane;
  scheduledDate: string;
  scheduledTime: string;
  audienceTimezone?: string;
  collisionPolicy?: ScheduleCollisionPolicy;
}

export interface CreateScheduleItemResponse {
  scheduleItem: ScheduleItem;
}
