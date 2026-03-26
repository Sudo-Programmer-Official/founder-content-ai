import { randomUUID } from "node:crypto";
import type {
  CompetitorFeedEntry,
  CompetitorFeedQuery,
  CompetitorFeedResponse,
  CompetitorSource,
  CompetitorSourceStatus,
  CompetitorWatchlist,
  CreateCompetitorSourceRequest,
  CreateCompetitorSourceResponse,
  ManualImportPayload,
  SourceFetchStatus,
  SourceItem,
  SourceItemAnalysis,
  TrendSignal,
  TrendsQuery,
  TrendsResponse,
  WatchlistSource,
} from "../../../../../packages/shared-types/index.ts";
import type { AuthenticatedPrincipal } from "../../middleware/auth.ts";
import { requireBusinessMembership } from "../authBusinessService.ts";
import {
  calculateNextFetchAt,
  clampFetchFrequencyMinutes,
  getFetchLockTimeoutMinutes,
  type FetchedSourceItemDraft,
} from "./fetchUtils.ts";
import { fetchSourceDrafts } from "./adapters.ts";
import { analyzeSourceItem } from "./analysisService.ts";
import { buildTrendSignals } from "./trendEngine.ts";

const sourcesById = new Map<string, CompetitorSource>();
const itemsById = new Map<string, SourceItem>();
const analysesByItemId = new Map<string, SourceItemAnalysis>();
const watchlistsById = new Map<string, CompetitorWatchlist>();
const watchlistSourcesById = new Map<string, WatchlistSource>();
const trendSignalsByBusinessId = new Map<string, { trends7d: ReturnType<typeof buildTrendSignals>["trends7d"]; trends30d: ReturnType<typeof buildTrendSignals>["trends30d"] }>();

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function resolveSourceStatus(sourceType: CompetitorSource["sourceType"]): CompetitorSourceStatus {
  return sourceType === "manual_import" ? "paused" : "active";
}

function resolveFetchStatus(sourceType: CompetitorSource["sourceType"]): SourceFetchStatus {
  return sourceType === "manual_import" ? "succeeded" : "scheduled";
}

function listWatchlistSourceIds(watchlistId: string): Set<string> {
  return new Set(
    Array.from(watchlistSourcesById.values())
      .filter((watchlistSource) => watchlistSource.watchlistId === watchlistId)
      .map((watchlistSource) => watchlistSource.sourceId),
  );
}

function resolveWatchlistSourceIds(
  businessId: string,
  watchlistId: string | undefined,
): Set<string> | undefined {
  if (!watchlistId) {
    return undefined;
  }

  const watchlist = watchlistsById.get(watchlistId);

  if (!watchlist || watchlist.businessId !== businessId) {
    throw new Error("watchlistId is invalid for this business.");
  }

  return listWatchlistSourceIds(watchlistId);
}

function listItemsForBusiness(businessId: string, sourceIds?: Set<string>): SourceItem[] {
  return Array.from(itemsById.values()).filter((item) => {
    if (item.businessId !== businessId) {
      return false;
    }

    if (sourceIds && !sourceIds.has(item.sourceId)) {
      return false;
    }

    return true;
  });
}

function listAnalysesForBusiness(businessId: string, sourceIds?: Set<string>): SourceItemAnalysis[] {
  return Array.from(analysesByItemId.values()).filter((analysis) => {
    if (analysis.businessId !== businessId) {
      return false;
    }

    if (!sourceIds) {
      return true;
    }

    const item = itemsById.get(analysis.sourceItemId);
    return Boolean(item && sourceIds.has(item.sourceId));
  });
}

function ensureWatchlist(
  businessId: string,
  createdByUserId: string,
  input: CreateCompetitorSourceRequest,
): CompetitorWatchlist | undefined {
  if (input.watchlistId) {
    const existingWatchlist = watchlistsById.get(input.watchlistId);

    if (!existingWatchlist || existingWatchlist.businessId !== businessId) {
      throw new Error("watchlistId is invalid for this business.");
    }

    return existingWatchlist;
  }

  if (!input.watchlistName?.trim()) {
    return undefined;
  }

  const normalizedName = input.watchlistName.trim();
  const existingWatchlist = Array.from(watchlistsById.values()).find(
    (watchlist) => watchlist.businessId === businessId && watchlist.name.toLowerCase() === normalizedName.toLowerCase(),
  );

  if (existingWatchlist) {
    return existingWatchlist;
  }

  const timestamp = nowIso();
  const createdWatchlist: CompetitorWatchlist = {
    id: randomUUID(),
    businessId,
    name: normalizedName,
    createdByUserId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  watchlistsById.set(createdWatchlist.id, createdWatchlist);

  return createdWatchlist;
}

function attachSourceToWatchlist(sourceId: string, watchlist: CompetitorWatchlist | undefined): void {
  if (!watchlist) {
    return;
  }

  const existing = Array.from(watchlistSourcesById.values()).find(
    (watchlistSource) => watchlistSource.watchlistId === watchlist.id && watchlistSource.sourceId === sourceId,
  );

  if (existing) {
    return;
  }

  const linkId = randomUUID();

  watchlistSourcesById.set(linkId, {
    id: linkId,
    watchlistId: watchlist.id,
    sourceId,
    createdAt: nowIso(),
  });
}

function toSourceItem(
  source: CompetitorSource,
  draft: FetchedSourceItemDraft,
): SourceItem {
  const timestamp = nowIso();

  return {
    id: randomUUID(),
    businessId: source.businessId,
    sourceId: source.id,
    externalId: draft.externalId,
    canonicalUrl: sanitizeOptional(draft.canonicalUrl),
    title: draft.title.trim(),
    excerpt: sanitizeOptional(draft.excerpt),
    contentText: draft.contentText.trim(),
    authorName: sanitizeOptional(draft.authorName),
    publishedAt: sanitizeOptional(draft.publishedAt) ?? timestamp,
    engagementScore: Math.max(draft.engagementScore ?? 1, 0.25),
    fetchedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function ingestDrafts(
  source: CompetitorSource,
  drafts: FetchedSourceItemDraft[],
): Promise<{ itemsImported: number; analysesCreated: number }> {
  let itemsImported = 0;
  let analysesCreated = 0;

  for (const draft of drafts) {
    const existingItem = Array.from(itemsById.values()).find(
      (item) => item.sourceId === source.id && item.externalId === draft.externalId,
    );

    const item = existingItem ?? toSourceItem(source, draft);

    if (!existingItem) {
      itemsById.set(item.id, item);
      itemsImported += 1;
    }

    const analysisBase = await analyzeSourceItem(item);
    const timestamp = nowIso();
    const existingAnalysis = analysesByItemId.get(item.id);

    const analysis: SourceItemAnalysis = {
      id: existingAnalysis?.id ?? randomUUID(),
      sourceItemId: item.id,
      businessId: item.businessId,
      topic: analysisBase.topic,
      hookType: analysisBase.hookType,
      tone: analysisBase.tone,
      format: analysisBase.format,
      whyItMightWork: analysisBase.whyItMightWork,
      confidence: analysisBase.confidence,
      createdAt: existingAnalysis?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    if (!existingAnalysis) {
      analysesCreated += 1;
    }

    analysesByItemId.set(item.id, analysis);
  }

  recomputeTrendSignals(source.businessId);

  return { itemsImported, analysesCreated };
}

function updateSourceFetchState(
  source: CompetitorSource,
  fetchStatus: SourceFetchStatus,
  options?: {
    error?: string;
    clearLock?: boolean;
    overrideNextFetchAt?: string | null;
    lastFetchedAt?: string | null;
  },
): void {
  const updatedSource: CompetitorSource = {
    ...source,
    lastFetchStatus: fetchStatus,
    lastFetchError: options?.error,
    lastFetchedAt: options?.lastFetchedAt ?? (fetchStatus === "succeeded" ? nowIso() : source.lastFetchedAt),
    nextFetchAt:
      options?.overrideNextFetchAt !== undefined
        ? options.overrideNextFetchAt
        : calculateNextFetchAt(source.sourceType, source.fetchFrequencyMinutes),
    fetchLockId: options?.clearLock ? undefined : source.fetchLockId,
    fetchLockedAt: options?.clearLock ? null : source.fetchLockedAt ?? null,
    updatedAt: nowIso(),
  };

  sourcesById.set(source.id, updatedSource);
}

async function fetchAndAnalyzeSource(
  source: CompetitorSource,
  manualImport?: ManualImportPayload,
): Promise<{ source: CompetitorSource; itemsImported: number; analysesCreated: number }> {
  const drafts = await fetchSourceDrafts(source, manualImport);
  const result = await ingestDrafts(source, drafts);
  const updatedSource = {
    ...source,
    lastFetchedAt: nowIso(),
    lastFetchStatus: "succeeded" as const,
    lastFetchError: undefined,
    nextFetchAt: calculateNextFetchAt(source.sourceType, source.fetchFrequencyMinutes),
    fetchLockId: undefined,
    fetchLockedAt: null,
    updatedAt: nowIso(),
  };

  sourcesById.set(updatedSource.id, updatedSource);

  return {
    source: updatedSource,
    ...result,
  };
}

function parseInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value ? Math.max(1, Math.round(value)) : fallback;
}

function recomputeTrendSignals(businessId: string): void {
  const items = listItemsForBusiness(businessId);
  const analyses = listAnalysesForBusiness(businessId);
  trendSignalsByBusinessId.set(businessId, buildTrendSignals(businessId, items, analyses));
}

export async function createCompetitorSource(
  principal: AuthenticatedPrincipal,
  input: CreateCompetitorSourceRequest,
): Promise<CreateCompetitorSourceResponse> {
  const membership = await requireBusinessMembership(principal, input.businessId);
  const timestamp = nowIso();
  const watchlist = ensureWatchlist(input.businessId, membership.userId, input);
  const sourceType = input.sourceType;
  const fetchFrequencyMinutes = sourceType === "manual_import"
    ? null
    : clampFetchFrequencyMinutes(input.fetchFrequencyMinutes);

  const source: CompetitorSource = {
    id: randomUUID(),
    businessId: input.businessId,
    sourceType,
    label: input.label.trim(),
    url: sanitizeOptional(input.url),
    status: resolveSourceStatus(sourceType),
    fetchFrequencyMinutes,
    nextFetchAt:
      sourceType === "manual_import"
        ? null
        : input.fetchNow === false
          ? calculateNextFetchAt(sourceType, fetchFrequencyMinutes, new Date())
          : nowIso(),
    lastFetchedAt: null,
    lastFetchStatus: resolveFetchStatus(sourceType),
    createdByUserId: membership.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  sourcesById.set(source.id, source);
  attachSourceToWatchlist(source.id, watchlist);

  if (sourceType === "manual_import" || input.fetchNow !== false) {
    try {
      const result = await fetchAndAnalyzeSource(source, input.manualImport);
      return {
        source: result.source,
        watchlist,
        itemsImported: result.itemsImported,
        analysesCreated: result.analysesCreated,
      };
    } catch (error) {
      updateSourceFetchState(source, "failed", {
        error: error instanceof Error ? error.message : "Unable to fetch source.",
      });
      throw error;
    }
  }

  return {
    source,
    watchlist,
    itemsImported: 0,
    analysesCreated: 0,
  };
}

export async function getCompetitorFeed(
  principal: AuthenticatedPrincipal,
  query: CompetitorFeedQuery,
): Promise<CompetitorFeedResponse> {
  await requireBusinessMembership(principal, query.businessId);

  const sourceIds = resolveWatchlistSourceIds(query.businessId, query.watchlistId);
  const days = parseInteger(query.days, 30);
  const limit = parseInteger(query.limit, 25);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const items = listItemsForBusiness(query.businessId, sourceIds)
    .filter((item) => new Date(item.publishedAt).getTime() >= cutoff)
    .sort((left, right) => new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime())
    .slice(0, limit)
    .map((item) => ({
      source: sourcesById.get(item.sourceId)!,
      item,
      analysis: analysesByItemId.get(item.id) ?? null,
    } satisfies CompetitorFeedEntry));

  return {
    items,
    generatedAt: nowIso(),
  };
}

export async function getTrendOverview(
  principal: AuthenticatedPrincipal,
  query: TrendsQuery,
): Promise<TrendsResponse> {
  await requireBusinessMembership(principal, query.businessId);

  const sourceIds = resolveWatchlistSourceIds(query.businessId, query.watchlistId);
  const items = listItemsForBusiness(query.businessId, sourceIds);
  const analyses = listAnalysesForBusiness(query.businessId, sourceIds);
  const signals = buildTrendSignals(query.businessId, items, analyses);

  trendSignalsByBusinessId.set(query.businessId, signals);

  return {
    trends7d: signals.trends7d,
    trends30d: signals.trends30d,
    generatedAt: nowIso(),
  };
}

export function claimDueCompetitorSources(limit: number, now = new Date()): CompetitorSource[] {
  const timeoutMs = getFetchLockTimeoutMinutes() * 60_000;
  const claimedSources: CompetitorSource[] = [];

  for (const source of sourcesById.values()) {
    if (claimedSources.length >= limit) {
      break;
    }

    if (source.sourceType === "manual_import" || source.status !== "active") {
      continue;
    }

    const nextFetchAt = source.nextFetchAt ? new Date(source.nextFetchAt).getTime() : Number.POSITIVE_INFINITY;
    const lockExpired =
      !source.fetchLockedAt || new Date(source.fetchLockedAt).getTime() + timeoutMs <= now.getTime();

    if (nextFetchAt > now.getTime() || !lockExpired) {
      continue;
    }

    const claimedSource: CompetitorSource = {
      ...source,
      fetchLockId: randomUUID(),
      fetchLockedAt: now.toISOString(),
      lastFetchStatus: "processing",
      updatedAt: nowIso(),
    };

    sourcesById.set(claimedSource.id, claimedSource);
    claimedSources.push(claimedSource);
  }

  return claimedSources;
}

export async function processClaimedCompetitorSource(sourceId: string): Promise<void> {
  const source = sourcesById.get(sourceId);

  if (!source) {
    return;
  }

  try {
    await fetchAndAnalyzeSource(source);
  } catch (error) {
    updateSourceFetchState(source, "failed", {
      error: error instanceof Error ? error.message : "Unable to process source.",
      clearLock: true,
      overrideNextFetchAt: calculateNextFetchAt(source.sourceType, source.fetchFrequencyMinutes),
    });
  }
}

export function getCompetitiveIntelligenceSnapshot(businessId: string): {
  items: SourceItem[];
  analyses: SourceItemAnalysis[];
  trends7d: TrendSignal[];
  trends30d: TrendSignal[];
} {
  const signals = trendSignalsByBusinessId.get(businessId) ?? {
    trends7d: [],
    trends30d: [],
  };

  return {
    items: listItemsForBusiness(businessId),
    analyses: listAnalysesForBusiness(businessId),
    trends7d: signals.trends7d,
    trends30d: signals.trends30d,
  };
}
