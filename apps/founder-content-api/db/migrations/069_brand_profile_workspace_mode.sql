alter table brand_profiles
  add column if not exists workspace_mode text
  not null
  default 'founder'
  check (workspace_mode in ('founder', 'business'));
