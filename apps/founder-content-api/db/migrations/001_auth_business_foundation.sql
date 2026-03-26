create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  cognito_sub text not null unique,
  email text not null,
  full_name text not null,
  avatar_url text,
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_email_lower_unique_idx on users (lower(email));

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id),
  name text not null,
  slug text not null unique,
  brand_name text not null,
  website_url text,
  niche text,
  timezone text not null default 'UTC',
  status text not null default 'active' check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'editor', 'viewer')),
  invited_by uuid references users(id),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index if not exists business_members_user_id_idx on business_members (user_id);
create index if not exists business_members_business_id_idx on business_members (business_id);

create table if not exists auth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('cognito_password', 'google', 'otp_email')),
  provider_user_id text not null,
  email text,
  created_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);

create index if not exists auth_identities_user_id_idx on auth_identities (user_id);

create table if not exists business_channels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  channel_type text not null,
  account_name text,
  external_account_id text,
  auth_metadata_json jsonb not null default '{}'::jsonb,
  status text not null default 'disconnected',
  connected_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists business_channels_business_id_idx on business_channels (business_id);

create table if not exists business_email_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  from_name text,
  from_email text,
  reply_to_email text,
  provider text not null default 'ses',
  ses_identity text,
  domain_status text not null default 'unverified',
  dkim_status text not null default 'pending',
  spf_status text not null default 'pending',
  configuration_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  max_businesses integer not null,
  max_members integer not null,
  max_generations integer not null,
  features_json jsonb not null default '{}'::jsonb,
  price_monthly integer not null default 0,
  price_yearly integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  plan_id uuid not null references plans(id),
  provider text not null,
  provider_subscription_id text not null unique,
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists subscriptions_business_id_idx on subscriptions (business_id);

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  feature text not null,
  quantity integer not null default 1,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_business_id_idx on usage_events (business_id);
create index if not exists usage_events_user_id_idx on usage_events (user_id);
create index if not exists usage_events_feature_idx on usage_events (feature);

create table if not exists admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id) on delete set null,
  business_id uuid references businesses(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_business_id_idx on admin_audit_logs (business_id);
create index if not exists admin_audit_logs_actor_user_id_idx on admin_audit_logs (actor_user_id);
