create table if not exists global_media_generation_settings (
  id boolean primary key default true,
  image_quality text not null default 'medium',
  tech_meme_panel_count integer not null default 1,
  comic_strip_panel_count integer not null default 3,
  cartoon_explainer_panel_count integer not null default 3,
  founder_doodle_panel_count integer not null default 3,
  minimal_infographic_panel_count integer not null default 3,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint global_media_generation_settings_singleton check (id),
  constraint global_media_generation_settings_image_quality_check
    check (image_quality in ('low', 'medium', 'high', 'auto')),
  constraint global_media_generation_settings_panel_counts_check
    check (
      tech_meme_panel_count in (1, 3, 5)
      and comic_strip_panel_count in (1, 3, 5)
      and cartoon_explainer_panel_count in (1, 3, 5)
      and founder_doodle_panel_count in (1, 3, 5)
      and minimal_infographic_panel_count in (1, 3, 5)
    )
);

insert into global_media_generation_settings (id)
values (true)
on conflict (id) do nothing;
