create table if not exists reel_projects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  created_by_user_id uuid references users(id) on delete set null,
  prompt text not null default '',
  settings_json jsonb not null default '{}'::jsonb,
  status text not null default 'storyboard_ready'
    check (status in ('storyboard_ready', 'queued', 'rendering', 'ready', 'failed')),
  storyboard_json jsonb not null default '{}'::jsonb,
  progress_json jsonb,
  render_meta_json jsonb not null default '{}'::jsonb,
  video_storage_key text,
  poster_storage_key text,
  duration_ms integer,
  error_message text,
  rendered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reel_projects_business_created_idx
  on reel_projects (business_id, created_at desc);
