alter table prospects
  add column if not exists last_contact_enriched_at timestamptz;

alter table prospect_contacts
  add column if not exists contact_confidence integer not null default 0 check (contact_confidence >= 0 and contact_confidence <= 100),
  add column if not exists last_enriched_at timestamptz;

alter table revenue_agent_email_events
  drop constraint if exists revenue_agent_email_events_event_type_check;

alter table revenue_agent_email_events
  add constraint revenue_agent_email_events_event_type_check
  check (
    event_type in (
      'queued',
      'approved',
      'sent',
      'delivered',
      'open',
      'bounce',
      'complaint',
      'unsubscribe',
      'failed',
      'follow_up_scheduled',
      'lead_discovered',
      'research_generated',
      'contact_enrichment_started',
      'contact_match_found',
      'contact_verified',
      'contact_primary_selected',
      'contact_enrichment_skipped',
      'draft_created',
      'draft_approved',
      'reply_received',
      'reply_analyzed',
      'meeting_booked',
      'meeting_prep_created',
      'not_interested'
    )
  );
