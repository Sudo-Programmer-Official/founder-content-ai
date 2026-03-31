create table if not exists workspace_brand_kits (
  business_id uuid primary key references businesses(id) on delete cascade,
  source_brand_kit_id uuid references brand_kits(id) on delete set null,
  primary_color text not null default '#111827',
  secondary_color text not null default '#F8FAFC',
  logo_asset_id uuid references workspace_assets(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into workspace_brand_kits (
  business_id,
  source_brand_kit_id,
  primary_color,
  secondary_color
)
select
  brand_kits.business_id,
  brand_kits.id,
  brand_kits.primary_color,
  brand_kits.secondary_color
from brand_kits
on conflict (business_id) do update
set
  source_brand_kit_id = excluded.source_brand_kit_id,
  primary_color = excluded.primary_color,
  secondary_color = excluded.secondary_color,
  updated_at = now();
