alter table idea_inbox_items
  add column if not exists input_type text not null default 'text',
  add column if not exists raw_input text,
  add column if not exists processed_text text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

update idea_inbox_items
set
  input_type = coalesce(nullif(input_type, ''), 'text'),
  raw_input = coalesce(raw_input, body),
  processed_text = coalesce(processed_text, body),
  source_metadata = coalesce(source_metadata, '{}'::jsonb)
where true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'idea_inbox_items_input_type_check'
  ) then
    alter table idea_inbox_items
      add constraint idea_inbox_items_input_type_check
      check (input_type in ('text', 'voice', 'image', 'link'));
  end if;
end $$;

create index if not exists idea_inbox_items_input_type_idx
  on idea_inbox_items (input_type, created_at desc);
