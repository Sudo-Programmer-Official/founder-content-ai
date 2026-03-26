create table if not exists brand_source_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  source_type text not null check (source_type in ('text', 'url', 'linkedin', 'instagram', 'facebook', 'blog')),
  source_url text not null,
  label text not null,
  title text,
  extracted_text text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  last_fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists brand_source_items_business_url_unique_idx
  on brand_source_items (business_id, source_url);

create index if not exists brand_source_items_business_id_idx
  on brand_source_items (business_id, updated_at desc);
