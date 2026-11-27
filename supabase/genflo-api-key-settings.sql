-- Run once in the Supabase SQL Editor for the All Ads Manager project.
create table if not exists public.aam_provider_api_keys (
  provider text primary key,
  api_key text not null,
  updated_at timestamptz not null default now()
);
alter table public.aam_provider_api_keys enable row level security;
revoke all on public.aam_provider_api_keys from anon, authenticated;
