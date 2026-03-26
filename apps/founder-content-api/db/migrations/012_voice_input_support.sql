do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'content_generation_logs_input_type_check'
  ) then
    alter table content_generation_logs
      drop constraint content_generation_logs_input_type_check;
  end if;
end $$;

alter table content_generation_logs
  add constraint content_generation_logs_input_type_check
  check (input_type in ('idea', 'link', 'upload', 'voice'));
