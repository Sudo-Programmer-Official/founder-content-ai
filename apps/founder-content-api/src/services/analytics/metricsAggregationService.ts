import { queryDb } from "../db/client.ts";

interface BusinessRow {
  id: string;
}

export async function updateWorkspaceMetrics(
  businessId: string,
  date = new Date().toISOString().slice(0, 10),
): Promise<void> {
  await queryDb(
    `
      insert into workspace_metrics_daily (
        business_id,
        date,
        total_generations,
        total_copies,
        total_remixes,
        total_publishes
      )
      values (
        $1,
        $2::date,
        (
          select count(*)::int
          from usage_events
          where business_id = $1
            and event_type in ('idea_generated', 'hook_generated', 'post_generated', 'capture_used', 'remix_used')
            and created_at::date = $2::date
        ),
        (
          select count(*)::int
          from usage_events
          where business_id = $1
            and event_type = 'output_copied'
            and created_at::date = $2::date
        ),
        (
          select count(*)::int
          from usage_events
          where business_id = $1
            and event_type = 'remix_used'
            and created_at::date = $2::date
        ),
        (
          select count(*)::int
          from usage_events
          where business_id = $1
            and event_type = 'publish_marked'
            and created_at::date = $2::date
        )
      )
      on conflict (business_id, date)
      do update set
        total_generations = excluded.total_generations,
        total_copies = excluded.total_copies,
        total_remixes = excluded.total_remixes,
        total_publishes = excluded.total_publishes
    `,
    [businessId, date],
  );
}

export async function updatePlatformMetrics(
  date = new Date().toISOString().slice(0, 10),
): Promise<void> {
  await queryDb(
    `
      insert into platform_metrics_daily (
        date,
        total_users,
        total_workspaces,
        total_generations,
        total_api_failures
      )
      values (
        $1::date,
        (select count(*)::int from users where created_at::date <= $1::date),
        (select count(*)::int from businesses where created_at::date <= $1::date),
        (
          select count(*)::int
          from usage_events
          where event_type in ('idea_generated', 'hook_generated', 'post_generated', 'capture_used', 'remix_used')
            and created_at::date = $1::date
        ),
        (
          select count(*)::int
          from content_generation_logs
          where success = false
            and created_at::date = $1::date
        )
      )
      on conflict (date)
      do update set
        total_users = excluded.total_users,
        total_workspaces = excluded.total_workspaces,
        total_generations = excluded.total_generations,
        total_api_failures = excluded.total_api_failures
    `,
    [date],
  );
}

export async function aggregateDailyMetrics(
  date = new Date().toISOString().slice(0, 10),
): Promise<void> {
  const businessesResult = await queryDb<BusinessRow>("select id from businesses");

  await Promise.all(businessesResult.rows.map((row) => updateWorkspaceMetrics(row.id, date)));
  await updatePlatformMetrics(date);
}
