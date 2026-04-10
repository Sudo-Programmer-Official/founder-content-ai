create table if not exists marketing_assistant_inquiries (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  company_name text,
  message text not null,
  topic text not null default 'other'
    check (topic in ('social_media_automation', 'founder_brand_system', 'growth_automation', 'service_fit', 'other')),
  selected_prompt text,
  page_url text,
  client_ip text,
  user_agent text,
  owner_email text not null,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists marketing_assistant_inquiries_created_idx
  on marketing_assistant_inquiries (created_at desc);

create index if not exists marketing_assistant_inquiries_email_idx
  on marketing_assistant_inquiries (lower(email), created_at desc);

create index if not exists marketing_assistant_inquiries_topic_idx
  on marketing_assistant_inquiries (topic, created_at desc);
