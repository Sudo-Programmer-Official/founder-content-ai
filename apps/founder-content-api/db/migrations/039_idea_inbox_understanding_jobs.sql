alter table jobs
  drop constraint if exists jobs_type_check;

alter table jobs
  add constraint jobs_type_check
  check (
    type in (
      'email_contact_import',
      'email_campaign_send',
      'post_publish',
      'growth_automation',
      'deliverability_rollup',
      'idea_process',
      'post_metrics_collect',
      'analytics_rollup',
      'report_digest',
      'competitor_pattern_extract'
    )
  );

alter table idea_inbox_items
  add column if not exists understanding_json jsonb,
  add column if not exists understanding_status text not null default 'queued',
  add column if not exists understanding_confidence_score numeric(4,3),
  add column if not exists understanding_error text,
  add column if not exists understanding_job_id uuid;

update idea_inbox_items
set
  understanding_json = coalesce(
    understanding_json,
    case
      when jsonb_typeof(source_metadata) = 'object'
        and source_metadata ? 'understanding'
        then source_metadata -> 'understanding'
      else null
    end
  ),
  understanding_status = case
    when understanding_json is not null then 'completed'
    when jsonb_typeof(source_metadata) = 'object'
      and source_metadata ? 'understanding'
      then 'completed'
    else coalesce(nullif(understanding_status, ''), 'queued')
  end,
  understanding_confidence_score = coalesce(understanding_confidence_score, 0.7)
where true;

alter table idea_inbox_items
  drop constraint if exists idea_inbox_items_understanding_status_check;

alter table idea_inbox_items
  add constraint idea_inbox_items_understanding_status_check
  check (understanding_status in ('queued', 'processing', 'completed', 'failed'));

alter table idea_inbox_items
  drop constraint if exists idea_inbox_items_understanding_job_id_fkey;

alter table idea_inbox_items
  add constraint idea_inbox_items_understanding_job_id_fkey
  foreign key (understanding_job_id) references jobs(id) on delete set null;

create index if not exists idea_inbox_items_understanding_status_idx
  on idea_inbox_items (business_id, understanding_status, created_at desc);

create index if not exists idea_inbox_items_understanding_job_idx
  on idea_inbox_items (understanding_job_id);
