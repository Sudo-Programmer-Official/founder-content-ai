update prospects
set opportunity_score = least(greatest(opportunity_score, 0), 100)
where opportunity_score is not null;

update prospect_research
set opportunity_score = least(greatest(opportunity_score, 0), 100)
where opportunity_score is not null;

alter table prospects
  drop constraint if exists prospects_opportunity_score_check;

alter table prospects
  add constraint prospects_opportunity_score_check
  check (opportunity_score >= 0 and opportunity_score <= 100);

alter table prospect_research
  drop constraint if exists prospect_research_opportunity_score_check;

alter table prospect_research
  add constraint prospect_research_opportunity_score_check
  check (opportunity_score >= 0 and opportunity_score <= 100);
