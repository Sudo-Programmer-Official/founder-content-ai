create table if not exists content_generation_suggestion_feedback (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  generated_asset_id uuid not null unique references content_assets(id) on delete cascade,
  source_asset_id uuid references content_assets(id) on delete set null,
  suggestion_id text not null,
  strategy text not null check (strategy in ('continue', 'deepen', 'contrarian', 'tactical')),
  selection_origin text not null default 'generate_for_me',
  selected_at timestamptz not null default now(),
  edit_count integer not null default 0,
  first_edited_at timestamptz,
  last_edited_at timestamptz,
  scheduled_post_id uuid references scheduled_posts(id) on delete set null,
  scheduled_at timestamptz,
  published_at timestamptz,
  performance_label text check (performance_label in ('low', 'medium', 'high')),
  performance_recorded_at timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_generation_suggestion_feedback_business_id_idx
  on content_generation_suggestion_feedback (business_id, selected_at desc);

create index if not exists content_generation_suggestion_feedback_strategy_idx
  on content_generation_suggestion_feedback (business_id, strategy, updated_at desc);

create index if not exists content_generation_suggestion_feedback_source_asset_id_idx
  on content_generation_suggestion_feedback (source_asset_id, updated_at desc)
  where source_asset_id is not null;

create index if not exists content_generation_suggestion_feedback_scheduled_post_id_idx
  on content_generation_suggestion_feedback (scheduled_post_id)
  where scheduled_post_id is not null;

create index if not exists content_generation_suggestion_feedback_performance_label_idx
  on content_generation_suggestion_feedback (performance_label, updated_at desc)
  where performance_label is not null;
