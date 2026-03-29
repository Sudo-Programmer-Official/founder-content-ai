alter table social_accounts
  drop constraint if exists social_accounts_business_id_platform_key;

alter table social_accounts
  drop constraint if exists social_accounts_business_id_fkey;

alter table social_accounts
  alter column business_id drop not null;

alter table social_accounts
  add constraint social_accounts_business_id_fkey
  foreign key (business_id) references businesses(id) on delete set null;

create table if not exists social_account_identities (
  id uuid primary key default gen_random_uuid(),
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  platform text not null check (platform in ('linkedin')),
  identity_type text not null check (identity_type in ('person', 'organization')),
  platform_identity_id text not null,
  platform_identity_urn text not null,
  display_name text not null,
  avatar_url text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (social_account_id, platform_identity_urn)
);

create index if not exists social_account_identities_account_idx
  on social_account_identities (social_account_id, created_at asc);

create unique index if not exists social_account_identities_platform_identity_idx
  on social_account_identities (platform, platform_identity_urn);

create table if not exists business_social_channels (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  platform text not null check (platform in ('linkedin')),
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  selected_identity_id uuid references social_account_identities(id) on delete set null,
  status text not null default 'connected' check (status in ('connected', 'expired', 'revoked', 'error')),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, platform)
);

create index if not exists business_social_channels_account_idx
  on business_social_channels (social_account_id);

create index if not exists business_social_channels_selected_identity_idx
  on business_social_channels (selected_identity_id);

alter table scheduled_posts
  add column if not exists social_account_identity_id uuid;

alter table scheduled_posts
  drop constraint if exists scheduled_posts_social_account_identity_id_fkey;

alter table scheduled_posts
  add constraint scheduled_posts_social_account_identity_id_fkey
  foreign key (social_account_identity_id) references social_account_identities(id) on delete set null;

create index if not exists scheduled_posts_social_account_identity_id_idx
  on scheduled_posts (social_account_identity_id);

insert into social_account_identities (
  social_account_id,
  platform,
  identity_type,
  platform_identity_id,
  platform_identity_urn,
  display_name,
  avatar_url,
  metadata_json
)
select
  sa.id,
  sa.platform,
  'person',
  sa.platform_user_id,
  sa.platform_user_urn,
  coalesce(
    nullif(sa.metadata_json ->> 'linkedInName', ''),
    nullif(sa.account_email, ''),
    sa.platform_user_id
  ),
  nullif(sa.metadata_json ->> 'pictureUrl', ''),
  jsonb_build_object(
    'seededFrom', 'social_accounts',
    'linkedInName', sa.metadata_json -> 'linkedInName'
  )
from social_accounts sa
where not exists (
  select 1
  from social_account_identities sai
  where sai.social_account_id = sa.id
    and sai.platform_identity_urn = sa.platform_user_urn
);

insert into business_social_channels (
  business_id,
  platform,
  social_account_id,
  selected_identity_id,
  status,
  metadata_json
)
select
  sa.business_id,
  sa.platform,
  sa.id,
  sai.id,
  sa.status,
  jsonb_build_object('migratedFrom', 'social_accounts')
from social_accounts sa
join social_account_identities sai
  on sai.social_account_id = sa.id
 and sai.platform_identity_urn = sa.platform_user_urn
where sa.business_id is not null
on conflict (business_id, platform)
do update set
  social_account_id = excluded.social_account_id,
  selected_identity_id = coalesce(business_social_channels.selected_identity_id, excluded.selected_identity_id),
  status = excluded.status,
  updated_at = now();

update scheduled_posts sp
set social_account_identity_id = bsc.selected_identity_id
from business_social_channels bsc
where sp.business_id = bsc.business_id
  and sp.platform = bsc.platform
  and sp.social_account_identity_id is null
  and bsc.selected_identity_id is not null;
