alter table jobs
  drop constraint if exists jobs_type_check;

alter table jobs
  add constraint jobs_type_check
  check (
    type in (
      'email_contact_import',
      'email_campaign_send',
      'post_publish',
      'growth_automation',
      'deliverability_rollup',
      'idea_process',
      'post_metrics_collect',
      'analytics_rollup',
      'report_digest',
      'competitor_pattern_extract',
      'knowledge_process'
    )
  );
