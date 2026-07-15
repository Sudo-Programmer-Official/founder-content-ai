create table if not exists prospect_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  source text not null default '',
  source_id text not null default '',
  organization_source_id text,
  person_source_id text,
  dedupe_key text not null default '',
  full_name text not null default '',
  first_name text,
  last_name text,
  title text not null default '',
  department text,
  email text,
  email_normalized text,
  email_verification_status text not null default 'not_started' check (
    email_verification_status in ('not_started', 'searching', 'verified', 'invalid', 'risky', 'unknown')
  ),
  email_verified_at timestamptz,
  verification_source text,
  verified_email text,
  verified_domain text,
  verified_reason text,
  direct_phone text,
  direct_phone_normalized text,
  linkedin_url text,
  organization_name text not null default '',
  organization_domain text,
  organization_website text,
  city text,
  state text,
  status text not null default 'not_started' check (
    status in ('not_started', 'searching', 'found', 'verified', 'no_match', 'needs_review')
  ),
  match_confidence integer not null default 0 check (match_confidence >= 0 and match_confidence <= 100),
  source_ids_json jsonb not null default '[]'::jsonb,
  source_names_json jsonb not null default '[]'::jsonb,
  enrichment_events_json jsonb not null default '[]'::jsonb,
  is_primary boolean not null default false,
  manual_override boolean not null default false,
  manually_corrected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prospect_contacts_business_id_idx
  on prospect_contacts (business_id, prospect_id, created_at desc);

create index if not exists prospect_contacts_status_idx
  on prospect_contacts (business_id, status, match_confidence desc, updated_at desc);

create unique index if not exists prospect_contacts_business_dedupe_idx
  on prospect_contacts (business_id, prospect_id, dedupe_key)
  where dedupe_key <> '';

create unique index if not exists prospect_contacts_business_email_idx
  on prospect_contacts (business_id, email_normalized)
  where email_normalized is not null;

create unique index if not exists prospect_contacts_primary_unique_idx
  on prospect_contacts (business_id, prospect_id)
  where is_primary;
