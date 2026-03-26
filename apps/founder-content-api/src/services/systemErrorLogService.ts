import type {
  ErrorCodeSummaryEntry,
  SystemErrorLogEntry,
} from "../../../../packages/shared-types/index.ts";
import type { QueryResultRow } from "pg";
import { isDatabaseConfigured, queryDb } from "./db/client.ts";
import { logError } from "../utils/logger.ts";
import { toErrorContext } from "../utils/http.ts";

interface SystemErrorLogRow extends QueryResultRow {
  id: string;
  route: string;
  user_id: string | null;
  business_id: string | null;
  code: string;
  message: string;
  metadata_json: Record<string, unknown> | null;
  created_at: Date | string;
}

interface ErrorCodeSummaryRow extends QueryResultRow {
  code: string;
  total: string | number;
}

interface CreateSystemErrorLogInput {
  route: string;
  userId?: string;
  businessId?: string;
  code: string;
  message: string;
  metadata?: Record<string, unknown>;
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapSystemErrorLog(row: SystemErrorLogRow): SystemErrorLogEntry {
  return {
    id: row.id,
    route: row.route,
    userId: row.user_id ?? undefined,
    businessId: row.business_id ?? undefined,
    code: row.code,
    message: row.message,
    metadata: row.metadata_json ?? {},
    createdAt: toIsoString(row.created_at),
  };
}

export async function createSystemErrorLog(
  input: CreateSystemErrorLogInput,
): Promise<SystemErrorLogEntry> {
  const result = await queryDb<SystemErrorLogRow>(
    `
      insert into system_error_logs (
        route,
        user_id,
        business_id,
        code,
        message,
        metadata_json
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb
      )
      returning
        id,
        route,
        user_id,
        business_id,
        code,
        message,
        metadata_json,
        created_at
    `,
    [
      input.route,
      input.userId ?? null,
      input.businessId ?? null,
      input.code,
      input.message,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  return mapSystemErrorLog(result.rows[0]);
}

export async function safeCreateSystemErrorLog(
  input: CreateSystemErrorLogInput,
): Promise<SystemErrorLogEntry | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  try {
    return await createSystemErrorLog(input);
  } catch (error) {
    logError("Failed to persist system error log.", {
      route: input.route,
      code: input.code,
      ...toErrorContext(error),
    });
    return null;
  }
}

export async function listRecentSystemErrorLogs(limit = 20): Promise<SystemErrorLogEntry[]> {
  const result = await queryDb<SystemErrorLogRow>(
    `
      select
        id,
        route,
        user_id,
        business_id,
        code,
        message,
        metadata_json,
        created_at
      from system_error_logs
      order by created_at desc
      limit $1
    `,
    [Math.max(1, Math.min(limit, 100))],
  );

  return result.rows.map(mapSystemErrorLog);
}

export async function listTopSystemErrorCodes(
  limit = 10,
): Promise<ErrorCodeSummaryEntry[]> {
  const result = await queryDb<ErrorCodeSummaryRow>(
    `
      select
        code,
        count(*)::int as total
      from system_error_logs
      where created_at >= current_date
      group by code
      order by total desc, code asc
      limit $1
    `,
    [Math.max(1, Math.min(limit, 50))],
  );

  return result.rows.map((row) => ({
    code: row.code,
    total: toNumber(row.total),
  }));
}
