-- El sitio de torneos es público y usa la clave anon. /admin usa Supabase Auth;
-- las operaciones sensibles exigen app_metadata.role = 'admin' mediante RLS.
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
drop policy if exists "Admins can read players" on public.players;
create policy "Admins can read players" on public.players for select to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Public can read finished tournaments" on public.finished_tournaments;
create policy "Public can read finished tournaments" on public.finished_tournaments for select to anon using (true);
drop policy if exists "Public can save finished tournaments" on public.finished_tournaments;
create policy "Public can save finished tournaments" on public.finished_tournaments for insert to anon with check (true);
drop policy if exists "Admins can read finished tournaments" on public.finished_tournaments;
create policy "Admins can read finished tournaments" on public.finished_tournaments for select to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "Admins can delete finished tournaments" on public.finished_tournaments;
create policy "Admins can delete finished tournaments" on public.finished_tournaments for delete to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
revoke all on public.players from public, anon, authenticated;
revoke all on public.finished_tournaments from public, anon, authenticated;
grant select, insert, update on public.players to anon;
grant select on public.players to authenticated;
grant select, insert on public.finished_tournaments to anon;
grant select, delete on public.finished_tournaments to authenticated;

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
create policy "Public can read player aliases" on public.player_aliases for select to anon, authenticated using (true);
drop policy if exists "Admins can add player aliases" on public.player_aliases;
create policy "Admins can add player aliases" on public.player_aliases for insert to authenticated
    with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "Admins can update player aliases" on public.player_aliases;
create policy "Admins can update player aliases" on public.player_aliases for update to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
    with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "Admins can delete player aliases" on public.player_aliases;
create policy "Admins can delete player aliases" on public.player_aliases for delete to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
revoke all on public.player_aliases from public, anon, authenticated;
grant select on public.player_aliases to anon, authenticated;
grant insert, update, delete on public.player_aliases to authenticated;
insert into public.player_aliases (alias_key, alias_name, canonical_key, canonical_name)
values ('gabo', 'Gabo', 'gabriel boric', 'Gabriel Boric')
on conflict (alias_key) do nothing;

create or replace function public.admin_promote_player_alias(p_alias_key text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    selected_alias public.player_aliases%rowtype;
begin
    if (((select auth.jwt()) -> 'app_metadata' ->> 'role') is distinct from 'admin') then
        raise exception 'Admin role required' using errcode = '42501';
    end if;
    select * into selected_alias
    from public.player_aliases
    where alias_key = p_alias_key
    for update;
    if not found then
        raise exception 'Alias not found' using errcode = 'P0002';
    end if;
    if exists (
        select 1 from public.player_aliases
        where canonical_key = selected_alias.alias_key
          and alias_key <> selected_alias.alias_key
    ) then
        raise exception 'Alias already has linked names; resolve that group first' using errcode = '22023';
    end if;
    if exists (
        select 1 from public.player_aliases
        where alias_key = selected_alias.canonical_key
          and alias_key <> selected_alias.alias_key
    ) then
        raise exception 'The current primary name is already linked to another player' using errcode = '22023';
    end if;
    delete from public.player_aliases where alias_key = selected_alias.alias_key;
    update public.player_aliases
    set canonical_key = selected_alias.alias_key,
        canonical_name = selected_alias.alias_name
    where canonical_key = selected_alias.canonical_key;
    insert into public.player_aliases (alias_key, alias_name, canonical_key, canonical_name)
    values (
        selected_alias.canonical_key,
        selected_alias.canonical_name,
        selected_alias.alias_key,
        selected_alias.alias_name
    );
end;
$$;
revoke all on function public.admin_promote_player_alias(text) from public, anon, authenticated;
grant execute on function public.admin_promote_player_alias(text) to authenticated;

create table if not exists public.shared_tournaments (
    id text primary key,
    tournament_id text not null,
    tournament_name text not null,
    tournament_format text not null default 'random',
    current_phase smallint not null default 1,
    current_round integer not null default 0,
    current_round_key text not null default 'group-0',
    phase_label text not null default 'Fase de grupos',
    tournament_finished boolean not null default false,
    winner text,
    podium jsonb not null default '{}'::jsonb,
    participants jsonb not null default '[]'::jsonb,
    matches jsonb not null default '[]'::jsonb,
    standings jsonb not null default '[]'::jsonb,
    swiss_byes jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.shared_tournaments enable row level security;

drop policy if exists "Public can read shared tournaments" on public.shared_tournaments;
create policy "Public can read shared tournaments" on public.shared_tournaments for select to anon using (true);

revoke all on public.shared_tournaments from public, anon, authenticated;
grant select on public.shared_tournaments to anon;

create schema if not exists private;
create table if not exists private.shared_tournament_write_tokens (
    share_id text primary key,
    token_hash text not null,
    created_at timestamptz not null default now()
);
alter table private.shared_tournament_write_tokens enable row level security;
revoke all on private.shared_tournament_write_tokens from public, anon, authenticated;

create or replace function public.publish_shared_tournament(
    p_share_id text,
    p_write_token text,
    p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    existing_token_hash text;
    supplied_token_hash text;
begin
    if nullif(p_share_id, '') is null or p_snapshot is null or length(coalesce(p_write_token, '')) < 48 then
        raise exception 'Invalid shared tournament payload' using errcode = '22023';
    end if;

    supplied_token_hash := encode(extensions.digest(convert_to(p_write_token, 'UTF8'), 'sha256'), 'hex');
    select token_hash into existing_token_hash
    from private.shared_tournament_write_tokens
    where share_id = p_share_id
    for update;

    if found then
        if existing_token_hash <> supplied_token_hash then
            raise exception 'Invalid shared tournament write token' using errcode = '42501';
        end if;
    else
        insert into private.shared_tournament_write_tokens (share_id, token_hash)
        values (p_share_id, supplied_token_hash);
    end if;

    insert into public.shared_tournaments (
        id, tournament_id, tournament_name, tournament_format, current_phase,
        current_round, current_round_key, phase_label, tournament_finished,
        winner, podium, participants, matches, standings, swiss_byes, updated_at
    ) values (
        p_share_id,
        p_snapshot->>'tournament_id',
        coalesce(p_snapshot->>'tournament_name', 'Torneo BeybladeX'),
        coalesce(p_snapshot->>'tournament_format', 'random'),
        coalesce((p_snapshot->>'current_phase')::smallint, 1),
        coalesce((p_snapshot->>'current_round')::integer, 0),
        coalesce(p_snapshot->>'current_round_key', 'group-0'),
        coalesce(p_snapshot->>'phase_label', 'Fase de grupos'),
        coalesce((p_snapshot->>'tournament_finished')::boolean, false),
        p_snapshot->>'winner',
        coalesce(p_snapshot->'podium', '{}'::jsonb),
        coalesce(p_snapshot->'participants', '[]'::jsonb),
        coalesce(p_snapshot->'matches', '[]'::jsonb),
        coalesce(p_snapshot->'standings', '[]'::jsonb),
        coalesce(p_snapshot->'swiss_byes', '[]'::jsonb),
        now()
    )
    on conflict (id) do update set
        tournament_id = excluded.tournament_id,
        tournament_name = excluded.tournament_name,
        tournament_format = excluded.tournament_format,
        current_phase = excluded.current_phase,
        current_round = excluded.current_round,
        current_round_key = excluded.current_round_key,
        phase_label = excluded.phase_label,
        tournament_finished = excluded.tournament_finished,
        winner = excluded.winner,
        podium = excluded.podium,
        participants = excluded.participants,
        matches = excluded.matches,
        standings = excluded.standings,
        swiss_byes = excluded.swiss_byes,
        updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.publish_shared_tournament(text, text, jsonb) from public, authenticated;
grant execute on function public.publish_shared_tournament(text, text, jsonb) to anon;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = 'shared_tournaments'
       ) then
        execute 'alter publication supabase_realtime add table public.shared_tournaments';
    end if;
end
$$;

-- Keep new Supabase projects aligned with the latest shared links and player profiles.
-- Shared tournament links expire after seven idle days. A new snapshot renews
-- the link, so remote tournaments stay available while the organizer updates them.
alter table public.shared_tournaments
    add column if not exists expires_at timestamptz;

update public.shared_tournaments
set expires_at = updated_at + interval '7 days'
where expires_at is null;

alter table public.shared_tournaments
    alter column expires_at set default (now() + interval '7 days'),
    alter column expires_at set not null;

create index if not exists shared_tournaments_expires_at_idx
    on public.shared_tournaments (expires_at);

drop policy if exists "Public can read shared tournaments" on public.shared_tournaments;
create policy "Public can read unexpired shared tournaments"
    on public.shared_tournaments for select to anon
    using (expires_at > now());

create or replace function public.publish_shared_tournament(
    p_share_id text,
    p_write_token text,
    p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    existing_token_hash text;
    supplied_token_hash text;
begin
    if nullif(p_share_id, '') is null or p_snapshot is null or length(coalesce(p_write_token, '')) < 48 then
        raise exception 'Invalid shared tournament payload' using errcode = '22023';
    end if;

    supplied_token_hash := encode(extensions.digest(convert_to(p_write_token, 'UTF8'), 'sha256'), 'hex');
    select token_hash into existing_token_hash
    from private.shared_tournament_write_tokens
    where share_id = p_share_id
    for update;

    if found then
        if existing_token_hash <> supplied_token_hash then
            raise exception 'Invalid shared tournament write token' using errcode = '42501';
        end if;
    else
        insert into private.shared_tournament_write_tokens (share_id, token_hash)
        values (p_share_id, supplied_token_hash);
    end if;

    insert into public.shared_tournaments (
        id, tournament_id, tournament_name, tournament_format, current_phase,
        current_round, current_round_key, phase_label, tournament_finished,
        winner, podium, participants, matches, standings, swiss_byes, updated_at, expires_at
    ) values (
        p_share_id,
        p_snapshot->>'tournament_id',
        coalesce(p_snapshot->>'tournament_name', 'Torneo BeybladeX'),
        coalesce(p_snapshot->>'tournament_format', 'random'),
        coalesce((p_snapshot->>'current_phase')::smallint, 1),
        coalesce((p_snapshot->>'current_round')::integer, 0),
        coalesce(p_snapshot->>'current_round_key', 'group-0'),
        coalesce(p_snapshot->>'phase_label', 'Fase de grupos'),
        coalesce((p_snapshot->>'tournament_finished')::boolean, false),
        p_snapshot->>'winner',
        coalesce(p_snapshot->'podium', '{}'::jsonb),
        coalesce(p_snapshot->'participants', '[]'::jsonb),
        coalesce(p_snapshot->'matches', '[]'::jsonb),
        coalesce(p_snapshot->'standings', '[]'::jsonb),
        coalesce(p_snapshot->'swiss_byes', '[]'::jsonb),
        now(),
        now() + interval '7 days'
    )
    on conflict (id) do update set
        tournament_id = excluded.tournament_id,
        tournament_name = excluded.tournament_name,
        tournament_format = excluded.tournament_format,
        current_phase = excluded.current_phase,
        current_round = excluded.current_round,
        current_round_key = excluded.current_round_key,
        phase_label = excluded.phase_label,
        tournament_finished = excluded.tournament_finished,
        winner = excluded.winner,
        podium = excluded.podium,
        participants = excluded.participants,
        matches = excluded.matches,
        standings = excluded.standings,
        swiss_byes = excluded.swiss_byes,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at;
end;
$$;

revoke all on function public.publish_shared_tournament(text, text, jsonb) from public, authenticated;
grant execute on function public.publish_shared_tournament(text, text, jsonb) to anon;

create or replace function private.cleanup_expired_shared_tournaments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    removed_count integer;
begin
    delete from private.shared_tournament_write_tokens token
    where token.share_id in (
        select tournament.id
        from public.shared_tournaments tournament
        where tournament.expires_at <= now()
    );

    delete from public.shared_tournaments
    where expires_at <= now();
    get diagnostics removed_count = row_count;
    return removed_count;
end;
$$;

revoke all on function private.cleanup_expired_shared_tournaments() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup-expired-shared-tournaments';
select cron.schedule(
    'cleanup-expired-shared-tournaments',
    '17 * * * *',
    'select private.cleanup_expired_shared_tournaments();'
);

-- Public player data contains no email or password. Auth ownership stays in a
-- separate table so the public profile page can expose only display fields.
create table if not exists public.player_accounts (
    user_id uuid primary key references auth.users(id) on delete cascade,
    nickname text not null check (length(btrim(nickname)) between 1 and 40),
    created_at timestamptz not null default now()
);

alter table public.player_accounts enable row level security;
revoke all on public.player_accounts from public, anon, authenticated;
grant select, update (nickname) on public.player_accounts to authenticated;

drop policy if exists "Users can read their player account" on public.player_accounts;
create policy "Users can read their player account"
    on public.player_accounts for select to authenticated
    using (user_id = (select auth.uid()) or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "Users can update their player account" on public.player_accounts;
create policy "Users can update their player account"
    on public.player_accounts for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));
drop policy if exists "Admins can manage player accounts" on public.player_accounts;
create policy "Admins can manage player accounts"
    on public.player_accounts for all to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
    with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.handle_new_player_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.player_accounts (user_id, nickname)
    values (
        new.id,
        coalesce(
            nullif(left(btrim(new.raw_user_meta_data ->> 'nickname'), 40), ''),
            nullif(left(split_part(coalesce(new.email, ''), '@', 1), 40), ''),
            'Jugador'
        )
    )
    on conflict (user_id) do nothing;
    return new;
end;
$$;

revoke all on function public.handle_new_player_account() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_player_account on auth.users;
create trigger on_auth_user_created_player_account
    after insert on auth.users
    for each row execute procedure public.handle_new_player_account();

insert into public.player_accounts (user_id, nickname)
select users.id,
       coalesce(
           nullif(left(btrim(users.raw_user_meta_data ->> 'nickname'), 40), ''),
           nullif(left(split_part(coalesce(users.email, ''), '@', 1), 40), ''),
           'Jugador'
       )
from auth.users users
on conflict (user_id) do nothing;

create table if not exists public.player_profile_requests (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    player_key text not null,
    player_name text not null,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references auth.users(id) on delete set null
);
create index if not exists player_profile_requests_status_created_idx
    on public.player_profile_requests (status, created_at desc);

alter table public.player_profile_requests enable row level security;
revoke all on public.player_profile_requests from public, anon, authenticated;
grant select, insert, update on public.player_profile_requests to authenticated;

drop policy if exists "Users can read their profile request" on public.player_profile_requests;
create policy "Users can read their profile request"
    on public.player_profile_requests for select to authenticated
    using (user_id = (select auth.uid()) or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "Users can make one profile request" on public.player_profile_requests;
create policy "Users can make one profile request"
    on public.player_profile_requests for insert to authenticated
    with check (
        user_id = (select auth.uid())
        and email = ((select auth.jwt()) ->> 'email')
        and status = 'pending'
        and reviewed_at is null
        and reviewed_by is null
    );
drop policy if exists "Admins can review profile requests" on public.player_profile_requests;
create policy "Admins can review profile requests"
    on public.player_profile_requests for update to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
    with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create table if not exists public.player_profile_owners (
    user_id uuid primary key references auth.users(id) on delete cascade,
    player_key text not null unique,
    player_name text not null,
    approved_by uuid references auth.users(id) on delete set null,
    approved_at timestamptz not null default now()
);

alter table public.player_profile_owners enable row level security;
revoke all on public.player_profile_owners from public, anon, authenticated;
grant select, insert, update, delete on public.player_profile_owners to authenticated;

drop policy if exists "Users can read their profile ownership" on public.player_profile_owners;
create policy "Users can read their profile ownership"
    on public.player_profile_owners for select to authenticated
    using (user_id = (select auth.uid()) or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "Admins can manage profile ownership" on public.player_profile_owners;
create policy "Admins can manage profile ownership"
    on public.player_profile_owners for all to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin')
    with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create table if not exists public.player_profiles (
    player_key text primary key,
    player_name text not null,
    nickname text not null,
    avatar_url text,
    banner_url text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.player_profiles enable row level security;
revoke all on public.player_profiles from public, anon, authenticated;
grant select on public.player_profiles to anon, authenticated;
grant insert (player_key, player_name, nickname) on public.player_profiles to authenticated;
grant update (nickname, avatar_url, banner_url) on public.player_profiles to authenticated;

drop policy if exists "Anyone can view public player profiles" on public.player_profiles;
create policy "Anyone can view public player profiles"
    on public.player_profiles for select to anon, authenticated using (true);
drop policy if exists "Profile owners can update public profile fields" on public.player_profiles;
create policy "Profile owners can update public profile fields"
    on public.player_profiles for update to authenticated
    using (exists (
        select 1 from public.player_profile_owners owner
        where owner.player_key = player_profiles.player_key and owner.user_id = (select auth.uid())
    ))
    with check (exists (
        select 1 from public.player_profile_owners owner
        where owner.player_key = player_profiles.player_key and owner.user_id = (select auth.uid())
    ));
drop policy if exists "Admins can create public player profiles" on public.player_profiles;
create policy "Admins can create public player profiles"
    on public.player_profiles for insert to authenticated
    with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create or replace function public.admin_review_player_profile_request(p_user_id uuid, p_approve boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    selected_request public.player_profile_requests%rowtype;
    account_nickname text;
begin
    if (((select auth.jwt()) -> 'app_metadata' ->> 'role') is distinct from 'admin') then
        raise exception 'Administrator privileges required' using errcode = '42501';
    end if;

    select request.* into selected_request
    from public.player_profile_requests request
    where request.user_id = p_user_id
    for update;

    if not found or selected_request.status <> 'pending' then
        raise exception 'Pending profile request not found' using errcode = 'P0002';
    end if;

    if p_approve then
        select account.nickname into account_nickname
        from public.player_accounts account
        where account.user_id = selected_request.user_id;

        insert into public.player_profile_owners (user_id, player_key, player_name, approved_by)
        values (selected_request.user_id, selected_request.player_key, selected_request.player_name, (select auth.uid()));

        insert into public.player_profiles (player_key, player_name, nickname)
        values (selected_request.player_key, selected_request.player_name, coalesce(account_nickname, selected_request.player_name))
        on conflict (player_key) do nothing;

        update public.player_profile_requests
        set status = 'approved', reviewed_at = now(), reviewed_by = (select auth.uid())
        where user_id = p_user_id;
    else
        update public.player_profile_requests
        set status = 'rejected', reviewed_at = now(), reviewed_by = (select auth.uid())
        where user_id = p_user_id;
    end if;
end;
$$;

revoke all on function public.admin_review_player_profile_request(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_review_player_profile_request(uuid, boolean) to authenticated;

-- Profile images come from user-provided external URLs; do not accept Storage uploads.
drop policy if exists "Public can read player profile images" on storage.objects;
drop policy if exists "Profile owners can read their images" on storage.objects;
drop policy if exists "Profile owners can upload images" on storage.objects;
drop policy if exists "Profile owners can replace images" on storage.objects;
drop policy if exists "Profile owners can delete images" on storage.objects;
-- Let administrator accounts inspect active share links and close them safely.
grant select on public.shared_tournaments to authenticated;

drop policy if exists "Admins can read active shared tournaments" on public.shared_tournaments;
create policy "Admins can read active shared tournaments"
    on public.shared_tournaments for select to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create table if not exists private.closed_shared_tournaments (
    share_id text primary key,
    closed_at timestamptz not null default now(),
    closed_by uuid references auth.users(id) on delete set null
);

alter table private.closed_shared_tournaments enable row level security;
revoke all on private.closed_shared_tournaments from public, anon, authenticated;

-- A persistent tombstone prevents an old writer token from recreating a closed link.
create or replace function private.reject_closed_shared_tournament()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if exists (
        select 1
        from private.closed_shared_tournaments closed
        where closed.share_id = new.id
    ) then
        raise exception 'This shared tournament has been closed by an administrator'
            using errcode = '42501';
    end if;
    return new;
end;
$$;

revoke all on function private.reject_closed_shared_tournament() from public, anon, authenticated;
drop trigger if exists reject_closed_shared_tournament on public.shared_tournaments;
create trigger reject_closed_shared_tournament
    before insert or update on public.shared_tournaments
    for each row execute function private.reject_closed_shared_tournament();

create or replace function public.admin_close_shared_tournament(p_share_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if ((select auth.jwt()) -> 'app_metadata' ->> 'role') is distinct from 'admin' then
        raise exception 'Administrator privileges required' using errcode = '42501';
    end if;

    if nullif(btrim(p_share_id), '') is null then
        raise exception 'A tournament share ID is required' using errcode = '22023';
    end if;

    perform 1
    from public.shared_tournaments tournament
    where tournament.id = p_share_id
      and tournament.expires_at > now()
      and not tournament.tournament_finished
    for update;

    if not found then
        raise exception 'Active shared tournament not found' using errcode = 'P0002';
    end if;

    insert into private.closed_shared_tournaments (share_id, closed_by)
    values (p_share_id, (select auth.uid()))
    on conflict (share_id) do nothing;

    delete from private.shared_tournament_write_tokens
    where share_id = p_share_id;

    delete from public.shared_tournaments
    where id = p_share_id;
end;
$$;

revoke all on function public.admin_close_shared_tournament(text) from public, anon, authenticated;
grant execute on function public.admin_close_shared_tournament(text) to authenticated;

-- Unregistered tournaments wait for approval; signed-in accounts publish directly.
alter table public.finished_tournaments
    add column if not exists created_by text,
    add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

drop policy if exists "Public can save finished tournaments" on public.finished_tournaments;
revoke insert on public.finished_tournaments from anon, authenticated;

-- Public visitors may select or add players, but cannot rename or alter existing rows.
drop policy if exists "Public can update players" on public.players;
revoke update on public.players from anon;

create table if not exists public.tournament_submissions (
    id uuid primary key default gen_random_uuid(),
    tournament_id text not null,
    tournament_name text not null,
    submission_type text not null default 'finished' check (submission_type = 'finished'),
    payload jsonb not null,
    share_id text,
    submitter_user_id uuid references auth.users(id) on delete set null,
    submitter_name text not null default 'Anónimo',
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    submitted_at timestamptz not null default now(),
    reviewed_at timestamptz,
    reviewed_by uuid references auth.users(id) on delete set null
);
create index if not exists tournament_submissions_status_submitted_idx
    on public.tournament_submissions (status, submitted_at desc);
create unique index if not exists tournament_submissions_pending_final_id_idx
    on public.tournament_submissions (tournament_id)
    where status = 'pending';
create unique index if not exists tournament_submissions_pending_share_id_idx
    on public.tournament_submissions (share_id)
    where submission_type = 'shared_live' and status = 'pending';

alter table public.tournament_submissions enable row level security;
revoke all on public.tournament_submissions from public, anon, authenticated;
grant select on public.tournament_submissions to authenticated;
drop policy if exists "Admins can read tournament submissions" on public.tournament_submissions;
create policy "Admins can read tournament submissions"
    on public.tournament_submissions for select to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

create table if not exists public.admin_activity_log (
    id bigint generated by default as identity primary key,
    event_type text not null,
    tournament_id text,
    tournament_name text,
    actor_user_id uuid references auth.users(id) on delete set null,
    actor_name text not null,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists admin_activity_log_created_at_idx
    on public.admin_activity_log (created_at desc);
alter table public.admin_activity_log enable row level security;
revoke all on public.admin_activity_log from public, anon, authenticated;
grant select on public.admin_activity_log to authenticated;
drop policy if exists "Admins can read activity log" on public.admin_activity_log;
create policy "Admins can read activity log"
    on public.admin_activity_log for select to authenticated
    using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

grant select on public.shared_tournaments to authenticated;
drop policy if exists "Authenticated can read unexpired shared tournaments" on public.shared_tournaments;
create policy "Authenticated can read unexpired shared tournaments"
    on public.shared_tournaments for select to authenticated
    using (expires_at > now());

create or replace function private.write_admin_activity_log(
    p_event_type text,
    p_tournament_id text,
    p_tournament_name text,
    p_actor_user_id uuid,
    p_actor_name text,
    p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
    insert into public.admin_activity_log (
        event_type, tournament_id, tournament_name, actor_user_id, actor_name, details
    ) values (
        p_event_type, p_tournament_id, p_tournament_name, p_actor_user_id,
        coalesce(nullif(btrim(p_actor_name), ''), 'Anónimo'), coalesce(p_details, '{}'::jsonb)
    );
end;
$$;
revoke all on function private.write_admin_activity_log(text, text, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.log_tournament_created(p_tournament_id text, p_tournament_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor_name text := 'Anónimo';
begin
    if nullif(btrim(p_tournament_id), '') is null or length(coalesce(p_tournament_name, '')) not between 1 and 120 then
        raise exception 'Invalid tournament identity' using errcode = '22023';
    end if;
    if (select auth.uid()) is not null then
        select coalesce(account.nickname, 'Usuario') into actor_name
        from public.player_accounts account
        where account.user_id = (select auth.uid());
        actor_name := coalesce(actor_name, 'Usuario');
    end if;
    perform private.write_admin_activity_log('created', p_tournament_id, p_tournament_name, (select auth.uid()), actor_name, '{}'::jsonb);
end;
$$;
revoke all on function public.log_tournament_created(text, text) from public;
grant execute on function public.log_tournament_created(text, text) to anon, authenticated;

create or replace function public.submit_tournament_for_approval(p_tournament jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    submission_id uuid;
    existing_submission_id uuid;
    new_tournament_id text := p_tournament->>'id';
    new_tournament_name text := left(btrim(coalesce(p_tournament->>'name', '')), 120);
begin
    if (select auth.uid()) is not null then
        raise exception 'Signed-in users must publish directly' using errcode = '42501';
    end if;
    if p_tournament is null or pg_column_size(p_tournament) > 2000000
       or nullif(new_tournament_id, '') is null or new_tournament_name = ''
       or jsonb_typeof(p_tournament->'participants') is distinct from 'array'
       or jsonb_typeof(p_tournament->'matches') is distinct from 'array' then
        raise exception 'Invalid tournament submission' using errcode = '22023';
    end if;

    select id into existing_submission_id from public.tournament_submissions
    where tournament_id = new_tournament_id
      and submission_type = 'finished' and status = 'pending'
    for update;
    if found then
        update public.tournament_submissions
        set payload = p_tournament, tournament_name = new_tournament_name, submitted_at = now()
        where id = existing_submission_id
        returning id into submission_id;
        return submission_id;
    end if;

    insert into public.tournament_submissions (tournament_id, tournament_name, submission_type, payload)
    values (new_tournament_id, new_tournament_name, 'finished', p_tournament)
    returning id into submission_id;

    perform private.write_admin_activity_log('approval_requested', new_tournament_id, new_tournament_name, null, 'Anónimo',
        jsonb_build_object('submission_id', submission_id));
    return submission_id;
end;
$$;
revoke all on function public.submit_tournament_for_approval(jsonb) from public, authenticated;
grant execute on function public.submit_tournament_for_approval(jsonb) to anon;

create or replace function public.publish_finished_tournament(p_tournament jsonb, p_creator_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor_name text;
    tournament_id text := p_tournament->>'id';
    tournament_name text := left(btrim(coalesce(p_tournament->>'name', '')), 120);
begin
    if (select auth.uid()) is null or p_creator_user_id is distinct from (select auth.uid()) then
        raise exception 'Publish using the account that created this tournament' using errcode = '42501';
    end if;
    if p_tournament is null or pg_column_size(p_tournament) > 2000000
       or nullif(tournament_id, '') is null or tournament_name = ''
       or jsonb_typeof(p_tournament->'participants') is distinct from 'array'
       or jsonb_typeof(p_tournament->'matches') is distinct from 'array' then
        raise exception 'Invalid tournament payload' using errcode = '22023';
    end if;

    select coalesce(account.nickname, 'Usuario') into actor_name
    from public.player_accounts account
    where account.user_id = (select auth.uid());
    actor_name := coalesce(actor_name, 'Usuario');

    if exists (select 1 from public.finished_tournaments where id = tournament_id) then
        return;
    end if;

    insert into public.finished_tournaments (
        id, name, finished_at, participants, standings, matches,
        tournament_format, swiss_byes, winner, podium, created_by, created_by_user_id
    ) values (
        tournament_id, tournament_name,
        coalesce(nullif(p_tournament->>'finished_at', '')::timestamptz, now()),
        coalesce(p_tournament->'participants', '[]'::jsonb),
        coalesce(p_tournament->'standings', '[]'::jsonb),
        coalesce(p_tournament->'matches', '[]'::jsonb),
        coalesce(p_tournament->>'tournament_format', 'random'),
        coalesce(p_tournament->'swiss_byes', '[]'::jsonb), p_tournament->>'winner',
        coalesce(p_tournament->'podium', '{}'::jsonb), actor_name, (select auth.uid())
    ) on conflict (id) do nothing;

    perform private.write_admin_activity_log('published', tournament_id, tournament_name, (select auth.uid()), actor_name,
        jsonb_build_object('channel', 'finished_table'));
end;
$$;
revoke all on function public.publish_finished_tournament(jsonb, uuid) from public, anon;
grant execute on function public.publish_finished_tournament(jsonb, uuid) to authenticated;

create or replace function public.publish_shared_tournament(
    p_share_id text,
    p_write_token text,
    p_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    existing_token_hash text;
    supplied_token_hash text;
    had_published_row boolean;
    actor_name text := 'Anónimo';
    tournament_id text := p_snapshot->>'tournament_id';
    tournament_name text := left(btrim(coalesce(p_snapshot->>'tournament_name', '')), 120);
    previous_round_key text;
begin
    if nullif(p_share_id, '') is null or p_snapshot is null or length(coalesce(p_write_token, '')) < 48
       or pg_column_size(p_snapshot) > 2000000 or nullif(tournament_id, '') is null then
        raise exception 'Invalid shared tournament payload' using errcode = '22023';
    end if;
    if exists (select 1 from private.closed_shared_tournaments where share_id = p_share_id) then
        raise exception 'This shared tournament has been closed by an administrator' using errcode = '42501';
    end if;

    supplied_token_hash := encode(extensions.digest(convert_to(p_write_token, 'UTF8'), 'sha256'), 'hex');
    select token_hash into existing_token_hash
    from private.shared_tournament_write_tokens
    where share_id = p_share_id
    for update;

    if found then
        if existing_token_hash <> supplied_token_hash then
            raise exception 'Invalid shared tournament write token' using errcode = '42501';
        end if;
    else
        insert into private.shared_tournament_write_tokens (share_id, token_hash)
        values (p_share_id, supplied_token_hash);
    end if;

    select current_round_key into previous_round_key
    from public.shared_tournaments where id = p_share_id;
    select exists(select 1 from public.shared_tournaments where id = p_share_id) into had_published_row;
    insert into public.shared_tournaments (
        id, tournament_id, tournament_name, tournament_format, current_phase,
        current_round, current_round_key, phase_label, tournament_finished,
        winner, podium, participants, matches, standings, swiss_byes, updated_at, expires_at
    ) values (
        p_share_id, tournament_id, tournament_name,
        coalesce(p_snapshot->>'tournament_format', 'random'),
        coalesce((p_snapshot->>'current_phase')::smallint, 1),
        coalesce((p_snapshot->>'current_round')::integer, 0),
        coalesce(p_snapshot->>'current_round_key', 'group-0'),
        coalesce(p_snapshot->>'phase_label', 'Fase de grupos'),
        coalesce((p_snapshot->>'tournament_finished')::boolean, false), p_snapshot->>'winner',
        coalesce(p_snapshot->'podium', '{}'::jsonb), coalesce(p_snapshot->'participants', '[]'::jsonb),
        coalesce(p_snapshot->'matches', '[]'::jsonb), coalesce(p_snapshot->'standings', '[]'::jsonb),
        coalesce(p_snapshot->'swiss_byes', '[]'::jsonb), now(), now() + interval '7 days'
    ) on conflict (id) do update set
        tournament_id = excluded.tournament_id,
        tournament_name = excluded.tournament_name,
        tournament_format = excluded.tournament_format,
        current_phase = excluded.current_phase,
        current_round = excluded.current_round,
        current_round_key = excluded.current_round_key,
        phase_label = excluded.phase_label,
        tournament_finished = excluded.tournament_finished,
        winner = excluded.winner,
        podium = excluded.podium,
        participants = excluded.participants,
        matches = excluded.matches,
        standings = excluded.standings,
        swiss_byes = excluded.swiss_byes,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at;

    if (select auth.uid()) is not null then
        select coalesce(account.nickname, 'Usuario') into actor_name
        from public.player_accounts account where account.user_id = (select auth.uid());
        actor_name := coalesce(actor_name, 'Usuario');
    end if;
    if not had_published_row then
        perform private.write_admin_activity_log('published', tournament_id, tournament_name,
            (select auth.uid()), actor_name, jsonb_build_object('channel', 'live_share'));
    elsif previous_round_key is distinct from p_snapshot->>'current_round_key' then
        perform private.write_admin_activity_log('round_updated', tournament_id, tournament_name,
            (select auth.uid()), actor_name, jsonb_build_object('round_key', p_snapshot->>'current_round_key'));
    end if;
end;
$$;
revoke all on function public.publish_shared_tournament(text, text, jsonb) from public;
grant execute on function public.publish_shared_tournament(text, text, jsonb) to anon, authenticated;

create or replace function public.admin_review_tournament_submission(p_submission_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    submission public.tournament_submissions%rowtype;
    actor_name text;
begin
    if ((select auth.jwt()) -> 'app_metadata' ->> 'role') is distinct from 'admin' then
        raise exception 'Administrator privileges required' using errcode = '42501';
    end if;
    select * into submission from public.tournament_submissions
    where id = p_submission_id for update;
    if not found or submission.status <> 'pending' then
        raise exception 'Pending tournament submission not found' using errcode = 'P0002';
    end if;
    select coalesce(account.nickname, 'Admin') into actor_name
    from public.player_accounts account where account.user_id = (select auth.uid());
    actor_name := coalesce(actor_name, 'Admin');

    if p_approve and submission.submission_type = 'finished' then
        if exists (select 1 from public.finished_tournaments where id = submission.payload->>'id') then
            raise exception 'A tournament with this ID is already published' using errcode = '23505';
        end if;
        insert into public.finished_tournaments (
            id, name, finished_at, participants, standings, matches, tournament_format,
            swiss_byes, winner, podium, created_by, created_by_user_id
        ) values (
            submission.payload->>'id', submission.tournament_name,
            coalesce(nullif(submission.payload->>'finished_at', '')::timestamptz, now()),
            coalesce(submission.payload->'participants', '[]'::jsonb),
            coalesce(submission.payload->'standings', '[]'::jsonb),
            coalesce(submission.payload->'matches', '[]'::jsonb),
            coalesce(submission.payload->>'tournament_format', 'random'),
            coalesce(submission.payload->'swiss_byes', '[]'::jsonb), submission.payload->>'winner',
            coalesce(submission.payload->'podium', '{}'::jsonb), submission.submitter_name, null
        ) on conflict (id) do nothing;
    end if;

    update public.tournament_submissions
    set status = case when p_approve then 'approved' else 'rejected' end,
        reviewed_at = now(), reviewed_by = (select auth.uid())
    where id = submission.id;

    perform private.write_admin_activity_log(
        case when p_approve then 'approved' else 'rejected' end,
        submission.tournament_id, submission.tournament_name, (select auth.uid()), actor_name,
        jsonb_build_object('submission_id', submission.id, 'submission_type', submission.submission_type, 'submitter', submission.submitter_name)
    );
    if p_approve then
        perform private.write_admin_activity_log('published', submission.tournament_id, submission.tournament_name,
            submission.submitter_user_id, submission.submitter_name,
            jsonb_build_object('submission_id', submission.id, 'channel', submission.submission_type));
    end if;
end;
$$;
revoke all on function public.admin_review_tournament_submission(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_review_tournament_submission(uuid, boolean) to authenticated;

create or replace function public.admin_close_shared_tournament(p_share_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor_name text;
    tournament_name text;
    tournament_id text;
begin
    if ((select auth.jwt()) -> 'app_metadata' ->> 'role') is distinct from 'admin' then
        raise exception 'Administrator privileges required' using errcode = '42501';
    end if;
    select tournament.tournament_name, tournament.tournament_id into tournament_name, tournament_id
    from public.shared_tournaments tournament
    where tournament.id = p_share_id and tournament.expires_at > now() and not tournament.tournament_finished
    for update;
    if not found then
        raise exception 'Active shared tournament not found' using errcode = 'P0002';
    end if;
    select coalesce(account.nickname, 'Admin') into actor_name
    from public.player_accounts account where account.user_id = (select auth.uid());
    insert into private.closed_shared_tournaments (share_id, closed_by)
    values (p_share_id, (select auth.uid())) on conflict (share_id) do nothing;
    delete from private.shared_tournament_write_tokens where share_id = p_share_id;
    delete from public.shared_tournaments where id = p_share_id;
    perform private.write_admin_activity_log('closed', tournament_id, tournament_name,
        (select auth.uid()), coalesce(actor_name, 'Admin'), jsonb_build_object('share_id', p_share_id));
end;
$$;
revoke all on function public.admin_close_shared_tournament(text) from public, anon, authenticated;
grant execute on function public.admin_close_shared_tournament(text) to authenticated;

create or replace function public.admin_delete_finished_tournament(p_tournament_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor_name text;
    deleted_name text;
begin
    if ((select auth.jwt()) -> 'app_metadata' ->> 'role') is distinct from 'admin' then
        raise exception 'Administrator privileges required' using errcode = '42501';
    end if;
    select coalesce(account.nickname, 'Admin') into actor_name
    from public.player_accounts account where account.user_id = (select auth.uid());
    delete from public.finished_tournaments where id = p_tournament_id returning name into deleted_name;
    if not found then
        raise exception 'Saved tournament not found' using errcode = 'P0002';
    end if;
    perform private.write_admin_activity_log('deleted', p_tournament_id, deleted_name,
        (select auth.uid()), coalesce(actor_name, 'Admin'), '{}'::jsonb);
end;
$$;
revoke all on function public.admin_delete_finished_tournament(text) from public, anon, authenticated;
grant execute on function public.admin_delete_finished_tournament(text) to authenticated;

-- Record meaningful state changes without accepting a caller-supplied actor identity.
create or replace function public.log_tournament_activity(
    p_tournament_id text,
    p_tournament_name text,
    p_details jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    actor_name text := 'Anónimo';
begin
    if nullif(btrim(p_tournament_id), '') is null
       or length(coalesce(p_tournament_name, '')) not between 1 and 120
       or jsonb_typeof(p_details) is distinct from 'object'
       or pg_column_size(p_details) > 4000 then
        raise exception 'Invalid tournament activity' using errcode = '22023';
    end if;

    if (select auth.uid()) is not null then
        select coalesce(account.nickname, 'Usuario') into actor_name
        from public.player_accounts account
        where account.user_id = (select auth.uid());
        actor_name := coalesce(actor_name, 'Usuario');
    end if;

    perform private.write_admin_activity_log(
        'updated', p_tournament_id, p_tournament_name,
        (select auth.uid()), actor_name, p_details
    );
end;
$$;
revoke all on function public.log_tournament_activity(text, text, jsonb) from public;
grant execute on function public.log_tournament_activity(text, text, jsonb) to anon, authenticated;
