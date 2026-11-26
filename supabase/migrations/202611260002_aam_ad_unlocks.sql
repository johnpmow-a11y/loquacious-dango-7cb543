-- Each distinct advertising payment attempt has its own ₦3,800 unlock.
-- Re-entering the ad payment flow creates a new attempt and requires a new unlock.
create table if not exists public.aam_ad_unlocks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  attempt_id uuid not null unique,
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
create index if not exists aam_ad_unlocks_customer_created_idx on public.aam_ad_unlocks(customer_id, created_at desc);
alter table public.aam_ad_unlocks enable row level security;
revoke all on public.aam_ad_unlocks from anon, authenticated;
