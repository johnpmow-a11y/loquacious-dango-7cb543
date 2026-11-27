-- All Ads Manager: DanSMS customer verification orders.
-- Additive migration. Does not alter NexOTP, Paystack, login, or email.
begin;

create table if not exists public.dansms_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  wallet_reference text not null unique,
  activation_id text unique,
  service_code text not null,
  country_code text not null,
  phone_number text,
  supplier_cost_usd numeric(12,4) not null check (supplier_cost_usd > 0),
  exchange_rate numeric(14,4) not null check (exchange_rate > 0),
  markup_kobo bigint not null check (markup_kobo >= 0),
  customer_charge_kobo bigint not null check (customer_charge_kobo > 0),
  status text not null default 'creating'
    check (status in ('creating','supplier_pending','waiting','completed','cancelled','expired','failed','refund_pending')),
  otp_code text,
  last_polled_at timestamptz,
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  provider_response jsonb,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dansms_orders_customer_created_idx
  on public.dansms_orders(customer_id,created_at desc);
create index if not exists dansms_orders_status_poll_idx
  on public.dansms_orders(status,last_polled_at);
alter table public.dansms_orders enable row level security;
revoke all on public.dansms_orders from public,anon,authenticated;
grant all on public.dansms_orders to service_role;

create or replace function public.bt_dansms_reserve_order(
 p_token uuid,p_reference text,p_service_code text,p_country_code text,
 p_supplier_cost_usd numeric,p_exchange_rate numeric,p_markup_kobo bigint,
 p_customer_charge_kobo bigint
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_customer uuid; v_balance bigint; v_order public.dansms_orders;
begin
 select customer_id into v_customer from public.customer_sessions
  where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'CUSTOMER_SESSION_EXPIRED'; end if;
 if p_reference is null or length(p_reference)<12 or p_service_code is null
   or p_country_code !~ '^\d{1,5}$' or p_supplier_cost_usd<=0
   or p_exchange_rate<=0 or p_markup_kobo<0
   or p_customer_charge_kobo<>ceil(p_supplier_cost_usd*p_exchange_rate*100)+p_markup_kobo then
   raise exception 'INVALID_DANSMS_PRICE';
 end if;
 insert into public.wallet_balances(customer_id,balance_kobo) values(v_customer,0)
  on conflict(customer_id) do nothing;
 update public.wallet_balances set balance_kobo=balance_kobo-p_customer_charge_kobo,updated_at=now()
  where customer_id=v_customer and balance_kobo>=p_customer_charge_kobo
  returning balance_kobo into v_balance;
 if v_balance is null then raise exception 'INSUFFICIENT_WALLET_BALANCE'; end if;
 insert into public.dansms_orders(customer_id,wallet_reference,service_code,country_code,
  supplier_cost_usd,exchange_rate,markup_kobo,customer_charge_kobo,status)
 values(v_customer,p_reference,p_service_code,p_country_code,p_supplier_cost_usd,
  p_exchange_rate,p_markup_kobo,p_customer_charge_kobo,'creating') returning * into v_order;
 insert into public.wallet_transactions(customer_id,reference,amount_kobo,transaction_type,description)
 values(v_customer,p_reference,-p_customer_charge_kobo,'debit','DanSMS verification number: '||p_service_code);
 return jsonb_build_object('success',true,'order_id',v_order.id,'balance',v_balance::numeric/100);
end;
$function$;

create or replace function public.bt_dansms_refund_order(
 p_reference text,p_final_status text,p_provider_response jsonb default null
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_order public.dansms_orders; v_refund_transaction_id uuid;
begin
 select * into v_order from public.dansms_orders where wallet_reference=p_reference for update;
 if v_order.id is null then raise exception 'DANSMS_ORDER_NOT_FOUND'; end if;
 if p_final_status not in ('cancelled','expired','failed') then raise exception 'INVALID_DANSMS_REFUND_STATUS'; end if;
 if v_order.refunded_at is null then
  -- Insert the unique refund ledger entry first. Credit the balance only if
  -- this transaction was newly inserted, so a replay can never double-credit.
  insert into public.wallet_transactions(customer_id,reference,amount_kobo,transaction_type,description)
   values(v_order.customer_id,'refund-'||p_reference,v_order.customer_charge_kobo,'refund',
    'DanSMS number order refund: '||v_order.service_code)
   on conflict(reference) do nothing
   returning id into v_refund_transaction_id;
  if v_refund_transaction_id is not null then
   update public.wallet_balances set balance_kobo=balance_kobo+v_order.customer_charge_kobo,updated_at=now()
    where customer_id=v_order.customer_id;
  end if;
 end if;
 update public.dansms_orders set status=p_final_status,refunded_at=coalesce(refunded_at,now()),
  provider_response=coalesce(p_provider_response,provider_response),updated_at=now()
  where id=v_order.id;
 return jsonb_build_object('success',true,'refunded',true,'already_refunded',v_order.refunded_at is not null);
end;
$function$;

create or replace function public.bt_dansms_claim_poll(
 p_token uuid,p_activation_id text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare v_order public.dansms_orders;
begin
 select * into v_order from public.dansms_orders
  where activation_id=p_activation_id and customer_id=(
   select customer_id from public.customer_sessions where token=p_token and expires_at>now()
  ) for update;
 if v_order.id is null then raise exception 'DANSMS_ORDER_NOT_FOUND'; end if;
 if v_order.status not in ('waiting','supplier_pending') then
  return jsonb_build_object('allowed',false,'status',v_order.status,'reason','terminal');
 end if;
 if v_order.last_polled_at is not null and v_order.last_polled_at>now()-interval '3 seconds' then
  return jsonb_build_object('allowed',false,'status',v_order.status,'reason','too_soon');
 end if;
 update public.dansms_orders set last_polled_at=now(),updated_at=now() where id=v_order.id;
 return jsonb_build_object('allowed',true,'status',v_order.status,'reference',v_order.wallet_reference);
end;
$function$;

revoke all on function public.bt_dansms_reserve_order(uuid,text,text,text,numeric,numeric,bigint,bigint) from public,anon,authenticated;
revoke all on function public.bt_dansms_refund_order(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.bt_dansms_claim_poll(uuid,text) from public,anon,authenticated;
grant execute on function public.bt_dansms_reserve_order(uuid,text,text,text,numeric,numeric,bigint,bigint) to service_role;
grant execute on function public.bt_dansms_refund_order(text,text,jsonb) to service_role;
grant execute on function public.bt_dansms_claim_poll(uuid,text) to service_role;
commit;
