create table if not exists outreach_leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  role text not null default 'Founder',
  platform text not null check (platform in ('linkedin', 'reddit', 'x')),
  profile_url text not null,
  bio text not null default '',
  recent_post text not null default '',
  engagement_label text not null default 'low' check (engagement_label in ('low', 'medium', 'high')),
  posts_frequently boolean not null default false,
  low_engagement boolean not null default true,
  founder_keyword boolean not null default true,
  priority_score integer not null default 0,
  status text not null default 'new' check (status in ('new', 'contacted', 'replied', 'activated')),
  contacted_at timestamptz,
  replied_at timestamptz,
  last_post_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outreach_leads_business_id_idx
  on outreach_leads (business_id, created_at desc);

create index if not exists outreach_leads_status_idx
  on outreach_leads (business_id, status, priority_score desc);

create table if not exists outreach_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references outreach_leads(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  type text not null check (type in ('initial', 'followup', 'reply', 'draft')),
  author text not null check (author in ('ai', 'operator', 'lead')),
  content text not null,
  tone text check (tone in ('casual', 'direct', 'curious')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists outreach_messages_lead_id_idx
  on outreach_messages (lead_id, created_at desc);

create table if not exists outreach_replies (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references outreach_leads(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  content text not null,
  sentiment text not null default 'neutral' check (sentiment in ('positive', 'neutral', 'negative')),
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists outreach_replies_lead_id_idx
  on outreach_replies (lead_id, detected_at desc);

alter table business_email_settings
  add column if not exists domain_name text;

alter table business_email_settings
  add column if not exists dns_records_json jsonb not null default '[]'::jsonb;

alter table business_email_settings
  add column if not exists verified_at timestamptz;

alter table business_email_settings
  add column if not exists last_checked_at timestamptz;

create table if not exists email_lists (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_lists_business_id_idx
  on email_lists (business_id, created_at desc);

create table if not exists email_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  tags_json jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'unsubscribed', 'bounced')),
  unsubscribe_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_contacts_business_email_lower_idx
  on email_contacts (business_id, lower(email));

create table if not exists email_list_members (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references email_lists(id) on delete cascade,
  contact_id uuid not null references email_contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (list_id, contact_id)
);

create index if not exists email_list_members_list_id_idx
  on email_list_members (list_id);

create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  list_id uuid references email_lists(id) on delete set null,
  name text not null,
  subject text not null,
  body_html text not null,
  body_text text not null default '',
  status text not null default 'draft' check (status in ('draft', 'queued', 'sending', 'sent', 'failed')),
  reply_to_email text,
  created_by_user_id uuid references users(id) on delete set null,
  scheduled_at timestamptz,
  send_started_at timestamptz,
  send_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_campaigns_business_id_idx
  on email_campaigns (business_id, created_at desc);

create table if not exists email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  contact_id uuid not null references email_contacts(id) on delete cascade,
  personalized_subject text not null,
  personalized_body_html text not null,
  personalized_body_text text not null default '',
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'failed', 'unsubscribed')),
  ses_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists email_campaign_recipients_campaign_contact_idx
  on email_campaign_recipients (campaign_id, contact_id);

create index if not exists email_campaign_recipients_status_idx
  on email_campaign_recipients (campaign_id, status);

create index if not exists email_campaign_recipients_message_id_idx
  on email_campaign_recipients (ses_message_id);

create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  campaign_recipient_id uuid references email_campaign_recipients(id) on delete cascade,
  event_type text not null check (event_type in ('queued', 'sent', 'delivered', 'open', 'bounce', 'complaint', 'unsubscribe', 'failed')),
  provider_message_id text,
  payload_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists email_events_recipient_id_idx
  on email_events (campaign_recipient_id, occurred_at desc);

create table if not exists system_error_logs (
  id uuid primary key default gen_random_uuid(),
  route text not null,
  user_id uuid references users(id) on delete set null,
  business_id uuid references businesses(id) on delete set null,
  code text not null,
  message text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_error_logs_created_at_idx
  on system_error_logs (created_at desc);

create index if not exists system_error_logs_code_idx
  on system_error_logs (code, created_at desc);
