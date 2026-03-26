create extension if not exists pgcrypto;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'usage_events'
      and column_name = 'feature'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_name = 'usage_events'
      and column_name = 'event_type'
  ) then
    alter table usage_events rename column feature to event_type;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'usage_events'
      and column_name = 'metadata_json'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_name = 'usage_events'
      and column_name = 'metadata'
  ) then
    alter table usage_events rename column metadata_json to metadata;
  end if;
end $$;

alter table usage_events
  add column if not exists event_type text;

alter table usage_events
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update usage_events
set event_type = coalesce(event_type, 'legacy_event')
where event_type is null;

alter table usage_events
  alter column event_type set not null;

create index if not exists usage_events_event_type_idx on usage_events (event_type);
create index if not exists usage_events_created_at_idx on usage_events (created_at desc);

create table if not exists content_generation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  business_id uuid references businesses(id) on delete set null,
  input_type text not null check (input_type in ('idea', 'link', 'upload')),
  tokens_used integer not null default 0,
  model text not null,
  latency_ms integer not null default 0,
  success boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists content_generation_logs_user_id_idx on content_generation_logs (user_id);
create index if not exists content_generation_logs_business_id_idx on content_generation_logs (business_id);
create index if not exists content_generation_logs_created_at_idx on content_generation_logs (created_at desc);
create index if not exists content_generation_logs_success_idx on content_generation_logs (success);

create table if not exists content_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete set null,
  user_id uuid references users(id) on delete set null,
  content_type text not null check (content_type in ('post', 'hook', 'email')),
  content_body jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now()
);

create index if not exists content_assets_business_id_idx on content_assets (business_id);
create index if not exists content_assets_user_id_idx on content_assets (user_id);
create index if not exists content_assets_type_idx on content_assets (content_type);

create table if not exists workspace_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  date date not null,
  total_generations integer not null default 0,
  total_copies integer not null default 0,
  total_remixes integer not null default 0,
  total_publishes integer not null default 0,
  created_at timestamptz not null default now(),
  unique (business_id, date)
);

create index if not exists workspace_metrics_daily_date_idx on workspace_metrics_daily (date desc);

create table if not exists platform_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  total_users integer not null default 0,
  total_workspaces integer not null default 0,
  total_generations integer not null default 0,
  total_api_failures integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists platform_metrics_daily_date_idx on platform_metrics_daily (date desc);

create table if not exists admin_alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('api_failure', 'abuse', 'anomaly')),
  severity text not null check (severity in ('low', 'medium', 'high')),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists admin_alerts_resolved_idx on admin_alerts (resolved);
create index if not exists admin_alerts_created_at_idx on admin_alerts (created_at desc);
