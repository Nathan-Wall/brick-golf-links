alter table domain_host_settings
add column if not exists auth_provider_host text null;

update domain_host_settings
set auth_provider_host = null
where auth_provider_host = host;
