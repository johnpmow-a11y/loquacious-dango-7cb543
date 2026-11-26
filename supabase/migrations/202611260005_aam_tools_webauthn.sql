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
