alter table user_preferences
  add column if not exists notify_email_campaign_updates boolean not null default true;

alter table email_campaigns
  add column if not exists start_notification_sent_at timestamptz;

alter table email_campaigns
  add column if not exists completion_notification_sent_at timestamptz;

alter table email_campaigns
  add column if not exists failure_notification_sent_at timestamptz;
