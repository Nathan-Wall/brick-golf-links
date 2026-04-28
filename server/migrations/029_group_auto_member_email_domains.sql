create table if not exists group_auto_member_email_domains (
  group_id bigint not null references groups(id) on delete cascade,
  email_domain text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, email_domain)
);

create index if not exists idx_group_auto_member_email_domains_email_domain
  on group_auto_member_email_domains (email_domain);
