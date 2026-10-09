-- Procurement notices read from the public PhilGEPS listing. Kept apart from the legal corpus: never embedded,
-- never retrieved by chat. Personal details on the notice (contact person, creator) are not stored.
create table if not exists notices (
  ref_no text primary key,
  title text not null,
  procuring_entity text not null,
  area_of_delivery text,
  category text not null,            -- Goods | Infrastructure | Consulting
  business_category text,
  mode text not null,                -- as written on PhilGEPS
  abc numeric,
  published_at date not null,
  closing_at timestamptz not null,
  status text not null,
  source_url text not null,          -- original posting
  fetched_at timestamptz not null,
  raw_hash text not null
);
create index if not exists notices_published_idx on notices (published_at desc);

create table if not exists notice_syncs (
  id bigserial primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  ok boolean not null default false,
  pages_read int not null default 0,
  notices_seen int not null default 0,
  notices_saved int not null default 0,
  notices_pruned int not null default 0,
  error text
);
