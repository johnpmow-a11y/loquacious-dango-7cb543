-- Each distinct advertising payment attempt has its own ₦3,800 unlock.
-- Also upgrades the earlier customer-wide table safely if it already exists.
create table if not exists public.aam_ad_unlocks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  attempt_id uuid,
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  amount_kobo integer not null default 380000 check (amount_kobo = 380000),
  reference text unique,
  authorization_url text,
  receipt_email text,
  payment_method text,
  unlocked_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.aam_ad_unlocks add column if not exists id uuid default gen_random_uuid();
alter table public.aam_ad_unlocks add column if not exists attempt_id uuid;
update public.aam_ad_unlocks set id=gen_random_uuid() where id is null;
update public.aam_ad_unlocks set attempt_id=gen_random_uuid() where attempt_id is null;
alter table public.aam_ad_unlocks alter column id set not null;
alter table public.aam_ad_unlocks alter column attempt_id set not null;
do $$ declare pk_name text; begin
  select conname into pk_name from pg_constraint where conrelid='public.aam_ad_unlocks'::regclass and contype='p';
  if pk_name is not null and not exists(select 1 from pg_constraint where conrelid='public.aam_ad_unlocks'::regclass and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (id)') then
    execute format('alter table public.aam_ad_unlocks drop constraint %I',pk_name);
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.aam_ad_unlocks'::regclass and contype='p') then
    alter table public.aam_ad_unlocks add constraint aam_ad_unlocks_pkey primary key(id);
  end if;
end $$;
create unique index if not exists aam_ad_unlocks_attempt_id_uidx on public.aam_ad_unlocks(attempt_id);
create index if not exists aam_ad_unlocks_customer_created_idx on public.aam_ad_unlocks(customer_id, created_at desc);
alter table public.aam_ad_unlocks enable row level security;
revoke all on public.aam_ad_unlocks from anon, authenticated;
