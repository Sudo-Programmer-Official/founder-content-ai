create table if not exists email_unsubscribes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  email text not null,
  reason text,
  source text not null default 'manual' check (source in ('campaign', 'manual', 'system', 'bounce', 'complaint')),
  source_campaign_id uuid references email_campaigns(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists email_unsubscribes_business_email_lower_idx
  on email_unsubscribes (business_id, lower(email));

create index if not exists email_unsubscribes_created_at_idx
  on email_unsubscribes (created_at desc);

alter table email_contacts
  drop constraint if exists email_contacts_status_check;

alter table email_contacts
  add constraint email_contacts_status_check
  check (status in ('active', 'unsubscribed', 'bounced', 'complained'));

insert into email_unsubscribes (
  business_id,
  email,
  reason,
  source,
  created_at
)
select
  business_id,
  email,
  'Migrated existing contact unsubscribe state.',
  'system',
  coalesce(unsubscribed_at, now())
from email_contacts
where status = 'unsubscribed'
on conflict do nothing;
