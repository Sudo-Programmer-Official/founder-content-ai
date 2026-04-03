create table if not exists email_campaign_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  recipient_count int not null default 0,
  delivered_count int not null default 0,
  failed_count int not null default 0,
  unsubscribed_count int not null default 0,
  send_started_at timestamptz,
  send_completed_at timestamptz,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_campaign_sends_campaign_id_idx
  on email_campaign_sends (campaign_id);

create index if not exists email_campaign_sends_business_id_idx
  on email_campaign_sends (business_id);

create index if not exists email_campaign_sends_status_idx
  on email_campaign_sends (status);

alter table email_campaign_recipients
  add column if not exists send_id uuid references email_campaign_sends(id) on delete cascade;

alter table email_campaign_recipients
  add column if not exists open_count int not null default 0;

alter table email_campaign_recipients
  add column if not exists first_opened_at timestamptz;

alter table email_campaign_recipients
  add column if not exists last_opened_at timestamptz;

alter table email_campaign_recipients
  add column if not exists click_count int not null default 0;

alter table email_campaign_recipients
  add column if not exists first_clicked_at timestamptz;

alter table email_campaign_recipients
  add column if not exists last_clicked_at timestamptz;

insert into email_campaign_sends (
  campaign_id,
  business_id,
  status,
  recipient_count,
  delivered_count,
  failed_count,
  unsubscribed_count,
  send_started_at,
  send_completed_at,
  created_by_user_id,
  created_at,
  updated_at
)
select
  c.id,
  c.business_id,
  case
    when c.status in ('queued', 'sending', 'sent', 'failed') then c.status
    else 'sent'
  end,
  count(r.id)::int,
  count(r.id) filter (where r.status = 'delivered')::int,
  count(r.id) filter (where r.status = 'failed')::int,
  count(r.id) filter (where r.status = 'unsubscribed')::int,
  c.send_started_at,
  c.send_completed_at,
  c.created_by_user_id,
  c.created_at,
  c.updated_at
from email_campaigns c
inner join email_campaign_recipients r on r.campaign_id = c.id
where r.send_id is null
  and not exists (
    select 1
    from email_campaign_sends s
    where s.campaign_id = c.id
  )
group by c.id;

update email_campaign_recipients r
set send_id = (
  select s.id
  from email_campaign_sends s
  where s.campaign_id = r.campaign_id
  order by s.created_at asc, s.id asc
  limit 1
)
where r.send_id is null;

alter table email_campaign_recipients
  alter column send_id set not null;

drop index if exists email_campaign_recipients_campaign_contact_idx;

create unique index if not exists email_campaign_recipients_send_contact_idx
  on email_campaign_recipients (send_id, contact_id);

create index if not exists email_campaign_recipients_send_id_idx
  on email_campaign_recipients (send_id);

create index if not exists email_campaign_recipients_send_status_created_idx
  on email_campaign_recipients (send_id, status, created_at asc);

create table if not exists email_campaign_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references email_campaigns(id) on delete cascade,
  send_id uuid not null references email_campaign_sends(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  original_url text not null,
  normalized_url text not null,
  label text,
  position_index int,
  created_at timestamptz not null default now()
);

create index if not exists email_campaign_links_campaign_id_idx
  on email_campaign_links (campaign_id);

create index if not exists email_campaign_links_send_id_idx
  on email_campaign_links (send_id);

alter table email_events
  add column if not exists send_id uuid references email_campaign_sends(id) on delete cascade;

alter table email_events
  add column if not exists link_id uuid references email_campaign_links(id) on delete set null;

alter table email_events
  add column if not exists source_type text not null default 'unknown';

alter table email_events
  add column if not exists user_agent text;

alter table email_events
  add column if not exists ip_hash text;

update email_events e
set send_id = r.send_id
from email_campaign_recipients r
where e.campaign_recipient_id = r.id
  and e.send_id is null;

alter table email_events
  drop constraint if exists email_events_event_type_check;

alter table email_events
  add constraint email_events_event_type_check
  check (event_type in ('queued', 'sent', 'delivered', 'open', 'click', 'bounce', 'complaint', 'unsubscribe', 'failed'));

create index if not exists email_events_send_id_idx
  on email_events (send_id, occurred_at desc);

create index if not exists email_events_link_id_idx
  on email_events (link_id, occurred_at desc);

create index if not exists email_events_event_type_idx
  on email_events (event_type, occurred_at desc);
