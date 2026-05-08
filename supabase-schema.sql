-- Pool League schema
-- Run this in Supabase SQL Editor. Safe to re-run.

create table if not exists public.league_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.league_state enable row level security;

-- Remove any older permissive policies from earlier setups.
drop policy if exists "Anyone can read league state" on public.league_state;
drop policy if exists "Anyone can update league state" on public.league_state;

-- Signed-in users (anyone with a Supabase auth session) can read.
drop policy if exists "Signed-in users can read league state" on public.league_state;
create policy "Signed-in users can read league state"
on public.league_state
for select
to authenticated
using (true);

-- Signed-in users can insert / update / delete the shared league row.
drop policy if exists "Signed-in users can write league state" on public.league_state;
create policy "Signed-in users can write league state"
on public.league_state
for all
to authenticated
using (true)
with check (true);

-- Enable Realtime so other devices see live updates.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_state'
  ) then
    alter publication supabase_realtime add table public.league_state;
  end if;
end $$;
