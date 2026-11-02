-- La app no usa autenticación: el sitio es público y las tablas se acceden con la clave anon.
-- Cualquier visitante puede consultar las tablas y registrar participantes y resultados.
-- Los resultados finalizados no tienen políticas públicas de edición ni eliminación.
-- No uses una clave service_role en el navegador ni en las variables expuestas.

create table if not exists public.players (
    id text primary key,
    name text not null,
    created_at timestamptz not null default now()
);

create table if not exists public.finished_tournaments (
    id text primary key,
    name text not null,
    finished_at timestamptz not null default now(),
    participants jsonb not null default '[]'::jsonb,
    standings jsonb not null default '[]'::jsonb,
    matches jsonb not null default '[]'::jsonb,
    tournament_format text not null default 'random',
    swiss_byes jsonb not null default '[]'::jsonb,
    winner text,
    podium jsonb not null default '{}'::jsonb
);

alter table public.players enable row level security;
alter table public.finished_tournaments enable row level security;

drop policy if exists "Public can read players" on public.players;
create policy "Public can read players" on public.players for select to anon using (true);
drop policy if exists "Public can add players" on public.players;
create policy "Public can add players" on public.players for insert to anon with check (true);
drop policy if exists "Public can update players" on public.players;
create policy "Public can update players" on public.players for update to anon using (true) with check (true);

drop policy if exists "Public can read finished tournaments" on public.finished_tournaments;
create policy "Public can read finished tournaments" on public.finished_tournaments for select to anon using (true);
drop policy if exists "Public can save finished tournaments" on public.finished_tournaments;
create policy "Public can save finished tournaments" on public.finished_tournaments for insert to anon with check (true);
grant select, insert, update on public.players to anon;
grant select, insert on public.finished_tournaments to anon;
