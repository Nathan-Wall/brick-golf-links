alter table links
add column if not exists remember_password_access boolean not null default true;
