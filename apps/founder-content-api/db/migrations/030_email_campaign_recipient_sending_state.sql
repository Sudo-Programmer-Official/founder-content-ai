alter table email_campaign_recipients
  drop constraint if exists email_campaign_recipients_status_check;

alter table email_campaign_recipients
  add constraint email_campaign_recipients_status_check
  check (status in ('queued', 'sending', 'sent', 'delivered', 'failed', 'unsubscribed'));

create index if not exists email_campaign_recipients_campaign_status_created_idx
  on email_campaign_recipients (campaign_id, status, created_at asc);
