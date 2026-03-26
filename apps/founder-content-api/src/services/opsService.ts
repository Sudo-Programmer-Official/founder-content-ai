import type { AdminOpsOverview } from "../../../../packages/shared-types/index.ts";
import type { QueryResultRow } from "pg";
import { queryDb } from "./db/client.ts";

interface CountRow extends QueryResultRow {
  total: string | number;
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getAdminOpsOverview(): Promise<AdminOpsOverview> {
  const [
    aiCallsResult,
    outreachMessagesResult,
    emailSendsResult,
    failuresResult,
    activeUsersResult,
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
  ]);

  return {
    aiCallsToday: toNumber(aiCallsResult.rows[0]?.total),
    outreachMessagesToday: toNumber(outreachMessagesResult.rows[0]?.total),
    emailSendsToday: toNumber(emailSendsResult.rows[0]?.total),
    failuresToday: toNumber(failuresResult.rows[0]?.total),
    activeUsersToday: toNumber(activeUsersResult.rows[0]?.total),
  };
}
