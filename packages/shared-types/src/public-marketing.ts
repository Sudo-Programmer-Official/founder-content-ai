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
