alter table social_accounts
  drop constraint if exists social_accounts_platform_check;

alter table social_accounts
  add constraint social_accounts_platform_check
  check (platform in ('linkedin', 'facebook'));

alter table social_account_identities
  drop constraint if exists social_account_identities_platform_check;

alter table social_account_identities
  add constraint social_account_identities_platform_check
  check (platform in ('linkedin', 'facebook', 'instagram'));

alter table social_account_identities
  drop constraint if exists social_account_identities_identity_type_check;

alter table social_account_identities
  add constraint social_account_identities_identity_type_check
  check (identity_type in ('person', 'organization', 'page'));

alter table business_social_channels
  drop constraint if exists business_social_channels_platform_check;

alter table business_social_channels
  add constraint business_social_channels_platform_check
  check (platform in ('linkedin', 'facebook'));

alter table scheduled_posts
  drop constraint if exists scheduled_posts_platform_check;

alter table scheduled_posts
  add constraint scheduled_posts_platform_check
  check (platform in ('linkedin', 'facebook', 'instagram'));
