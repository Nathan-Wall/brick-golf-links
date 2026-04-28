create table if not exists registration_invites (
  id bigserial primary key,
  token text not null,
  group_id bigint references groups(id) on delete set null,
  created_by_user_id bigint references users(id) on delete set null,
  used_by_user_id bigint references users(id) on delete set null,
  used_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  used_at timestamptz
);

create unique index if not exists idx_registration_invites_token_unique
  on registration_invites (token);

create index if not exists idx_registration_invites_group_id
  on registration_invites (group_id);

create index if not exists idx_registration_invites_used_at
  on registration_invites (used_at);
