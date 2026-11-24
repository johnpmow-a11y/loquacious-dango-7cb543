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
