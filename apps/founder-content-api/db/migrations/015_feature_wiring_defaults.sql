insert into feature_flags (key, description, enabled_globally)
values
  ('content_generation', 'Core idea, hook, and post generation flows', true),
  ('capture_remix', 'Capture, remix, and repurpose flows', true),
  ('visual_generation', 'Brand-aware image generation', true),
  ('scheduler', 'Scheduling and publishing workflows', true),
  ('control_dashboard', 'Mission dashboard and pipeline actions', true),
  ('brand_intelligence', 'Brand profile and brand-aware generation', true),
  ('system_read_only', 'Failsafe mode that blocks writes while allowing reads', false)
on conflict (key) do update
set
  description = excluded.description,
  enabled_globally = excluded.enabled_globally;
