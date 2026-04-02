alter table businesses
  add column if not exists unlimited_generations boolean not null default false;

create index if not exists businesses_unlimited_generations_idx
  on businesses (unlimited_generations)
  where unlimited_generations = true;
