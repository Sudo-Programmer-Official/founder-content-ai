alter table scheduled_posts
  add column if not exists audience_timezone text;

update scheduled_posts sp
set audience_timezone = b.timezone
from businesses b
where sp.business_id = b.id
  and (sp.audience_timezone is null or btrim(sp.audience_timezone) = '');

update scheduled_posts
set audience_timezone = 'UTC'
where audience_timezone is null or btrim(audience_timezone) = '';

alter table scheduled_posts
  alter column audience_timezone set not null;

alter table scheduled_posts
  alter column audience_timezone set default 'UTC';

create index if not exists scheduled_posts_audience_timezone_idx
  on scheduled_posts (audience_timezone);
