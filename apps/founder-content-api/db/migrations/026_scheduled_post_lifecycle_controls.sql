alter table scheduled_posts
  drop constraint if exists scheduled_posts_status_check;

alter table scheduled_posts
  add constraint scheduled_posts_status_check
  check (status in ('scheduled', 'processing', 'published', 'failed', 'paused', 'canceled'));

alter table publication_events
  drop constraint if exists publication_events_status_check;

alter table publication_events
  add constraint publication_events_status_check
  check (status in ('scheduled', 'processing', 'published', 'failed', 'paused', 'canceled'));
