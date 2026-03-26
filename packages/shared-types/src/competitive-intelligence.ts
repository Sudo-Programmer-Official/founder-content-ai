export type CompetitorSourceType = "rss" | "public_url" | "website_page" | "manual_import";
export type CompetitorSourceStatus = "active" | "paused" | "error";
export type SourceFetchStatus = "idle" | "scheduled" | "processing" | "succeeded" | "failed";
export type SourceItemFormat =
  | "article"
  | "post"
  | "thread"
  | "landing-page"
  | "newsletter"
  | "note"
  | "other";
export type HookType =
  | "curiosity"
  | "contrarian"
  | "story"
  | "how-to"
  | "list"
  | "question"
  | "data"
  | "insight"
  | "other";
export type ToneCategory =
  | "storytelling"
  | "educational"
  | "contrarian"
  | "analytical"
  | "promotional"
  | "conversational"
  | "other";

export interface CompetitorSource {
  id: string;
  businessId: string;
  sourceType: CompetitorSourceType;
  label: string;
  url?: string;
  status: CompetitorSourceStatus;
  fetchFrequencyMinutes: number | null;
  nextFetchAt: string | null;
  lastFetchedAt: string | null;
  lastFetchStatus: SourceFetchStatus;
  lastFetchError?: string;
  fetchLockId?: string;
  fetchLockedAt?: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ManualImportPayload {
  title?: string;
  canonicalUrl?: string;
  contentText: string;
  excerpt?: string;
  authorName?: string;
  publishedAt?: string;
  engagementScore?: number;
}

export interface CompetitorWatchlist {
  id: string;
  businessId: string;
  name: string;
  description?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistSource {
  id: string;
  watchlistId: string;
  sourceId: string;
  createdAt: string;
}

export interface SourceItem {
  id: string;
  businessId: string;
  sourceId: string;
  externalId: string;
  canonicalUrl?: string;
  title: string;
  excerpt?: string;
  contentText: string;
  authorName?: string;
  publishedAt: string;
  engagementScore: number;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceItemAnalysis {
  id: string;
  businessId: string;
  sourceItemId: string;
  topic: string;
  hookType: HookType;
  tone: ToneCategory;
  format: SourceItemFormat;
  whyItMightWork: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrendSignal {
  id: string;
  businessId: string;
  topic: string;
  windowDays: 7 | 30;
  sourceItemCount: number;
  momentum: number;
  engagementWeightedTrendScore: number;
  sampleHookTypes: HookType[];
  generatedAt: string;
}

export interface CreateCompetitorSourceRequest {
  businessId: string;
  sourceType: CompetitorSourceType;
  label: string;
  url?: string;
  fetchFrequencyMinutes?: number;
  watchlistId?: string;
  watchlistName?: string;
  fetchNow?: boolean;
  manualImport?: ManualImportPayload;
}

export interface CreateCompetitorSourceResponse {
  source: CompetitorSource;
  watchlist?: CompetitorWatchlist;
  itemsImported: number;
  analysesCreated: number;
}

export interface CompetitorFeedQuery {
  businessId: string;
  watchlistId?: string;
  days?: number;
  limit?: number;
}

export interface CompetitorFeedEntry {
  source: CompetitorSource;
  item: SourceItem;
  analysis: SourceItemAnalysis | null;
}

export interface CompetitorFeedResponse {
  items: CompetitorFeedEntry[];
  generatedAt: string;
}

export interface TrendsQuery {
  businessId: string;
  watchlistId?: string;
}

export interface TrendsResponse {
  trends7d: TrendSignal[];
  trends30d: TrendSignal[];
  generatedAt: string;
}
