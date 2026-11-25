-- All Ads Manager: persistent customer-to-customer chat reactions.
create table if not exists public.aam_chat_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.aam_chat_messages(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  emoji text not null check (emoji in ('👍','❤️','😂','😮','😢','🙏')),
  created_at timestamptz not null default now(),
  constraint aam_chat_message_reactions_one_per_customer unique (message_id, customer_id)
);

create index if not exists aam_chat_message_reactions_message_idx
  on public.aam_chat_message_reactions (message_id, created_at);

alter table public.aam_chat_message_reactions enable row level security;
-- All reads and writes are performed by the authenticated Netlify chat function
-- using the Supabase service-role key after checking chat participation.
