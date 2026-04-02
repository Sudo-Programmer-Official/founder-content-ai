create table if not exists publish_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  source_kind text not null check (source_kind in ('manual', 'scheduled', 'retry')),
  status text not null default 'processing' check (status in ('processing', 'success', 'partial', 'failed')),
  title text,
  content_text text,
  asset_group_id uuid references content_assets(id) on delete set null,
  asset_payload jsonb not null default '{}'::jsonb,
  distribution_group_id uuid references content_distribution_groups(id) on delete set null,
  retry_of_attempt_id uuid references publish_attempts(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists publish_attempts_business_created_idx
  on publish_attempts (business_id, created_at desc);

create index if not exists publish_attempts_business_status_idx
  on publish_attempts (business_id, status, created_at desc);

create index if not exists publish_attempts_distribution_group_idx
  on publish_attempts (distribution_group_id, created_at desc)
  where distribution_group_id is not null;

create index if not exists publish_attempts_retry_of_attempt_idx
  on publish_attempts (retry_of_attempt_id, created_at desc)
  where retry_of_attempt_id is not null;

create table if not exists publish_attempt_platforms (
  id uuid primary key default gen_random_uuid(),
  publish_attempt_id uuid not null references publish_attempts(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  platform text not null check (platform in ('linkedin', 'facebook', 'instagram')),
  status text not null default 'processing' check (status in ('processing', 'success', 'failed')),
  content_text text not null,
  asset_group_id uuid references content_assets(id) on delete set null,
  asset_payload jsonb not null default '{}'::jsonb,
  media_summary jsonb not null default '{}'::jsonb,
  scheduled_post_id uuid references scheduled_posts(id) on delete set null,
  schedule_item_id uuid references schedule_items(id) on delete set null,
  distribution_group_id uuid references content_distribution_groups(id) on delete set null,
  social_account_id uuid references social_accounts(id) on delete set null,
  social_account_identity_id uuid references social_account_identities(id) on delete set null,
  external_post_id text,
  external_post_url text,
  error_code text,
  error_message text,
  response_json jsonb not null default '{}'::jsonb,
  retry_of_publish_attempt_platform_id uuid references publish_attempt_platforms(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publish_attempt_id, platform)
);

create index if not exists publish_attempt_platforms_attempt_idx
  on publish_attempt_platforms (publish_attempt_id, created_at asc);

create index if not exists publish_attempt_platforms_business_platform_idx
  on publish_attempt_platforms (business_id, platform, created_at desc);

create index if not exists publish_attempt_platforms_status_idx
  on publish_attempt_platforms (publish_attempt_id, status, created_at asc);

create index if not exists publish_attempt_platforms_scheduled_post_idx
  on publish_attempt_platforms (scheduled_post_id, created_at desc)
  where scheduled_post_id is not null;

create index if not exists publish_attempt_platforms_retry_of_idx
  on publish_attempt_platforms (retry_of_publish_attempt_platform_id, created_at desc)
  where retry_of_publish_attempt_platform_id is not null;
