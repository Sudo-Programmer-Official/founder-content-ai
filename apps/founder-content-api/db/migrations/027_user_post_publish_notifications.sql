alter table user_preferences
  add column if not exists notify_post_published boolean not null default true;
