create table if not exists domains (
  canonical_host text primary key,
  label text not null,
  is_default_for_new_accounts boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists domain_aliases (
  alias_host text primary key,
  canonical_host text not null references domains(canonical_host) on delete cascade,
  created_at timestamptz not null default now()
);

delete from user_domain_access
where canonical_host not in (select canonical_host from domains);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_domain_access_canonical_host_fkey'
  ) then
    alter table user_domain_access
      add constraint user_domain_access_canonical_host_fkey
      foreign key (canonical_host) references domains(canonical_host) on delete cascade;
  end if;
end $$;
