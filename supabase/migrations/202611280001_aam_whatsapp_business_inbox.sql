-- WhatsApp Business inbound-message routing into the existing All Ads Manager Inbox.
create table if not exists public.aam_whatsapp_business_numbers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone_number text,
  connected_account_id text,
  connection_status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aam_whatsapp_business_numbers_customer_idx
  on public.aam_whatsapp_business_numbers(customer_id, updated_at desc);
alter table public.aam_whatsapp_business_numbers enable row level security;
revoke all on public.aam_whatsapp_business_numbers from anon, authenticated;
grant all on public.aam_whatsapp_business_numbers to service_role;

-- Preserve WhatsApp provider identifiers and media metadata on Inbox threads/messages.
alter table public.aam_ad_inbox_threads
  drop constraint if exists aam_ad_inbox_threads_platform_check;
alter table public.aam_ad_inbox_threads
  add constraint aam_ad_inbox_threads_platform_check
  check (platform in ('facebook','instagram','tiktok','whatsapp'));
alter table public.aam_ad_inbox_messages
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;
