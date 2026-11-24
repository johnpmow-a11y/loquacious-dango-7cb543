-- All Ads Manager: customer Status audio and 15-minute chat edits.
alter table public.aam_social_statuses
  add column if not exists audio_path text;

alter table public.aam_chat_messages
  add column if not exists edited_at timestamptz;

create index if not exists aam_chat_messages_edit_window_idx
  on public.aam_chat_messages (id, sender_id, created_at);
