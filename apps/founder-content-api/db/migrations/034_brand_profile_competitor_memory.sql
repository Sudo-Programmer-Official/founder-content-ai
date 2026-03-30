alter table brand_profiles
  add column if not exists selected_competitors jsonb not null default '[]'::jsonb;

create index if not exists brand_profiles_selected_competitors_gin_idx
  on brand_profiles using gin (selected_competitors);
