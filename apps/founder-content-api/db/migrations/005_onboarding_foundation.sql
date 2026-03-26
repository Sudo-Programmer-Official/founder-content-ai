create extension if not exists pgcrypto;

create table if not exists onboarding_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  business_id uuid references businesses(id) on delete set null,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed')),
  current_step text not null default 'intent' check (current_step in ('intent', 'workspace', 'generate', 'activate', 'completed')),
  use_case text check (use_case in ('personal_brand', 'business_marketing', 'agency_clients')),
  target_channels jsonb not null default '[]'::jsonb,
  goals jsonb not null default '[]'::jsonb,
  preferred_tone text check (preferred_tone in ('professional', 'friendly', 'bold')),
  first_content_generated_at timestamptz,
  first_content_copied_at timestamptz,
  first_channel_connected_at timestamptz,
  first_content_scheduled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists onboarding_profiles_business_id_idx on onboarding_profiles (business_id);
create index if not exists onboarding_profiles_status_idx on onboarding_profiles (status);

create table if not exists brand_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  industry text,
  preferred_tone text check (preferred_tone in ('professional', 'friendly', 'bold')),
  target_channels jsonb not null default '[]'::jsonb,
  goals jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_profiles_preferred_tone_idx on brand_profiles (preferred_tone);
