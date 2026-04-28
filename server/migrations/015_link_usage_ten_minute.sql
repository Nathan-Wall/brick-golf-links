create table if not exists link_usage_ten_minute (
  link_id bigint not null references links(id) on delete cascade,
  bucket_start timestamptz not null,
  usage_count integer not null default 0,
  primary key (link_id, bucket_start)
);

create index if not exists idx_link_usage_ten_minute_bucket_start
  on link_usage_ten_minute (bucket_start);
