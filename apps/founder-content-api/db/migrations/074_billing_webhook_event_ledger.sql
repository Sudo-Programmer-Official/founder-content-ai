create table if not exists billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe')),
  provider_event_id text not null,
  event_type text not null,
  processing_state text not null default 'processing' check (
    processing_state in ('processing', 'processed', 'failed')
  ),
  payload_json jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists billing_webhook_events_state_idx
  on billing_webhook_events (provider, processing_state, created_at desc);

create index if not exists billing_webhook_events_created_idx
  on billing_webhook_events (created_at desc);
