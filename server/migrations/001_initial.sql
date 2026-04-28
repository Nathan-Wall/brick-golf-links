create extension if not exists citext;

create table if not exists users (
  id bigserial primary key,
  email citext not null unique,
  name text not null,
  picture_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists links (
  id bigserial primary key,
  slug citext not null,
  canonical_host text not null,
  destination_url text not null,
  description text,
  internal_only boolean not null default false,
  created_by_user_id bigint not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (canonical_host, slug)
);

create index if not exists idx_links_lookup on links (canonical_host, slug);
