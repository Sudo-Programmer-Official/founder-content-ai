import type { Request, Response } from "express";
import { getPublicBlogBySlug, listPublicBlogs } from "../services/publicBlogService.ts";
import { handleApiError } from "../utils/http.ts";

function normalizeWorkspace(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw || "sudo-programmer";
}

export async function getPublicBlogsController(request: Request, response: Response): Promise<void> {
  try {
    const workspace = normalizeWorkspace(request.query.workspace);
    const posts = await listPublicBlogs(workspace);
    response.json({
      ok: true,
      workspace,
      posts,
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "public_blogs_list_failed",
      message: "Unable to load blog posts right now.",
      logMessage: "Failed to load public blog posts.",
    });
  }
}

export async function getPublicBlogBySlugController(request: Request, response: Response): Promise<void> {
  try {
    const workspace = normalizeWorkspace(request.query.workspace);
    const slug = typeof request.params.slug === "string" ? request.params.slug.trim() : "";
    const post = await getPublicBlogBySlug(workspace, slug);

    if (!post) {
      response.status(404).json({
        ok: false,
        error: {
          code: "public_blog_not_found",
          message: "Blog post not found.",
        },
      });
      return;
    }

    response.json({
      ok: true,
      workspace,
      post,
    });
  } catch (error) {
    handleApiError(response, error, {
      statusCode: 500,
      code: "public_blog_detail_failed",
      message: "Unable to load this blog post right now.",
      logMessage: "Failed to load public blog post.",
    });
  }
}
