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
