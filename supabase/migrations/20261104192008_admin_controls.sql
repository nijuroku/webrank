-- Keep the public tournament app anonymous, but reserve alias management and
-- finished-tournament deletion for users explicitly marked as admins in app_metadata.

drop policy if exists "Public can add player aliases" on public.player_aliases;
drop policy if exists "Public can read player aliases" on public.player_aliases;
create policy "Public can read player aliases"
    on public.player_aliases for select to anon, authenticated using (true);

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

revoke all on public.player_aliases from public, anon, authenticated;
grant select on public.player_aliases to anon, authenticated;
grant insert, update, delete on public.player_aliases to authenticated;

revoke all on public.players from public, anon, authenticated;
grant select, insert, update on public.players to anon;
grant select on public.players to authenticated;

drop policy if exists "Admins can read players" on public.players;
create policy "Admins can read players"
    on public.players for select to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
grant select on public.players to authenticated;

drop policy if exists "Admins can read finished tournaments" on public.finished_tournaments;
create policy "Admins can read finished tournaments"
    on public.finished_tournaments for select to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can delete finished tournaments" on public.finished_tournaments;
create policy "Admins can delete finished tournaments"
    on public.finished_tournaments for delete to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
revoke all on public.finished_tournaments from public, anon, authenticated;
grant select, insert on public.finished_tournaments to anon;
grant select, delete on public.finished_tournaments to authenticated;
