create table if not exists growth_leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  source text not null default 'manual' check (source in ('landing_page', 'demo_request', 'manual', 'csv_import', 'system')),
  status text not null default 'new' check (status in ('new', 'engaged', 'trial', 'converted', 'churned')),
  notes text,
  first_email_sent_at timestamptz,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists growth_leads_business_email_lower_idx
  on growth_leads (business_id, lower(email));

create index if not exists growth_leads_business_status_idx
  on growth_leads (business_id, status, created_at desc);

create table if not exists growth_automation_flows (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  slug text not null,
  trigger text not null default 'lead_created' check (trigger in ('lead_created')),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists growth_automation_flows_business_slug_idx
  on growth_automation_flows (business_id, slug);

create index if not exists growth_automation_flows_business_status_idx
  on growth_automation_flows (business_id, status, created_at desc);

create table if not exists growth_automation_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references growth_automation_flows(id) on delete cascade,
  day_offset integer not null default 0 check (day_offset >= 0),
  channel text not null default 'email' check (channel in ('email')),
  template_key text not null,
  subject text not null,
  body_text text not null,
  body_html text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists growth_automation_steps_flow_template_idx
  on growth_automation_steps (flow_id, template_key);

create index if not exists growth_automation_steps_flow_day_idx
  on growth_automation_steps (flow_id, day_offset asc);

create table if not exists growth_automation_enrollments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  lead_id uuid not null references growth_leads(id) on delete cascade,
  flow_id uuid not null references growth_automation_flows(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  last_run_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, flow_id)
);

create index if not exists growth_automation_enrollments_business_status_idx
  on growth_automation_enrollments (business_id, status, created_at desc);

create table if not exists growth_automation_step_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  enrollment_id uuid not null references growth_automation_enrollments(id) on delete cascade,
  lead_id uuid not null references growth_leads(id) on delete cascade,
  step_id uuid not null references growth_automation_steps(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  sent_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, step_id)
);

create index if not exists growth_automation_step_runs_due_idx
  on growth_automation_step_runs (status, scheduled_for asc);

create index if not exists growth_automation_step_runs_business_idx
  on growth_automation_step_runs (business_id, status, scheduled_for asc);
