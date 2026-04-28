alter table links
  add column if not exists password_hash text;
