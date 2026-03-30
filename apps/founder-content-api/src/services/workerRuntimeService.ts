import type { QueryResultRow } from "pg";
import { queryDb } from "./db/client.ts";

interface WorkerRuntimeHeartbeatRow extends QueryResultRow {
  worker_key: string;
  worker_type: string;
  service_name: string | null;
  last_heartbeat_at: Date | string;
  last_successful_pass_at: Date | string | null;
  last_work_detected_at: Date | string | null;
  last_error_at: Date | string | null;
  last_error_message: string | null;
  metadata_json: unknown;
}

function serializeMetadata(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export async function recordWorkerHeartbeat(input: {
  workerKey: string;
  workerType: string;
  serviceName?: string;
  hadWork: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await queryDb(
    `
      insert into worker_runtime_heartbeats (
        worker_key,
        worker_type,
        service_name,
        last_heartbeat_at,
        last_successful_pass_at,
        last_work_detected_at,
        last_error_message,
        metadata_json,
        created_at,
        updated_at
      ) values (
        $1,
        $2,
        $3,
        now(),
        now(),
        case when $4::boolean then now() else null end,
        null,
        $5::jsonb,
        now(),
        now()
      )
      on conflict (worker_key)
      do update
      set
        worker_type = excluded.worker_type,
        service_name = excluded.service_name,
        last_heartbeat_at = now(),
        last_successful_pass_at = now(),
        last_work_detected_at = case
          when $4::boolean then now()
          else worker_runtime_heartbeats.last_work_detected_at
        end,
        last_error_message = null,
        metadata_json = excluded.metadata_json,
        updated_at = now()
    `,
    [
      input.workerKey,
      input.workerType,
      input.serviceName ?? null,
      input.hadWork,
      serializeMetadata(input.metadata ?? {}),
    ],
  );
}

export async function recordWorkerFailure(input: {
  workerKey: string;
  workerType: string;
  serviceName?: string;
  errorMessage: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await queryDb(
    `
      insert into worker_runtime_heartbeats (
        worker_key,
        worker_type,
        service_name,
        last_heartbeat_at,
        last_error_at,
        last_error_message,
        metadata_json,
        created_at,
        updated_at
      ) values (
        $1,
        $2,
        $3,
        now(),
        now(),
        $4,
        $5::jsonb,
        now(),
        now()
      )
      on conflict (worker_key)
      do update
      set
        worker_type = excluded.worker_type,
        service_name = excluded.service_name,
        last_heartbeat_at = now(),
        last_error_at = now(),
        last_error_message = excluded.last_error_message,
        metadata_json = excluded.metadata_json,
        updated_at = now()
    `,
    [
      input.workerKey,
      input.workerType,
      input.serviceName ?? null,
      input.errorMessage,
      serializeMetadata(input.metadata ?? {}),
    ],
  );
}

export async function loadLatestWorkerHeartbeat(
  workerType: string,
): Promise<WorkerRuntimeHeartbeatRow | null> {
  const result = await queryDb<WorkerRuntimeHeartbeatRow>(
    `
      select
        worker_key,
        worker_type,
        service_name,
        last_heartbeat_at,
        last_successful_pass_at,
        last_work_detected_at,
        last_error_at,
        last_error_message,
        metadata_json
      from worker_runtime_heartbeats
      where worker_type = $1
      order by updated_at desc
      limit 1
    `,
    [workerType],
  );

  return result.rows[0] ?? null;
}
