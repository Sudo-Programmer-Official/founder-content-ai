alter table growth_automation_step_runs
  add column if not exists retry_count integer not null default 0;

alter table growth_automation_step_runs
  add column if not exists last_attempted_at timestamptz;

create table if not exists growth_lead_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  lead_id uuid not null references growth_leads(id) on delete cascade,
  step_run_id uuid references growth_automation_step_runs(id) on delete set null,
  provider_message_id text,
  event_type text not null check (
    event_type in (
      'captured',
      'enrolled',
      'email_sent',
      'email_delivered',
      'email_bounced',
      'email_complained',
      'email_opened',
      'email_clicked',
      'email_failed',
      'step_skipped',
      'status_changed'
    )
  ),
  metadata_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists growth_lead_events_business_idx
  on growth_lead_events (business_id, occurred_at desc);

create index if not exists growth_lead_events_lead_idx
  on growth_lead_events (lead_id, occurred_at desc);

create unique index if not exists growth_lead_events_provider_dedupe_idx
  on growth_lead_events (lead_id, provider_message_id, event_type)
  where provider_message_id is not null;
