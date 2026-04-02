create table if not exists email_billing_configs (
  business_id uuid primary key references businesses(id) on delete cascade,
  tier_code text not null check (tier_code in ('none', 'starter_email', 'growth_email', 'scale_email', 'custom')),
  billing_source text not null default 'bundled' check (billing_source in ('bundled', 'addon', 'manual', 'custom')),
  subscriber_limit integer,
  monthly_email_limit integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_billing_configs_tier_code_idx
  on email_billing_configs (tier_code, billing_source);

insert into email_billing_configs (
  business_id,
  tier_code,
  billing_source,
  subscriber_limit,
  monthly_email_limit
)
select
  b.id,
  case b.plan_code
    when 'pro' then 'starter_email'
    when 'growth' then 'growth_email'
    when 'custom' then 'custom'
    else 'none'
  end as tier_code,
  case b.plan_code
    when 'free' then 'manual'
    when 'custom' then 'custom'
    else 'bundled'
  end as billing_source,
  case b.plan_code
    when 'pro' then 20000
    when 'growth' then 20000
    when 'custom' then null
    else 0
  end as subscriber_limit,
  case b.plan_code
    when 'pro' then 100000
    when 'growth' then 300000
    when 'custom' then null
    else 0
  end as monthly_email_limit
from businesses b
on conflict (business_id) do nothing;
