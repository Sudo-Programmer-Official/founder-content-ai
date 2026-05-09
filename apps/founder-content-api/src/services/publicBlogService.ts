import type { QueryResultRow } from "pg";
import { queryDb } from "./db/client.ts";
import { HttpError } from "../utils/http.ts";

interface WorkspaceRow extends QueryResultRow {
  id: string;
  slug: string;
  name: string;
  brand_name: string | null;
}

interface PublishUpdateCountRow extends QueryResultRow {
  total: string | number;
}

interface ContentAssetRow extends QueryResultRow {
  id: string;
  title: string | null;
  content_body: unknown;
  content_metadata: unknown;
  pipeline_stage: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ScheduledPostRow extends QueryResultRow {
  id: string;
  content_text: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  scheduled_at: Date | string | null;
  published_at: Date | string | null;
}

interface PublicBlogPost {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content: string;
  date: string;
  tags: string[];
  keywords: string[];
  image: string | null;
  author: string;
  readTimeMinutes: number;
  aiSummary: string | null;
  pipelineStage: string;
  source: "content_asset" | "scheduled_post";
  updatedAt: string;
  fingerprint: string;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unwrapObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractTextContent(contentBody: unknown): string {
  if (typeof contentBody === "string" && contentBody.trim() !== "") {
    return contentBody.trim();
  }

  const body = unwrapObject(contentBody);
  const direct = normalizeText(body.content) || normalizeText(body.post) || normalizeText(body.text);
  if (direct) {
    return direct;
  }

  const variations = Array.isArray(body.variations) ? body.variations : [];
  for (const variation of variations) {
    const candidate = unwrapObject(variation);
    const text = normalizeText(candidate.content) || normalizeText(candidate.post) || normalizeText(candidate.text);
    if (text) return text;
  }

  return "";
}

function guessTitleFromBody(text: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  if (!firstLine) return "Untitled post";
  return firstLine.replace(/^#+\s*/, "").slice(0, 120);
}

function extractSummary(text: string): string {
  const clean = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  return (clean[0] || text.slice(0, 180)).slice(0, 220).trim();
}

function extractHashtagTags(text: string): string[] {
  const matches = text.match(/(^|\s)#([a-z0-9_]+)/gi) || [];
  return Array.from(new Set(matches.map((entry) => entry.replace(/^[^#]*#/, "").toLowerCase())));
}

function estimateReadingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function normalizeForFingerprint(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ]+/g, "").trim();
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function stageScore(stage: string): number {
  const normalized = normalizeText(stage).toLowerCase();
  if (normalized === "published" || normalized === "posted") return 4;
  if (normalized === "processing") return 3;
  if (normalized === "scheduled") return 2;
  return 1;
}

function pickPreferredPost(current: PublicBlogPost, candidate: PublicBlogPost): PublicBlogPost {
  const currentScore = stageScore(current.pipelineStage);
  const candidateScore = stageScore(candidate.pipelineStage);
  if (candidateScore > currentScore) return candidate;
  if (candidateScore < currentScore) return current;
  return new Date(candidate.updatedAt).getTime() > new Date(current.updatedAt).getTime() ? candidate : current;
}

async function loadWorkspace(workspaceSlug: string): Promise<WorkspaceRow | null> {
  const result = await queryDb<WorkspaceRow>(
    `
      select id, slug, name, brand_name
      from businesses
      where lower(slug) = lower($1)
      limit 1
    `,
    [workspaceSlug],
  );
  return result.rows[0] ?? null;
}

async function loadPublishedContentAssets(workspaceId: string): Promise<ContentAssetRow[]> {
  const result = await queryDb<ContentAssetRow>(
    `
      select id, title, content_body, content_metadata, pipeline_stage, created_at, updated_at
      from content_assets
      where business_id = $1
        and content_type = 'post'
        and coalesce(content_metadata, '{}'::jsonb)->>'website_published' = 'true'
      order by coalesce(updated_at, created_at) desc
    `,
    [workspaceId],
  );
  return result.rows;
}

async function loadScheduledPosts(workspaceId: string): Promise<ScheduledPostRow[]> {
  const result = await queryDb<ScheduledPostRow>(
    `
      select id, content_text, status, created_at, updated_at, scheduled_at, published_at
      from scheduled_posts
      where business_id = $1
        and status = 'published'
      order by coalesce(published_at, scheduled_at, updated_at, created_at) desc
    `,
    [workspaceId],
  );
  return result.rows.filter((row) => normalizeText(row.content_text) !== "");
}

function fromContentAsset(workspace: WorkspaceRow, row: ContentAssetRow): PublicBlogPost | null {
  const content = extractTextContent(row.content_body);
  if (!content) return null;

  const metadata = unwrapObject(row.content_metadata);
  const title = normalizeText(row.title) || normalizeText(metadata.title) || guessTitleFromBody(content);
  const summary = normalizeText(metadata.summary) || extractSummary(content);
  const slugSeed = normalizeText(metadata.slug) || `${title}-${row.id.slice(0, 8)}`;
  const slug = toSlug(slugSeed);
  const keywords = asStringArray(metadata.keywords);
  const tags = Array.from(new Set([...asStringArray(metadata.tags), ...extractHashtagTags(content)])).slice(0, 12);
  const image = normalizeText(metadata.image) || normalizeText(metadata.coverImage) || null;
  const dateValue = normalizeText(metadata.publishedAt) || normalizeText(metadata.date);

  return {
    id: row.id,
    slug,
    title,
    summary,
    content,
    date: dateValue ? toIso(dateValue) : toIso(row.created_at),
    tags,
    keywords,
    image,
    author: workspace.brand_name || workspace.name,
    readTimeMinutes: estimateReadingMinutes(content),
    aiSummary: normalizeText(metadata.aiSummary) || normalizeText(metadata.ai_summary) || null,
    pipelineStage: row.pipeline_stage || "draft",
    source: "content_asset",
    updatedAt: toIso(row.updated_at),
    fingerprint: normalizeForFingerprint(content).slice(0, 280),
  };
}

function fromScheduledPost(workspace: WorkspaceRow, row: ScheduledPostRow): PublicBlogPost {
  const content = normalizeText(row.content_text);
  const title = guessTitleFromBody(content);
  const summary = extractSummary(content);
  const slug = toSlug(`${title}-${row.id.slice(0, 8)}`);
  const date = row.published_at || row.scheduled_at || row.created_at;

  return {
    id: row.id,
    slug,
    title,
    summary,
    content,
    date: toIso(date),
    tags: extractHashtagTags(content).slice(0, 12),
    keywords: [],
    image: null,
    author: workspace.brand_name || workspace.name,
    readTimeMinutes: estimateReadingMinutes(content),
    aiSummary: null,
    pipelineStage: row.status || "scheduled",
    source: "scheduled_post",
    updatedAt: toIso(row.updated_at),
    fingerprint: normalizeForFingerprint(content).slice(0, 280),
  };
}

async function loadWorkspacePosts(workspaceSlug: string): Promise<PublicBlogPost[]> {
  const workspace = await loadWorkspace(workspaceSlug);
  if (!workspace) return [];

  const [assetRows, scheduledRows] = await Promise.all([
    loadPublishedContentAssets(workspace.id),
    loadScheduledPosts(workspace.id),
  ]);

  const posts = [
    ...assetRows.map((row) => fromContentAsset(workspace, row)).filter((row): row is PublicBlogPost => Boolean(row)),
    ...scheduledRows.map((row) => fromScheduledPost(workspace, row)),
  ];

  const dedupedByFingerprint = new Map<string, PublicBlogPost>();
  for (const post of posts) {
    const key = post.fingerprint || post.id;
    const existing = dedupedByFingerprint.get(key);
    if (!existing) {
      dedupedByFingerprint.set(key, post);
      continue;
    }
    dedupedByFingerprint.set(key, pickPreferredPost(existing, post));
  }

  return Array.from(dedupedByFingerprint.values()).sort(
    (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
  );
}

export async function listPublicBlogs(workspaceSlug: string): Promise<Array<Omit<PublicBlogPost, "content" | "fingerprint">>> {
  const posts = await loadWorkspacePosts(workspaceSlug);
  return posts.map(({ content: _content, fingerprint: _fingerprint, ...post }) => post);
}

export async function getPublicBlogBySlug(
  workspaceSlug: string,
  slug: string,
): Promise<Omit<PublicBlogPost, "fingerprint"> | null> {
  const posts = await loadWorkspacePosts(workspaceSlug);
  const normalizedSlug = toSlug(slug);
  const post = posts.find((entry) => entry.slug === normalizedSlug);
  if (!post) return null;
  const { fingerprint: _fingerprint, ...rest } = post;
  return rest;
}

async function loadWorkspaceById(workspaceId: string): Promise<WorkspaceRow> {
  const result = await queryDb<WorkspaceRow>(
    `
      select id, slug, name, brand_name
      from businesses
      where id = $1
      limit 1
    `,
    [workspaceId],
  );

  if (result.rowCount === 0) {
    throw new HttpError(404, "workspace_not_found", "Workspace not found.");
  }

  return result.rows[0];
}

export async function publishWorkspaceBlogs(workspaceId: string): Promise<{ workspaceId: string; workspaceSlug: string; updatedCount: number }> {
  const workspace = await loadWorkspaceById(workspaceId);

  const result = await queryDb<PublishUpdateCountRow>(
    `
      with updated as (
        update content_assets
        set
          content_metadata = jsonb_set(
            coalesce(content_metadata, '{}'::jsonb),
            '{website_published}',
            'true'::jsonb,
            true
          ),
          updated_at = now()
        where business_id = $1
          and content_type = 'post'
          and coalesce(pipeline_stage, 'draft') in ('published', 'posted', 'scheduled', 'processing')
        returning id
      )
      select count(*)::text as total from updated
    `,
    [workspace.id],
  );

  return {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    updatedCount: Number(result.rows[0]?.total ?? 0),
  };
}

export async function unpublishWorkspaceBlogBySlug(
  workspaceId: string,
  slug: string,
): Promise<{ workspaceId: string; workspaceSlug: string; slug: string; updatedCount: number }> {
  const workspace = await loadWorkspaceById(workspaceId);
  const normalizedSlug = toSlug(slug);
  const posts = await loadWorkspacePosts(workspace.slug);
  const target = posts.find((entry) => entry.slug === normalizedSlug && entry.source === "content_asset");

  if (!target) {
    throw new HttpError(404, "blog_not_found", "Published blog not found for this workspace/slug.");
  }

  const result = await queryDb<PublishUpdateCountRow>(
    `
      with updated as (
        update content_assets
        set
          content_metadata = jsonb_set(
            coalesce(content_metadata, '{}'::jsonb),
            '{website_published}',
            'false'::jsonb,
            true
          ),
          updated_at = now()
        where business_id = $1
          and id = $2
        returning id
      )
      select count(*)::text as total from updated
    `,
    [workspace.id, target.id],
  );

  return {
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    slug: normalizedSlug,
    updatedCount: Number(result.rows[0]?.total ?? 0),
  };
}
