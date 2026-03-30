create table if not exists post_assets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references content_assets(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  type text not null check (type in ('image')),
  source text not null default 'upload' check (source in ('upload', 'generated')),
  storage_key text not null,
  storage_url text not null,
  mime_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  order_index integer not null default 0,
  status text not null default 'ready' check (status in ('uploaded', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, storage_key)
);

create index if not exists post_assets_post_id_idx
  on post_assets (post_id, order_index asc, created_at asc);

create index if not exists post_assets_business_id_idx
  on post_assets (business_id, created_at desc);

create index if not exists post_assets_status_idx
  on post_assets (status, created_at desc);
