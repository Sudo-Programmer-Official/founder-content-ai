create table if not exists workspace_media_preset_performance (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  media_preset_id uuid not null references media_presets(id) on delete cascade,
  surface text not null
    check (surface in ('post', 'email', 'visual_generation')),
  sample_count int not null default 0,
  impressions_sum int not null default 0,
  clicks_sum int not null default 0,
  engagements_sum int not null default 0,
  conversions_sum int not null default 0,
  avg_score numeric(10,4) not null default 0,
  performance_weight numeric(10,4) not null default 0,
  confidence_band text not null default 'low'
    check (confidence_band in ('low', 'medium', 'high')),
  last_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, media_preset_id, surface)
);

create index if not exists workspace_media_preset_performance_surface_idx
  on workspace_media_preset_performance (business_id, surface, performance_weight desc, updated_at desc);

create table if not exists workspace_media_type_performance (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  media_type text not null,
  surface text not null
    check (surface in ('post', 'email', 'visual_generation')),
  sample_count int not null default 0,
  impressions_sum int not null default 0,
  clicks_sum int not null default 0,
  engagements_sum int not null default 0,
  conversions_sum int not null default 0,
  avg_score numeric(10,4) not null default 0,
  performance_weight numeric(10,4) not null default 0,
  confidence_band text not null default 'low'
    check (confidence_band in ('low', 'medium', 'high')),
  last_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, media_type, surface)
);

create index if not exists workspace_media_type_performance_surface_idx
  on workspace_media_type_performance (business_id, surface, performance_weight desc, updated_at desc);
