import type {
  ContentIngestionError,
  ContentIngestionItem,
  ContentIngestionSourceType,
  PreviewContentIngestionRequest,
  PreviewContentIngestionResponse,
  RepurposeSourceUrlInput,
} from "../../../../../packages/shared-types/index.ts";
import { fetchPublicUrlContent, normalizePublicUrl } from "../competitiveIntelligence/fetchUtils.ts";
import { HttpError } from "../../utils/http.ts";
import { listSavedContentSources, upsertSavedContentSources } from "./brandSourceMemoryService.ts";

const MAX_SOURCE_TEXT_LENGTH = 3200;
const MAX_CONTEXT_TEXT_LENGTH = 500;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const truncated = value.slice(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(" ");
  return (lastSpaceIndex > 120 ? truncated.slice(0, lastSpaceIndex) : truncated).trim();
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return normalizeWhitespace(stripHtml(titleMatch?.[1] ?? ""));
}

function extractMetaDescription(html: string): string {
  const metaMatch = html.match(
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  );
  return normalizeWhitespace(stripHtml(metaMatch?.[1] ?? ""));
}

function extractParagraphs(html: string): string[] {
  const matches = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  return matches
    .map((match) => normalizeWhitespace(stripHtml(match[1] ?? "")))
    .filter((paragraph) => paragraph.length > 40)
    .slice(0, 8);
}

function resolveSourceType(url: URL): ContentIngestionSourceType {
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();

  if (hostname.includes("linkedin.com")) {
    return "linkedin";
  }

  if (hostname.includes("instagram.com")) {
    return "instagram";
  }

  if (hostname.includes("facebook.com")) {
    return "facebook";
  }

  if (
    pathname.includes("/blog")
    || pathname.includes("/article")
    || pathname.includes("/posts")
    || hostname.startsWith("blog.")
  ) {
    return "blog";
  }

  return "url";
}

function resolveSourceLabel(source: RepurposeSourceUrlInput, safeUrl: string, index: number): string {
  const explicitLabel = normalizeOptional(source.label);

  if (explicitLabel) {
    return explicitLabel;
  }

  try {
    return new URL(safeUrl).hostname.replace(/^www\./i, "");
  } catch {
    return `Source ${index + 1}`;
  }
}

function normalizeSourceUrlsWithErrors(sourceUrls: RepurposeSourceUrlInput[]): {
  sources: Array<{
    url: string;
    safeUrl: string;
    label: string;
  }>;
  errors: ContentIngestionError[];
} {
  const sources: Array<{
    url: string;
    safeUrl: string;
    label: string;
  }> = [];
  const errors: ContentIngestionError[] = [];

  sourceUrls.forEach((source, index) => {
    const url = normalizeOptional(source.url);

    if (!url) {
      return;
    }

    try {
      const safeUrl = normalizePublicUrl(url);
      sources.push({
        url,
        safeUrl,
        label: resolveSourceLabel(source, safeUrl, index),
      });
    } catch (error) {
      errors.push({
        label: resolveSourceLabel(source, url, index),
        url,
        message:
          error instanceof Error
            ? error.message
            : "Enter a valid public URL like https://example.com or example.com.",
      });
    }
  });

  return {
    sources,
    errors,
  };
}

export function buildCombinedIngestionText(input: {
  items: ContentIngestionItem[];
  contextText?: string;
}): string {
  const contextText = normalizeOptional(input.contextText);

  return [
    contextText ? `Priority context:\n${truncateText(contextText, MAX_CONTEXT_TEXT_LENGTH)}` : "",
    ...input.items.map((item) => `${item.label}\n${item.rawText}`),
  ]
    .filter((segment) => segment !== "")
    .join("\n\n");
}

async function ingestSourceUrl(input: {
  url: string;
  safeUrl: string;
  label: string;
}): Promise<ContentIngestionItem> {
  const response = await fetchPublicUrlContent(input.safeUrl);
  const title = extractTitle(response.body);
  const description = extractMetaDescription(response.body);
  const paragraphs = extractParagraphs(response.body);
  const rawText = [title, description, paragraphs.join("\n\n")]
    .filter((segment) => segment && segment.trim() !== "")
    .join("\n\n");

  if (!rawText.trim()) {
    throw new HttpError(400, "source_unavailable", "Unable to extract readable text from the URL.");
  }

  const finalUrl = normalizePublicUrl(response.finalUrl || input.safeUrl);
  const parsedFinalUrl = new URL(finalUrl);

  return {
    label: input.label,
    sourceType: resolveSourceType(parsedFinalUrl),
    title: title || undefined,
    rawText: truncateText(rawText, MAX_SOURCE_TEXT_LENGTH),
    metadata: {
      url: input.url,
      finalUrl,
      hostname: parsedFinalUrl.hostname,
    },
  };
}

export async function previewContentIngestion(
  input: PreviewContentIngestionRequest,
): Promise<PreviewContentIngestionResponse> {
  const { sources, errors: normalizationErrors } = normalizeSourceUrlsWithErrors(input.sourceUrls);

  if (sources.length === 0) {
    throw new HttpError(
      400,
      "bad_request",
      normalizationErrors.length > 0
        ? "Add at least one valid public page, post, or article URL."
        : "At least one public source URL is required.",
    );
  }

  const results = await Promise.allSettled(
    sources.map(async (source) => ingestSourceUrl(source)),
  );

  const items: ContentIngestionItem[] = [];
  const errors: ContentIngestionError[] = [...normalizationErrors];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(result.value);
      return;
    }

    const source = sources[index];
    const message =
      result.reason instanceof Error ? result.reason.message : "Unable to read this source right now.";
    errors.push({
      label: source.label,
      url: source.url,
      message,
    });
  });

  if (items.length === 0) {
    throw new HttpError(
      400,
      "source_unavailable",
      "Unable to read content from the provided URLs. Use public page, post, or article links.",
    );
  }

  const normalizedBusinessId = normalizeOptional(input.businessId);
  const savedSources = normalizedBusinessId
    ? await upsertSavedContentSources(normalizedBusinessId, items)
    : [];

  return {
    items,
    errors,
    combinedText: truncateText(
      buildCombinedIngestionText({
        items,
        contextText: input.contextText,
      }),
      MAX_SOURCE_TEXT_LENGTH,
    ),
    savedSources:
      normalizedBusinessId && savedSources.length === 0
        ? await listSavedContentSources(normalizedBusinessId)
        : savedSources,
  };
}
