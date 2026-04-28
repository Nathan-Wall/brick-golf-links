create extension if not exists pgcrypto;

create or replace function generate_link_public_id(size integer default 16)
returns text
language plpgsql
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
  alphabet_length constant integer := length(alphabet);
  bytes bytea := gen_random_bytes(size);
  output text := '';
  byte_index integer;
begin
  if size < 1 then
    raise exception 'Link public id size must be positive.';
  end if;

  for byte_index in 0..size - 1 loop
    output := output || substr(alphabet, (get_byte(bytes, byte_index) % alphabet_length) + 1, 1);
  end loop;

  return output;
end;
$$;

alter table links
  add column if not exists public_id text;

update links
set public_id = generate_link_public_id()
where public_id is null;

create unique index if not exists idx_links_public_id on links (public_id);

alter table links
  alter column public_id set not null;
