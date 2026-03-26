import type {
  ApiError,
  CompetitorFeedQuery,
  CompetitorFeedResponse,
  CreateCompetitorSourceRequest,
  CreateCompetitorSourceResponse,
  TrendsQuery,
  TrendsResponse,
} from "../../../../packages/shared-types/index.ts";
import type { Request, Response } from "express";
import {
  createCompetitorSource,
  getCompetitorFeed,
  getTrendOverview,
} from "../services/competitiveIntelligence/service.ts";

function parsePositiveInteger(value: unknown): number | undefined {
  const candidate =
    typeof value === "string" ? Number(value) : typeof value === "number" ? value : null;

  if (candidate === null) {
    return undefined;
  }

  return Number.isFinite(candidate) && candidate > 0 ? Math.round(candidate) : undefined;
}

export async function createCompetitorSourceController(
  request: Request<unknown, CreateCompetitorSourceResponse | ApiError, Partial<CreateCompetitorSourceRequest>>,
  response: Response<CreateCompetitorSourceResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    response.status(401).json({
      ok: false,
      error: {
        code: "auth_required",
        message: "Authentication is required.",
      },
    });
    return;
  }

  const businessId = request.body?.businessId?.trim();
  const sourceType = request.body?.sourceType;
  const label = request.body?.label?.trim();

  if (!businessId || !sourceType || !label) {
    response.status(400).json({
      ok: false,
      error: {
        code: "bad_request",
        message: "businessId, sourceType, and label are required.",
      },
    });
    return;
  }

  try {
    const createdSource = await createCompetitorSource(request.auth, {
      businessId,
      sourceType,
      label,
      url: request.body?.url?.trim(),
      fetchFrequencyMinutes: parsePositiveInteger(request.body?.fetchFrequencyMinutes),
      watchlistId: request.body?.watchlistId?.trim(),
      watchlistName: request.body?.watchlistName?.trim(),
      fetchNow: request.body?.fetchNow,
      manualImport: request.body?.manualImport,
    });

    response.status(201).json(createdSource);
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: {
        code: "competitor_source_creation_failed",
        message: error instanceof Error ? error.message : "Unable to create competitor source.",
      },
    });
  }
}

export async function getCompetitorFeedController(
  request: Request<unknown, CompetitorFeedResponse | ApiError, unknown, Partial<CompetitorFeedQuery>>,
  response: Response<CompetitorFeedResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    response.status(401).json({
      ok: false,
      error: {
        code: "auth_required",
        message: "Authentication is required.",
      },
    });
    return;
  }

  const businessId = request.query.businessId?.trim();

  if (!businessId) {
    response.status(400).json({
      ok: false,
      error: {
        code: "bad_request",
        message: "businessId is required.",
      },
    });
    return;
  }

  try {
    const feed = await getCompetitorFeed(request.auth, {
      businessId,
      watchlistId: request.query.watchlistId?.trim(),
      days: parsePositiveInteger(request.query.days),
      limit: parsePositiveInteger(request.query.limit),
    });

    response.json(feed);
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: {
        code: "competitor_feed_failed",
        message: error instanceof Error ? error.message : "Unable to load competitor feed.",
      },
    });
  }
}

export async function getTrendsController(
  request: Request<unknown, TrendsResponse | ApiError, unknown, Partial<TrendsQuery>>,
  response: Response<TrendsResponse | ApiError>,
): Promise<void> {
  if (!request.auth) {
    response.status(401).json({
      ok: false,
      error: {
        code: "auth_required",
        message: "Authentication is required.",
      },
    });
    return;
  }

  const businessId = request.query.businessId?.trim();

  if (!businessId) {
    response.status(400).json({
      ok: false,
      error: {
        code: "bad_request",
        message: "businessId is required.",
      },
    });
    return;
  }

  try {
    const trends = await getTrendOverview(request.auth, {
      businessId,
      watchlistId: request.query.watchlistId?.trim(),
    });

    response.json(trends);
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: {
        code: "trend_lookup_failed",
        message: error instanceof Error ? error.message : "Unable to load trends.",
      },
    });
  }
}
