import type { RepurposeSourceUrlInput } from "./repurpose.ts";

export type ContentIngestionSourceType =
  | "text"
  | "url"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "blog";

export interface ContentIngestionItem {
  label: string;
  sourceType: ContentIngestionSourceType;
  rawText: string;
  title?: string;
  metadata?: {
    url?: string;
    finalUrl?: string;
    hostname?: string;
  };
}

export interface ContentIngestionError {
  label: string;
  url: string;
  message: string;
}

export interface SavedContentSource {
  id: string;
  businessId: string;
  label: string;
  sourceType: ContentIngestionSourceType;
  sourceUrl: string;
  title?: string;
  extractedText: string;
  lastFetchedAt: string;
  updatedAt: string;
  metadata?: {
    url?: string;
    finalUrl?: string;
    hostname?: string;
  };
}

export interface PreviewContentIngestionRequest {
  businessId?: string;
  contextText?: string;
  sourceUrls: RepurposeSourceUrlInput[];
}

export interface PreviewContentIngestionResponse {
  items: ContentIngestionItem[];
  errors: ContentIngestionError[];
  combinedText: string;
  savedSources: SavedContentSource[];
}

export interface ListSavedContentSourcesResponse {
  sources: SavedContentSource[];
}
