import type {
  AdminAlert,
  AdminAlertSeverity,
  AdminAlertType,
} from "../../../../../packages/shared-types/index.ts";
import { queryDb } from "../db/client.ts";

interface AlertRow {
  id: string;
  type: AdminAlertType;
  severity: AdminAlertSeverity;
  message: string;
  metadata: Record<string, unknown> | null;
  resolved: boolean;
  created_at: Date | string;
}

interface FailureSummaryRow {
  failure_count: string | number;
}

interface AbuseSummaryRow {
  event_count: string | number;
  user_id: string | null;
}

function toIsoString(value: Date | string): string {
  return new Date(value).toISOString();
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapAlert(row: AlertRow): AdminAlert {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    message: row.message,
    metadata: row.metadata ?? {},
    resolved: row.resolved,
    createdAt: toIsoString(row.created_at),
  };
}

export async function createAlert(
  type: AdminAlertType,
  severity: AdminAlertSeverity,
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<AdminAlert> {
  const existingResult = await queryDb<AlertRow>(
    `
      select
        id,
        type,
        severity,
        message,
        metadata,
        resolved,
        created_at
      from admin_alerts
      where type = $1
        and severity = $2
        and message = $3
        and resolved = false
      order by created_at desc
      limit 1
    `,
    [type, severity, message],
  );

  if (existingResult.rows[0]) {
    return mapAlert(existingResult.rows[0]);
  }

  const result = await queryDb<AlertRow>(
    `
      insert into admin_alerts (
        type,
        severity,
        message,
        metadata,
        resolved
      ) values (
        $1,
        $2,
        $3,
        $4::jsonb,
        false
      )
      returning
        id,
        type,
        severity,
        message,
        metadata,
        resolved,
        created_at
    `,
    [type, severity, message, JSON.stringify(metadata)],
  );

  return mapAlert(result.rows[0]);
}

export async function evaluateAlerts(): Promise<AdminAlert[]> {
  const [failureResult, abuseResult] = await Promise.all([
    queryDb<FailureSummaryRow>(
      `
        select count(*)::int as failure_count
        from content_generation_logs
        where success = false
          and created_at >= now() - interval '24 hours'
      `,
    ),
    queryDb<AbuseSummaryRow>(
      `
        select
          count(*)::int as event_count,
          user_id
        from usage_events
        where created_at >= now() - interval '1 hour'
          and user_id is not null
        group by user_id
        order by event_count desc
        limit 1
      `,
    ),
  ]);

  const createdAlerts: AdminAlert[] = [];
  const failureCount = toNumber(failureResult.rows[0]?.failure_count);

  if (failureCount >= 5) {
    const severity: AdminAlertSeverity = failureCount >= 20 ? "high" : "medium";
    createdAlerts.push(
      await createAlert(
        "api_failure",
        severity,
        "Recent API failures crossed the alert threshold.",
        {
          window: "24h",
          failureCount,
        },
      ),
    );
  }

  const abuseCandidate = abuseResult.rows[0];
  const eventCount = toNumber(abuseCandidate?.event_count);

  if (abuseCandidate?.user_id && eventCount >= 200) {
    createdAlerts.push(
      await createAlert(
        "abuse",
        eventCount >= 500 ? "high" : "medium",
        "A single user has generated an unusual amount of activity in the last hour.",
        {
          userId: abuseCandidate.user_id,
          eventCount,
          window: "1h",
        },
      ),
    );
  }

  const unresolvedResult = await queryDb<AlertRow>(
    `
      select
        id,
        type,
        severity,
        message,
        metadata,
        resolved,
        created_at
      from admin_alerts
      where resolved = false
      order by created_at desc
      limit 10
    `,
  );

  return unresolvedResult.rows.map(mapAlert);
}
