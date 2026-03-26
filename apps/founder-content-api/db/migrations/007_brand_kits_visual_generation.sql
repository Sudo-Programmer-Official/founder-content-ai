create extension if not exists pgcrypto;

create table if not exists brand_kits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  primary_color text not null default '#111827',
  secondary_color text not null default '#F8FAFC',
  background_style text not null default 'dark' check (background_style in ('dark', 'light', 'gradient')),
  font_style text not null default 'bold' check (font_style in ('modern', 'bold', 'elegant')),
  visual_style text not null default 'minimal' check (visual_style in ('minimal', 'luxury', 'playful')),
  tone text not null default 'professional' check (tone in ('professional', 'bold', 'friendly')),
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brand_kits_business_id_idx on brand_kits (business_id);
create index if not exists brand_kits_visual_style_idx on brand_kits (visual_style);
create index if not exists brand_kits_background_style_idx on brand_kits (background_style);
