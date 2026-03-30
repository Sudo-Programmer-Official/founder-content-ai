import type {
  AdminJobQueueOverview,
  AdminJobQueueTypeOverview,
  AdminOpsOverview,
  AdminPostingReliabilityOverview,
  AdminProblemJob,
  AdminWorkerHealth,
} from "../../../../packages/shared-types/index.ts";
import type { QueryResultRow } from "pg";
import { queryDb } from "./db/client.ts";
import { listRiskyEmailDomains } from "./email/emailDeliverabilityService.ts";
import { loadLatestWorkerHeartbeat } from "./workerRuntimeService.ts";

interface CountRow extends QueryResultRow {
  total: string | number;
}

interface WorkerHeartbeatMetadata {
  pollIntervalMs?: number;
}

interface JobBacklogRow extends QueryResultRow {
  type: string;
  queued: string | number;
  processing: string | number;
  failed: string | number;
  paused: string | number;
  stuck_queued: string | number;
  stale_processing: string | number;
}

interface ProblemJobRow extends QueryResultRow {
  id: string;
  business_id: string | null;
  type: string;
  status: string;
  attempts: string | number;
  max_attempts: string | number;
  run_after: Date | string;
  locked_at: Date | string | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  problem_kind: "failed" | "stuck_queued" | "stale_processing";
}

interface PostingReliabilityRow extends QueryResultRow {
  scheduled_last_7d: string | number;
  published_last_7d: string | number;
  failed_last_7d: string | number;
  missed_due_count: string | number;
  processing_now: string | number;
  average_publish_delay_minutes: string | number | null;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function parseHeartbeatMetadata(value: unknown): WorkerHeartbeatMetadata {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as WorkerHeartbeatMetadata;
  }

  return {};
}

function resolveWorkerStatus(input: {
  lastHeartbeatAt?: string;
  pollIntervalMs: number;
}): AdminWorkerHealth["status"] {
  if (!input.lastHeartbeatAt) {
    return "offline";
  }

  const ageMs = Date.now() - new Date(input.lastHeartbeatAt).getTime();
  const healthyThresholdMs = Math.max(input.pollIntervalMs * 3, 30_000);
  const staleThresholdMs = Math.max(input.pollIntervalMs * 12, 120_000);

  if (ageMs <= healthyThresholdMs) {
    return "healthy";
  }

  if (ageMs <= staleThresholdMs) {
    return "stale";
  }

  return "offline";
}

async function loadWorkerHealth(): Promise<AdminWorkerHealth> {
  const heartbeat = await loadLatestWorkerHeartbeat("shared_app_worker");
  const metadata = parseHeartbeatMetadata(heartbeat?.metadata_json);
  const pollIntervalMs =
    typeof metadata.pollIntervalMs === "number" && Number.isFinite(metadata.pollIntervalMs)
      ? metadata.pollIntervalMs
      : Number.parseInt(process.env.APP_WORKER_POLL_INTERVAL_MS ?? "5000", 10) || 5000;

  return {
    workerKey: heartbeat?.worker_key ?? "shared-app-worker",
    workerType: heartbeat?.worker_type ?? "shared_app_worker",
    serviceName: heartbeat?.service_name ?? undefined,
    status: resolveWorkerStatus({
      lastHeartbeatAt: toIsoString(heartbeat?.last_heartbeat_at),
      pollIntervalMs,
    }),
    pollIntervalMs,
    lastHeartbeatAt: toIsoString(heartbeat?.last_heartbeat_at),
    lastSuccessfulPassAt: toIsoString(heartbeat?.last_successful_pass_at),
    lastWorkDetectedAt: toIsoString(heartbeat?.last_work_detected_at),
    lastErrorAt: toIsoString(heartbeat?.last_error_at),
    lastErrorMessage: heartbeat?.last_error_message ?? undefined,
  };
}

async function loadJobQueueOverview(): Promise<AdminJobQueueOverview> {
  const [backlogResult, problemJobsResult] = await Promise.all([
    queryDb<JobBacklogRow>(
      `
        select
          type,
          count(*) filter (where status = 'queued')::int as queued,
          count(*) filter (where status = 'processing')::int as processing,
          count(*) filter (where status = 'failed')::int as failed,
          count(*) filter (where status = 'paused')::int as paused,
          count(*) filter (
            where status = 'queued'
              and run_after <= now() - interval '10 minutes'
          )::int as stuck_queued,
          count(*) filter (
            where status = 'processing'
              and locked_at is not null
              and locked_at <= now() - interval '20 minutes'
          )::int as stale_processing
        from jobs
        where status in ('queued', 'processing', 'failed', 'paused')
        group by type
        order by type asc
      `,
    ),
    queryDb<ProblemJobRow>(
      `
        select
          id,
          business_id,
          type,
          status,
          attempts,
          max_attempts,
          run_after,
          locked_at,
          error_message,
          created_at,
          updated_at,
          case
            when status = 'failed' then 'failed'
            when status = 'processing'
              and locked_at is not null
              and locked_at <= now() - interval '20 minutes'
              then 'stale_processing'
            else 'stuck_queued'
          end as problem_kind
        from jobs
        where status = 'failed'
          or (
            status = 'queued'
            and run_after <= now() - interval '10 minutes'
          )
          or (
            status = 'processing'
            and locked_at is not null
            and locked_at <= now() - interval '20 minutes'
          )
        order by updated_at desc
        limit 12
      `,
    ),
  ]);

  const byType: AdminJobQueueTypeOverview[] = backlogResult.rows.map((row) => ({
    type: row.type,
    queued: toNumber(row.queued),
    processing: toNumber(row.processing),
    failed: toNumber(row.failed),
    paused: toNumber(row.paused),
    stuckQueued: toNumber(row.stuck_queued),
    staleProcessing: toNumber(row.stale_processing),
  }));

  const totals = byType.reduce(
    (summary, row) => ({
      queued: summary.queued + row.queued,
      processing: summary.processing + row.processing,
      failed: summary.failed + row.failed,
      paused: summary.paused + row.paused,
      stuckQueued: summary.stuckQueued + row.stuckQueued,
      staleProcessing: summary.staleProcessing + row.staleProcessing,
    }),
    {
      queued: 0,
      processing: 0,
      failed: 0,
      paused: 0,
      stuckQueued: 0,
      staleProcessing: 0,
    },
  );

  const problemJobs: AdminProblemJob[] = problemJobsResult.rows.map((row) => ({
    id: row.id,
    businessId: row.business_id ?? undefined,
    type: row.type,
    status: row.status,
    problemKind: row.problem_kind,
    attempts: toNumber(row.attempts),
    maxAttempts: toNumber(row.max_attempts),
    runAfter: new Date(row.run_after).toISOString(),
    lockedAt: toIsoString(row.locked_at),
    errorMessage: row.error_message ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));

  return {
    ...totals,
    byType,
    problemJobs,
  };
}

async function loadPostingReliability(): Promise<AdminPostingReliabilityOverview> {
  const result = await queryDb<PostingReliabilityRow>(
    `
      select
        count(*) filter (
          where created_at >= now() - interval '7 days'
        )::int as scheduled_last_7d,
        count(*) filter (
          where published_at is not null
            and published_at >= now() - interval '7 days'
        )::int as published_last_7d,
        count(*) filter (
          where status = 'failed'
            and updated_at >= now() - interval '7 days'
        )::int as failed_last_7d,
        count(*) filter (
          where status = 'scheduled'
            and latest_dispatch_at is not null
            and latest_dispatch_at < now()
        )::int as missed_due_count,
        count(*) filter (where status = 'processing')::int as processing_now,
        avg(extract(epoch from (published_at - scheduled_at)) / 60.0) filter (
          where published_at is not null
            and published_at >= now() - interval '7 days'
        ) as average_publish_delay_minutes
      from scheduled_posts
    `,
  );

  const row = result.rows[0];

  return {
    scheduledLast7d: toNumber(row?.scheduled_last_7d),
    publishedLast7d: toNumber(row?.published_last_7d),
    failedLast7d: toNumber(row?.failed_last_7d),
    missedDueCount: toNumber(row?.missed_due_count),
    processingNow: toNumber(row?.processing_now),
    averagePublishDelayMinutes: Number(toNumber(row?.average_publish_delay_minutes).toFixed(1)),
  };
}

export async function getAdminOpsOverview(): Promise<AdminOpsOverview> {
  const [
    aiCallsResult,
    outreachMessagesResult,
    emailSendsResult,
    failuresResult,
    activeUsersResult,
    riskyEmailDomains,
    workerHealth,
    jobQueue,
    postingReliability,
  ] = await Promise.all([
    queryDb<CountRow>(
      `
        select count(*)::int as total
        from content_generation_logs
        where created_at >= current_date
      `,
    ),
    queryDb<CountRow>(
      `
        select count(*)::int as total
        from outreach_messages
        where sent_at is not null
          and sent_at >= current_date
      `,
    ),
    queryDb<CountRow>(
      `
        select count(*)::int as total
        from email_campaign_recipients
        where sent_at is not null
          and sent_at >= current_date
      `,
    ),
    queryDb<CountRow>(
      `
        select count(*)::int as total
        from system_error_logs
        where created_at >= current_date
      `,
    ),
    queryDb<CountRow>(
      `
        select count(distinct user_id)::int as total
        from usage_events
        where user_id is not null
          and created_at >= current_date
      `,
    ),
    listRiskyEmailDomains(),
    loadWorkerHealth(),
    loadJobQueueOverview(),
    loadPostingReliability(),
  ]);

  return {
    aiCallsToday: toNumber(aiCallsResult.rows[0]?.total),
    outreachMessagesToday: toNumber(outreachMessagesResult.rows[0]?.total),
    emailSendsToday: toNumber(emailSendsResult.rows[0]?.total),
    failuresToday: toNumber(failuresResult.rows[0]?.total),
    activeUsersToday: toNumber(activeUsersResult.rows[0]?.total),
    riskyEmailDomains,
    workerHealth,
    jobQueue,
    postingReliability,
  };
}
