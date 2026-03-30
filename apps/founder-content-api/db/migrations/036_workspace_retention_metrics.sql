alter table workspace_metrics_daily
  add column if not exists posts_created integer not null default 0;

alter table workspace_metrics_daily
  add column if not exists posts_scheduled integer not null default 0;

alter table workspace_metrics_daily
  add column if not exists posts_published integer not null default 0;

alter table workspace_metrics_daily
  add column if not exists emails_sent integer not null default 0;

alter table workspace_metrics_daily
  add column if not exists active_flag boolean not null default false;

alter table workspace_metrics_daily
  add column if not exists last_active_at timestamptz;

create index if not exists workspace_metrics_daily_business_date_idx
  on workspace_metrics_daily (business_id, date desc);

create index if not exists workspace_metrics_daily_active_idx
  on workspace_metrics_daily (business_id, active_flag, date desc);
