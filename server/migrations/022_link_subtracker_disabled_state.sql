alter table link_subtrackers
  add column if not exists is_disabled boolean not null default false;
