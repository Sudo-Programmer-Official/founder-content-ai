create table if not exists idea_inbox_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  body text not null,
  status text not null default 'new' check (status in ('new', 'converted', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idea_inbox_items_business_id_idx
  on idea_inbox_items (business_id, created_at desc);

create index if not exists idea_inbox_items_status_idx
  on idea_inbox_items (status);

alter table content_assets
  add column if not exists title text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists source_kind text not null default 'generated',
  add column if not exists pipeline_stage text not null default 'draft',
  add column if not exists source_idea_id uuid references idea_inbox_items(id) on delete set null;

update content_assets
set
  updated_at = coalesce(updated_at, created_at),
  pipeline_stage = case
    when status in ('published', 'posted') then 'posted'
    when status = 'scheduled' then 'scheduled'
    when status = 'review' then 'review'
    else 'draft'
  end,
  source_kind = coalesce(nullif(source_kind, ''), 'generated')
where true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'content_assets_source_kind_check'
  ) then
    alter table content_assets
      add constraint content_assets_source_kind_check
      check (source_kind in ('generated', 'manual', 'idea', 'capture', 'remix'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'content_assets_pipeline_stage_check'
  ) then
    alter table content_assets
      add constraint content_assets_pipeline_stage_check
      check (pipeline_stage in ('draft', 'review', 'scheduled', 'posted'));
  end if;
end $$;

create index if not exists content_assets_pipeline_stage_idx
  on content_assets (business_id, pipeline_stage, updated_at desc);

create index if not exists content_assets_source_kind_idx
  on content_assets (source_kind);
