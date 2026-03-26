alter table business_email_settings
  add column if not exists existing_mx_json jsonb not null default '[]'::jsonb;

alter table business_email_settings
  add column if not exists existing_spf_value text;

alter table business_email_settings
  add column if not exists existing_dmarc_value text;

alter table business_email_settings
  add column if not exists recommended_spf_value text;

alter table business_email_settings
  add column if not exists conflict_flags_json jsonb not null default '[]'::jsonb;

create unique index if not exists business_email_settings_domain_name_lower_unique_idx
  on business_email_settings (lower(domain_name))
  where domain_name is not null;
