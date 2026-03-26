create table if not exists user_style_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  selected_tones jsonb not null default '[]'::jsonb,
  content_types jsonb not null default '[]'::jsonb,
  edit_count integer not null default 0,
  accepted_output_count integer not null default 0,
  last_event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, business_id)
);

create index if not exists user_style_profiles_user_id_idx
  on user_style_profiles (user_id);

create index if not exists user_style_profiles_business_id_idx
  on user_style_profiles (business_id);
