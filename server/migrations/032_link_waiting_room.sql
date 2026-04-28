alter table links
  add column if not exists waiting_room_enabled boolean not null default false;
