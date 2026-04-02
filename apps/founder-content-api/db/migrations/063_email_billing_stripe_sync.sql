alter table email_billing_configs
  add column if not exists provider_customer_id text;

alter table email_billing_configs
  add column if not exists provider_subscription_id text;

alter table email_billing_configs
  add column if not exists provider_price_id text;

alter table email_billing_configs
  add column if not exists subscription_status text;

alter table email_billing_configs
  add column if not exists current_period_start timestamptz;

alter table email_billing_configs
  add column if not exists current_period_end timestamptz;

alter table email_billing_configs
  add column if not exists cancel_at_period_end boolean not null default false;

create unique index if not exists email_billing_configs_provider_subscription_id_idx
  on email_billing_configs (provider_subscription_id)
  where provider_subscription_id is not null;

create index if not exists email_billing_configs_provider_customer_id_idx
  on email_billing_configs (provider_customer_id)
  where provider_customer_id is not null;
