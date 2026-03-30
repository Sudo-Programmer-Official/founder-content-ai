create table if not exists post_metrics (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  scheduled_post_id uuid not null unique references scheduled_posts(id) on delete cascade,
  source text not null default 'manual' check (source in ('manual', 'api', 'derived')),
  performance_label text check (performance_label in ('low', 'medium', 'high')),
  impressions integer not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  clicks integer not null default 0,
  engagement_score numeric(8,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists post_metrics_business_id_idx
  on post_metrics (business_id, updated_at desc);

create index if not exists post_metrics_performance_label_idx
  on post_metrics (performance_label, updated_at desc);
