create table if not exists email_sign_in_codes (
  id bigserial primary key,
  email citext not null,
  code_hash text not null,
  requested_ip text,
  failed_attempt_count integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_sign_in_codes_email_created_at
  on email_sign_in_codes (email, created_at desc);

create index if not exists idx_email_sign_in_codes_requested_ip_created_at
  on email_sign_in_codes (requested_ip, created_at desc);
