-- Ensure the admin dashboard shows every account, including customers with a zero wallet.
create or replace function public.bt_admin_wallet_get(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from public.admin_sessions
    where token = p_token and expires_at > now()
  ) then
    raise exception 'Invalid or expired admin session';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'customer_id', c.id,
        'customer_name', c.name,
        'balance', coalesce(b.balance_kobo, 0)::numeric / 100,
        'updated_at', b.updated_at
      ) order by c.name
    )
    from public.customers c
    left join public.wallet_balances b on b.customer_id = c.id
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.bt_admin_wallet_get(uuid) from public, anon, authenticated;
grant execute on function public.bt_admin_wallet_get(uuid) to anon, authenticated;
