create table if not exists content_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  lane text not null check (lane in ('social', 'email')),
  primary_channel text not null check (primary_channel in ('linkedin', 'instagram', 'facebook', 'email')),
  days integer not null default 1 check (days > 0 and days <= 365),
  title text,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'scheduled', 'archived')),
  default_audience_timezone text,
  default_scheduled_time text,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_batches_business_id_status_idx
  on content_batches (business_id, status, updated_at desc);

create index if not exists content_batches_lane_idx
  on content_batches (lane, primary_channel, created_at desc);

create table if not exists content_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  batch_id uuid references content_batches(id) on delete set null,
  source_asset_id uuid references content_assets(id) on delete set null,
  idea_text text,
  base_text text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_items_business_id_updated_at_idx
  on content_items (business_id, updated_at desc);

create index if not exists content_items_batch_id_idx
  on content_items (batch_id, created_at asc);

create index if not exists content_items_source_asset_id_idx
  on content_items (source_asset_id);

create table if not exists content_variants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  content_item_id uuid not null references content_items(id) on delete cascade,
  source_asset_id uuid references content_assets(id) on delete set null,
  channel text not null check (channel in ('linkedin', 'instagram', 'facebook', 'email')),
  lane text not null check (lane in ('social', 'email')),
  title text,
  text_content text not null default '',
  html_content text,
  media_json jsonb not null default '{"images":[],"videos":[]}'::jsonb,
  source text not null default 'generated' check (source in ('generated', 'manual', 'remix')),
  status text not null default 'draft' check (status in ('draft', 'ready', 'scheduled', 'processing', 'published', 'failed', 'paused', 'canceled')),
  is_customized boolean not null default false,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, channel)
);

create index if not exists content_variants_business_id_status_idx
  on content_variants (business_id, status, updated_at desc);

create index if not exists content_variants_lane_channel_idx
  on content_variants (lane, channel, updated_at desc);

create index if not exists content_variants_source_asset_id_idx
  on content_variants (source_asset_id);

create table if not exists schedule_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  content_item_id uuid not null references content_items(id) on delete cascade,
  variant_id uuid not null references content_variants(id) on delete cascade,
  legacy_scheduled_post_id uuid references scheduled_posts(id) on delete set null,
  channel text not null check (channel in ('linkedin', 'instagram', 'facebook', 'email')),
  lane text not null check (lane in ('social', 'email')),
  scheduled_date date not null,
  scheduled_time time not null,
  audience_timezone text,
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'processing', 'published', 'failed', 'paused', 'canceled')),
  external_reference_id text,
  external_reference_url text,
  metadata_json jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, content_item_id, channel, scheduled_at)
);

create index if not exists schedule_items_business_id_scheduled_at_idx
  on schedule_items (business_id, scheduled_at asc nulls last, scheduled_date asc, scheduled_time asc);

create index if not exists schedule_items_variant_id_idx
  on schedule_items (variant_id, scheduled_at asc nulls last);

create index if not exists schedule_items_status_idx
  on schedule_items (status, scheduled_at asc nulls last, updated_at desc);

create index if not exists schedule_items_legacy_scheduled_post_id_idx
  on schedule_items (legacy_scheduled_post_id);
