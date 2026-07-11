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
      'draft_created',
      'draft_approved',
      'reply_received',
      'reply_analyzed',
      'meeting_booked',
      'meeting_prep_created',
      'not_interested'
    )
  );
