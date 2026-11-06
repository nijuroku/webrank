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
