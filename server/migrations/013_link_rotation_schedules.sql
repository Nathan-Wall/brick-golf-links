alter table links
  add column if not exists schedule_mode text not null default 'windows';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'links_schedule_mode_check'
  ) then
    alter table links
      add constraint links_schedule_mode_check
      check (schedule_mode in ('windows', 'rotation'));
  end if;
end $$;

create table if not exists link_rotation_schedules (
  link_id bigint primary key references links(id) on delete cascade,
  interval_minutes integer not null check (interval_minutes > 0 and interval_minutes <= 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists link_rotation_schedule_destinations (
  id bigserial primary key,
  link_id bigint not null references links(id) on delete cascade,
  destination_url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_link_rotation_schedule_destinations_lookup
  on link_rotation_schedule_destinations (link_id, sort_order, id);
