alter table if exists post_assets
  add column if not exists metadata_json jsonb not null default '{}'::jsonb;

alter table if exists post_assets
  drop constraint if exists post_assets_type_check;

alter table if exists post_assets
  add constraint post_assets_type_check
  check (type in ('image', 'video'));

alter table if exists workspace_assets
  drop constraint if exists workspace_assets_asset_type_check;

alter table if exists workspace_assets
  add constraint workspace_assets_asset_type_check
  check (asset_type in ('image', 'video', 'logo', 'document', 'screenshot'));
