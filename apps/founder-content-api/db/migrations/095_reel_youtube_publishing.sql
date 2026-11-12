create table if not exists reel_youtube_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  channel_id text not null,
  channel_title text,
  account_email text,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  scope text[] not null default array[]::text[],
  status text not null default 'connected' check (status in ('connected', 'error')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reel_youtube_publications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references reel_projects(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  video_id text not null,
  visibility text not null check (visibility in ('private', 'unlisted', 'public')),
  title text not null,
  description text not null default '',
  video_url text not null,
  published_at timestamptz not null default now(),
  unique (project_id)
);

create index if not exists reel_youtube_publications_business_created_idx
  on reel_youtube_publications (business_id, published_at desc);
