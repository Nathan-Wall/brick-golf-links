create table if not exists link_subtrackers (
  id bigserial primary key,
  link_id bigint not null references links(id) on delete cascade,
  name text not null,
  tracking_id text not null,
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (link_id, tracking_id)
);
