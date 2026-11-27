-- Add WhatsApp-style View Once media to direct chat.
-- Additive only: existing messages, wallets, login, payments and email are unchanged.
begin;
alter table public.aam_chat_messages
  add column if not exists view_once boolean not null default false,
  add column if not exists viewed_at timestamptz;

create or replace function public.aam_chat_send_v2(
 p_token uuid,p_conversation uuid,p_body text,p_type text,p_media_path text,p_shared_post uuid,p_view_once boolean default false
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_other uuid; v_id uuid; v_body text; v_type text; v_path text; v_once boolean;
begin
 select customer_id into v_customer from public.customer_sessions where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 if not exists(select 1 from public.aam_chat_participants where conversation_id=p_conversation and customer_id=v_customer) then raise exception 'Conversation not found'; end if;
 select customer_id into v_other from public.aam_chat_participants where conversation_id=p_conversation and customer_id<>v_customer limit 1;
 if v_other is null then raise exception 'Conversation recipient not found'; end if;
 v_type=coalesce(p_type,'text');v_body=coalesce(p_body,'');v_path=nullif(coalesce(p_media_path,''),'');v_once=coalesce(p_view_once,false);
 if v_type not in ('text','image','video','voice','shared_post') then raise exception 'Unsupported message type'; end if;
 if v_type='text' and length(trim(v_body))=0 then raise exception 'Write a message first'; end if;
 if length(v_body)>5000 then raise exception 'Message is too long'; end if;
 if v_type='voice' and (v_path is null or v_path not like 'voice/'||v_customer::text||'/%') then raise exception 'Invalid voice note'; end if;
 if v_type in ('image','video') and (v_path is null or v_path not like v_customer::text||'/chat/%') then raise exception 'Invalid media attachment'; end if;
 if v_once and v_type not in ('image','video') then raise exception 'View Once is available for pictures and videos only'; end if;
 if v_type='shared_post' and (p_shared_post is null or not exists(select 1 from public.aam_social_posts where id=p_shared_post and moderation_status='published')) then raise exception 'Shared post is unavailable'; end if;
 insert into public.aam_chat_messages(conversation_id,sender_id,message_type,body,media_path,shared_post_id,view_once)
 values(p_conversation,v_customer,v_type,v_body,v_path,p_shared_post,v_once) returning id into v_id;
 update public.aam_chat_conversations set updated_at=now() where id=p_conversation;
 insert into public.aam_social_notifications(recipient_id,actor_id,event_type,title,body,message_id)
 values(v_other,v_customer,case when v_type='shared_post' then 'share' else 'message' end,'New message',
 case when v_once then 'Sent a view-once media message' when v_type='voice' then 'Sent a voice note' when v_type='shared_post' then 'Shared a post' when v_type in ('image','video') then 'Sent media' else left(v_body,180) end,v_id);
 return jsonb_build_object('ok',true,'message_id',v_id,'view_once',v_once);
end $$;

create or replace function public.aam_chat_view_once(p_token uuid,p_message_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_customer uuid; v_message public.aam_chat_messages%rowtype;
begin
 select customer_id into v_customer from public.customer_sessions where token=p_token and expires_at>now();
 if v_customer is null then raise exception 'Session expired'; end if;
 select m.* into v_message
 from public.aam_chat_messages m
 join public.aam_chat_participants p on p.conversation_id=m.conversation_id and p.customer_id=v_customer
 where m.id=p_message_id and m.deleted_at is null and m.view_once=true
 for update of m;
 if not found then raise exception 'This view-once message is unavailable'; end if;
 if v_message.sender_id=v_customer then raise exception 'The sender cannot open their own view-once message'; end if;
 if v_message.viewed_at is not null then raise exception 'This view-once message has already been opened'; end if;
 if v_message.media_path is null or v_message.message_type not in ('image','video') then raise exception 'View-once media is unavailable'; end if;
 update public.aam_chat_messages set viewed_at=now() where id=p_message_id;
 return jsonb_build_object('ok',true,'media_path',v_message.media_path,'message_type',v_message.message_type);
end $$;

revoke all on function public.aam_chat_send_v2(uuid,uuid,text,text,text,uuid,boolean) from public,anon,authenticated;
revoke all on function public.aam_chat_view_once(uuid,uuid) from public,anon,authenticated;
grant execute on function public.aam_chat_send_v2(uuid,uuid,text,text,text,uuid,boolean) to service_role;
grant execute on function public.aam_chat_view_once(uuid,uuid) to service_role;
commit;
