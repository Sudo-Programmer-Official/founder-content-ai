create table if not exists user_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light', 'dark', 'focus')),
  font_size text not null default 'medium' check (font_size in ('small', 'medium', 'large')),
  density text not null default 'comfortable' check (density in ('compact', 'comfortable', 'spacious')),
  layout_mode text not null default 'dashboard' check (layout_mode in ('dashboard', 'creator', 'planner')),
  ai_assist_level text not null default 'balanced' check (ai_assist_level in ('off', 'minimal', 'balanced', 'proactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_preferences_theme_idx
  on user_preferences (theme);

create index if not exists user_preferences_layout_mode_idx
  on user_preferences (layout_mode);
