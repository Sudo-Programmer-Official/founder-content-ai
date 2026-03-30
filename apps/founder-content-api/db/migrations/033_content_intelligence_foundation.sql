alter table content_assets
  add column if not exists content_metadata jsonb not null default '{}'::jsonb;

create index if not exists content_assets_metadata_gin_idx
  on content_assets
  using gin (content_metadata);
