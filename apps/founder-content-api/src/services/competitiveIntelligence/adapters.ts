import type {
  CompetitorSource,
  CompetitorSourceType,
  ManualImportPayload,
} from "../../../../../packages/shared-types/index.ts";
import {
  createManualImportDraft,
  extractHtmlDraft,
  fetchPublicUrlContent,
  normalizePublicUrl,
  sanitizeText,
  type FetchedSourceItemDraft,
} from "./fetchUtils.ts";

function getXmlTagContent(block: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = block.match(pattern);
  return match?.[1] ? sanitizeText(match[1]) : undefined;
}

function parseRssItems(xml: string): FetchedSourceItemDraft[] {
  const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s\S]*?<\/entry>/gi) ?? [];

  return itemBlocks.slice(0, 12).map((block, index) => {
    const link = getXmlTagContent(block, "link");
    const title = getXmlTagContent(block, "title") ?? `RSS item ${index + 1}`;
    const contentText =
      getXmlTagContent(block, "content:encoded")
      ?? getXmlTagContent(block, "description")
      ?? title;
    const publishedAt =
      getXmlTagContent(block, "pubDate")
      ?? getXmlTagContent(block, "published")
      ?? new Date().toISOString();

    return {
      externalId: getXmlTagContent(block, "guid") ?? link ?? `${title}-${index}`,
      canonicalUrl: link,
      title,
      excerpt: getXmlTagContent(block, "description"),
      contentText,
      authorName: getXmlTagContent(block, "author") ?? getXmlTagContent(block, "dc:creator"),
      publishedAt,
      engagementScore: 1,
      formatHint: "article",
      rawPayload: {
        kind: "rss-item",
      },
    };
  });
}

async function fetchRssSource(source: CompetitorSource): Promise<FetchedSourceItemDraft[]> {
  if (!source.url) {
    throw new Error("RSS sources require a url.");
  }

  const response = await fetchPublicUrlContent(source.url);
  return parseRssItems(response.body);
}

async function fetchPublicUrlSource(source: CompetitorSource): Promise<FetchedSourceItemDraft[]> {
  if (!source.url) {
    throw new Error("Public URL sources require a url.");
  }

  const response = await fetchPublicUrlContent(source.url);

  return [
    extractHtmlDraft(source, response.body, response.finalUrl, "article"),
  ];
}

async function fetchWebsitePageSource(source: CompetitorSource): Promise<FetchedSourceItemDraft[]> {
  if (!source.url) {
    throw new Error("Website page sources require a url.");
  }

  const response = await fetchPublicUrlContent(source.url);

  return [
    extractHtmlDraft(source, response.body, response.finalUrl, "landing-page"),
  ];
}

function fetchManualImportSource(
  source: CompetitorSource,
  manualImport: ManualImportPayload | undefined,
): FetchedSourceItemDraft[] {
  if (!manualImport) {
    throw new Error("manualImport is required for manual_import sources.");
  }

  return [createManualImportDraft(source, manualImport)];
}

export async function fetchSourceDrafts(
  source: CompetitorSource,
  manualImport?: ManualImportPayload,
): Promise<FetchedSourceItemDraft[]> {
  const sourceType: CompetitorSourceType = source.sourceType;

  if ((sourceType === "rss" || sourceType === "public_url" || sourceType === "website_page") && source.url) {
    source.url = normalizePublicUrl(source.url);
  }

  switch (sourceType) {
    case "rss":
      return fetchRssSource(source);
    case "public_url":
      return fetchPublicUrlSource(source);
    case "website_page":
      return fetchWebsitePageSource(source);
    case "manual_import":
      return fetchManualImportSource(source, manualImport);
    default:
      throw new Error(`Unsupported source type: ${String(sourceType)}`);
  }
}
