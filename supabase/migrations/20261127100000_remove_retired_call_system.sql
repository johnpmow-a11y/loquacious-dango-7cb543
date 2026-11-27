-- Remove the retired calling subsystem only.
-- Customer accounts, sessions, profiles, chats, notifications and wallet ledgers are untouched.
begin;
drop function if exists public.aam_social_charge_call_avatar(uuid, uuid);
drop table if exists public.aam_call_avatar_purchases;
drop table if exists public.aam_call_participants;
drop table if exists public.aam_calls;
commit;
