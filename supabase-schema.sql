create table if not exists public.league_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.league_state enable row level security;

drop policy if exists "Anyone can read league state" on public.league_state;
create policy "Anyone can read league state"
on public.league_state
for select
to anon
using (true);

drop policy if exists "Anyone can update league state" on public.league_state;
create policy "Anyone can update league state"
on public.league_state
for all
to anon
using (true)
with check (true);
