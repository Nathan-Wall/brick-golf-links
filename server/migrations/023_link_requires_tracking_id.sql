alter table links
  add column if not exists requires_tracking_id boolean not null default false;
