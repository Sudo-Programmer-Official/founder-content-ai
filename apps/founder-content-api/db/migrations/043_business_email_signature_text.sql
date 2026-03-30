alter table business_email_settings
  add column if not exists signature_text text;
