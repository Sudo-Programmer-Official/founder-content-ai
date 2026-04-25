alter table brand_kits
  add column if not exists brand_name text;

alter table brand_kits
  add column if not exists industry text;

alter table brand_kits
  add column if not exists style text;

alter table brand_kits
  add column if not exists font_family text;

alter table brand_kits
  add column if not exists icon_style text;

alter table brand_kits
  add column if not exists tone_keywords jsonb not null default '[]'::jsonb;

alter table brand_kits
  add column if not exists image_guidelines text;

alter table brand_kits
  add column if not exists business_description text;

alter table brand_kits
  add column if not exists website_url text;

update brand_kits
set
  brand_name = coalesce(nullif(brand_kits.brand_name, ''), businesses.brand_name, businesses.name),
  industry = coalesce(nullif(brand_kits.industry, ''), brand_profiles.industry, businesses.niche),
  style = coalesce(nullif(brand_kits.style, ''), brand_profiles.visual_style),
  website_url = coalesce(nullif(brand_kits.website_url, ''), brand_profiles.website_url, businesses.website_url)
from businesses
left join brand_profiles
  on brand_profiles.business_id = businesses.id
where brand_kits.business_id = businesses.id;

create index if not exists brand_kits_industry_idx
  on brand_kits (industry);

create table if not exists brand_studio_generations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  created_by_user_id uuid references users(id) on delete set null,
  workspace_asset_id uuid references workspace_assets(id) on delete set null,
  reference_generation_id uuid references brand_studio_generations(id) on delete set null,
  asset_kind text not null
    check (asset_kind in ('homepage_hero', 'feature_section', 'cta_banner', 'icon_set', 'social_media', 'email_header')),
  template_key text not null
    check (template_key in ('daycare', 'salon', 'fitness', 'restaurant', 'custom')),
  consistency_mode text not null default 'standard'
    check (consistency_mode in ('standard', 'match_previous_style')),
  title text not null,
  prompt text not null,
  goal text,
  context text,
  layout text,
  extra_instructions text,
  icon_labels jsonb not null default '[]'::jsonb,
  brand_snapshot jsonb not null default '{}'::jsonb,
  request_payload jsonb not null default '{}'::jsonb,
  asset_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists brand_studio_generations_business_created_idx
  on brand_studio_generations (business_id, created_at desc);

create index if not exists brand_studio_generations_asset_kind_idx
  on brand_studio_generations (business_id, asset_kind, created_at desc);
