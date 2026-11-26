-- One-time advertising payment-method unlock per customer.
create table if not exists public.aam_ad_unlocks (
  customer_id uuid primary key,
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
alter table public.aam_ad_unlocks enable row level security;
revoke all on public.aam_ad_unlocks from anon, authenticated;
