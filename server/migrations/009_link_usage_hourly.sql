create table if not exists link_usage_hourly (
  link_id bigint not null references links(id) on delete cascade,
  hour_start timestamptz not null,
  usage_count integer not null default 0,
  primary key (link_id, hour_start)
);

create index if not exists idx_link_usage_hourly_hour_start
  on link_usage_hourly (hour_start);
