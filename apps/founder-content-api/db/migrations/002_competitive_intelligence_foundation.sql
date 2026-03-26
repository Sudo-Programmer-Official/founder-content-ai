create table if not exists competitor_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  source_type text not null check (source_type in ('rss', 'public_url', 'website_page', 'manual_import')),
  label text not null,
  url text,
  status text not null default 'active' check (status in ('active', 'paused', 'error')),
  fetch_frequency_minutes integer,
  next_fetch_at timestamptz,
  last_fetched_at timestamptz,
  last_fetch_status text not null default 'idle' check (
    last_fetch_status in ('idle', 'scheduled', 'processing', 'succeeded', 'failed')
  ),
  last_fetch_error text,
  fetch_lock_id text,
  fetch_locked_at timestamptz,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists competitor_sources_business_id_idx on competitor_sources (business_id);
create index if not exists competitor_sources_next_fetch_at_idx on competitor_sources (next_fetch_at);

create table if not exists source_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  source_id uuid not null references competitor_sources(id) on delete cascade,
  external_id text not null,
  canonical_url text,
  title text not null,
  excerpt text,
  content_text text not null,
  author_name text,
  published_at timestamptz not null,
  engagement_score numeric(12, 4) not null default 1,
  raw_payload_json jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create index if not exists source_items_business_id_idx on source_items (business_id);
create index if not exists source_items_source_id_idx on source_items (source_id);
create index if not exists source_items_published_at_idx on source_items (published_at desc);

create table if not exists source_item_analysis (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  source_item_id uuid not null unique references source_items(id) on delete cascade,
  topic text not null,
  hook_type text not null,
  tone text not null,
  format text not null,
  why_it_might_work text not null,
  confidence numeric(6, 4) not null default 0.5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists source_item_analysis_business_id_idx on source_item_analysis (business_id);
create index if not exists source_item_analysis_topic_idx on source_item_analysis (topic);

create table if not exists trend_signals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  topic text not null,
  window_days integer not null check (window_days in (7, 30)),
  source_item_count integer not null,
  momentum numeric(12, 4) not null default 0,
  engagement_weighted_trend_score numeric(12, 4) not null default 0,
  sample_hook_types jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now()
);

create index if not exists trend_signals_business_id_idx on trend_signals (business_id);
create index if not exists trend_signals_topic_idx on trend_signals (topic);
create index if not exists trend_signals_generated_at_idx on trend_signals (generated_at desc);

create table if not exists competitor_watchlists (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  description text,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create index if not exists competitor_watchlists_business_id_idx on competitor_watchlists (business_id);

create table if not exists watchlist_sources (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references competitor_watchlists(id) on delete cascade,
  source_id uuid not null references competitor_sources(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (watchlist_id, source_id)
);

create index if not exists watchlist_sources_watchlist_id_idx on watchlist_sources (watchlist_id);
create index if not exists watchlist_sources_source_id_idx on watchlist_sources (source_id);
