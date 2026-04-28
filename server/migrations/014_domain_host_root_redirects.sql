create table if not exists domain_host_settings (
  host text primary key,
  root_redirect_slug text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into domain_host_settings (host, root_redirect_slug)
select canonical_host, 'admin'
from domains
on conflict (host) do nothing;

insert into domain_host_settings (host, root_redirect_slug)
select alias_host, 'admin'
from domain_aliases
on conflict (host) do nothing;
