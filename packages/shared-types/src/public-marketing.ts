import type { SocialPlatform } from "./social-publishing";

export type PublicSocialProofMediaType = "text" | "image" | "video" | "carousel";

export interface PublicSocialProofPost {
  id: string;
  platform: SocialPlatform;
  externalPostUrl: string;
  externalPostId?: string;
  authorDisplayName: string;
  authorAvatarUrl?: string;
  workspaceBrandName: string;
  workspaceWebsiteUrl?: string;
  captionPreview: string;
  publishedAt: string;
  thumbnailUrl?: string;
  mediaType: PublicSocialProofMediaType;
  featured: boolean;
}

export interface PublicSocialProofQuery {
  limit?: string;
}

export interface PublicSocialProofResponse {
  posts: PublicSocialProofPost[];
}

export type PublicMarketingAssistantTopic =
  | "social_media_automation"
  | "founder_brand_system"
  | "growth_automation"
  | "service_fit"
  | "other";

export interface CreatePublicMarketingInquiryRequest {
  name: string;
  email: string;
  companyName?: string;
  message: string;
  topic?: PublicMarketingAssistantTopic;
  selectedPrompt?: string;
  pageUrl?: string;
  honeypot?: string;
}

export interface CreatePublicMarketingInquiryResponse {
  inquiryId: string;
  receivedAt: string;
}
