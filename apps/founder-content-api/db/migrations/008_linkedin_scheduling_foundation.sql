create extension if not exists pgcrypto;

create table if not exists social_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  platform text not null check (platform in ('linkedin')),
  platform_user_id text not null,
  platform_user_urn text not null,
  account_email text,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text[] not null default array[]::text[],
  status text not null default 'connected' check (status in ('connected', 'expired', 'revoked', 'error')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, platform)
);

create index if not exists social_accounts_user_id_idx on social_accounts (user_id);
create index if not exists social_accounts_business_id_idx on social_accounts (business_id);
create unique index if not exists social_accounts_platform_user_idx on social_accounts (platform, platform_user_id);

create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  social_account_id uuid references social_accounts(id) on delete set null,
  platform text not null check (platform in ('linkedin')),
  content_text text not null,
  asset_group_id text,
  asset_payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'processing', 'published', 'failed')),
  external_post_id text,
  external_post_url text,
  error_message text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_posts_business_id_idx on scheduled_posts (business_id);
create index if not exists scheduled_posts_status_scheduled_at_idx on scheduled_posts (status, scheduled_at);
create index if not exists scheduled_posts_social_account_id_idx on scheduled_posts (social_account_id);

create table if not exists publication_events (
  id uuid primary key default gen_random_uuid(),
  scheduled_post_id uuid not null references scheduled_posts(id) on delete cascade,
  status text not null check (status in ('scheduled', 'processing', 'published', 'failed')),
  response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists publication_events_scheduled_post_id_idx on publication_events (scheduled_post_id);
