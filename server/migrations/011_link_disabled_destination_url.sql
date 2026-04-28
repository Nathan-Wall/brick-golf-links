alter table links
  add column if not exists disabled_destination_url text;
