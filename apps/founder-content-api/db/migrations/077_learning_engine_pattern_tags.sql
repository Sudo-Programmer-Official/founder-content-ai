alter table workspace_content_pattern_rollups
  drop constraint if exists workspace_content_pattern_rollups_pattern_type_check;

alter table workspace_content_pattern_rollups
  add constraint workspace_content_pattern_rollups_pattern_type_check
  check (pattern_type in ('angle', 'format', 'send_window', 'tag'));
