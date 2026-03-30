alter table growth_leads
  add column if not exists source_platform text,
  add column if not exists source_asset_id uuid references content_assets(id) on delete set null,
  add column if not exists source_asset_title text,
  add column if not exists source_external_url text;

create index if not exists growth_leads_business_source_platform_idx
  on growth_leads (business_id, source_platform, created_at desc);

create index if not exists growth_leads_source_asset_id_idx
  on growth_leads (source_asset_id);
