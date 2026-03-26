alter table scheduled_posts
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz;

create index if not exists scheduled_posts_user_id_scheduled_at_idx
  on scheduled_posts (user_id, scheduled_at);

create index if not exists scheduled_posts_last_attempt_at_idx
  on scheduled_posts (last_attempt_at);
