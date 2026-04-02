create table if not exists content_distribution_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  content_item_id uuid not null references content_items(id) on delete cascade,
  primary_variant_id uuid references content_variants(id) on delete set null,
  lane text not null check (lane in ('social', 'email')),
  title text,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'processing', 'partial', 'published', 'failed', 'paused', 'canceled')),
  editable_until timestamptz,
  metadata_json jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, lane)
);

create index if not exists content_distribution_groups_business_status_idx
  on content_distribution_groups (business_id, status, created_at desc);

create index if not exists content_distribution_groups_content_item_idx
  on content_distribution_groups (content_item_id, lane, created_at desc);

create index if not exists content_distribution_groups_editable_until_idx
  on content_distribution_groups (editable_until asc nulls last);

alter table schedule_items
  add column if not exists distribution_group_id uuid;

alter table schedule_items
  drop constraint if exists schedule_items_distribution_group_id_fkey;

alter table schedule_items
  add constraint schedule_items_distribution_group_id_fkey
  foreign key (distribution_group_id) references content_distribution_groups(id) on delete set null;

create index if not exists schedule_items_distribution_group_id_idx
  on schedule_items (distribution_group_id, scheduled_at asc nulls last);

with seeded_groups as (
  select distinct on (si.content_item_id, si.lane)
    si.business_id,
    si.user_id,
    si.content_item_id,
    si.variant_id as primary_variant_id,
    si.lane,
    coalesce(cv.title, nullif(ci.idea_text, ''), 'Scheduled content') as title,
    si.status,
    case
      when si.scheduled_at is not null then si.scheduled_at - interval '5 minutes'
      else null
    end as editable_until,
    si.published_at,
    jsonb_build_object(
      'seededFrom', 'schedule_items',
      'legacyScheduledPostId', si.legacy_scheduled_post_id
    ) as metadata_json
  from schedule_items si
  join content_items ci on ci.id = si.content_item_id
  left join content_variants cv on cv.id = si.variant_id
  where si.distribution_group_id is null
  order by si.content_item_id, si.lane, si.scheduled_at desc nulls last, si.created_at desc
)
insert into content_distribution_groups (
  business_id,
  user_id,
  content_item_id,
  primary_variant_id,
  lane,
  title,
  status,
  editable_until,
  metadata_json,
  published_at
)
select
  sg.business_id,
  sg.user_id,
  sg.content_item_id,
  sg.primary_variant_id,
  sg.lane,
  sg.title,
  sg.status,
  sg.editable_until,
  sg.metadata_json,
  sg.published_at
from seeded_groups sg
where not exists (
  select 1
  from content_distribution_groups cdg
  where cdg.content_item_id = sg.content_item_id
    and cdg.lane = sg.lane
);

update schedule_items si
set distribution_group_id = cdg.id
from content_distribution_groups cdg
where si.content_item_id = cdg.content_item_id
  and si.lane = cdg.lane
  and si.distribution_group_id is null;
