-- Per-IP request counters for /api/chat. Keys are salted hashes, never raw addresses.
create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);
