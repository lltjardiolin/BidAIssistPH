-- Supabase exposes the public schema through its REST API to the anon and authenticated roles. The app never uses
-- that API: it connects as postgres, which owns these tables and bypasses RLS. Enabling RLS with no policies closes
-- the API to anon/authenticated without changing anything the app does.
alter table chunks enable row level security;
alter table corpus_releases enable row level security;
alter table document_aliases enable row level security;
alter table document_versions enable row level security;
alter table documents enable row level security;
alter table notice_syncs enable row level security;
alter table notices enable row level security;
alter table rate_limits enable row level security;
