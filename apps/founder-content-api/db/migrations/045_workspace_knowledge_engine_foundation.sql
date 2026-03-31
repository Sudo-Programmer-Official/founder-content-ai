create table if not exists workspace_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  source_type text not null check (source_type in ('website', 'note')),
  title text,
  source_url text,
  raw_text text not null default '',
  extracted_text text not null default '',
  metadata_json jsonb not null default '{}'::jsonb,
  processing_status text not null default 'queued' check (processing_status in ('queued', 'processing', 'completed', 'failed')),
  processing_error text,
  processing_job_id uuid references jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_knowledge_sources_business_idx
  on workspace_knowledge_sources (business_id, created_at desc);

create index if not exists workspace_knowledge_sources_status_idx
  on workspace_knowledge_sources (business_id, processing_status, updated_at desc);

create unique index if not exists workspace_knowledge_sources_business_source_url_idx
  on workspace_knowledge_sources (business_id, source_url)
  where source_url is not null;

create table if not exists workspace_knowledge_profiles (
  business_id uuid primary key references businesses(id) on delete cascade,
  voice_summary text,
  audience_summary text,
  positioning_summary text,
  beliefs jsonb not null default '[]'::jsonb,
  topic_clusters jsonb not null default '[]'::jsonb,
  source_count integer not null default 0,
  processing_status text not null default 'queued' check (processing_status in ('queued', 'processing', 'completed', 'failed')),
  processing_error text,
  last_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspace_knowledge_profiles_status_idx
  on workspace_knowledge_profiles (processing_status, updated_at desc);
