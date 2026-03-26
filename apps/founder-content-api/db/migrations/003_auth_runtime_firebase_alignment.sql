do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_name = 'users'
      and column_name = 'cognito_sub'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_name = 'users'
      and column_name = 'auth_subject'
  ) then
    alter table users rename column cognito_sub to auth_subject;
  end if;
end $$;

alter table auth_identities
  drop constraint if exists auth_identities_provider_check;

alter table auth_identities
  add constraint auth_identities_provider_check
  check (provider in ('firebase', 'firebase_password', 'google', 'otp_email'));
