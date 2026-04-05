do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'welcome_email_sent_at'
  ) then
    alter table users
      add column welcome_email_sent_at timestamptz;

    update users
    set welcome_email_sent_at = created_at
    where welcome_email_sent_at is null;
  end if;
end $$;
