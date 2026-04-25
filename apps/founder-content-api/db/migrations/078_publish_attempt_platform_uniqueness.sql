alter table publish_attempt_platforms
  drop constraint if exists publish_attempt_platforms_publish_attempt_id_platform_key;

create unique index if not exists publish_attempt_platforms_attempt_scheduled_post_uidx
  on publish_attempt_platforms (publish_attempt_id, scheduled_post_id)
  where scheduled_post_id is not null;

create unique index if not exists publish_attempt_platforms_attempt_schedule_item_uidx
  on publish_attempt_platforms (publish_attempt_id, schedule_item_id)
  where schedule_item_id is not null;
