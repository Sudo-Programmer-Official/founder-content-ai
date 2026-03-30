alter table jobs
  add column if not exists job_key text;

create unique index if not exists jobs_active_job_key_idx
  on jobs (job_key)
  where job_key is not null
    and status in ('queued', 'processing');

create index if not exists jobs_job_key_created_idx
  on jobs (job_key, created_at desc)
  where job_key is not null;
