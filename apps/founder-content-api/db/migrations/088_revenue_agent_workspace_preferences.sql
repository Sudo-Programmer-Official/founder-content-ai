create table if not exists revenue_agent_workspace_preferences (
  business_id uuid primary key references businesses(id) on delete cascade,
  feed_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
