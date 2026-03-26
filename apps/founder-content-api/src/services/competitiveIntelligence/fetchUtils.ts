import type {
  CompetitorSource,
  CompetitorSourceType,
  ManualImportPayload,
  SourceItemFormat,
} from "../../../../../packages/shared-types/index.ts";

export interface FetchedSourceItemDraft {
  externalId: string;
  canonicalUrl?: string;
  title: string;
  excerpt?: string;
  contentText: string;
  authorName?: string;
  publishedAt?: string;
  engagementScore?: number;
  formatHint?: SourceItemFormat;
  rawPayload: Record<string, unknown>;
}

const COMMON_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeHtmlEntities(value: string): string {
  return Object.entries(COMMON_ENTITY_MAP).reduce(
    (current, [entity, replacement]) => current.split(entity).join(replacement),
    value,
  );
}

export function sanitizeText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

export function getDefaultFetchFrequencyMinutes(): number {
  const configured = Number(process.env.COMPETITOR_DEFAULT_FETCH_FREQUENCY_MINUTES ?? 720);
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 720;
}

export function getMinimumFetchFrequencyMinutes(): number {
  const configured = Number(process.env.COMPETITOR_MIN_FETCH_FREQUENCY_MINUTES ?? 360);
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 360;
}

export function getFetchLockTimeoutMinutes(): number {
  const configured = Number(process.env.COMPETITOR_FETCH_LOCK_TIMEOUT_MINUTES ?? 15);
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 15;
}

export function getFetchBatchSize(): number {
  const configured = Number(process.env.COMPETITOR_FETCH_BATCH_SIZE ?? 10);
  return Number.isFinite(configured) && configured > 0 ? Math.round(configured) : 10;
}

export function clampFetchFrequencyMinutes(value?: number): number {
  const minimum = getMinimumFetchFrequencyMinutes();
  const fallback = getDefaultFetchFrequencyMinutes();

  if (!value || !Number.isFinite(value)) {
    return Math.max(fallback, minimum);
  }

  return Math.max(Math.round(value), minimum);
}

export function calculateNextFetchAt(
  sourceType: CompetitorSourceType,
  frequencyMinutes: number | null,
  now = new Date(),
): string | null {
  if (sourceType === "manual_import") {
    return null;
  }

  const minutes = clampFetchFrequencyMinutes(frequencyMinutes ?? undefined);
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

function isPrivateIpv4(hostname: string): boolean {
  return /^10\./.test(hostname)
    || /^127\./.test(hostname)
    || /^169\.254\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

export function normalizePublicUrl(value: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error("A public URL is required.");
  }

  const url = new URL(normalized);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public http(s) URLs are allowed.");
  }

  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed.");
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost"
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname === "::1"
    || hostname === "[::1]"
    || isPrivateIpv4(hostname)
  ) {
    throw new Error("Private or local URLs are not allowed.");
  }

  url.hash = "";

  return url.toString();
}

export async function fetchPublicUrlContent(url: string): Promise<{
  finalUrl: string;
  contentType: string;
  body: string;
}> {
  const safeUrl = normalizePublicUrl(url);
  const response = await fetch(safeUrl, {
    headers: {
      "User-Agent": process.env.COMPETITOR_FETCH_USER_AGENT ?? "FounderContentAICompetitiveIntel/0.1",
      Accept: "text/html,application/rss+xml,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}.`);
  }

  return {
    finalUrl: response.url || safeUrl,
    contentType: response.headers.get("content-type") ?? "text/plain",
    body: await response.text(),
  };
}

function extractMetaContent(html: string, key: string): string | undefined {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const match = html.match(pattern);
  return match?.[1] ? sanitizeText(match[1]) : undefined;
}

function extractTitleFromHtml(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? sanitizeText(match[1]) : undefined;
}

function extractAuthorFromHtml(html: string): string | undefined {
  return extractMetaContent(html, "author") ?? extractMetaContent(html, "og:author");
}

function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
}

export function extractTextFromHtml(html: string): string {
  return sanitizeText(stripScriptsAndStyles(html));
}

export function extractHtmlDraft(
  source: CompetitorSource,
  html: string,
  finalUrl: string,
  formatHint: SourceItemFormat,
): FetchedSourceItemDraft {
  const title = extractMetaContent(html, "og:title") ?? extractTitleFromHtml(html) ?? source.label;
  const excerpt = extractMetaContent(html, "description") ?? extractMetaContent(html, "og:description");
  const contentText = extractTextFromHtml(html);

  return {
    externalId: finalUrl,
    canonicalUrl: finalUrl,
    title,
    excerpt,
    contentText,
    authorName: extractAuthorFromHtml(html),
    publishedAt: new Date().toISOString(),
    engagementScore: 1,
    formatHint,
    rawPayload: {
      contentType: "text/html",
    },
  };
}

export function createManualImportDraft(
  source: CompetitorSource,
  payload: ManualImportPayload,
): FetchedSourceItemDraft {
  const contentText = payload.contentText.trim();

  if (!contentText) {
    throw new Error("manualImport.contentText is required.");
  }

  return {
    externalId: payload.canonicalUrl?.trim() || `${source.id}-${Date.now()}`,
    canonicalUrl: payload.canonicalUrl?.trim(),
    title: payload.title?.trim() || contentText.slice(0, 120),
    excerpt: payload.excerpt?.trim(),
    contentText,
    authorName: payload.authorName?.trim(),
    publishedAt: payload.publishedAt?.trim() || new Date().toISOString(),
    engagementScore: payload.engagementScore ?? 1,
    formatHint: "note",
    rawPayload: {
      sourceType: "manual_import",
    },
  };
}
