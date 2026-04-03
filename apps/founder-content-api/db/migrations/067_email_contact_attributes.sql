alter table email_contacts
  add column if not exists attributes_json jsonb not null default '{}'::jsonb;

create index if not exists email_contacts_attributes_json_gin_idx
  on email_contacts
  using gin (attributes_json);

create index if not exists email_contacts_state_attribute_idx
  on email_contacts ((attributes_json ->> 'state'))
  where attributes_json ? 'state';

create index if not exists email_contacts_plan_attribute_idx
  on email_contacts ((attributes_json ->> 'plan'))
  where attributes_json ? 'plan';
