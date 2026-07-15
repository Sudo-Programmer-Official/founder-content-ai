alter table prospects
  add column if not exists decision_maker_confidence integer not null default 0 check (decision_maker_confidence >= 0 and decision_maker_confidence <= 100),
  add column if not exists website_quality_score integer not null default 0 check (website_quality_score >= 0 and website_quality_score <= 100),
  add column if not exists reachability_score integer not null default 0 check (reachability_score >= 0 and reachability_score <= 100),
  add column if not exists reachability_reasons_json jsonb not null default '[]'::jsonb,
  add column if not exists ai_recommendation text not null default '',
  add column if not exists reachability_updated_at timestamptz;
