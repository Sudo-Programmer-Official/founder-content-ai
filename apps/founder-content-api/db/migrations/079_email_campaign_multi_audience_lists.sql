create table if not exists email_campaign_audience_lists (
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  list_id uuid not null references email_lists(id) on delete restrict,
  position_index int not null default 0,
  created_at timestamptz not null default now(),
  primary key (campaign_id, list_id)
);

create index if not exists email_campaign_audience_lists_list_id_idx
  on email_campaign_audience_lists (list_id);
