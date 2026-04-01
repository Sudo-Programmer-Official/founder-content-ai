insert into plans (
  code,
  name,
  max_businesses,
  max_members,
  max_generations,
  features_json,
  price_monthly,
  price_yearly
)
values
  ('free', 'Free', 1, 1, 60, '{}'::jsonb, 0, 0),
  ('pro', 'Starter', 1, 3, 150, '{"scheduler":"unlimited","best_time":"smart"}'::jsonb, 900, 9000),
  ('growth', 'Pro', 3, 10, 1000, '{"scheduler":"advanced","analytics":"enabled"}'::jsonb, 1900, 19000),
  ('custom', 'Custom', 10, 50, 5000, '{"billing":"custom"}'::jsonb, 0, 0)
on conflict (code)
do update set
  name = excluded.name,
  max_businesses = excluded.max_businesses,
  max_members = excluded.max_members,
  max_generations = excluded.max_generations,
  features_json = excluded.features_json,
  price_monthly = excluded.price_monthly,
  price_yearly = excluded.price_yearly;

alter table subscriptions
  add column if not exists provider_customer_id text;

alter table subscriptions
  add column if not exists provider_price_id text;

alter table subscriptions
  add column if not exists provider_checkout_session_id text;

alter table subscriptions
  add column if not exists cancel_at_period_end boolean not null default false;

alter table subscriptions
  add column if not exists metadata_json jsonb not null default '{}'::jsonb;

alter table subscriptions
  add column if not exists updated_at timestamptz not null default now();

create index if not exists subscriptions_provider_customer_id_idx
  on subscriptions (provider_customer_id)
  where provider_customer_id is not null;

create index if not exists subscriptions_provider_price_id_idx
  on subscriptions (provider_price_id)
  where provider_price_id is not null;
