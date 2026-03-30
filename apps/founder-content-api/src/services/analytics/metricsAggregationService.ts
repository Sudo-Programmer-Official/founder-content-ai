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
        total_publishes,
        posts_created,
        posts_scheduled,
        posts_published,
        emails_sent,
        active_flag,
        last_active_at
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
        ),
        (
          select count(*)::int
          from content_assets
          where business_id = $1
            and content_type = 'post'
            and created_at::date = $2::date
        ),
        (
          select count(*)::int
          from scheduled_posts
          where business_id = $1
            and created_at::date = $2::date
        ),
        (
          select count(*)::int
          from scheduled_posts
          where business_id = $1
            and status = 'published'
            and published_at is not null
            and published_at::date = $2::date
        ),
        (
          select count(*)::int
          from email_campaign_recipients r
          inner join email_campaigns c on c.id = r.campaign_id
          where c.business_id = $1
            and r.sent_at is not null
            and r.sent_at::date = $2::date
        ),
        (
          (
            select count(*)::int
            from usage_events
            where business_id = $1
              and created_at::date = $2::date
          ) +
          (
            select count(*)::int
            from content_assets
            where business_id = $1
              and created_at::date = $2::date
          ) +
          (
            select count(*)::int
            from scheduled_posts
            where business_id = $1
              and (
                created_at::date = $2::date
                or (published_at is not null and published_at::date = $2::date)
              )
          ) +
          (
            select count(*)::int
            from email_campaign_recipients r
            inner join email_campaigns c on c.id = r.campaign_id
            where c.business_id = $1
              and r.sent_at is not null
              and r.sent_at::date = $2::date
          )
        ) > 0,
        (
          select max(activity_at)
          from (
            select max(created_at) as activity_at
            from usage_events
            where business_id = $1
              and created_at::date = $2::date
            union all
            select max(created_at) as activity_at
            from content_assets
            where business_id = $1
              and created_at::date = $2::date
            union all
            select max(created_at) as activity_at
            from scheduled_posts
            where business_id = $1
              and created_at::date = $2::date
            union all
            select max(published_at) as activity_at
            from scheduled_posts
            where business_id = $1
              and published_at is not null
              and published_at::date = $2::date
            union all
            select max(r.sent_at) as activity_at
            from email_campaign_recipients r
            inner join email_campaigns c on c.id = r.campaign_id
            where c.business_id = $1
              and r.sent_at is not null
              and r.sent_at::date = $2::date
          ) activity
        )
      )
      on conflict (business_id, date)
      do update set
        total_generations = excluded.total_generations,
        total_copies = excluded.total_copies,
        total_remixes = excluded.total_remixes,
        total_publishes = excluded.total_publishes,
        posts_created = excluded.posts_created,
        posts_scheduled = excluded.posts_scheduled,
        posts_published = excluded.posts_published,
        emails_sent = excluded.emails_sent,
        active_flag = excluded.active_flag,
        last_active_at = excluded.last_active_at
    `,
    [businessId, date],
  );
}

export async function syncRecentWorkspaceMetrics(
  businessId: string,
  days = 14,
): Promise<void> {
  const safeDays = Math.max(1, Math.min(days, 60));
  const today = new Date();

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(today);
    cursor.setUTCDate(today.getUTCDate() - offset);
    await updateWorkspaceMetrics(businessId, cursor.toISOString().slice(0, 10));
  }
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
