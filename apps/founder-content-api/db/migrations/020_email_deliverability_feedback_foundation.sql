create table if not exists email_provider_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  domain_name text not null,
  campaign_recipient_id uuid references email_campaign_recipients(id) on delete set null,
  provider_message_id text not null,
  event_type text not null check (
    event_type in ('delivered', 'bounce_soft', 'bounce_hard', 'complaint', 'reject')
  ),
  subtype text,
  recipient_email text not null,
  raw_payload_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists email_provider_events_business_domain_idx
  on email_provider_events (business_id, domain_name, occurred_at desc);

create index if not exists email_provider_events_message_id_idx
  on email_provider_events (provider_message_id, occurred_at desc);

create unique index if not exists email_provider_events_unique_event_idx
  on email_provider_events (
    business_id,
    provider_message_id,
    event_type,
    recipient_email,
    occurred_at
  );

create table if not exists email_domain_reputation (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  domain_name text not null,
  deliverability_score integer not null default 0,
  score_band text not null default 'needs_attention' check (
    score_band in ('excellent', 'needs_attention', 'at_risk')
  ),
  blockers_json jsonb not null default '[]'::jsonb,
  ses_verified boolean not null default false,
  dkim_verified boolean not null default false,
  spf_status text not null default 'missing',
  dmarc_status text not null default 'missing',
  bounce_rate_7d numeric(8,6) not null default 0,
  complaint_rate_7d numeric(8,6) not null default 0,
  delivery_rate_7d numeric(8,6) not null default 0,
  recent_deliveries_7d integer not null default 0,
  recent_hard_bounces_7d integer not null default 0,
  recent_soft_bounces_7d integer not null default 0,
  recent_complaints_7d integer not null default 0,
  last_evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_domain_reputation_business_domain_idx
  on email_domain_reputation (business_id, lower(domain_name));

create index if not exists email_domain_reputation_score_band_idx
  on email_domain_reputation (score_band, deliverability_score asc, updated_at desc);

alter table email_contacts
  add column if not exists last_bounce_at timestamptz;

alter table email_contacts
  add column if not exists last_complaint_at timestamptz;

alter table email_contacts
  add column if not exists last_provider_event_at timestamptz;

alter table email_contacts
  drop constraint if exists email_contacts_status_check;

alter table email_contacts
  add constraint email_contacts_status_check
  check (status in ('active', 'unsubscribed', 'bounced', 'complained', 'suppressed'));
