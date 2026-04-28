alter table links
  add column if not exists usage_count integer not null default 0;
