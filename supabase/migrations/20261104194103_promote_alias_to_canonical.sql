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
