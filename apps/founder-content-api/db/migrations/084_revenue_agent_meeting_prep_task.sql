alter table revenue_agent_tasks
  drop constraint if exists revenue_agent_tasks_task_type_check;

alter table revenue_agent_tasks
  add constraint revenue_agent_tasks_task_type_check
  check (task_type in ('research', 'approve_draft', 'send_email', 'follow_up', 'value_follow_up', 'breakup', 'meeting_prep'));
