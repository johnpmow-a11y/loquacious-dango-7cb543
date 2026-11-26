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
