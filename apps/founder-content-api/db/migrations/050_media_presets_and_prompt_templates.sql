create table if not exists media_presets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  supported_business_types jsonb not null default '[]'::jsonb,
  supported_content_types jsonb not null default '[]'::jsonb,
  supported_goals jsonb not null default '[]'::jsonb,
  media_types jsonb not null default '[]'::jsonb,
  fallback_order jsonb not null default '[]'::jsonb,
  ui_label text,
  priority int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists prompt_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category text not null,
  template_body text not null,
  variables jsonb not null default '[]'::jsonb,
  notes text,
  version int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists media_preset_prompt_map (
  id uuid primary key default gen_random_uuid(),
  media_preset_id uuid not null references media_presets(id) on delete cascade,
  media_type text not null,
  prompt_template_id uuid not null references prompt_templates(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (media_preset_id, media_type)
);

create table if not exists decision_rules (
  id uuid primary key default gen_random_uuid(),
  rule_name text not null,
  rule_scope text not null default 'global'
    check (rule_scope in ('global', 'business_type', 'workspace')),
  business_type text
    check (business_type in ('general', 'saas', 'daycare', 'fitness')),
  business_id uuid references businesses(id) on delete cascade,
  conditions jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '{}'::jsonb,
  priority int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_media_overrides (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  media_preset_id uuid not null references media_presets(id) on delete cascade,
  is_enabled boolean not null default true,
  custom_prompt_template_id uuid references prompt_templates(id) on delete set null,
  custom_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, media_preset_id)
);

insert into prompt_templates (slug, name, category, template_body, variables, notes)
values
  (
    'media.quote_card.default',
    'Quote card default',
    'media',
    'Create a bold quote-card visual using the supplied headline and short supporting text. Keep it text-led, brand-safe, and minimal.',
    '["headline","supportingText","brandTone","brandColors","businessType"]'::jsonb,
    'Safe text-first quote card prompt.'
  ),
  (
    'media.stat_card.default',
    'Stat card default',
    'media',
    'Create a stat-card visual that highlights one clear number or punchy claim. Avoid fake dashboards and keep the layout clean.',
    '["headline","supportingText","brandTone","brandColors","businessType"]'::jsonb,
    'Used for stat and proof-led visuals.'
  ),
  (
    'media.framework_card.default',
    'Framework card default',
    'media',
    'Create a framework-card visual with a strong headline and up to three bullets. Keep the structure easy to scan on mobile.',
    '["headline","supportingText","bulletPoints","brandTone","brandColors","businessType"]'::jsonb,
    'Used for structured tactical graphics.'
  )
on conflict (slug) do update
set
  name = excluded.name,
  category = excluded.category,
  template_body = excluded.template_body,
  variables = excluded.variables,
  notes = excluded.notes,
  updated_at = now();

insert into media_presets (
  slug,
  name,
  description,
  supported_business_types,
  supported_content_types,
  supported_goals,
  media_types,
  fallback_order,
  ui_label,
  priority,
  is_active
)
values
  (
    'saas-authority',
    'SaaS authority pack',
    'Text-led visual defaults for SaaS authority and product education.',
    '["saas","general"]'::jsonb,
    '["post","email"]'::jsonb,
    '["authority","engagement"]'::jsonb,
    '["quote_card","framework_card","stat_card","screenshot_highlight"]'::jsonb,
    '["quote_card","framework_card","stat_card"]'::jsonb,
    'SaaS',
    20,
    true
  ),
  (
    'daycare-trust',
    'Daycare trust pack',
    'Safe, trust-building visuals that avoid realistic generated family imagery.',
    '["daycare"]'::jsonb,
    '["post","email"]'::jsonb,
    '["authority","conversion"]'::jsonb,
    '["quote_card","framework_card","screenshot_highlight"]'::jsonb,
    '["quote_card","framework_card"]'::jsonb,
    'Daycare',
    30,
    true
  ),
  (
    'fitness-momentum',
    'Fitness momentum pack',
    'Motivational visual defaults for fitness, coaching, and challenge-driven content.',
    '["fitness","general"]'::jsonb,
    '["post","email"]'::jsonb,
    '["engagement","conversion"]'::jsonb,
    '["quote_card","stat_card","photo_overlay"]'::jsonb,
    '["quote_card","stat_card"]'::jsonb,
    'Fitness',
    25,
    true
  )
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  supported_business_types = excluded.supported_business_types,
  supported_content_types = excluded.supported_content_types,
  supported_goals = excluded.supported_goals,
  media_types = excluded.media_types,
  fallback_order = excluded.fallback_order,
  ui_label = excluded.ui_label,
  priority = excluded.priority,
  is_active = excluded.is_active,
  updated_at = now();

insert into media_preset_prompt_map (media_preset_id, media_type, prompt_template_id)
select
  media_presets.id,
  media_type_map.media_type,
  prompt_templates.id
from media_presets
join (
  values
    ('quote_card', 'media.quote_card.default'),
    ('stat_card', 'media.stat_card.default'),
    ('framework_card', 'media.framework_card.default')
) as media_type_map(media_type, prompt_slug)
  on media_type_map.media_type = any (
    select jsonb_array_elements_text(media_presets.media_types)
  )
join prompt_templates
  on prompt_templates.slug = media_type_map.prompt_slug
on conflict (media_preset_id, media_type) do nothing;

insert into decision_rules (
  rule_name,
  rule_scope,
  business_type,
  conditions,
  outputs,
  priority,
  is_active
)
values
  (
    'prefer_existing_assets_when_available',
    'global',
    null,
    '{"hasUploadedAssets": true}'::jsonb,
    '{"recommendedAction": "use_existing_asset"}'::jsonb,
    10,
    true
  ),
  (
    'daycare_avoids_realistic_generated_people',
    'business_type',
    'daycare',
    '{"businessType": "daycare"}'::jsonb,
    '{"disallowedMediaTypes": ["photo_overlay"], "recommendedMediaTypes": ["quote_card", "framework_card"]}'::jsonb,
    20,
    true
  ),
  (
    'saas_prefers_text_visuals_without_assets',
    'business_type',
    'saas',
    '{"businessType": "saas", "hasUploadedAssets": false}'::jsonb,
    '{"recommendedMediaTypes": ["quote_card", "framework_card", "stat_card"]}'::jsonb,
    30,
    true
  ),
  (
    'fitness_can_use_photo_overlay_with_assets',
    'business_type',
    'fitness',
    '{"businessType": "fitness", "hasUploadedAssets": true}'::jsonb,
    '{"recommendedMediaTypes": ["photo_overlay", "stat_card", "quote_card"]}'::jsonb,
    40,
    true
  )
on conflict do nothing;
