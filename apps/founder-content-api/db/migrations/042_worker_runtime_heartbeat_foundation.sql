create table if not exists worker_runtime_heartbeats (
  worker_key text primary key,
  worker_type text not null,
  service_name text,
  last_heartbeat_at timestamptz not null default now(),
  last_successful_pass_at timestamptz,
  last_work_detected_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists worker_runtime_heartbeats_updated_idx
  on worker_runtime_heartbeats (updated_at desc);
