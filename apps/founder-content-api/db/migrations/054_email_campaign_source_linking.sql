alter table email_campaigns
  add column if not exists source_asset_id uuid references content_assets(id) on delete set null;

alter table email_campaigns
  add column if not exists source_idea_id uuid references idea_inbox_items(id) on delete set null;

alter table email_campaigns
  add column if not exists source_title text;

create index if not exists email_campaigns_source_asset_id_idx
  on email_campaigns (source_asset_id);

create index if not exists email_campaigns_source_idea_id_idx
  on email_campaigns (source_idea_id);
