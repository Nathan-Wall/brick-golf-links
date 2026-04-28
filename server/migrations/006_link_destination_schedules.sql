alter table links
  add column if not exists schedule_timezone text not null default 'UTC';

create table if not exists link_destination_schedules (
  id bigserial primary key,
  link_id bigint not null references links(id) on delete cascade,
  start_minute integer not null check (start_minute >= 0 and start_minute < 1440),
  end_minute integer not null check (end_minute > start_minute and end_minute <= 1440),
  destination_url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_link_destination_schedules_lookup
  on link_destination_schedules (link_id, start_minute, end_minute);
