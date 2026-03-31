create table if not exists media_generation_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  content_asset_id uuid references content_assets(id) on delete set null,
  media_preset_id uuid references media_presets(id) on delete set null,
  prompt_template_id uuid references prompt_templates(id) on delete set null,
  generated_media_type text not null,
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  status text not null default 'completed'
    check (status in ('queued', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists media_generation_logs_business_created_idx
  on media_generation_logs (business_id, created_at desc);

create table if not exists media_performance_stats (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  media_preset_id uuid references media_presets(id) on delete set null,
  media_type text not null,
  surface text not null
    check (surface in ('post', 'email', 'visual_generation')),
  impressions int not null default 0,
  clicks int not null default 0,
  engagements int not null default 0,
  conversions int not null default 0,
  score numeric(10,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, media_preset_id, media_type, surface)
);

create index if not exists media_performance_stats_business_updated_idx
  on media_performance_stats (business_id, updated_at desc);
