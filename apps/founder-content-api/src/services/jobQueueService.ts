import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { queryDb, withDbTransaction } from "./db/client.ts";

interface JobRow extends QueryResultRow {
  id: string;
  business_id: string | null;
  job_key: string | null;
  type: string;
  status: string;
  priority: string | number;
  payload_json: unknown;
  attempts: string | number;
  max_attempts: string | number;
  run_after: Date | string;
  locked_at: Date | string | null;
  locked_by: string | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
}

export interface JobQueueRecord<TPayload = Record<string, unknown>> {
  id: string;
  businessId?: string;
  jobKey?: string;
  type: string;
  status: string;
  priority: number;
  payload: TPayload;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedAt?: string;
  lockedBy?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface CreateJobInput<TPayload> {
  businessId?: string;
  jobKey?: string;
  type: string;
  priority?: number;
  payload?: TPayload;
  maxAttempts?: number;
  runAfter?: string;
  client?: PoolClient;
}

interface ClaimQueuedJobsInput {
  types: string[];
  batchSize: number;
  lockedBy: string;
  staleAfterMinutes?: number;
}

export interface JobQueueSnapshot {
  dueCount: number;
  futureCount: number;
  processingCount: number;
  failedCount: number;
  nextRunAfter?: string;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePayload<TPayload>(value: unknown): TPayload {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as TPayload;
  }

  return {} as TPayload;
}

function mapJobRow<TPayload>(row: JobRow): JobQueueRecord<TPayload> {
  return {
    id: row.id,
    businessId: row.business_id ?? undefined,
    jobKey: row.job_key ?? undefined,
    type: row.type,
    status: row.status,
    priority: toNumber(row.priority),
    payload: parsePayload<TPayload>(row.payload_json),
    attempts: toNumber(row.attempts),
    maxAttempts: toNumber(row.max_attempts),
    runAfter: new Date(row.run_after).toISOString(),
    lockedAt: toIsoString(row.locked_at),
    lockedBy: row.locked_by ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: toIsoString(row.completed_at),
  };
}

async function executeQuery<TRow extends QueryResultRow>(
  text: string,
  values: unknown[],
  client?: PoolClient,
): Promise<QueryResult<TRow>> {
  if (client) {
    return client.query<TRow>(text, values);
  }

  return queryDb<TRow>(text, values);
}

export async function createJob<TPayload = Record<string, unknown>>(
  input: CreateJobInput<TPayload>,
): Promise<JobQueueRecord<TPayload>> {
  const result = await executeQuery<JobRow>(
    `
      insert into jobs (
        business_id,
        job_key,
        type,
        status,
        priority,
        payload_json,
        max_attempts,
        run_after
      ) values (
        $1::uuid,
        $2,
        $3,
        'queued',
        $4::int,
        $5::jsonb,
        $6::int,
        $7::timestamptz
      )
      on conflict (job_key)
      where job_key is not null
        and status in ('queued', 'processing')
      do update
      set
        updated_at = now(),
        error_message = null
      returning
        id,
        business_id,
        job_key,
        type,
        status,
        priority,
        payload_json,
        attempts,
        max_attempts,
        run_after,
        locked_at,
        locked_by,
        error_message,
        created_at,
        updated_at,
        completed_at
    `,
    [
      input.businessId ?? null,
      input.jobKey ?? null,
      input.type,
      input.priority ?? 100,
      JSON.stringify(input.payload ?? {}),
      input.maxAttempts ?? 3,
      input.runAfter ?? new Date().toISOString(),
    ],
    input.client,
  );

  return mapJobRow<TPayload>(result.rows[0]);
}

export async function claimQueuedJobs<TPayload = Record<string, unknown>>(
  input: ClaimQueuedJobsInput,
): Promise<Array<JobQueueRecord<TPayload>>> {
  return withDbTransaction(async (client) => {
    const result = await executeQuery<JobRow>(
      `
        with candidate_ids as (
          select j.id
          from jobs j
          where j.type = any($1::text[])
            and j.attempts < j.max_attempts
            and (
              (j.status = 'queued' and j.run_after <= now())
              or (
                j.status = 'processing'
                and j.locked_at is not null
                and j.locked_at < now() - ($2::int * interval '1 minute')
              )
            )
          order by j.priority asc, j.run_after asc, j.created_at asc
          limit $3
          for update skip locked
        )
        update jobs j
        set
          status = 'processing',
          attempts = j.attempts + 1,
          locked_at = now(),
          locked_by = $4,
          error_message = null,
          updated_at = now()
        from candidate_ids c
        where j.id = c.id
        returning
          j.id,
          j.business_id,
          j.job_key,
          j.type,
          j.status,
          j.priority,
          j.payload_json,
          j.attempts,
          j.max_attempts,
          j.run_after,
          j.locked_at,
          j.locked_by,
          j.error_message,
          j.created_at,
          j.updated_at,
          j.completed_at
      `,
      [input.types, input.staleAfterMinutes ?? 30, input.batchSize, input.lockedBy],
      client,
    );

    return result.rows.map((row) => mapJobRow<TPayload>(row));
  });
}

export async function inspectJobQueue(types: string[]): Promise<JobQueueSnapshot> {
  const result = await queryDb<{
    due_count: string | number;
    future_count: string | number;
    processing_count: string | number;
    failed_count: string | number;
    next_run_after: Date | string | null;
  }>(
    `
      select
        count(*) filter (
          where status = 'queued'
            and run_after <= now()
            and attempts < max_attempts
        )::int as due_count,
        count(*) filter (
          where status = 'queued'
            and run_after > now()
            and attempts < max_attempts
        )::int as future_count,
        count(*) filter (
          where status = 'processing'
            and attempts < max_attempts
        )::int as processing_count,
        count(*) filter (
          where status = 'failed'
        )::int as failed_count,
        min(run_after) filter (
          where status = 'queued'
            and attempts < max_attempts
        ) as next_run_after
      from jobs
      where type = any($1::text[])
    `,
    [types],
  );

  const row = result.rows[0];

  return {
    dueCount: toNumber(row?.due_count),
    futureCount: toNumber(row?.future_count),
    processingCount: toNumber(row?.processing_count),
    failedCount: toNumber(row?.failed_count),
    nextRunAfter: toIsoString(row?.next_run_after),
  };
}

export async function markJobCompleted(jobId: string, client?: PoolClient): Promise<void> {
  await executeQuery(
    `
      update jobs
      set
        status = 'completed',
        locked_at = null,
        locked_by = null,
        error_message = null,
        completed_at = now(),
        updated_at = now()
      where id = $1::uuid
    `,
    [jobId],
    client,
  );
}

export async function pauseJob(jobId: string, client?: PoolClient): Promise<void> {
  await executeQuery(
    `
      update jobs
      set
        status = 'paused',
        locked_at = null,
        locked_by = null,
        updated_at = now()
      where id = $1::uuid
        and status in ('queued', 'processing')
    `,
    [jobId],
    client,
  );
}

export async function releaseJob(
  jobId: string,
  input?: {
    runAfter?: string;
    errorMessage?: string;
  },
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      update jobs
      set
        status = 'queued',
        locked_at = null,
        locked_by = null,
        error_message = $2,
        run_after = coalesce($3::timestamptz, run_after),
        updated_at = now()
      where id = $1::uuid
        and status = 'processing'
    `,
    [jobId, input?.errorMessage ?? null, input?.runAfter ?? null],
    client,
  );
}

export async function markJobFailed(
  jobId: string,
  errorMessage: string,
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      update jobs
      set
        status = case
          when attempts >= max_attempts then 'failed'
          else 'queued'
        end,
        locked_at = null,
        locked_by = null,
        error_message = $2,
        run_after = case
          when attempts >= max_attempts then run_after
          else now() + (least(attempts, 5) * interval '1 minute')
        end,
        updated_at = now(),
        completed_at = case
          when attempts >= max_attempts then now()
          else completed_at
        end
      where id = $1::uuid
    `,
    [jobId, errorMessage],
    client,
  );
}

export async function markJobTerminalFailed(
  jobId: string,
  errorMessage: string,
  client?: PoolClient,
): Promise<void> {
  await executeQuery(
    `
      update jobs
      set
        status = 'failed',
        locked_at = null,
        locked_by = null,
        error_message = $2,
        updated_at = now(),
        completed_at = now()
      where id = $1::uuid
    `,
    [jobId, errorMessage],
    client,
  );
}
