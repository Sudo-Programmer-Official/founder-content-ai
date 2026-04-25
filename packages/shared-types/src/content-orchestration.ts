export type ContentChannel = "linkedin" | "instagram" | "facebook" | "email";
export type ContentExecutionLane = "social" | "email";
export type ContentBatchStatus = "draft" | "confirmed" | "scheduled" | "archived";
export type ContentBatchSpacing = "daily" | "weekdays";
export type SocialContentPlanDuration = "7_days" | "14_days" | "30_days";
export type SocialContentPlanPlatform = Extract<ContentChannel, "linkedin" | "instagram" | "facebook">;
export type SocialContentPlanEntryType =
  | "educational"
  | "social_proof"
  | "promotional"
  | "community"
  | "story";
export type ContentVariantTextProfile = "full" | "medium" | "short";
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
export type ContentDistributionGroupStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "partial"
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

export interface ContentVariantAssetTransform {
  aspectRatio?: "1:1" | "9:16";
  maxImages?: number;
}

export interface ContentVariantAdaptationPlan {
  sourceChannel: ContentChannel;
  textProfile: ContentVariantTextProfile;
  assetTransform?: ContentVariantAssetTransform;
}

export interface ContentVariantMetadata {
  dayIndex?: number;
  angle?: string;
  adaptation?: ContentVariantAdaptationPlan;
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
  metadata?: ContentVariantMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface ContentDistributionGroup {
  id: string;
  businessId: string;
  contentItemId: string;
  primaryVariantId?: string;
  lane: ContentExecutionLane;
  title?: string;
  status: ContentDistributionGroupStatus;
  editableUntil?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleItem {
  id: string;
  businessId: string;
  contentItemId: string;
  variantId: string;
  distributionGroupId?: string;
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

export interface SocialContentPlanEntry {
  batchId: string;
  contentItemId: string;
  variantId: string;
  day: number;
  dateKey: string;
  scheduledTime: string;
  type: SocialContentPlanEntryType;
  platform: SocialContentPlanPlatform;
  title?: string;
  content: string;
  imagePrompt: string;
  cta: string;
  angle?: string;
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
  distributionGroups: ContentDistributionGroup[];
  scheduleItems: ScheduleItem[];
}

export interface ConfirmContentBatchRequest {
  businessId: string;
  batchId: string;
  startDate: string;
  defaultScheduledTime: string;
  audienceTimezone?: string;
  spacing?: ContentBatchSpacing;
  channels?: SocialContentPlanPlatform[];
}

export interface ConfirmContentBatchResponse {
  batch: ContentBatch;
  distributionGroups: ContentDistributionGroup[];
  scheduleItems: ScheduleItem[];
}

export interface GenerateContentPlanRequest {
  businessId: string;
  duration: SocialContentPlanDuration;
  goal: string;
  platforms: SocialContentPlanPlatform[];
  title?: string;
  tone?: string;
  audienceTimezone?: string;
  defaultScheduledTime?: string;
  startDate?: string;
}

export interface GenerateContentPlanResponse {
  batch: ContentBatch;
  items: ContentItem[];
  variants: ContentVariant[];
  selectedPlatforms: SocialContentPlanPlatform[];
  plan: SocialContentPlanEntry[];
}

export interface GetContentPlanResponse extends GetContentBatchResponse {
  selectedPlatforms: SocialContentPlanPlatform[];
  plan: SocialContentPlanEntry[];
}

export interface ApproveContentPlanRequest {
  businessId: string;
  batchId: string;
  startDate: string;
  defaultScheduledTime: string;
  audienceTimezone?: string;
  spacing?: ContentBatchSpacing;
  platforms?: SocialContentPlanPlatform[];
}

export interface ApproveContentPlanResponse extends ConfirmContentBatchResponse {
  selectedPlatforms: SocialContentPlanPlatform[];
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
