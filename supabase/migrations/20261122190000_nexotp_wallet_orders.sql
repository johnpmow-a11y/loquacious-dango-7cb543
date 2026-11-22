-- All Ads Manager: NexOTP verification-number orders funded from customer wallets.
-- Provider API credentials remain server-side in Netlify (NEXOTP_API_KEY).
begin;

create table if not exists public.nexotp_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  wallet_reference text not null unique,
  provider_order_id text unique,
  product_id bigint not null,
  service_name text not null,
  order_type text not null check (order_type in ('short_term','long_term','other_countries')),
  country_code text,
  supplier_price_kobo bigint not null check (supplier_price_kobo > 0),
  markup_kobo bigint not null check (markup_kobo >= 0),
  customer_charge_kobo bigint not null check (customer_charge_kobo > 0),
  phone_number text,
  sms_text text,
  pin text,
  status text not null default 'creating',
  expiration timestamptz,
  provider_response jsonb,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nexotp_orders_customer_created_idx on public.nexotp_orders(customer_id,created_at desc);
create index if not exists nexotp_orders_status_idx on public.nexotp_orders(status,updated_at desc);
alter table public.nexotp_orders enable row level security;
revoke all on public.nexotp_orders from public,anon,authenticated;
grant all on public.nexotp_orders to service_role;

create or replace function public.bt_nexotp_reserve_order(
  p_token uuid,p_reference text,p_product_id bigint,p_service_name text,
  p_order_type text,p_country_code text,p_supplier_price_kobo bigint,
  p_markup_kobo bigint,p_customer_charge_kobo bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_customer uuid; v_balance bigint;
begin
  select customer_id into v_customer from public.customer_sessions
    where token=p_token and expires_at>now();
  if v_customer is null then raise exception 'CUSTOMER_SESSION_EXPIRED'; end if;
  if p_order_type not in ('short_term','long_term','other_countries')
     or p_supplier_price_kobo<=0 or p_markup_kobo<0
     or p_customer_charge_kobo<>p_supplier_price_kobo+p_markup_kobo then
    raise exception 'INVALID_NEXOTP_PRICE';
  end if;
  insert into public.wallet_balances(customer_id,balance_kobo) values(v_customer,0)
    on conflict(customer_id) do nothing;
  update public.wallet_balances set balance_kobo=balance_kobo-p_customer_charge_kobo,updated_at=now()
    where customer_id=v_customer and balance_kobo>=p_customer_charge_kobo
    returning balance_kobo into v_balance;
  if v_balance is null then raise exception 'INSUFFICIENT_WALLET_BALANCE'; end if;
  insert into public.nexotp_orders(customer_id,wallet_reference,product_id,service_name,order_type,country_code,
    supplier_price_kobo,markup_kobo,customer_charge_kobo,status)
  values(v_customer,p_reference,p_product_id,p_service_name,p_order_type,nullif(p_country_code,''),
    p_supplier_price_kobo,p_markup_kobo,p_customer_charge_kobo,'creating');
  insert into public.wallet_transactions(customer_id,reference,amount_kobo,transaction_type,description)
  values(v_customer,p_reference,-p_customer_charge_kobo,'debit','NexOTP verification number: '||p_service_name);
  return jsonb_build_object('success',true,'order_reference',p_reference,'balance',v_balance::numeric/100);
end;
$function$;

create or replace function public.bt_nexotp_refund_order(
  p_reference text,p_status text,p_provider_response jsonb default null
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_order public.nexotp_orders;
begin
  select * into v_order from public.nexotp_orders where wallet_reference=p_reference for update;
  if v_order.id is null then raise exception 'NEXOTP_ORDER_NOT_FOUND'; end if;
  if v_order.refunded_at is null then
    update public.wallet_balances set balance_kobo=balance_kobo+v_order.customer_charge_kobo,updated_at=now()
      where customer_id=v_order.customer_id;
    insert into public.wallet_transactions(customer_id,reference,amount_kobo,transaction_type,description)
      values(v_order.customer_id,'refund-'||p_reference,v_order.customer_charge_kobo,'refund','NexOTP order refund: '||v_order.service_name)
      on conflict(reference) do nothing;
  end if;
  update public.nexotp_orders set status=p_status,refunded_at=coalesce(refunded_at,now()),
    provider_response=coalesce(p_provider_response,provider_response),updated_at=now()
    where id=v_order.id;
  return jsonb_build_object('success',true,'refunded',true);
end;
$function$;

revoke all on function public.bt_nexotp_reserve_order(uuid,text,bigint,text,text,text,bigint,bigint,bigint) from public,anon,authenticated;
revoke all on function public.bt_nexotp_refund_order(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bt_nexotp_reserve_order(uuid,text,bigint,text,text,text,bigint,bigint,bigint) to service_role;
grant execute on function public.bt_nexotp_refund_order(text,text,jsonb) to service_role;
commit;
