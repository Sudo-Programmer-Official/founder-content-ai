import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryResultRow } from "pg";
import { queryDb } from "../src/services/db/client.ts";

interface WorkspaceRow extends QueryResultRow {
  id: string;
  slug: string;
  name: string;
  brand_name: string;
}

interface ContentAssetRow extends QueryResultRow {
  id: string;
  business_id: string | null;
  title: string | null;
  content_body: unknown;
  content_metadata: unknown;
  source_kind: string | null;
  pipeline_stage: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PostAssetRow extends QueryResultRow {
  post_id: string;
  storage_url: string;
  mime_type: string;
  status: string;
  source: string;
  order_index: number;
}

interface ExportPost {
  id: string;
  title: string;
  slug: string;
  date: string;
  summary: string;
  tags: string[];
  keywords: string[];
  image: string | null;
  aiSummary: string | null;
  author: string;
  sourceKind: string;
  pipelineStage: string;
  updatedAt: string;
  body: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "..", "..");
const defaultOutputRoot = path.resolve(repoRoot, "exports", "workspaces");

function getArgValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const entry = process.argv.find((arg) => arg.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function unwrapObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
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
    if (text) {
      return text;
    }
  }

  return "";
}

function guessTitleFromBody(text: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");

  if (!firstLine) {
    return "Untitled post";
  }

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

function toMarkdownBody(text: string, title: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return `# ${title}\n\nDraft content.\n`;
  }

  if (trimmed.includes("\n# ") || trimmed.startsWith("# ")) {
    return `${trimmed}\n`;
  }

  return `# ${title}\n\n${trimmed}\n`;
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"')}"`;
}

function buildFrontmatter(post: ExportPost): string {
  const tagList = post.tags.map((tag) => yamlQuote(tag)).join(", ");
  const keywordList = post.keywords.map((keyword) => yamlQuote(keyword)).join(", ");

  const lines = [
    "---",
    `title: ${yamlQuote(post.title)}`,
    `slug: ${yamlQuote(post.slug)}`,
    `date: ${yamlQuote(post.date)}`,
    `summary: ${yamlQuote(post.summary)}`,
    `tags: [${tagList}]`,
    `keywords: [${keywordList}]`,
    `author: ${yamlQuote(post.author)}`,
    `source_kind: ${yamlQuote(post.sourceKind)}`,
    `pipeline_stage: ${yamlQuote(post.pipelineStage)}`,
    `updated_at: ${yamlQuote(post.updatedAt)}`,
  ];

  if (post.image) {
    lines.push(`image: ${yamlQuote(post.image)}`);
  }

  if (post.aiSummary) {
    lines.push(`ai_summary: ${yamlQuote(post.aiSummary)}`);
  }

  lines.push("---", "");
  return `${lines.join("\n")}`;
}

async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

async function findWorkspaces(input?: string): Promise<WorkspaceRow[]> {
  if (input) {
    const result = await queryDb<WorkspaceRow>(
      `
        select id, slug, name, brand_name
        from businesses
        where id::text = $1
           or lower(slug) = lower($1)
      `,
      [input],
    );

    if (result.rowCount === 0) {
      throw new Error(`Workspace not found for '${input}'. Pass --workspace=<business-id-or-slug>.`);
    }

    return result.rows;
  }

  const result = await queryDb<WorkspaceRow>(
    `
      select id, slug, name, brand_name
      from businesses
      where status = 'active'
      order by created_at asc
    `,
  );

  return result.rows;
}

async function loadContentAssets(businessId: string): Promise<ContentAssetRow[]> {
  const result = await queryDb<ContentAssetRow>(
    `
      select
        id,
        business_id,
        title,
        content_body,
        content_metadata,
        source_kind,
        pipeline_stage,
        created_at,
        updated_at
      from content_assets
      where business_id = $1
        and content_type = 'post'
      order by coalesce(updated_at, created_at) desc
    `,
    [businessId],
  );

  return result.rows;
}

async function loadPostAssets(businessId: string): Promise<Map<string, PostAssetRow[]>> {
  const result = await queryDb<PostAssetRow>(
    `
      select
        post_id,
        storage_url,
        mime_type,
        status,
        source,
        order_index
      from post_assets
      where business_id = $1
        and status = 'ready'
      order by post_id asc, order_index asc, created_at asc
    `,
    [businessId],
  );

  const byPostId = new Map<string, PostAssetRow[]>();
  for (const row of result.rows) {
    const existing = byPostId.get(row.post_id) ?? [];
    existing.push(row);
    byPostId.set(row.post_id, existing);
  }

  return byPostId;
}

function buildExportPost(
  workspace: WorkspaceRow,
  row: ContentAssetRow,
  postAssets: Map<string, PostAssetRow[]>,
): ExportPost | null {
  const textContent = extractTextContent(row.content_body);
  if (!textContent) {
    return null;
  }

  const metadata = unwrapObject(row.content_metadata);
  const title = normalizeText(row.title) || guessTitleFromBody(textContent);
  const slug = toSlug(`${title}-${row.id.slice(0, 8)}`);
  const summary = normalizeText(metadata.summary) || extractSummary(textContent);

  const metadataTags = asStringArray(metadata.tags);
  const hashtagTags = extractHashtagTags(textContent);
  const tags = Array.from(new Set([...metadataTags, ...hashtagTags])).slice(0, 12);

  const keywords = asStringArray(metadata.keywords);
  const aiSummary = normalizeText(metadata.aiSummary) || normalizeText(metadata.ai_summary) || null;

  const imageFromAsset = (postAssets.get(row.id) ?? []).find((asset) => asset.mime_type.startsWith("image/"))?.storage_url;
  const imageFromMeta = normalizeText(metadata.image) || normalizeText(metadata.coverImage) || "";
  const image = imageFromAsset || imageFromMeta || null;

  return {
    id: row.id,
    title,
    slug,
    date: toIso(row.created_at),
    summary,
    tags,
    keywords,
    image,
    aiSummary,
    author: workspace.brand_name || workspace.name,
    sourceKind: row.source_kind || "generated",
    pipelineStage: row.pipeline_stage || "draft",
    updatedAt: toIso(row.updated_at),
    body: toMarkdownBody(textContent, title),
  };
}

async function writeWorkspaceExport(workspace: WorkspaceRow, posts: ExportPost[], outputRoot: string): Promise<void> {
  const workspaceDir = path.resolve(outputRoot, workspace.slug, "blogs");
  await ensureDir(workspaceDir);

  const manifest = posts.map((post) => ({
    id: post.id,
    title: post.title,
    slug: post.slug,
    date: post.date,
    summary: post.summary,
    tags: post.tags,
    keywords: post.keywords,
    image: post.image,
    aiSummary: post.aiSummary,
    author: post.author,
    sourceKind: post.sourceKind,
    pipelineStage: post.pipelineStage,
    updatedAt: post.updatedAt,
    file: `${post.slug}.md`,
  }));

  for (const post of posts) {
    const markdown = `${buildFrontmatter(post)}${post.body}`;
    const filePath = path.resolve(workspaceDir, `${post.slug}.md`);
    await fs.writeFile(filePath, markdown, "utf8");
  }

  await fs.writeFile(path.resolve(workspaceDir, "index.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export interface ExportWorkspaceBlogsOptions {
  workspace?: string;
  all?: boolean;
  outDir?: string;
}

export async function exportWorkspaceBlogs(options: ExportWorkspaceBlogsOptions = {}): Promise<void> {
  const workspaceArg = options.workspace ?? getArgValue("workspace") ?? process.env.BLOG_EXPORT_WORKSPACE;
  const allFlag = options.all ?? hasFlag("all");
  const outputRoot = path.resolve(options.outDir ?? getArgValue("out") ?? process.env.BLOG_EXPORT_OUT_DIR ?? defaultOutputRoot);

  if (!workspaceArg && !allFlag) {
    throw new Error("Missing scope. Pass --workspace=<business-id-or-slug> or --all.");
  }

  const workspaces = await findWorkspaces(allFlag ? undefined : workspaceArg);
  if (workspaces.length === 0) {
    console.log("No active workspaces found. Nothing to export.");
    return;
  }

  let totalPosts = 0;

  for (const workspace of workspaces) {
    const [assets, postAssets] = await Promise.all([
      loadContentAssets(workspace.id),
      loadPostAssets(workspace.id),
    ]);

    const posts = assets
      .map((row) => buildExportPost(workspace, row, postAssets))
      .filter((entry): entry is ExportPost => Boolean(entry));

    await writeWorkspaceExport(workspace, posts, outputRoot);
    totalPosts += posts.length;

    console.log(`Exported ${posts.length} blog posts for workspace ${workspace.slug}`);
  }

  console.log(`Done. Exported ${totalPosts} posts across ${workspaces.length} workspace(s) to ${outputRoot}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportWorkspaceBlogs().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
