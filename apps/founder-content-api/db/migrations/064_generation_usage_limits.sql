alter table usage_limits_daily
  add column if not exists generations_limit integer not null default 3;

alter table usage_limits_daily
  add column if not exists generations_used integer not null default 0;

update usage_limits_daily ud
set generations_limit = case b.plan_code
  when 'free' then 3
  when 'pro' then 10
  when 'growth' then 100000
  when 'custom' then 100000
  else 3
end
from businesses b
where b.id = ud.business_id;

update plans
set max_generations = case code
  when 'free' then 45
  when 'pro' then 300
  when 'growth' then 100000
  when 'custom' then 100000
  else max_generations
end
where code in ('free', 'pro', 'growth', 'custom');

create table if not exists usage_limits_monthly (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  month_start date not null,
  generations_limit integer not null default 0,
  generations_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, month_start)
);

create index if not exists usage_limits_monthly_business_id_idx
  on usage_limits_monthly (business_id, month_start desc);

insert into usage_limits_monthly (
  business_id,
  month_start,
  generations_limit,
  generations_used
)
select
  b.id,
  date_trunc('month', now())::date,
  p.max_generations,
  0
from businesses b
inner join plans p on p.code = b.plan_code
on conflict (business_id, month_start) do nothing;
