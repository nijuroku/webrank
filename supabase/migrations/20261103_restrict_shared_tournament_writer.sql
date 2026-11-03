revoke all on function public.publish_shared_tournament(text, text, jsonb) from public, authenticated;
grant execute on function public.publish_shared_tournament(text, text, jsonb) to anon;
