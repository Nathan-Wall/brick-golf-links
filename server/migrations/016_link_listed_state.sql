alter table links
  add column if not exists is_listed boolean not null default false;
