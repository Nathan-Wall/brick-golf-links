create table if not exists groups (
  id bigserial primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_groups_name_unique
  on groups (lower(name));

create table if not exists user_group_memberships (
  group_id bigint not null references groups(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists idx_user_group_memberships_user_id
  on user_group_memberships (user_id);

create table if not exists group_domain_access (
  group_id bigint not null references groups(id) on delete cascade,
  canonical_host text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, canonical_host)
);

create index if not exists idx_group_domain_access_group_id
  on group_domain_access (group_id);
