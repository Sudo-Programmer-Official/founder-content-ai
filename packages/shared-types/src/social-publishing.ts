export type SocialPlatform = "linkedin" | "facebook" | "instagram";
export type SocialAccountStatus = "connected" | "expired" | "revoked" | "error";
export type PostAssetType = "image" | "video";
export type PostAssetSource = "upload" | "generated";
export type PostAssetStatus = "uploaded" | "processing" | "ready" | "failed";
export type PostAssetAspectRatio = "1:1" | "9:16";
export type PostAssetMetadataSource = "upload" | "motion_template";
export type PostPerformanceLabel = "low" | "medium" | "high";
export type SchedulingSafetyWarningCode = "daily_limit" | "minimum_gap";
export type ScheduledPostStatus =
  | "scheduled"
  | "processing"
  | "published"
  | "failed"
  | "paused"
  | "canceled";
export type SocialAccountIdentityType = "person" | "organization" | "page";
export type ScheduledPostMutationAction =
  | "pause"
  | "resume"
  | "cancel"
  | "reschedule"
  | "retry"
  | "publish_now"
  | "move_to_draft";

export interface SocialAccountIdentity {
  id: string;
  platform: SocialPlatform;
  type: SocialAccountIdentityType;
  platformIdentityId: string;
  platformIdentityUrn: string;
  displayName: string;
  avatarUrl?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SocialAccount {
  id: string;
  businessId: string;
  userId: string;
  platform: SocialPlatform;
  platformUserId: string;
  platformUserUrn: string;
  accountEmail?: string;
  tokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  scopes: string[];
  status: SocialAccountStatus;
  metadata: Record<string, unknown>;
  availableIdentities: SocialAccountIdentity[];
  selectedIdentity?: SocialAccountIdentity;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationEvent {
  id: string;
  scheduledPostId: string;
  status: ScheduledPostStatus;
  response: Record<string, unknown>;
  createdAt: string;
}

export type MotionTemplateId = "subtle_zoom" | "caption_pulse" | "story_pan";
export type MotionTemplateAspectRatio = "square" | "portrait";

export interface MotionTemplateMetadata {
  id: MotionTemplateId;
  aspectRatio?: MotionTemplateAspectRatio;
  durationMs?: number;
  loop?: boolean;
  sourceAssetIds?: string[];
  sourceSlideCount?: number;
}

export interface BasePostAssetMetadata {
  aspectRatio?: PostAssetAspectRatio;
}

export interface ImagePostAssetMetadata extends BasePostAssetMetadata {
  source?: "upload";
}

export interface VideoPostAssetMetadata extends BasePostAssetMetadata {
  durationMs?: number;
  width?: number;
  height?: number;
  source?: PostAssetMetadataSource;
  motionTemplate?: MotionTemplateMetadata;
  posterAssetId?: string;
}

export type PostAssetMetadata = ImagePostAssetMetadata | VideoPostAssetMetadata;

export interface BasePostAsset {
  id: string;
  businessId: string;
  postId: string;
  source: PostAssetSource;
  storageKey: string;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  orderIndex: number;
  status: PostAssetStatus;
  previewUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImagePostAsset extends BasePostAsset {
  type: "image";
  metadata: ImagePostAssetMetadata;
}

export interface VideoPostAsset extends BasePostAsset {
  type: "video";
  metadata: VideoPostAssetMetadata;
}

export type PostAsset = ImagePostAsset | VideoPostAsset;

export interface ScheduledPostSlide {
  imageDataUrl: string;
  altText?: string;
  mimeType?: string;
}

export interface ScheduledPost {
  id: string;
  businessId: string;
  userId: string;
  platform: SocialPlatform;
  selectedIdentityId?: string;
  selectedIdentityDisplayName?: string;
  selectedIdentityType?: SocialAccountIdentityType;
  contentText: string;
  assetGroupId?: string;
  slides: ScheduledPostSlide[];
  assets: PostAsset[];
  scheduledAt: string;
  earliestDispatchAt: string;
  latestDispatchAt: string;
  audienceTimezone: string;
  status: ScheduledPostStatus;
  dispatchPriority: number;
  dispatchJobId?: string;
  externalPostId?: string;
  externalPostUrl?: string;
  errorMessage?: string;
  retryCount: number;
  performanceLabel?: PostPerformanceLabel;
  performanceRecordedAt?: string;
  engagementScore?: number;
  lastAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface SchedulingSafetyWarning {
  code: SchedulingSafetyWarningCode;
  title: string;
  message: string;
}

export type RecommendPostTimeContentType = "carousel" | "image" | "text";

export interface RecommendedPostTimeSlot {
  scheduledAt: string;
  localLabel: string;
  reason: string;
  source: "global" | "history" | "hybrid";
}

export interface RecommendPostTimeQuery {
  businessId: string;
  contentType?: RecommendPostTimeContentType;
  audienceTimezone?: string;
}

export interface RecommendPostTimeResponse {
  timezone: string;
  slots: RecommendedPostTimeSlot[];
  usedHistory: boolean;
}

export interface GenerateHashtagsRequest {
  businessId?: string;
  contentText: string;
  contentType?: RecommendPostTimeContentType;
  targetCount?: number;
}

export interface GenerateHashtagsResponse {
  hashtags: string[];
  captionWithHashtags: string;
}

export interface StartSocialAuthRequest {
  businessId: string;
  platform: SocialPlatform;
  returnPath?: string;
}

export interface StartSocialAuthResponse {
  authorizationUrl: string;
}

export interface MetaPageConnectionCandidate {
  pageId: string;
  pageName: string;
  pictureUrl?: string;
  tasks: string[];
  instagramBusinessAccountId?: string;
  instagramUsername?: string;
  instagramDisplayName?: string;
  instagramProfilePictureUrl?: string;
}

export interface MetaAuthSessionQuery {
  businessId: string;
  session: string;
}

export interface MetaAuthSessionResponse {
  session: string;
  pages: MetaPageConnectionCandidate[];
}

export interface SelectMetaPageRequest {
  businessId: string;
  session: string;
  pageId: string;
}

export interface SelectMetaPageResponse {
  account: SocialAccount;
}

export interface DisconnectSocialAccountRequest {
  businessId: string;
}

export interface DisconnectSocialAccountResponse {
  disconnectedAccountId: string;
}

export interface SelectSocialAccountIdentityRequest {
  businessId: string;
  identityId: string;
}

export interface SelectSocialAccountIdentityResponse {
  account: SocialAccount;
}

export interface SocialAccountsQuery {
  businessId: string;
}

export interface SocialAccountsResponse {
  accounts: SocialAccount[];
}

export interface SchedulePostRequest {
  businessId: string;
  platform: SocialPlatform;
  contentText: string;
  assetGroupId?: string;
  slides: ScheduledPostSlide[];
  scheduledAt: string;
  audienceTimezone?: string;
  ignoreSafetyWarnings?: boolean;
}

export interface SchedulePostResponse {
  scheduledPost: ScheduledPost;
  safetyWarnings?: SchedulingSafetyWarning[];
}

export interface PublishPostRequest {
  businessId: string;
  platform: SocialPlatform;
  contentText: string;
  assetId?: string;
  slides?: ScheduledPostSlide[];
  title?: string;
}

export interface PublishPostResponse {
  platform: SocialPlatform;
  externalPostId: string;
  externalPostUrl: string;
  publishedAt: string;
  asset?: import("./analytics.ts").ContentAsset;
}

export interface ScheduledPostsQuery {
  businessId: string;
  platform?: SocialPlatform;
}

export interface ScheduledPostsResponse {
  scheduledPosts: ScheduledPost[];
}

export interface UpdateScheduledPostRequest {
  businessId: string;
  action: ScheduledPostMutationAction;
  scheduledAt?: string;
  audienceTimezone?: string;
  ignoreSafetyWarnings?: boolean;
}

export interface UpdateScheduledPostResponse {
  scheduledPost: ScheduledPost;
  safetyWarnings?: SchedulingSafetyWarning[];
}

export interface UpdateScheduledPostPerformanceRequest {
  businessId: string;
  performanceLabel: PostPerformanceLabel;
}

export interface UpdateScheduledPostPerformanceResponse {
  scheduledPost: ScheduledPost;
}

export interface CreateMediaUploadUrlRequest {
  businessId: string;
  postId: string;
  fileType: string;
  assetType?: PostAssetType;
  fileName?: string;
  sizeBytes?: number;
}

export interface CreateMediaUploadUrlResponse {
  uploadUrl: string;
  storageKey: string;
  storageUrl: string;
  expiresAt: string;
}

export interface CreatePostAssetRequest {
  businessId: string;
  postId: string;
  storageKey: string;
  storageUrl: string;
  mimeType: string;
  sizeBytes: number;
  type?: PostAssetType;
  source?: PostAssetSource;
  metadata?: PostAssetMetadata;
  orderIndex?: number;
}

export interface CreatePostAssetResponse {
  asset: PostAsset;
}

export interface ListPostAssetsQuery {
  businessId: string;
  postId: string;
}

export interface ListPostAssetsResponse {
  assets: PostAsset[];
}

export interface GetPostAssetQuery {
  businessId: string;
}

export interface GetPostAssetResponse {
  asset: PostAsset;
}

export interface DownloadPostAssetQuery {
  businessId: string;
}

export interface DownloadPostAssetResponse {
  asset: PostAsset;
  downloadUrl: string;
  fileName: string;
}

export interface DeletePostAssetRequest {
  businessId: string;
}

export interface DeletePostAssetResponse {
  deletedAssetId: string;
}
