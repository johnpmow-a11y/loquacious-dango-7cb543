-- WhatsApp-style direct message actions for All Ads Manager.
-- Additive only: existing customer login, sessions, wallets and payments are untouched.
begin;
alter table public.aam_chat_messages
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;

create table if not exists public.aam_chat_message_reactions (
  message_id uuid not null references public.aam_chat_messages(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  emoji text not null check (emoji in ('👍','❤️','😂','😮','😢','🙏','🔥','👏','😍','🎉')),
  created_at timestamptz not null default now(),
  primary key(message_id,customer_id)
);
alter table public.aam_chat_message_reactions enable row level security;
revoke all on public.aam_chat_message_reactions from public,anon,authenticated;
grant all on public.aam_chat_message_reactions to service_role;

create or replace function public.aam_chat_edit_message(p_token uuid,p_message_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_message public.aam_chat_messages%rowtype; v_body text;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 v_body=trim(coalesce(p_body,''));
 if length(v_body)<1 or length(v_body)>5000 then raise exception 'Message must be between 1 and 5,000 characters'; end if;
 select * into v_message from public.aam_chat_messages where id=p_message_id for update;
 if not found or v_message.sender_id<>v_customer then raise exception 'You can only edit your own messages'; end if;
 if v_message.deleted_at is not null then raise exception 'This message was deleted'; end if;
 if v_message.message_type<>'text' then raise exception 'Only text messages can be edited'; end if;
 if v_message.created_at<now()-interval '15 minutes' then raise exception 'The 15-minute edit period has expired'; end if;
 update public.aam_chat_messages set body=v_body,edited_at=now() where id=p_message_id;
 update public.aam_chat_conversations set updated_at=now() where id=v_message.conversation_id;
 return jsonb_build_object('ok',true,'edited_at',now());
end $$;

create or replace function public.aam_chat_delete_message(p_token uuid,p_message_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_message public.aam_chat_messages%rowtype;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 select * into v_message from public.aam_chat_messages where id=p_message_id for update;
 if not found or v_message.sender_id<>v_customer then raise exception 'You can only delete your own messages'; end if;
 if v_message.deleted_at is not null then return jsonb_build_object('ok',true); end if;
 update public.aam_chat_messages set deleted_at=now(),body='',media_path=null,shared_post_id=null,message_type='text'
 where id=p_message_id;
 delete from public.aam_chat_message_reactions where message_id=p_message_id;
 update public.aam_chat_conversations set updated_at=now() where id=v_message.conversation_id;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.aam_chat_toggle_reaction(p_token uuid,p_message_id uuid,p_emoji text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_conversation uuid; v_existing text; v_reacted boolean;
begin
 select customer_id into v_customer from public.customer_sessions
 where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if p_emoji not in ('👍','❤️','😂','😮','😢','🙏','🔥','👏','😍','🎉') then raise exception 'Choose a supported reaction'; end if;
 select conversation_id into v_conversation from public.aam_chat_messages
 where id=p_message_id and deleted_at is null;
 if v_conversation is null then raise exception 'Message is unavailable'; end if;
 if not exists(select 1 from public.aam_chat_participants where conversation_id=v_conversation and customer_id=v_customer) then raise exception 'Conversation not found'; end if;
 select emoji into v_existing from public.aam_chat_message_reactions where message_id=p_message_id and customer_id=v_customer;
 if v_existing=p_emoji then
   delete from public.aam_chat_message_reactions where message_id=p_message_id and customer_id=v_customer;
   v_reacted=false;
 else
   insert into public.aam_chat_message_reactions(message_id,customer_id,emoji)
   values(p_message_id,v_customer,p_emoji)
   on conflict(message_id,customer_id) do update set emoji=excluded.emoji,created_at=now();
   v_reacted=true;
 end if;
 return jsonb_build_object('ok',true,'reacted',v_reacted);
end $$;

revoke all on function public.aam_chat_edit_message(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.aam_chat_delete_message(uuid,uuid) from public,anon,authenticated;
revoke all on function public.aam_chat_toggle_reaction(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.aam_chat_edit_message(uuid,uuid,text) to service_role;
grant execute on function public.aam_chat_delete_message(uuid,uuid) to service_role;
grant execute on function public.aam_chat_toggle_reaction(uuid,uuid,text) to service_role;
commit;
