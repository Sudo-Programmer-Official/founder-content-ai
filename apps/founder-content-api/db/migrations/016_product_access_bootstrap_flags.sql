insert into feature_flags (key, description, enabled_globally)
values
  ('outreach', 'Outreach workspace and operator workflows', true),
  ('email_campaigns', 'Email campaign creation and sending', false)
on conflict (key) do update
set
  description = excluded.description,
  enabled_globally = excluded.enabled_globally;
