alter table users
  add column if not exists default_schedule_timezone text not null default 'America/Chicago';
