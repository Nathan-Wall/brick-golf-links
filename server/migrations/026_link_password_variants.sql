create table if not exists link_passwords (
  id bigserial primary key,
  link_id bigint not null references links(id) on delete cascade,
  name text not null,
  password text not null,
  is_disabled boolean not null default false,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (link_id, password)
);
