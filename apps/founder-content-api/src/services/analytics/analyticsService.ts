import type {
  AdminAlert,
  AdminUserListItem,
  AdminWorkspaceListItem,
  AnalyticsEventType,
  AnalyticsSeriesPoint,
  ContentAsset,
  ContentGenerationLog,
  EventBreakdownEntry,
  PlatformOverview,
  UsageEvent,
  UsageSummary,
  WorkspaceMetricDaily,
  WorkspaceOverview,
} from "../../../../../packages/shared-types/index.ts";
import { listAdminWorkspacesWithAccess } from "../adminControlService.ts";
import { queryDb } from "../db/client.ts";
import { evaluateAlerts } from "./alertService.ts";
import { getAICostSummary } from "./costService.ts";

interface CountRow {
  total: string | number;
}

interface GrowthRow {
  date: string;
  total: string | number;
}

interface UsageEventRow {
  id: string;
  user_id: string | null;
  business_id: string | null;
  event_type: AnalyticsEventType;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
}

interface ContentGenerationLogRow {
  id: string;
  user_id: string | null;
  business_id: string | null;
  input_type: "idea" | "link" | "upload";
  tokens_used: string | number;
  model: string;
  latency_ms: string | number;
  success: boolean;
  created_at: Date | string;
}

interface ContentAssetRow {
  id: string;
  business_id: string | null;
  user_id: string | null;
  content_type: "post" | "hook" | "email";
  title: string | null;
  content_body: unknown;
  status: "draft" | "review" | "scheduled" | "posted" | "published";
  pipeline_stage: "draft" | "review" | "scheduled" | "posted" | null;
  source_kind: "generated" | "manual" | "idea" | "capture" | "remix" | null;
  source_idea_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface WorkspaceMetricRow {
  id: string;
  business_id: string;
  date: string;
  total_generations: string | number;
  total_copies: string | number;
  total_remixes: string | number;
  total_publishes: string | number;
  created_at: Date | string;
}

interface AdminUserRow {
  id: string;
  email: string;
  full_name: string;
  status: string;
  created_at: Date | string;
  business_count: string | number;
  last_active_at: Date | string | null;
}

interface AdminWorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: Date | string;
  owner_email: string | null;
  member_count: string | number;
}

interface WorkspaceTotalsRow {
  total_generations: string | number;
  total_copies: string | number;
  total_remixes: string | number;
  total_publishes: string | number;
  total_assets: string | number;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function mapUsageEvent(row: UsageEventRow): UsageEvent {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    businessId: row.business_id ?? undefined,
    eventType: row.event_type,
    metadata: row.metadata ?? {},
    createdAt: toIsoString(row.created_at),
  };
}

function mapContentGenerationLog(row: ContentGenerationLogRow): ContentGenerationLog {
  return {
    id: row.id,
    userId: row.user_id ?? undefined,
    businessId: row.business_id ?? undefined,
    inputType: row.input_type,
    tokensUsed: toNumber(row.tokens_used),
    model: row.model,
    latencyMs: toNumber(row.latency_ms),
    success: row.success,
    createdAt: toIsoString(row.created_at),
  };
}

function extractTextContent(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.content === "string" && candidate.content.trim() !== "") {
    return candidate.content.trim();
  }

  if (typeof candidate.post === "string" && candidate.post.trim() !== "") {
    return candidate.post.trim();
  }

  if (Array.isArray(candidate.variations)) {
    const firstVariation = candidate.variations.find(
      (variation) =>
        variation &&
        typeof variation === "object" &&
        typeof (variation as Record<string, unknown>).content === "string",
    ) as Record<string, unknown> | undefined;

    if (typeof firstVariation?.content === "string" && firstVariation.content.trim() !== "") {
      return firstVariation.content.trim();
    }
  }

  return undefined;
}

function mapContentAsset(row: ContentAssetRow): ContentAsset {
  return {
    id: row.id,
    businessId: row.business_id ?? undefined,
    userId: row.user_id ?? undefined,
    contentType: row.content_type,
    title: row.title ?? undefined,
    contentBody: row.content_body,
    status: row.status,
    pipelineStage: row.pipeline_stage ?? undefined,
    sourceKind: row.source_kind ?? undefined,
    sourceIdeaId: row.source_idea_id ?? undefined,
    textContent: extractTextContent(row.content_body),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapWorkspaceMetric(row: WorkspaceMetricRow): WorkspaceMetricDaily {
  return {
    id: row.id,
    businessId: row.business_id,
    date: row.date,
    totalGenerations: toNumber(row.total_generations),
    totalCopies: toNumber(row.total_copies),
    totalRemixes: toNumber(row.total_remixes),
    totalPublishes: toNumber(row.total_publishes),
    createdAt: toIsoString(row.created_at),
  };
}

function buildDateSeries(days: number, rows: GrowthRow[]): AnalyticsSeriesPoint[] {
  const totalsByDate = new Map(rows.map((row) => [row.date, toNumber(row.total)]));
  const series: AnalyticsSeriesPoint[] = [];
  const end = new Date();

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(end);
    cursor.setDate(end.getDate() - offset);
    const date = cursor.toISOString().slice(0, 10);
    series.push({
      date,
      value: totalsByDate.get(date) ?? 0,
    });
  }

  return series;
}

export async function getPlatformOverview(): Promise<PlatformOverview> {
  const [
    userCountResult,
    workspaceCountResult,
    generationCountResult,
    failureCountResult,
    unresolvedAlertCountResult,
    userGrowthResult,
    workspaceGrowthResult,
    usageTrendResult,
    aiUsage,
    alerts,
  ] = await Promise.all([
    queryDb<CountRow>("select count(*)::int as total from users"),
    queryDb<CountRow>("select count(*)::int as total from businesses"),
    queryDb<CountRow>(
      `
        select count(*)::int as total
        from usage_events
        where event_type in ('idea_generated', 'hook_generated', 'post_generated', 'capture_used', 'remix_used')
      `,
    ),
    queryDb<CountRow>(
      `
        select count(*)::int as total
        from content_generation_logs
        where success = false
      `,
    ),
    queryDb<CountRow>(
      `
        select count(*)::int as total
        from admin_alerts
        where resolved = false
      `,
    ),
    queryDb<GrowthRow>(
      `
        select
          created_at::date::text as date,
          count(*)::int as total
        from users
        where created_at >= now() - interval '14 days'
        group by created_at::date
        order by created_at::date asc
      `,
    ),
    queryDb<GrowthRow>(
      `
        select
          created_at::date::text as date,
          count(*)::int as total
        from businesses
        where created_at >= now() - interval '14 days'
        group by created_at::date
        order by created_at::date asc
      `,
    ),
    queryDb<GrowthRow>(
      `
        select
          created_at::date::text as date,
          count(*)::int as total
        from usage_events
        where created_at >= now() - interval '14 days'
          and event_type in ('idea_generated', 'hook_generated', 'post_generated', 'capture_used', 'remix_used')
        group by created_at::date
        order by created_at::date asc
      `,
    ),
    getAICostSummary(),
    evaluateAlerts(),
  ]);

  return {
    totals: {
      totalUsers: toNumber(userCountResult.rows[0]?.total),
      totalWorkspaces: toNumber(workspaceCountResult.rows[0]?.total),
      totalGenerations: toNumber(generationCountResult.rows[0]?.total),
      totalApiFailures: toNumber(failureCountResult.rows[0]?.total),
      unresolvedAlerts: toNumber(unresolvedAlertCountResult.rows[0]?.total),
    },
    userGrowth: buildDateSeries(14, userGrowthResult.rows),
    workspaceGrowth: buildDateSeries(14, workspaceGrowthResult.rows),
    usageTrend: buildDateSeries(14, usageTrendResult.rows),
    aiUsage,
    alerts,
  };
}

export async function getWorkspaceOverview(businessId: string): Promise<WorkspaceOverview> {
  const [totalsResult, timelineResult, dailyMetricsResult, assetsResult] = await Promise.all([
    queryDb<WorkspaceTotalsRow>(
      `
        select
          count(*) filter (
            where event_type in ('idea_generated', 'hook_generated', 'post_generated', 'capture_used', 'remix_used')
          )::int as total_generations,
          count(*) filter (where event_type = 'output_copied')::int as total_copies,
          count(*) filter (where event_type = 'remix_used')::int as total_remixes,
          count(*) filter (where event_type = 'publish_marked')::int as total_publishes,
          (
            select count(*)::int
            from content_assets
            where business_id = $1
          ) as total_assets
        from usage_events
        where business_id = $1
      `,
      [businessId],
    ),
    queryDb<UsageEventRow>(
      `
        select
          id,
          user_id,
          business_id,
          event_type,
          metadata,
          created_at
        from usage_events
        where business_id = $1
        order by created_at desc
        limit 20
      `,
      [businessId],
    ),
    queryDb<WorkspaceMetricRow>(
      `
        select
          id,
          business_id,
          date::text as date,
          total_generations,
          total_copies,
          total_remixes,
          total_publishes,
          created_at
        from workspace_metrics_daily
        where business_id = $1
        order by date desc
        limit 14
      `,
      [businessId],
    ),
    queryDb<ContentAssetRow>(
      `
        select
          id,
          business_id,
          user_id,
          content_type,
          title,
          content_body,
          status,
          pipeline_stage,
          source_kind,
          source_idea_id,
          created_at,
          updated_at
        from content_assets
        where business_id = $1
        order by created_at desc
        limit 10
      `,
      [businessId],
    ),
  ]);

  const totals = totalsResult.rows[0];

  return {
    businessId,
    totals: {
      totalGenerations: toNumber(totals?.total_generations),
      totalCopies: toNumber(totals?.total_copies),
      totalRemixes: toNumber(totals?.total_remixes),
      totalPublishes: toNumber(totals?.total_publishes),
      totalAssets: toNumber(totals?.total_assets),
    },
    funnel: {
      generated: toNumber(totals?.total_generations),
      copied: toNumber(totals?.total_copies),
      published: toNumber(totals?.total_publishes),
    },
    activityTimeline: timelineResult.rows.map(mapUsageEvent),
    dailyMetrics: dailyMetricsResult.rows.reverse().map(mapWorkspaceMetric),
    topAssets: assetsResult.rows.map(mapContentAsset),
  };
}

export async function getUsageSummary(): Promise<UsageSummary> {
  const [recentEventsResult, eventBreakdownResult, generationLogsResult, generationCountResult, failureCountResult] =
    await Promise.all([
      queryDb<UsageEventRow>(
        `
          select
            id,
            user_id,
            business_id,
            event_type,
            metadata,
            created_at
          from usage_events
          order by created_at desc
          limit 20
        `,
      ),
      queryDb<{ event_type: AnalyticsEventType; total: string | number }>(
        `
          select
            event_type,
            count(*)::int as total
          from usage_events
          where created_at >= now() - interval '30 days'
          group by event_type
          order by total desc, event_type asc
        `,
      ),
      queryDb<ContentGenerationLogRow>(
        `
          select
            id,
            user_id,
            business_id,
            input_type,
            tokens_used,
            model,
            latency_ms,
            success,
            created_at
          from content_generation_logs
          order by created_at desc
          limit 20
        `,
      ),
      queryDb<CountRow>(
        `
          select count(*)::int as total
          from content_generation_logs
          where success = true
        `,
      ),
      queryDb<CountRow>(
        `
          select count(*)::int as total
          from content_generation_logs
          where success = false
        `,
      ),
    ]);

  const eventBreakdown: EventBreakdownEntry[] = eventBreakdownResult.rows.map((row) => ({
    eventType: row.event_type,
    total: toNumber(row.total),
  }));

  return {
    recentEvents: recentEventsResult.rows.map(mapUsageEvent),
    eventBreakdown,
    recentGenerationLogs: generationLogsResult.rows.map(mapContentGenerationLog),
    generationCount: toNumber(generationCountResult.rows[0]?.total),
    failureCount: toNumber(failureCountResult.rows[0]?.total),
  };
}

export async function listAdminUsers(): Promise<AdminUserListItem[]> {
  const result = await queryDb<AdminUserRow>(
    `
      select
        u.id,
        u.email,
        u.full_name,
        u.status,
        u.created_at,
        count(distinct bm.business_id)::int as business_count,
        max(ue.created_at) as last_active_at
      from users u
      left join business_members bm on bm.user_id = u.id
      left join usage_events ue on ue.user_id = u.id
      group by u.id
      order by u.created_at desc
      limit 100
    `,
  );

  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    businessCount: toNumber(row.business_count),
    lastActiveAt: row.last_active_at ? toIsoString(row.last_active_at) : undefined,
  }));
}

export async function listAdminWorkspaces(): Promise<AdminWorkspaceListItem[]> {
  return listAdminWorkspacesWithAccess();
}
