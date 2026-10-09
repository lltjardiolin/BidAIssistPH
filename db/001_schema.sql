create extension if not exists vector;

create table if not exists documents (
  id text primary key,
  reference text not null,
  title text not null,
  doc_type text not null,
  framework text not null,
  status text not null,
  authority_level int not null,
  issuing_body text not null,
  date_approved date, date_published date, date_filed date,
  effective_date date, withdrawn_date date, expires_at date,
  withdrawn_by text references documents(id) deferrable initially deferred,
  superseded_by text references documents(id) deferrable initially deferred,
  counterpart text references documents(id) deferrable initially deferred,
  parent_id text references documents(id) deferrable initially deferred,
  index_default boolean not null default true,
  ingest boolean not null default true,
  source_url text,                   -- null allowed only when ingest = false
  verification text,
  status_snapshot jsonb
);

create table if not exists document_aliases (
  alias text primary key,
  document_id text not null references documents(id)
);

create table if not exists document_versions (
  id bigserial primary key,
  document_id text not null references documents(id),
  source_url text not null,
  local_path text not null,
  sha256 text not null,
  retrieved_at timestamptz not null,
  content_type text,
  bytes bigint,
  verified_for_ingest boolean not null default false,
  unique(document_id, sha256)
);

-- IMPORTANT: replace 1536 with the exact configured embedding dimension before migration.
create table if not exists chunks (
  id text primary key,
  document_id text not null references documents(id),
  document_version_id bigint references document_versions(id),
  context_header text not null,
  text text not null,
  page int, section text, subsection text, heading text,
  framework text not null, status text not null, authority_level int not null,
  doc_type text not null, index_default boolean not null,
  reference_tokens text[] not null default '{}',
  tsv tsvector generated always as (to_tsvector('simple', context_header || ' ' || text)) stored,
  embedding vector(1536)
);

create index if not exists chunks_tsv_idx on chunks using gin (tsv);
create index if not exists chunks_ref_tokens_idx on chunks using gin (reference_tokens);
create index if not exists chunks_meta_idx on chunks (status, framework, doc_type, index_default);
-- Create HNSW only after confirming embedding dimension/provider compatibility.

-- Records which embedding model built the index. Changing it requires a full re-embed.
create table if not exists corpus_releases (
  corpus_version text primary key,
  embedding_model text not null,
  embedding_dimensions int not null,
  lock_sha256 text not null,            -- sha256 of manifest.lock.json used for this release
  created_at timestamptz not null default now()
);

-- Load documents inside ONE transaction: self-references (e.g. withdrawn IRR -> Adv. 09-2026)
-- are deferred, so manifest order does not matter.
