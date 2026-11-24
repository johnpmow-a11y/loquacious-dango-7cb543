-- Live typing state for All Ads Manager direct and group chats.
-- Additive only; message delivery, read receipts, auth and other services are unchanged.
begin;
alter table public.aam_chat_participants add column if not exists typing_at timestamptz;
create index if not exists aam_chat_participants_typing_at_idx on public.aam_chat_participants (conversation_id, typing_at);
commit;
