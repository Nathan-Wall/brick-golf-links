alter table users
  add column if not exists link_variables jsonb not null default '{}'::jsonb;
