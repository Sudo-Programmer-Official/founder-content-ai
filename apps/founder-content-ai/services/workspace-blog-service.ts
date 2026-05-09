import { apiGet, apiPost } from "./api-client";

export interface WorkspacePublishedBlogEntry {
  slug: string;
  title: string;
  date: string;
  source: "content_asset" | "scheduled_post";
}

export interface WorkspacePublishedBlogsResponse {
  workspaceId: string;
  workspaceSlug: string;
  posts: WorkspacePublishedBlogEntry[];
}

export interface WorkspaceBlogPublishResponse {
  workspaceId: string;
  workspaceSlug: string;
  updatedCount: number;
  synced: boolean;
  built: boolean;
  websiteRoot: string;
}

export interface WorkspaceBlogUnpublishResponse {
  workspaceId: string;
  workspaceSlug: string;
  slug: string;
  updatedCount: number;
}

export interface WorkspaceBlogDraftCreateResponse {
  workspaceId: string;
  workspaceSlug: string;
  assetId: string;
  slug: string;
  pipelineStage: "draft" | "posted";
}

export async function requestWorkspacePublishedBlogs(
  businessId: string,
): Promise<WorkspacePublishedBlogsResponse> {
  const encodedBusinessId = encodeURIComponent(businessId);
  return apiGet<WorkspacePublishedBlogsResponse>(`/workspace/blogs?businessId=${encodedBusinessId}`);
}

export async function requestWorkspaceBlogsPublish(
  businessId: string,
  runBuild = false,
): Promise<WorkspaceBlogPublishResponse> {
  return apiPost<{ businessId: string; runBuild: boolean }, WorkspaceBlogPublishResponse>(
    "/workspace/blogs/publish",
    {
      businessId,
      runBuild,
    },
  );
}

export async function requestWorkspaceBlogUnpublishBySlug(
  businessId: string,
  slug: string,
): Promise<WorkspaceBlogUnpublishResponse> {
  const encodedSlug = encodeURIComponent(slug);
  return apiPost<{ businessId: string }, WorkspaceBlogUnpublishResponse>(
    `/workspace/blogs/${encodedSlug}/unpublish`,
    { businessId },
  );
}

export async function requestWorkspaceBlogDraftCreate(input: {
  businessId: string;
  title: string;
  content: string;
  summary?: string;
  slug?: string;
  tags?: string[];
  keywords?: string[];
  image?: string;
  publishNow?: boolean;
}): Promise<WorkspaceBlogDraftCreateResponse> {
  return apiPost<typeof input, WorkspaceBlogDraftCreateResponse>(
    "/workspace/blogs/drafts",
    input,
  );
}
