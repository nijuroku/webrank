create table if not exists public.player_aliases (
    alias_key text primary key,
    alias_name text not null,
    canonical_key text not null,
    canonical_name text not null,
    created_at timestamptz not null default now(),
    constraint player_aliases_not_self check (alias_key <> canonical_key)
);

create index if not exists player_aliases_canonical_key_idx
    on public.player_aliases (canonical_key);

alter table public.player_aliases enable row level security;

drop policy if exists "Public can read player aliases" on public.player_aliases;
create policy "Public can read player aliases"
    on public.player_aliases for select to anon using (true);

drop policy if exists "Public can add player aliases" on public.player_aliases;
create policy "Public can add player aliases"
    on public.player_aliases for insert to anon with check (true);

revoke all on public.player_aliases from public, anon, authenticated;
grant select, insert on public.player_aliases to anon;

insert into public.player_aliases (alias_key, alias_name, canonical_key, canonical_name)
values ('gabo', 'Gabo', 'gabriel boric', 'Gabriel Boric')
on conflict (alias_key) do nothing;
