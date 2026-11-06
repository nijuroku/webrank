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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-profile-images', 'player-profile-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can read player profile images" on storage.objects;
drop policy if exists "Profile owners can read their images" on storage.objects;
create policy "Profile owners can read their images"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'player-profile-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and name in (((select auth.uid())::text || '/avatar'), ((select auth.uid())::text || '/banner'))
        and exists (select 1 from public.player_profile_owners owner where owner.user_id = (select auth.uid()))
    );
drop policy if exists "Profile owners can upload images" on storage.objects;
create policy "Profile owners can upload images"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'player-profile-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and name in (((select auth.uid())::text || '/avatar'), ((select auth.uid())::text || '/banner'))
        and exists (select 1 from public.player_profile_owners owner where owner.user_id = (select auth.uid()))
    );
drop policy if exists "Profile owners can replace images" on storage.objects;
create policy "Profile owners can replace images"
    on storage.objects for update to authenticated
    using (
        bucket_id = 'player-profile-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and name in (((select auth.uid())::text || '/avatar'), ((select auth.uid())::text || '/banner'))
        and exists (select 1 from public.player_profile_owners owner where owner.user_id = (select auth.uid()))
    )
    with check (
        bucket_id = 'player-profile-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and name in (((select auth.uid())::text || '/avatar'), ((select auth.uid())::text || '/banner'))
        and exists (select 1 from public.player_profile_owners owner where owner.user_id = (select auth.uid()))
    );
drop policy if exists "Profile owners can delete images" on storage.objects;
create policy "Profile owners can delete images"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'player-profile-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (select 1 from public.player_profile_owners owner where owner.user_id = (select auth.uid()))
    );
