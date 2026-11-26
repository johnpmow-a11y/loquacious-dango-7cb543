-- X Ads OAuth 1.0a customer connections.
-- PENDING REVIEW ONLY. Do not execute until the user explicitly authorizes SQL.
create table if not exists public.aam_x_oauth_states (
  oauth_token text primary key,
  oauth_token_secret_ciphertext text not null,
  oauth_token_secret_iv text not null,
  oauth_token_secret_tag text not null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists aam_x_oauth_states_expiry_idx on public.aam_x_oauth_states(expires_at);
create table if not exists public.aam_x_ad_connections (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  x_user_id text not null,
  x_username text not null,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  access_token_tag text not null,
  access_secret_ciphertext text not null,
  access_secret_iv text not null,
  access_secret_tag text not null,
  connection_status text not null default 'AUTHORIZED' check (connection_status in ('AUTHORIZED','ACTIVE','REVOKED','ERROR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.aam_x_oauth_states enable row level security;
alter table public.aam_x_ad_connections enable row level security;
revoke all on public.aam_x_oauth_states from anon, authenticated;
revoke all on public.aam_x_ad_connections from anon, authenticated;
grant all on public.aam_x_oauth_states to service_role;
grant all on public.aam_x_ad_connections to service_role;
