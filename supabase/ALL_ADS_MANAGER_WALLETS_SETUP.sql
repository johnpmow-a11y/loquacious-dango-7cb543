-- All Ads Manager — Customer + Administrator Wallet Setup
-- Safe, additive, repeatable setup for the current Supabase project.
-- Includes customer Paystack deposits, customer balance RPC, and the separate Admin Wallet.
-- Run this complete file in the Supabase SQL Editor if the wallet migration status is uncertain.
-- It does not alter Paystack keys, email settings, customer login, or existing balances.

-- ADS Manager Paystack wallet deposits (NGN).
-- Apply once in the EXISTING project: ftwhcqrtmfxdzokmudvu.
-- Card PAN, CVV, PIN and authentication codes are never stored here.

begin;

create table if not exists public.wallet_deposits (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  customer_id uuid not null references public.customers(id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo between 10000 and 300000000),
  currency text not null default 'NGN' check (currency = 'NGN'),
  method text not null check (method in ('bank_transfer','card')),
  email text not null,
  status text not null default 'pending' check (status in ('pending','success','failed','reversed','initialization_failed')),
  paystack_transaction_id text unique,
  paystack_channel text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_balances (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  balance_kobo bigint not null default 0 check (balance_kobo >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  reference text not null unique,
  amount_kobo bigint not null,
  currency text not null default 'NGN',
  transaction_type text not null check (transaction_type in ('deposit','debit','refund')),
  status text not null default 'success',
  description text not null,
  created_at timestamptz not null default now()
);

-- Keep the correct limits even when this migration is re-run on a table
-- created by the earlier draft. Amounts are stored in kobo.
alter table public.wallet_deposits drop constraint if exists wallet_deposits_amount_kobo_check;
alter table public.wallet_deposits add constraint wallet_deposits_amount_kobo_check
  check (amount_kobo between 10000 and 300000000);

alter table public.wallet_deposits enable row level security;
alter table public.wallet_balances enable row level security;
alter table public.wallet_transactions enable row level security;
revoke all on public.wallet_deposits, public.wallet_balances, public.wallet_transactions from public, anon, authenticated;
grant all on public.wallet_deposits, public.wallet_balances, public.wallet_transactions to service_role;

-- Called only by the trusted Netlify server after Paystack signature and
-- transaction verification. A unique reference makes webhook retries safe.
create or replace function public.bt_paystack_credit_deposit(
  p_reference text,
  p_transaction_id text,
  p_channel text,
  p_paid_at timestamptz,
  p_amount_kobo bigint,
  p_currency text
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  d public.wallet_deposits;
begin
  select * into d from public.wallet_deposits where reference = p_reference for update;
  if d.id is null then raise exception 'Deposit reference not found'; end if;
  if d.amount_kobo <> p_amount_kobo or d.currency <> upper(p_currency) then
    raise exception 'Verified payment amount or currency does not match';
  end if;
  if d.status = 'success' then
    return jsonb_build_object('success', true, 'alreadyCredited', true);
  end if;
  if d.status <> 'pending' then raise exception 'Deposit is not pending'; end if;

  update public.wallet_deposits
  set status = 'success', paystack_transaction_id = p_transaction_id,
      paystack_channel = p_channel, paid_at = coalesce(p_paid_at, now())
  where id = d.id;

  insert into public.wallet_balances(customer_id, balance_kobo)
  values (d.customer_id, d.amount_kobo)
  on conflict (customer_id) do update
    set balance_kobo = public.wallet_balances.balance_kobo + excluded.balance_kobo,
        updated_at = now();

  insert into public.wallet_transactions(customer_id, reference, amount_kobo, transaction_type, description)
  values (d.customer_id, d.reference, d.amount_kobo, 'deposit',
          case when d.method = 'card' then 'Paystack card payment' else 'Paystack bank transfer' end);

  return jsonb_build_object('success', true, 'alreadyCredited', false);
end;
$function$;

create or replace function public.bt_customer_wallet_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_customer_id uuid; v_balance bigint;
begin
  select customer_id into v_customer_id from public.customer_sessions
  where token = p_token and expires_at > now();
  if v_customer_id is null then raise exception 'Invalid or expired customer session'; end if;
  select coalesce(balance_kobo,0) into v_balance from public.wallet_balances where customer_id=v_customer_id;
  return jsonb_build_object(
    'balance', coalesce(v_balance,0)::numeric / 100,
    'transactions', coalesce((select jsonb_agg(jsonb_build_object(
      'reference', reference, 'amount', amount_kobo::numeric/100,
      'type', transaction_type, 'status', status, 'description', description,
      'created_at', created_at
    ) order by created_at desc) from public.wallet_transactions where customer_id=v_customer_id), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.bt_admin_wallet_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'Invalid or expired admin session'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'customer_id', b.customer_id, 'customer_name', c.name,
    'balance', b.balance_kobo::numeric/100, 'updated_at', b.updated_at
  ) order by c.name) from public.wallet_balances b join public.customers c on c.id=b.customer_id), '[]'::jsonb);
end;
$function$;


create or replace function public.bt_admin_wallet_transactions_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'Invalid or expired admin session'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'customer_name', c.name, 'amount', d.amount_kobo::numeric/100,
    'method', d.method, 'status', d.status, 'reference', d.reference,
    'created_at', d.created_at, 'paid_at', d.paid_at
  ) order by d.created_at desc) from public.wallet_deposits d
    join public.customers c on c.id=d.customer_id), '[]'::jsonb);
end;
$function$;

revoke all on function public.bt_paystack_credit_deposit(text,text,text,timestamptz,bigint,text) from public, anon, authenticated;
grant execute on function public.bt_paystack_credit_deposit(text,text,text,timestamptz,bigint,text) to service_role;
revoke all on function public.bt_customer_wallet_get(uuid) from public, anon, authenticated;
grant execute on function public.bt_customer_wallet_get(uuid) to anon, authenticated;
revoke all on function public.bt_admin_wallet_get(uuid) from public, anon, authenticated;
grant execute on function public.bt_admin_wallet_get(uuid) to anon, authenticated;

revoke all on function public.bt_admin_wallet_transactions_get(uuid) from public, anon, authenticated;
grant execute on function public.bt_admin_wallet_transactions_get(uuid) to anon, authenticated;

commit;


-- All Ads Manager: separate universal administrator wallet.
-- Additive only: customer wallet tables, deposits, and purchase RPCs are unchanged.
begin;

create table if not exists public.admin_wallet_balances (
  id smallint primary key default 1 check (id = 1),
  balance_kobo bigint not null default 0 check (balance_kobo >= 0),
  updated_at timestamptz not null default now()
);
insert into public.admin_wallet_balances(id,balance_kobo) values(1,0)
on conflict(id) do nothing;

create table if not exists public.admin_wallet_deposits (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  amount_kobo bigint not null check (amount_kobo between 10000 and 300000000),
  currency text not null default 'NGN' check(currency='NGN'),
  email text not null,
  status text not null default 'pending'
    check(status in ('pending','success','failed','reversed','initialization_failed')),
  paystack_transaction_id text unique,
  paystack_channel text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  amount_kobo bigint not null,
  transaction_type text not null check(transaction_type in ('deposit','debit','refund','adjustment')),
  description text not null,
  provider text,
  service_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_supplier_purchases (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  provider text not null,
  service_name text not null,
  supplier_order_id text,
  supplier_cost_kobo bigint not null check(supplier_cost_kobo > 0),
  status text not null default 'reserved'
    check(status in ('reserved','supplier_pending','pending','completed','failed','refund_pending','refunded')),
  supplier_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_supplier_purchases_created_idx
  on public.admin_supplier_purchases(created_at desc);

alter table public.admin_wallet_balances enable row level security;
alter table public.admin_wallet_deposits enable row level security;
alter table public.admin_wallet_transactions enable row level security;
alter table public.admin_supplier_purchases enable row level security;
revoke all on public.admin_wallet_balances, public.admin_wallet_deposits,
  public.admin_wallet_transactions, public.admin_supplier_purchases
  from public, anon, authenticated;
grant all on public.admin_wallet_balances, public.admin_wallet_deposits,
  public.admin_wallet_transactions, public.admin_supplier_purchases to service_role;

create or replace function public.bt_admin_personal_wallet_get(p_token uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_balance bigint;
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'ADMIN_SESSION_EXPIRED'; end if;
  select balance_kobo into v_balance from public.admin_wallet_balances where id=1;
  return jsonb_build_object(
    'balance',coalesce(v_balance,0)::numeric/100,
    'transactions',coalesce((select jsonb_agg(jsonb_build_object(
      'reference',reference,'amount',amount_kobo::numeric/100,
      'type',transaction_type,'description',description,'provider',provider,
      'service_name',service_name,'created_at',created_at
    ) order by created_at desc) from public.admin_wallet_transactions),'[]'::jsonb),
    'deposits',coalesce((select jsonb_agg(jsonb_build_object(
      'reference',reference,'amount',amount_kobo::numeric/100,'status',status,
      'email',email,'created_at',created_at,'paid_at',paid_at
    ) order by created_at desc) from public.admin_wallet_deposits),'[]'::jsonb),
    'purchases',coalesce((select jsonb_agg(jsonb_build_object(
      'reference',reference,'provider',provider,'service_name',service_name,
      'supplier_order_id',supplier_order_id,'supplier_cost',supplier_cost_kobo::numeric/100,
      'status',status,'supplier_response',supplier_response,'created_at',created_at,'updated_at',updated_at
    ) order by created_at desc) from public.admin_supplier_purchases),'[]'::jsonb)
  );
end;
$function$;

create or replace function public.bt_admin_wallet_credit_deposit(
  p_token uuid,p_reference text,p_transaction_id text,p_channel text,
  p_paid_at timestamptz,p_amount_kobo bigint,p_currency text
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare d public.admin_wallet_deposits;
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'ADMIN_SESSION_EXPIRED'; end if;
  select * into d from public.admin_wallet_deposits where reference=p_reference for update;
  if d.id is null then raise exception 'ADMIN_DEPOSIT_NOT_FOUND'; end if;
  if d.amount_kobo<>p_amount_kobo or d.currency<>upper(p_currency) then
    raise exception 'ADMIN_DEPOSIT_AMOUNT_MISMATCH';
  end if;
  if d.status='success' then return jsonb_build_object('success',true,'already_credited',true); end if;
  if d.status<>'pending' then raise exception 'ADMIN_DEPOSIT_NOT_PENDING'; end if;
  update public.admin_wallet_deposits set status='success',
    paystack_transaction_id=p_transaction_id,paystack_channel=p_channel,
    paid_at=coalesce(p_paid_at,now()) where id=d.id;
  update public.admin_wallet_balances set balance_kobo=balance_kobo+d.amount_kobo,
    updated_at=now() where id=1;
  insert into public.admin_wallet_transactions(reference,amount_kobo,transaction_type,description)
    values(d.reference,d.amount_kobo,'deposit','Paystack administrator wallet funding');
  return jsonb_build_object('success',true,'already_credited',false);
end;
$function$;

-- Webhook variant: Paystack's signed server-to-server event has no browser admin token.
create or replace function public.bt_admin_wallet_credit_deposit_webhook(
  p_reference text,p_transaction_id text,p_channel text,
  p_paid_at timestamptz,p_amount_kobo bigint,p_currency text
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare d public.admin_wallet_deposits;
begin
  select * into d from public.admin_wallet_deposits where reference=p_reference for update;
  if d.id is null then raise exception 'ADMIN_DEPOSIT_NOT_FOUND'; end if;
  if d.amount_kobo<>p_amount_kobo or d.currency<>upper(p_currency) then
    raise exception 'ADMIN_DEPOSIT_AMOUNT_MISMATCH';
  end if;
  if d.status='success' then return jsonb_build_object('success',true,'already_credited',true); end if;
  if d.status<>'pending' then raise exception 'ADMIN_DEPOSIT_NOT_PENDING'; end if;
  update public.admin_wallet_deposits set status='success',
    paystack_transaction_id=p_transaction_id,paystack_channel=p_channel,
    paid_at=coalesce(p_paid_at,now()) where id=d.id;
  update public.admin_wallet_balances set balance_kobo=balance_kobo+d.amount_kobo,
    updated_at=now() where id=1;
  insert into public.admin_wallet_transactions(reference,amount_kobo,transaction_type,description)
    values(d.reference,d.amount_kobo,'deposit','Paystack administrator wallet funding');
  return jsonb_build_object('success',true,'already_credited',false);
end;
$function$;

create or replace function public.bt_admin_wallet_reserve_purchase(
  p_token uuid,p_reference text,p_provider text,p_service_name text,p_supplier_cost_kobo bigint
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_balance bigint; v_purchase public.admin_supplier_purchases;
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'ADMIN_SESSION_EXPIRED'; end if;
  if p_reference is null or length(p_reference)<12 or p_provider is null
     or p_service_name is null or p_supplier_cost_kobo<=0 then
    raise exception 'INVALID_ADMIN_PURCHASE';
  end if;
  -- Serialize all reservations before checking the idempotency reference.
  -- This prevents concurrent requests from spending the same wallet balance.
  select balance_kobo into v_balance from public.admin_wallet_balances where id=1 for update;
  select * into v_purchase from public.admin_supplier_purchases where reference=p_reference;
  if v_purchase.id is not null then
    if v_purchase.provider<>p_provider
       or v_purchase.service_name<>p_service_name
       or v_purchase.supplier_cost_kobo<>p_supplier_cost_kobo then
      raise exception 'ADMIN_PURCHASE_REFERENCE_CONFLICT';
    end if;
    return jsonb_build_object('purchase_id',v_purchase.id,'status',v_purchase.status,'already_reserved',true);
  end if;
  if coalesce(v_balance,0)<p_supplier_cost_kobo then raise exception 'INSUFFICIENT_ADMIN_WALLET_BALANCE'; end if;
  update public.admin_wallet_balances set balance_kobo=balance_kobo-p_supplier_cost_kobo,updated_at=now() where id=1;
  insert into public.admin_supplier_purchases(reference,provider,service_name,supplier_cost_kobo,status)
    values(p_reference,p_provider,p_service_name,p_supplier_cost_kobo,'reserved') returning * into v_purchase;
  insert into public.admin_wallet_transactions(reference,amount_kobo,transaction_type,description,provider,service_name)
    values(p_reference,-p_supplier_cost_kobo,'debit','Admin supplier purchase: '||p_service_name,p_provider,p_service_name);
  return jsonb_build_object('purchase_id',v_purchase.id,'status',v_purchase.status,'already_reserved',false);
end;
$function$;

create or replace function public.bt_admin_wallet_update_purchase(
  p_token uuid,p_reference text,p_supplier_order_id text,p_status text,p_supplier_response jsonb default null
) returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_purchase public.admin_supplier_purchases;
begin
  if not exists(select 1 from public.admin_sessions where token=p_token and expires_at>now())
    then raise exception 'ADMIN_SESSION_EXPIRED'; end if;
  if p_status not in ('supplier_pending','pending','completed','failed','refund_pending','refunded') then
    raise exception 'INVALID_ADMIN_PURCHASE_STATUS';
  end if;
  select * into v_purchase from public.admin_supplier_purchases where reference=p_reference for update;
  if v_purchase.id is null then raise exception 'ADMIN_PURCHASE_NOT_FOUND'; end if;
  if v_purchase.status='refunded' then
    return jsonb_build_object('success',true,'status','refunded','already_refunded',true);
  end if;
  if p_status in ('failed','refunded') then
    if not exists(select 1 from public.admin_wallet_transactions where reference='refund-'||p_reference) then
      update public.admin_wallet_balances set balance_kobo=balance_kobo+v_purchase.supplier_cost_kobo,
        updated_at=now() where id=1;
      insert into public.admin_wallet_transactions(reference,amount_kobo,transaction_type,description,provider,service_name)
        values('refund-'||p_reference,v_purchase.supplier_cost_kobo,'refund',
          'Refund: admin supplier purchase '||v_purchase.service_name,v_purchase.provider,v_purchase.service_name);
    end if;
    p_status:='refunded';
  end if;
  update public.admin_supplier_purchases set supplier_order_id=coalesce(p_supplier_order_id,supplier_order_id),
    status=p_status,supplier_response=coalesce(p_supplier_response,supplier_response),updated_at=now()
    where id=v_purchase.id;
  return jsonb_build_object('success',true,'status',p_status);
end;
$function$;

revoke all on function public.bt_admin_personal_wallet_get(uuid) from public,anon,authenticated;
revoke all on function public.bt_admin_wallet_credit_deposit(uuid,text,text,text,timestamptz,bigint,text) from public,anon,authenticated;
revoke all on function public.bt_admin_wallet_reserve_purchase(uuid,text,text,text,bigint) from public,anon,authenticated;
revoke all on function public.bt_admin_wallet_update_purchase(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bt_admin_personal_wallet_get(uuid) to service_role;
grant execute on function public.bt_admin_wallet_credit_deposit(uuid,text,text,text,timestamptz,bigint,text) to service_role;
revoke all on function public.bt_admin_wallet_credit_deposit_webhook(text,text,text,timestamptz,bigint,text) from public,anon,authenticated;
grant execute on function public.bt_admin_wallet_credit_deposit_webhook(text,text,text,timestamptz,bigint,text) to service_role;
grant execute on function public.bt_admin_wallet_reserve_purchase(uuid,text,text,text,bigint) to service_role;
grant execute on function public.bt_admin_wallet_update_purchase(uuid,text,text,text,jsonb) to service_role;

commit;



-- NexOTP customer wallet orders
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
