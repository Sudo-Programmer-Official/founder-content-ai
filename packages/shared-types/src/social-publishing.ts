export type SocialPlatform = "linkedin";
export type SocialAccountStatus = "connected" | "expired" | "revoked" | "error";
export type ScheduledPostStatus = "scheduled" | "processing" | "published" | "failed";
export type SocialAccountIdentityType = "person" | "organization";

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
  contentText: string;
  assetGroupId?: string;
  slides: ScheduledPostSlide[];
  scheduledAt: string;
  status: ScheduledPostStatus;
  externalPostId?: string;
  externalPostUrl?: string;
  errorMessage?: string;
  retryCount: number;
  lastAttemptAt?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
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
}

export interface SchedulePostResponse {
  scheduledPost: ScheduledPost;
}

export interface PublishPostRequest {
  businessId: string;
  platform: SocialPlatform;
  contentText: string;
  assetId?: string;
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
