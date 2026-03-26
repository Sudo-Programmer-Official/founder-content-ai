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

export interface PreviewContentIngestionRequest {
  businessId?: string;
  contextText?: string;
  sourceUrls: RepurposeSourceUrlInput[];
}

export interface PreviewContentIngestionResponse {
  items: ContentIngestionItem[];
  errors: ContentIngestionError[];
  combinedText: string;
}
