create table if not exists business_media_profiles (
  business_id uuid primary key references businesses(id) on delete cascade,
  business_type text not null default 'general'
    check (business_type in ('general', 'saas', 'daycare', 'fitness')),
  prefer_existing_assets boolean not null default true,
  prefer_text_visuals boolean not null default false,
  allow_generated_illustrations boolean not null default true,
  avoid_realistic_people boolean not null default true,
  allow_screenshot_highlights boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into business_media_profiles (
  business_id,
  business_type,
  prefer_existing_assets,
  prefer_text_visuals,
  allow_generated_illustrations,
  avoid_realistic_people,
  allow_screenshot_highlights
)
select
  businesses.id,
  case
    when lower(coalesce(businesses.niche, '')) like '%daycare%'
      or lower(coalesce(businesses.niche, '')) like '%child%'
      or lower(coalesce(businesses.niche, '')) like '%kids%'
      then 'daycare'
    when lower(coalesce(businesses.niche, '')) like '%fitness%'
      or lower(coalesce(businesses.niche, '')) like '%gym%'
      then 'fitness'
    when lower(coalesce(businesses.niche, '')) like '%saas%'
      or lower(coalesce(businesses.niche, '')) like '%software%'
      or lower(coalesce(businesses.niche, '')) like '%startup%'
      or lower(coalesce(businesses.niche, '')) like '%ai%'
      then 'saas'
    else 'general'
  end,
  true,
  false,
  true,
  true,
  true
from businesses
on conflict (business_id) do nothing;
