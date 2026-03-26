alter table businesses
  add column if not exists plan_code text not null default 'free';

alter table businesses
  add column if not exists trial_ends_at timestamptz;

alter table businesses
  add column if not exists grace_until timestamptz;

alter table businesses
  add column if not exists is_active boolean not null default true;

alter table businesses
  add column if not exists admin_override_note text;

alter table businesses
  drop constraint if exists businesses_plan_code_check;

alter table businesses
  add constraint businesses_plan_code_check
  check (plan_code in ('free', 'pro', 'growth', 'custom'));

create table if not exists feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text,
  enabled_globally boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists feature_flag_targets (
  id uuid primary key default gen_random_uuid(),
  feature_flag_id uuid not null references feature_flags(id) on delete cascade,
  target_type text not null check (target_type in ('business', 'user')),
  target_id uuid not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (feature_flag_id, target_type, target_id)
);

create index if not exists feature_flag_targets_target_lookup_idx
  on feature_flag_targets (target_type, target_id);

create table if not exists usage_limits_daily (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  date date not null,
  posts_limit integer not null default 10,
  posts_used integer not null default 0,
  emails_limit integer not null default 20,
  emails_used integer not null default 0,
  outreach_limit integer not null default 20,
  outreach_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, date)
);

create index if not exists usage_limits_daily_business_id_idx
  on usage_limits_daily (business_id);

create table if not exists admin_actions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  action text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_actions_target_lookup_idx
  on admin_actions (target_type, target_id, created_at desc);

create index if not exists admin_actions_actor_user_id_idx
  on admin_actions (actor_user_id, created_at desc);
