alter table links
  add column if not exists expires_at timestamptz;
