alter table brand_kits
  add column if not exists accent_style text not null default 'highlight_box'
  check (accent_style in ('highlight_box', 'underline', 'bold'));

alter table brand_kits
  add column if not exists brand_placement text not null default 'top_left'
  check (brand_placement in ('top_left', 'bottom_right', 'side_label'));

create index if not exists brand_kits_accent_style_idx
  on brand_kits (accent_style);

create index if not exists brand_kits_brand_placement_idx
  on brand_kits (brand_placement);
