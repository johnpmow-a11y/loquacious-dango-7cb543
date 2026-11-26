-- ALL ADS MANAGER: CURRENT ADDITIVE SUPABASE UPDATES
-- STATUS: PENDING REVIEW ONLY — NOT EXECUTED.
-- IMPORTANT: The user has explicitly instructed that NO SQL be run yet.
-- Do not paste or execute this file in Supabase until the user explicitly authorizes it.
-- This consolidated file is provided for later review and one-step application only.
-- Project: ftwhcqrtmfxdzokmudvu
-- If the user later authorizes execution, review prerequisites and apply only after
-- confirming the existing core customer/session, social, calls, and wallet setup.
-- Safe to re-run: statements use IF NOT EXISTS / CREATE OR REPLACE where applicable.
-- IMPORTANT: This script does not configure VAPID keys; those belong in Netlify env vars.
-- WebRTC signaling requires the existing public.aam_calls and public.aam_call_participants tables.
-- Profile ID is BIGINT (10 digits). Do NOT also run the older ads-manager-public-profile-id.sql
-- because that older file attempts to create the same column as TEXT.



-- ============================================================
-- supabase/migrations/20261122180000_admin_wallet_show_zero_balances.sql
-- ============================================================

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



-- ============================================================
-- supabase/migrations/20261122190000_nexotp_wallet_orders.sql
-- ============================================================

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



-- ============================================================
-- supabase/migrations/20261124100000_chat_typing_indicators.sql
-- ============================================================

-- Live typing state for All Ads Manager direct and group chats.
-- Additive only; message delivery, read receipts, auth and other services are unchanged.
begin;
alter table public.aam_chat_participants add column if not exists typing_at timestamptz;
create index if not exists aam_chat_participants_typing_at_idx on public.aam_chat_participants (conversation_id, typing_at);
commit;



-- ============================================================
-- supabase/migrations/20261124120000_status_audio_chat_edit.sql
-- ============================================================

-- All Ads Manager: customer Status audio and 15-minute chat edits.
alter table public.aam_social_statuses
  add column if not exists audio_path text;

alter table public.aam_chat_messages
  add column if not exists edited_at timestamptz;

create index if not exists aam_chat_messages_edit_window_idx
  on public.aam_chat_messages (id, sender_id, created_at);



-- ============================================================
-- supabase/migrations/20261124_social_post_audio.sql
-- ============================================================

-- Optional audio tracks attached to photo/video social posts.
alter table public.aam_social_posts
  add column if not exists audio_path text;



-- ============================================================
-- supabase/migrations/20261124_social_public_profile_id.sql
-- ============================================================

-- All Ads Manager: stable 10-digit public profile IDs.
-- Safe to run more than once.
create sequence if not exists public.aam_social_public_profile_id_seq
  minvalue 1000000000 maxvalue 9999999999 start with 1000000000;

alter table public.aam_social_profiles
  add column if not exists public_profile_id bigint;

update public.aam_social_profiles
set public_profile_id = nextval('public.aam_social_public_profile_id_seq')
where public_profile_id is null;

alter table public.aam_social_profiles
  alter column public_profile_id set default nextval('public.aam_social_public_profile_id_seq'),
  alter column public_profile_id set not null;

create unique index if not exists aam_social_profiles_public_profile_id_uidx
  on public.aam_social_profiles(public_profile_id);

alter sequence public.aam_social_public_profile_id_seq
  owned by public.aam_social_profiles.public_profile_id;



-- ============================================================
-- supabase/ads-manager-push-notifications.sql
-- ============================================================

create table if not exists public.ads_manager_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('admin','customer')),
  customer_id text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ads_manager_push_role_customer_check check (
    (role = 'admin' and customer_id is null) or
    (role = 'customer' and customer_id is not null)
  )
);
create index if not exists ads_manager_push_role_customer_idx
  on public.ads_manager_push_subscriptions(role, customer_id);
alter table public.ads_manager_push_subscriptions enable row level security;
revoke all on public.ads_manager_push_subscriptions from anon, authenticated;



-- ============================================================
-- supabase/ads-manager-webrtc-signaling.sql
-- ============================================================

-- All Ads Manager: private, short-lived WebRTC signaling messages.
-- Run once in the Supabase SQL editor. Service-role Netlify functions are
-- the only intended writers/readers; browser clients must not access this table.

create table if not exists public.aam_call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.aam_calls(id) on delete cascade,
  sender_id uuid not null references public.customers(id) on delete cascade,
  recipient_id uuid not null references public.customers(id) on delete cascade,
  signal_type text not null check (signal_type in ('offer','answer','ice','hangup')),
  payload jsonb,
  created_at timestamptz not null default now(),
  constraint aam_call_signals_distinct_participants check (sender_id <> recipient_id)
);

create index if not exists aam_call_signals_recipient_poll_idx
  on public.aam_call_signals (call_id, recipient_id, created_at);

alter table public.aam_call_signals enable row level security;

revoke all on public.aam_call_signals from anon, authenticated;

-- Signals are intentionally short-lived. This cleanup can be run periodically.
delete from public.aam_call_signals
where created_at < now() - interval '1 day';


-- ============================================================
-- All Ads Manager: WebRTC signalling and advertising integration
-- These are idempotent additions; the base social/call tables must already exist.
-- ============================================================

-- 20261124150000_unified_webrtc_call_signals.sql
-- Unified signalling for customer-to-customer and administrator-to-customer WebRTC calls.
-- Only Netlify functions using the Supabase service role may access this table.
-- Intentionally does not delete or modify any existing call/customer data.
begin;

create table if not exists public.aam_call_signal_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.aam_calls(id) on delete cascade,
  sender_identity text not null,
  recipient_identity text not null,
  sender_role text not null check (sender_role in ('customer','admin')),
  recipient_role text not null check (recipient_role in ('customer','admin')),
  signal_type text not null check (signal_type in ('offer','answer','ice','hangup')),
  payload jsonb,
  created_at timestamptz not null default now(),
  constraint aam_call_signal_events_distinct_participants check (sender_identity <> recipient_identity)
);

create index if not exists aam_call_signal_events_recipient_idx
  on public.aam_call_signal_events (call_id, recipient_identity, created_at);

alter table public.aam_call_signal_events enable row level security;
revoke all on public.aam_call_signal_events from anon, authenticated;
grant all on public.aam_call_signal_events to service_role;

commit;

-- 202611260001_aam_ad_connections.sql
-- All Ads Manager: private customer-to-ad-platform connection metadata.
-- Provider OAuth tokens remain in Composio and are never stored in Supabase.
create table if not exists public.aam_ad_connections (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  platform text not null check (platform in ('facebook','instagram','tiktok','snapchat')),
  toolkit_slug text not null,
  connected_account_id text not null unique,
  connection_status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aam_ad_connections_customer_platform_idx
  on public.aam_ad_connections(customer_id, platform, updated_at desc);
alter table public.aam_ad_connections enable row level security;
revoke all on public.aam_ad_connections from anon, authenticated;

-- 202611260002_aam_ad_unlocks.sql
-- A successful ₦3,000 unlock opens a rolling 20-minute window.
-- Multiple ad campaigns/payments are allowed during the window; another fee is due only after expiry.
create table if not exists public.aam_ad_unlocks (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null, attempt_id uuid unique,
 platform text, status text not null default 'pending' check(status in ('pending','paid','failed')),
 amount_kobo integer not null default 300000 check(amount_kobo=300000), reference text unique,
 authorization_url text, receipt_email text, payment_method text,
 unlocked_at timestamptz, expires_at timestamptz, updated_at timestamptz not null default now(), created_at timestamptz not null default now()
);
alter table public.aam_ad_unlocks add column if not exists id uuid default gen_random_uuid();
alter table public.aam_ad_unlocks add column if not exists attempt_id uuid;
alter table public.aam_ad_unlocks add column if not exists platform text;
alter table public.aam_ad_unlocks add column if not exists expires_at timestamptz;
update public.aam_ad_unlocks set id=gen_random_uuid() where id is null;
update public.aam_ad_unlocks set attempt_id=gen_random_uuid() where attempt_id is null;
alter table public.aam_ad_unlocks alter column id set not null;
alter table public.aam_ad_unlocks alter column attempt_id set not null;

-- Older versions used customer_id as a primary/unique key. Remove that
-- restriction so a customer can create a new unlock record after expiry.
do $$
declare item record;
begin
  for item in
    select conname, contype, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid='public.aam_ad_unlocks'::regclass
      and (
        (contype='p' and pg_get_constraintdef(oid) <> 'PRIMARY KEY (id)')
        or (contype='u' and pg_get_constraintdef(oid) = 'UNIQUE (customer_id)')
      )
  loop
    execute format('alter table public.aam_ad_unlocks drop constraint %I',item.conname);
  end loop;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.aam_ad_unlocks'::regclass
      and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (id)'
  ) then
    alter table public.aam_ad_unlocks add constraint aam_ad_unlocks_pkey primary key(id);
  end if;
end $$;

do $$
declare item record;
begin
  for item in
    select indexname from pg_indexes
    where schemaname='public' and tablename='aam_ad_unlocks'
      and indexdef ilike 'create unique index%'
      and indexdef ilike '%(customer_id)'
  loop
    execute format('drop index if exists public.%I',item.indexname);
  end loop;
end $$;
create unique index if not exists aam_ad_unlocks_attempt_id_uidx on public.aam_ad_unlocks(attempt_id);
create index if not exists aam_ad_unlocks_customer_created_idx on public.aam_ad_unlocks(customer_id,created_at desc);
create index if not exists aam_ad_unlocks_active_window_idx on public.aam_ad_unlocks(customer_id,expires_at desc) where status='paid';
alter table public.aam_ad_unlocks enable row level security;
revoke all on public.aam_ad_unlocks from anon,authenticated;
grant all on public.aam_ad_unlocks to service_role;

-- 202611260003_aam_ad_inbox.sql
-- All Ads Manager: persistent ownership map for customer-created advertising campaigns.
-- This lets the existing customer Inbox route each ad conversation to its owner.
create table if not exists public.aam_ad_campaign_assets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','tiktok')),
  toolkit_slug text not null,
  connected_account_id text not null,
  ad_account_id text,
  campaign_id text,
  ad_set_id text,
  ad_group_id text,
  creative_id text,
  ad_id text,
  page_id text,
  post_id text,
  object_story_id text,
  provider_result jsonb not null default '{}'::jsonb,
  sync_cursor text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists aam_ad_campaign_assets_owner_platform_campaign_uidx
  on public.aam_ad_campaign_assets(customer_id, platform, campaign_id)
  where campaign_id is not null;
create index if not exists aam_ad_campaign_assets_customer_idx
  on public.aam_ad_campaign_assets(customer_id, platform, updated_at desc);
create index if not exists aam_ad_campaign_assets_post_idx
  on public.aam_ad_campaign_assets(platform, post_id)
  where post_id is not null;

-- External ad conversations/messages are stored separately from private customer chats,
-- but are merged into the same Inbox API/UI. No public or authenticated direct access.
create table if not exists public.aam_ad_inbox_threads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  campaign_asset_id uuid references public.aam_ad_campaign_assets(id) on delete set null,
  platform text not null check (platform in ('facebook','instagram','tiktok')),
  provider_thread_id text not null,
  provider_post_id text,
  provider_ad_id text,
  thread_title text not null default 'Ad conversation',
  sender_name text,
  sender_avatar_url text,
  last_message text,
  last_message_at timestamptz not null default now(),
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, platform, provider_thread_id)
);
create index if not exists aam_ad_inbox_threads_customer_idx
  on public.aam_ad_inbox_threads(customer_id, last_message_at desc);

create table if not exists public.aam_ad_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.aam_ad_inbox_threads(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  provider_message_id text not null,
  sender_name text not null default 'Ad visitor',
  sender_external_id text,
  message_text text not null default '',
  message_kind text not null default 'comment' check (message_kind in ('comment','reply','messenger','direct')),
  is_from_customer boolean not null default false,
  provider_parent_message_id text,
  provider_created_at timestamptz,
  created_at timestamptz not null default now(),
  unique(thread_id, provider_message_id)
);
create index if not exists aam_ad_inbox_messages_thread_idx
  on public.aam_ad_inbox_messages(thread_id, provider_created_at asc);

alter table public.aam_ad_campaign_assets enable row level security;
alter table public.aam_ad_inbox_threads enable row level security;
alter table public.aam_ad_inbox_messages enable row level security;
revoke all on public.aam_ad_campaign_assets, public.aam_ad_inbox_threads, public.aam_ad_inbox_messages from anon, authenticated;
grant all on public.aam_ad_campaign_assets, public.aam_ad_inbox_threads, public.aam_ad_inbox_messages to service_role;

-- 202611260004_aam_ad_inbox_provider_metadata.sql
-- Preserve provider-specific ad comment fields needed for safe replies (notably TikTok identity metadata).
alter table public.aam_ad_inbox_messages
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

alter table public.aam_ad_campaign_assets
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;


-- ============================================================
-- supabase/migrations/202611260005_aam_tools_webauthn.sql
-- STATUS: PENDING ONLY — NOT EXECUTED.
-- ============================================================

-- All Ads Manager: server-verified WebAuthn credentials for the TOOLS gate.
-- PENDING ONLY. Do not execute until the user explicitly authorizes SQL changes.
create table if not exists public.aam_tools_webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0 check (counter >= 0),
  transports text[] not null default '{}',
  device_type text,
  backed_up boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, credential_id)
);
create index if not exists aam_tools_webauthn_credentials_customer_idx
  on public.aam_tools_webauthn_credentials(customer_id, created_at desc);
alter table public.aam_tools_webauthn_credentials enable row level security;
revoke all on public.aam_tools_webauthn_credentials from public, anon, authenticated;
grant all on public.aam_tools_webauthn_credentials to service_role;

create table if not exists public.aam_tools_webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  action text not null check (action in ('registration','authentication')),
  challenge text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists aam_tools_webauthn_challenges_lookup_idx
  on public.aam_tools_webauthn_challenges(customer_id, action, expires_at desc);
alter table public.aam_tools_webauthn_challenges enable row level security;
revoke all on public.aam_tools_webauthn_challenges from public, anon, authenticated;
grant all on public.aam_tools_webauthn_challenges to service_role;
