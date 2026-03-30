alter table scheduled_posts
  add column if not exists earliest_dispatch_at timestamptz;

alter table scheduled_posts
  add column if not exists latest_dispatch_at timestamptz;

alter table scheduled_posts
  add column if not exists dispatch_job_id uuid;

alter table scheduled_posts
  add column if not exists dispatch_priority integer not null default 40;

alter table scheduled_posts
  add column if not exists hook_hash text;

alter table scheduled_posts
  add column if not exists body_hash text;

alter table scheduled_posts
  add column if not exists content_fingerprint text;

update scheduled_posts
set
  earliest_dispatch_at = coalesce(earliest_dispatch_at, scheduled_at),
  latest_dispatch_at = coalesce(latest_dispatch_at, scheduled_at)
where earliest_dispatch_at is null
   or latest_dispatch_at is null;

alter table scheduled_posts
  alter column earliest_dispatch_at set not null;

alter table scheduled_posts
  alter column latest_dispatch_at set not null;

alter table scheduled_posts
  drop constraint if exists scheduled_posts_dispatch_job_id_fkey;

alter table scheduled_posts
  add constraint scheduled_posts_dispatch_job_id_fkey
  foreign key (dispatch_job_id) references jobs(id) on delete set null;

create index if not exists scheduled_posts_dispatch_window_idx
  on scheduled_posts (status, earliest_dispatch_at asc, latest_dispatch_at asc);

create index if not exists scheduled_posts_dispatch_job_id_idx
  on scheduled_posts (dispatch_job_id);

create index if not exists scheduled_posts_content_fingerprint_idx
  on scheduled_posts (platform, content_fingerprint, created_at desc)
  where content_fingerprint is not null;
