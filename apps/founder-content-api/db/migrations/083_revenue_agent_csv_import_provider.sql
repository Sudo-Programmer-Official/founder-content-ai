alter table lead_sources
  drop constraint if exists lead_sources_provider_check;

alter table lead_sources
  add constraint lead_sources_provider_check
  check (provider in ('google_business', 'mock', 'csv_import'));

alter table revenue_agent_agent_runs
  drop constraint if exists revenue_agent_agent_runs_provider_check;

alter table revenue_agent_agent_runs
  add constraint revenue_agent_agent_runs_provider_check
  check (provider in ('google_business', 'mock', 'csv_import'));
