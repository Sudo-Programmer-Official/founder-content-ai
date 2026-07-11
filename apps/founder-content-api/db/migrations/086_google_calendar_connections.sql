create table if not exists google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id text not null,
  google_account_id text not null,
  account_email text,
  calendar_id text not null default 'primary',
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text[] not null default '{}'::text[],
  status text not null default 'connected' check (status in ('connected', 'expired', 'revoked', 'error')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id)
);

create index if not exists google_calendar_connections_business_id_idx
  on google_calendar_connections (business_id, created_at desc);
