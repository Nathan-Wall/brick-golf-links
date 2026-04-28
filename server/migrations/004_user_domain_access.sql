create table if not exists user_domain_access (
  user_id bigint not null references users(id) on delete cascade,
  canonical_host text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, canonical_host)
);

create index if not exists idx_user_domain_access_user_id
  on user_domain_access (user_id);
