alter table brand_profiles
  add column if not exists linkedin_url text;

alter table brand_profiles
  add column if not exists instagram_url text;

alter table brand_profiles
  add column if not exists facebook_url text;

alter table brand_profiles
  add column if not exists website_url text;
