import { createHmac, timingSafeEqual } from 'node:crypto';

const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
async function db(path,options={}) {
  const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key) throw new Error('Database service is not configured.');
  const r=await fetch(base+'/rest/v1/'+path,{...options,headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json',...(options.headers||{})}});
  const d=await r.json().catch(()=>[]);
  if(!r.ok){const e=new Error(d.message||'Database request failed.');e.status=r.status;e.code=d.code;throw e;}
  return d;
}
function rawBody(event){const body=event.body||'';return event.isBase64Encoded?Buffer.from(body,'base64'):Buffer.from(body,'utf8');}
function validSignature(raw,header,secret){
  if(!header||!secret||!/^sha256=[a-f0-9]{64}$/i.test(header))return false;
  const expected=Buffer.from('sha256='+createHmac('sha256',secret).update(raw).digest('hex'));
  const actual=Buffer.from(header);
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
function messageText(m){
  if(m.text?.body)return m.text.body;
  if(m.button?.text)return m.button.text;
  if(m.interactive?.button_reply?.title)return m.interactive.button_reply.title;
  if(m.interactive?.list_reply?.title)return m.interactive.list_reply.title;
  if(m.image?.caption)return m.image.caption;
  if(m.video?.caption)return m.video.caption;
  if(m.document?.caption)return m.document.caption;
  const type=String(m.type||'message');
  return '['+type+' message]';
}
async function persistStatus(customerId,status,phoneNumberId,wabaId){
  const messageId=String(status.id||'').trim(),state=String(status.status||'').toLowerCase();
  if(!messageId||!['sent','delivered','read','failed'].includes(state))return false;
  const rows=await db('aam_ad_inbox_messages?select=id,provider_metadata&customer_id=eq.'+encodeURIComponent(customerId)+'&provider_message_id=eq.'+encodeURIComponent(messageId)+'&provider_metadata->>provider=eq.whatsapp&provider_metadata->>phone_number_id=eq.'+encodeURIComponent(phoneNumberId)+'&provider_metadata->>waba_id=eq.'+encodeURIComponent(wabaId)+'&limit=2');
  // Require one exact match; never update an ambiguous provider message ID.
  if(rows.length!==1)return false;
  const row=rows[0];
  const metadata=row.provider_metadata&&typeof row.provider_metadata==='object'?row.provider_metadata:{};
  const next={...metadata,delivery_status:state,status_timestamp:status.timestamp?new Date(Number(status.timestamp)*1000).toISOString():new Date().toISOString(),status_recipient_id:status.recipient_id||null,status_phone_number_id:phoneNumberId,status_waba_id:wabaId,status_errors:Array.isArray(status.errors)?status.errors:[]};
  await db('aam_ad_inbox_messages?id=eq.'+encodeURIComponent(row.id)+'&customer_id=eq.'+encodeURIComponent(customerId),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({provider_metadata:next})});
  return true;
}
async function persistMessage(customerId,phoneNumberId,displayPhone,wabaId,message,profileName){
  const sender=String(message.from||'').trim(),messageId=String(message.id||'').trim();
  if(!sender||!messageId)return false;
  const threadKey=phoneNumberId+':'+sender;
  const at=message.timestamp?new Date(Number(message.timestamp)*1000).toISOString():new Date().toISOString();
  const body=messageText(message);
  const found=await db('aam_ad_inbox_threads?select=id,unread_count&customer_id=eq.'+encodeURIComponent(customerId)+'&platform=eq.whatsapp&provider_thread_id=eq.'+encodeURIComponent(threadKey)+'&limit=1');
  let thread=found[0];
  if(!thread){
    const created=await db('aam_ad_inbox_threads?on_conflict=customer_id,platform,provider_thread_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({customer_id:customerId,platform:'whatsapp',provider_thread_id:threadKey,thread_title:'WhatsApp Business message',sender_name:profileName||sender,last_message:body,last_message_at:at,unread_count:0})});
    thread=created[0]||(await db('aam_ad_inbox_threads?select=id,unread_count&customer_id=eq.'+encodeURIComponent(customerId)+'&platform=eq.whatsapp&provider_thread_id=eq.'+encodeURIComponent(threadKey)+'&limit=1'))[0];
  }
  if(!thread)return false;
  const inserted=await db('aam_ad_inbox_messages?on_conflict=thread_id,provider_message_id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({thread_id:thread.id,customer_id:customerId,provider_message_id:messageId,sender_name:profileName||sender,sender_external_id:sender,message_text:body,message_kind:'direct',is_from_customer:false,provider_created_at:at,provider_metadata:{provider:'whatsapp',message_type:message.type||'text',phone_number_id:phoneNumberId,waba_id:wabaId,display_phone_number:displayPhone||null,raw:message}})});
  if(!inserted.length)return false;
  await db('aam_ad_inbox_threads?id=eq.'+encodeURIComponent(thread.id)+'&customer_id=eq.'+encodeURIComponent(customerId),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({last_message:body,last_message_at:at,unread_count:Number(thread.unread_count||0)+1,sender_name:profileName||sender,updated_at:new Date().toISOString()})});
  return true;
}
export async function handler(event){
  if(event.httpMethod==='GET'){
    const q=event.queryStringParameters||{},verify=process.env.META_WEBHOOK_VERIFY_TOKEN;
    if(!verify)return json(503,{error:'WhatsApp webhook verification is not configured.'});
    if(q['hub.mode']==='subscribe'&&q['hub.verify_token']===verify)return {statusCode:200,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'},body:String(q['hub.challenge']||'')};
    return json(403,{error:'Webhook verification failed.'});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  try{
    const raw=rawBody(event),secret=process.env.META_APP_SECRET;
    if(!validSignature(raw,event.headers?.['x-hub-signature-256']||event.headers?.['X-Hub-Signature-256'],secret))return json(401,{error:'Invalid webhook signature.'});
    const payload=JSON.parse(raw.toString('utf8'));
    if(payload.object!=='whatsapp_business_account')return json(200,{ok:true,ignored:true});
    let imported=0,status_updates=0;
    for(const entry of payload.entry||[]){
      const wabaId=String(entry.id||'');
      for(const change of entry.changes||[]){
        if(change.field!=='messages')continue;
        const value=change.value||{},phoneNumberId=String(value.metadata?.phone_number_id||'');
        if(!phoneNumberId)continue;
        const mappings=await db('aam_whatsapp_business_numbers?select=customer_id,waba_id,display_phone_number,connection_status&phone_number_id=eq.'+encodeURIComponent(phoneNumberId)+'&waba_id=eq.'+encodeURIComponent(wabaId)+'&connection_status=eq.ACTIVE&limit=2');
        // Bind each webhook event to both the registered business phone and its WABA.
        // A phone-number match alone must never route another business account's event.
        if(mappings.length!==1)continue;
        const mapping=mappings[0];if(!mapping||String(mapping.waba_id)!==wabaId)continue;
        const profiles=new Map((value.contacts||[]).map(c=>[String(c.wa_id||''),c.profile?.name||'']));
        for(const message of value.messages||[]){
          if(await persistMessage(mapping.customer_id,phoneNumberId,mapping.display_phone_number,wabaId||mapping.waba_id,message,profiles.get(String(message.from||''))))imported++;
        }
        for(const status of value.statuses||[]){
          if(await persistStatus(mapping.customer_id,status,phoneNumberId,wabaId||mapping.waba_id))status_updates++;
        }
      }
    }
    return json(200,{ok:true,imported,status_updates});
  }catch(error){console.error('WhatsApp Business webhook:',error);return json(error.status||500,{error:'Could not process WhatsApp Business event.'});}
}
