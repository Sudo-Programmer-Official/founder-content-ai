create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  type text not null check (
    type in (
      'email_contact_import',
      'email_campaign_send',
      'post_publish',
      'growth_automation',
      'deliverability_rollup'
    )
  ),
  status text not null default 'queued' check (
    status in ('queued', 'processing', 'completed', 'failed', 'paused')
  ),
  priority integer not null default 100,
  payload_json jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists jobs_status_priority_idx
  on jobs (status, priority asc, run_after asc, created_at asc);

create index if not exists jobs_business_id_idx
  on jobs (business_id, status, created_at desc);

create table if not exists email_contact_import_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  job_id uuid unique references jobs(id) on delete set null,
  list_name text not null,
  file_name text,
  status text not null default 'queued' check (
    status in ('queued', 'processing', 'completed', 'failed')
  ),
  total_rows integer not null default 0,
  processed_rows integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  mapping_json jsonb not null default '{}'::jsonb,
  error_summary_json jsonb not null default '[]'::jsonb,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists email_contact_import_jobs_business_id_idx
  on email_contact_import_jobs (business_id, created_at desc);

create index if not exists email_contact_import_jobs_status_idx
  on email_contact_import_jobs (status, created_at desc);
