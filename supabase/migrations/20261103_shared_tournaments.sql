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
