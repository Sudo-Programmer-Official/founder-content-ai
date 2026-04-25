create table if not exists email_autopilot_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  created_by_user_id uuid references users(id) on delete set null,
  audience_id uuid not null references email_lists(id) on delete restrict,
  goal text not null,
  strategy text not null
    check (strategy in ('conversion', 'engagement', 'awareness')),
  status text not null default 'processing'
    check (status in ('processing', 'testing', 'winner_selected', 'completed', 'failed')),
  winner_variant_id uuid,
  test_audience_size integer not null default 0,
  remainder_audience_size integer not null default 0,
  evaluation_mode text not null default 'simulated'
    check (evaluation_mode in ('simulated', 'live')),
  summary_json jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_autopilot_runs_business_created_idx
  on email_autopilot_runs (business_id, created_at desc);

create index if not exists email_autopilot_runs_business_status_idx
  on email_autopilot_runs (business_id, status, created_at desc);

create table if not exists campaign_variants (
  id uuid primary key default gen_random_uuid(),
  autopilot_run_id uuid not null references email_autopilot_runs(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  campaign_id uuid references email_campaigns(id) on delete set null,
  rollout_campaign_id uuid references email_campaigns(id) on delete set null,
  asset_id uuid references workspace_assets(id) on delete set null,
  label text not null,
  angle text not null,
  subject text not null,
  content text not null,
  status text not null default 'testing'
    check (status in ('testing', 'winner', 'discarded')),
  metrics_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaign_variants_run_idx
  on campaign_variants (autopilot_run_id, created_at asc);

create index if not exists campaign_variants_business_status_idx
  on campaign_variants (business_id, status, updated_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'email_autopilot_runs_winner_variant_fk'
  ) then
    alter table email_autopilot_runs
      add constraint email_autopilot_runs_winner_variant_fk
      foreign key (winner_variant_id) references campaign_variants(id) on delete set null;
  end if;
end $$;
