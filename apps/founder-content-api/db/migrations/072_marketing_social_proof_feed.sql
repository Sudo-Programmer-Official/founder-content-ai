create table if not exists marketing_social_proof_feed (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  source_scheduled_post_id uuid references scheduled_posts(id) on delete set null,
  platform text not null check (platform in ('linkedin', 'facebook', 'instagram')),
  external_post_id text,
  external_post_url text not null,
  author_display_name text not null,
  author_avatar_url text,
  workspace_brand_name text not null,
  workspace_website_url text,
  caption_preview text not null,
  media_type text not null check (media_type in ('text', 'image', 'video', 'carousel')),
  thumbnail_url text,
  is_featured boolean not null default false,
  featured_rank integer,
  is_public_marketing_safe boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz not null
);

create unique index if not exists marketing_social_proof_feed_platform_url_idx
  on marketing_social_proof_feed (platform, external_post_url);

create index if not exists marketing_social_proof_feed_public_idx
  on marketing_social_proof_feed (is_public_marketing_safe, is_featured, published_at desc);

create index if not exists marketing_social_proof_feed_business_idx
  on marketing_social_proof_feed (business_id, published_at desc);

