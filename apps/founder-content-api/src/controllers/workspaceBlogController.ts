import type { Request, Response } from "express";
import { publishWorkspaceBlogToWebsite } from "../services/workspaceBlogPublishingService.ts";
import {
  createWorkspaceBlogDraft,
  listPublishedWorkspaceBlogs,
  publishWorkspaceBlogs,
  unpublishWorkspaceBlogBySlug,
} from "../services/publicBlogService.ts";
import { enforceWorkspaceReadAccess, enforceWorkspaceWriteAccess } from "../services/governanceService.ts";
import { handleApiError, sendApiError } from "../utils/http.ts";

function requireBusinessId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function getWorkspaceBlogsController(request: Request, response: Response): Promise<void> {
  const businessId = requireBusinessId(request.query.businessId);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceReadAccess(request.auth, businessId, "blog_publishing");
    const result = await listPublishedWorkspaceBlogs(businessId);
    response.json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_blogs_list_failed",
      message: "Unable to load workspace blogs right now.",
      logMessage: "Failed to load workspace blogs.",
    });
  }
}

export async function postWorkspaceBlogsPublishController(
  request: Request<unknown, unknown, { businessId?: string; runBuild?: boolean }>,
  response: Response,
): Promise<void> {
  const businessId = requireBusinessId(request.body?.businessId);

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "blog_publishing",
    });

    const publishStateResult = await publishWorkspaceBlogs(businessId);
    const websiteResult = await publishWorkspaceBlogToWebsite({
      workspaceId: businessId,
      runBuild: request.body?.runBuild === true,
    });

    response.json({
      workspaceId: publishStateResult.workspaceId,
      workspaceSlug: publishStateResult.workspaceSlug,
      updatedCount: publishStateResult.updatedCount,
      synced: websiteResult.synced,
      built: websiteResult.built,
      websiteRoot: websiteResult.websiteRoot,
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_blogs_publish_failed",
      message: "Unable to publish workspace blogs right now.",
      logMessage: "Failed to publish workspace blogs.",
    });
  }
}

export async function postWorkspaceBlogUnpublishController(
  request: Request<{ slug: string }, unknown, { businessId?: string }>,
  response: Response,
): Promise<void> {
  const businessId = requireBusinessId(request.body?.businessId);
  const slug = typeof request.params.slug === "string" ? request.params.slug.trim() : "";

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  if (!slug) {
    sendApiError(response, 400, "slug_required", "slug is required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "blog_publishing",
    });

    const result = await unpublishWorkspaceBlogBySlug(businessId, slug);
    response.json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_blog_unpublish_failed",
      message: "Unable to unpublish this workspace blog right now.",
      logMessage: "Failed to unpublish workspace blog.",
    });
  }
}

export async function postWorkspaceBlogDraftController(
  request: Request<
    unknown,
    unknown,
    {
      businessId?: string;
      title?: string;
      content?: string;
      summary?: string;
      slug?: string;
      tags?: string[];
      keywords?: string[];
      image?: string;
      publishNow?: boolean;
    }
  >,
  response: Response,
): Promise<void> {
  const businessId = requireBusinessId(request.body?.businessId);
  const title = typeof request.body?.title === "string" ? request.body.title.trim() : "";
  const content = typeof request.body?.content === "string" ? request.body.content.trim() : "";

  if (!businessId) {
    sendApiError(response, 400, "business_id_required", "businessId is required.");
    return;
  }

  if (!title || !content) {
    sendApiError(response, 400, "bad_request", "title and content are required.");
    return;
  }

  try {
    await enforceWorkspaceWriteAccess({
      principal: request.auth,
      businessId,
      featureKey: "blog_publishing",
    });

    const result = await createWorkspaceBlogDraft({
      workspaceId: businessId,
      title,
      content,
      summary: request.body?.summary,
      slug: request.body?.slug,
      tags: Array.isArray(request.body?.tags) ? request.body.tags : undefined,
      keywords: Array.isArray(request.body?.keywords) ? request.body.keywords : undefined,
      image: request.body?.image,
      publishNow: request.body?.publishNow === true,
    });

    response.status(201).json(result);
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "workspace_blog_draft_create_failed",
      message: "Unable to create workspace blog draft right now.",
      logMessage: "Failed to create workspace blog draft.",
    });
  }
}
