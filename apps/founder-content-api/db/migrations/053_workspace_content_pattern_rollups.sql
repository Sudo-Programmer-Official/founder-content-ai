create table if not exists workspace_content_pattern_rollups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  pattern_type text not null check (pattern_type in ('angle', 'format', 'send_window')),
  pattern_key text not null,
  label text not null,
  support_count int not null default 0,
  published_count int not null default 0,
  high_signal_count int not null default 0,
  low_signal_count int not null default 0,
  avg_engagement_score numeric(10, 4) not null default 0,
  performance_score numeric(10, 4) not null default 0,
  metadata_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (business_id, pattern_type, pattern_key)
);

create index if not exists workspace_content_pattern_rollups_business_updated_idx
  on workspace_content_pattern_rollups (business_id, updated_at desc);

create index if not exists workspace_content_pattern_rollups_business_performance_idx
  on workspace_content_pattern_rollups (business_id, pattern_type, performance_score desc, updated_at desc);
