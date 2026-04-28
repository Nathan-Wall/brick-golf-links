create table if not exists group_domain_admin_access (
  group_id bigint not null references groups(id) on delete cascade,
  host text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, host)
);

create index if not exists idx_group_domain_admin_access_group_id
  on group_domain_admin_access (group_id);
