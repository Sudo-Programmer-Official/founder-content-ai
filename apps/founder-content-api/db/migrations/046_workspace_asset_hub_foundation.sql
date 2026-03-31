create table if not exists workspace_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  created_by_user_id uuid references users(id) on delete set null,
  asset_type text not null
    check (asset_type in ('image', 'logo', 'document', 'screenshot')),
  source_type text not null
    check (source_type in ('upload', 'post_asset', 'brand_kit', 'generated')),
  source_reference_id text,
  title text,
  storage_key text,
  storage_url text not null,
  mime_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  tags jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  usage_count int not null default 0 check (usage_count >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_assets_business_storage_key_unique_idx
  on workspace_assets (business_id, storage_key)
  where storage_key is not null;

create index if not exists workspace_assets_business_created_idx
  on workspace_assets (business_id, created_at desc);

create index if not exists workspace_assets_business_type_active_idx
  on workspace_assets (business_id, asset_type, is_active, created_at desc);

create index if not exists workspace_assets_source_reference_idx
  on workspace_assets (business_id, source_type, source_reference_id);

create table if not exists workspace_asset_usages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  asset_id uuid not null references workspace_assets(id) on delete cascade,
  usage_surface text not null
    check (usage_surface in ('post', 'email', 'brand_kit', 'visual_generation', 'asset_hub')),
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists workspace_asset_usages_asset_surface_reference_unique_idx
  on workspace_asset_usages (asset_id, usage_surface, reference_id);

create index if not exists workspace_asset_usages_business_created_idx
  on workspace_asset_usages (business_id, created_at desc);

create index if not exists workspace_asset_usages_asset_created_idx
  on workspace_asset_usages (asset_id, created_at desc);
