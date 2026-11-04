-- Explicitly grant only the operations required by the public app and admin panel.
revoke all on public.players from public, anon, authenticated;
grant select, insert, update on public.players to anon;
grant select on public.players to authenticated;

revoke all on public.finished_tournaments from public, anon, authenticated;
grant select, insert on public.finished_tournaments to anon;
grant select, delete on public.finished_tournaments to authenticated;

drop policy if exists "Admins can read players" on public.players;
create policy "Admins can read players"
    on public.players for select to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can read finished tournaments" on public.finished_tournaments;
create policy "Admins can read finished tournaments"
    on public.finished_tournaments for select to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can delete finished tournaments" on public.finished_tournaments;
create policy "Admins can delete finished tournaments"
    on public.finished_tournaments for delete to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can add player aliases" on public.player_aliases;
create policy "Admins can add player aliases"
    on public.player_aliases for insert to authenticated
    with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can update player aliases" on public.player_aliases;
create policy "Admins can update player aliases"
    on public.player_aliases for update to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
    with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can delete player aliases" on public.player_aliases;
create policy "Admins can delete player aliases"
    on public.player_aliases for delete to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
