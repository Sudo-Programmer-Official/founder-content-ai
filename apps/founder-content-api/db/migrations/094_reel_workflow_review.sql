alter table reel_projects
  add column if not exists workflow_stage text not null default 'script_draft',
  add column if not exists approval_note text,
  add column if not exists reviewed_note text,
  add column if not exists approved_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists published_at timestamptz;

alter table reel_projects
  drop constraint if exists reel_projects_workflow_stage_check;

alter table reel_projects
  add constraint reel_projects_workflow_stage_check
  check (workflow_stage in ('script_draft', 'approved', 'rendered', 'reviewed', 'published'));

create index if not exists reel_projects_business_workflow_stage_idx
  on reel_projects (business_id, workflow_stage, updated_at desc);

create table if not exists reel_project_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references reel_projects(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  created_by_user_id uuid references users(id) on delete set null,
  revision_number integer not null check (revision_number > 0),
  revision_type text not null check (revision_type in ('generated', 'edited', 'scene_regenerated', 'approved', 'reviewed')),
  storyboard_json jsonb not null,
  settings_json jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  unique (project_id, revision_number)
);

create index if not exists reel_project_revisions_project_created_idx
  on reel_project_revisions (project_id, created_at desc);
