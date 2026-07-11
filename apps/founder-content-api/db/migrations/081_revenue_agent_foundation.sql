create table if not exists lead_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider text not null check (provider in ('google_business', 'mock')),
  query_json jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  last_fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_sources_business_id_idx
  on lead_sources (business_id, created_at desc);

create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  lead_source_id uuid references lead_sources(id) on delete set null,
  business_name text not null,
  website text,
  website_normalized text,
  email text,
  email_normalized text,
  phone text,
  phone_normalized text,
  city text,
  state text,
  industry text not null default '',
  source text not null default 'google_business',
  source_url text,
  rating numeric(3, 2),
  review_count integer not null default 0,
  pain_summary text not null default '',
  opportunity_score integer not null default 0 check (opportunity_score >= 0 and opportunity_score <= 5),
  opportunity_tags_json jsonb not null default '[]'::jsonb,
  suggested_offer_angle text not null default '',
  status text not null default 'new' check (
    status in (
      'new',
      'researched',
      'drafted',
      'approved',
      'sent',
      'replied',
      'follow_up_due',
      'meeting_booked',
      'not_interested',
      'dead'
    )
  ),
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  approved_at timestamptz,
  sent_at timestamptz,
  replied_at timestamptz,
  meeting_booked_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prospects_business_id_status_idx
  on prospects (business_id, status, updated_at desc);

create index if not exists prospects_business_id_followup_idx
  on prospects (business_id, next_follow_up_at asc nulls last);

create unique index if not exists prospects_business_website_unique_idx
  on prospects (business_id, website_normalized)
  where website_normalized is not null;

create unique index if not exists prospects_business_email_unique_idx
  on prospects (business_id, email_normalized)
  where email_normalized is not null;

create unique index if not exists prospects_business_phone_unique_idx
  on prospects (business_id, phone_normalized)
  where phone_normalized is not null;

create table if not exists prospect_research (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  agent_run_id uuid,
  pain_summary text not null default '',
  opportunity_score integer not null default 0 check (opportunity_score >= 0 and opportunity_score <= 5),
  opportunity_tags_json jsonb not null default '[]'::jsonb,
  suggested_offer_angle text not null default '',
  email_subject text not null default '',
  email_body text not null default '',
  research_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prospect_id)
);

create index if not exists prospect_research_business_id_idx
  on prospect_research (business_id, created_at desc);

create table if not exists revenue_agent_outreach_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  research_id uuid references prospect_research(id) on delete set null,
  agent_run_id uuid,
  type text not null check (type in ('initial', 'followup', 'value', 'breakup')),
  author text not null check (author in ('ai', 'operator', 'lead')),
  subject text not null default '',
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'failed')),
  approved_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists revenue_agent_outreach_messages_business_id_idx
  on revenue_agent_outreach_messages (business_id, prospect_id, created_at desc);

create table if not exists revenue_agent_sequences (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  day_offset integer not null check (day_offset >= 0),
  message_type text not null check (message_type in ('initial', 'followup', 'value', 'breakup')),
  subject_template text not null,
  body_template text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, day_offset)
);

create index if not exists revenue_agent_sequences_business_id_idx
  on revenue_agent_sequences (business_id, day_offset asc);

create table if not exists revenue_agent_email_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  prospect_id uuid references prospects(id) on delete cascade,
  message_id uuid references revenue_agent_outreach_messages(id) on delete set null,
  event_type text not null check (
    event_type in ('queued', 'approved', 'sent', 'delivered', 'open', 'bounce', 'complaint', 'unsubscribe', 'failed', 'follow_up_scheduled')
  ),
  provider_message_id text,
  payload_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists revenue_agent_email_events_business_id_idx
  on revenue_agent_email_events (business_id, occurred_at desc);

create table if not exists revenue_agent_agent_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  lead_source_id uuid references lead_sources(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  industry text not null default '',
  city text not null default '',
  state text not null default '',
  offer text not null default '',
  daily_lead_limit integer not null default 20,
  provider text not null default 'mock' check (provider in ('google_business', 'mock')),
  prospects_found integer not null default 0,
  prospects_saved integer not null default 0,
  drafts_generated integer not null default 0,
  emails_sent integer not null default 0,
  error_message text,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists revenue_agent_agent_runs_business_id_idx
  on revenue_agent_agent_runs (business_id, created_at desc);

alter table prospect_research
  add constraint prospect_research_agent_run_id_fkey
  foreign key (agent_run_id) references revenue_agent_agent_runs(id) on delete set null;

alter table revenue_agent_outreach_messages
  add constraint revenue_agent_outreach_messages_agent_run_id_fkey
  foreign key (agent_run_id) references revenue_agent_agent_runs(id) on delete set null;

create table if not exists revenue_agent_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  prospect_id uuid not null references prospects(id) on delete cascade,
  message_id uuid references revenue_agent_outreach_messages(id) on delete set null,
  run_id uuid references revenue_agent_agent_runs(id) on delete set null,
  task_type text not null check (task_type in ('research', 'approve_draft', 'send_email', 'follow_up', 'value_follow_up', 'breakup')),
  status text not null default 'open' check (status in ('open', 'done', 'skipped', 'failed')),
  due_at timestamptz not null,
  completed_at timestamptz,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists revenue_agent_tasks_business_id_idx
  on revenue_agent_tasks (business_id, status, due_at asc);

create index if not exists revenue_agent_tasks_prospect_id_idx
  on revenue_agent_tasks (prospect_id, due_at asc);

insert into revenue_agent_sequences (
  business_id,
  day_offset,
  message_type,
  subject_template,
  body_template
)
select
  b.id,
  sequence.day_offset,
  sequence.message_type,
  sequence.subject_template,
  sequence.body_template
from businesses b
cross join (
  values
    (
      0,
      'initial',
      '{{business_name}} quick audit',
      'Hi {{first_name}},\n\nI noticed {{business_name}} and put together a quick note about the missed follow-up gap I keep seeing in local service businesses.\n\n{{pain_summary}}\n\nIf it helps, I can send a 2-minute audit showing where AI booking + follow-up automation could free up time and recover leads.\n\n{{signature}}'
    ),
    (
      3,
      'followup',
      'Quick follow-up for {{business_name}}',
      'Hi {{first_name}},\n\nJust bumping this in case it got buried.\n\nI still think the biggest leverage at {{business_name}} is reducing missed lead follow-up and making booking easier.\n\nIf you want, I can send the 2-minute audit.\n\n{{signature}}'
    ),
    (
      7,
      'value',
      'A useful idea for {{business_name}}',
      'Hi {{first_name}},\n\nOne thing I would test at {{business_name}} is a simple automation that responds to inbound leads fast, then nudges them if they go quiet.\n\nThat tends to recover meetings without adding front-desk work.\n\n{{signature}}'
    ),
    (
      14,
      'breakup',
      'Should I close the loop?',
      'Hi {{first_name}},\n\nLast note from me. If improving missed follow-up and booking conversion is not a priority right now, I will close the loop.\n\nIf you do want the audit, reply and I will send it over.\n\n{{signature}}'
    )
) as sequence(day_offset, message_type, subject_template, body_template)
where not exists (
  select 1
  from revenue_agent_sequences s
  where s.business_id = b.id
    and s.day_offset = sequence.day_offset
);
