create table if not exists workspace_topic_insights (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  topic_key text not null,
  topic_label text not null,
  idea_count int not null default 0,
  post_count int not null default 0,
  published_count int not null default 0,
  high_signal_count int not null default 0,
  medium_signal_count int not null default 0,
  low_signal_count int not null default 0,
  avg_engagement_score numeric(10, 4) not null default 0,
  email_support_score numeric(10, 4) not null default 0,
  reuse_score numeric(10, 4) not null default 0,
  last_used_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (business_id, topic_key)
);

create index if not exists workspace_topic_insights_business_updated_idx
  on workspace_topic_insights (business_id, updated_at desc);

create index if not exists workspace_topic_insights_business_reuse_idx
  on workspace_topic_insights (business_id, reuse_score desc, updated_at desc);
