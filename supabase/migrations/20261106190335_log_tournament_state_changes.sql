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
