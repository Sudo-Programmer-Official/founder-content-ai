alter table brand_profiles
  add column if not exists tone text;

alter table brand_profiles
  add column if not exists writing_style text;

alter table brand_profiles
  add column if not exists visual_style text;

alter table brand_profiles
  add column if not exists topics jsonb not null default '[]'::jsonb;

alter table brand_profiles
  add column if not exists patterns jsonb not null default '[]'::jsonb;

update brand_profiles
set tone = coalesce(tone, preferred_tone)
where tone is null
  and preferred_tone is not null;

create index if not exists brand_profiles_tone_idx on brand_profiles (tone);
create index if not exists brand_profiles_visual_style_idx on brand_profiles (visual_style);
create index if not exists brand_profiles_topics_gin_idx on brand_profiles using gin (topics);
create index if not exists brand_profiles_patterns_gin_idx on brand_profiles using gin (patterns);
