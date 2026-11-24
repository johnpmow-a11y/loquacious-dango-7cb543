import crypto from 'node:crypto';
import { sendPush } from './_push.mjs';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function db(path,options={}){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Supabase server configuration is missing.');const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>[]);if(!r.ok){const error=new Error(d.message||d.error||'Administrator call request failed.');error.code=d.code||'';error.status=r.status;throw error;}return d;}
async function broadcastCallSignal(callId,signal){
 const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!base||!key)return false;
 try{
  const response=await fetch(`${base}/realtime/v1/api/broadcast`,{
   method:'POST',
   headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
   body:JSON.stringify({messages:[{topic:`aam-call-${callId}`,event:'signal',payload:signal}]})
  });
  if(!response.ok){console.warn('Admin call Realtime broadcast failed:',response.status);return false;}
  return true;
 }catch(error){console.warn('Admin call Realtime broadcast unavailable:',error.message);return false;}
}
async function validAdmin(token){if(!uuid.test(token))return false;const rows=await db(`admin_sessions?select=token&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows.length===1;}
export async function handler(event){if(event.httpMethod==='OPTIONS')return json(204,{});if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});try{const b=JSON.parse(event.body||'{}'),token=String(b.token||''),action=String(b.action||'');if(!await validAdmin(token))return json(401,{error:'Administrator session expired.'});const hash=crypto.createHash('sha256').update(token).digest('hex');
 if(action==='status'){const id=String(b.call_id||'');if(!uuid.test(id))return json(400,{error:'A valid call ID is required.'});let calls=await db('aam_calls?select=id,status,created_at&caller_role=eq.admin&admin_session_hash=eq.'+hash+'&id=eq.'+encodeURIComponent(id)+'&limit=1');if(!calls.length)return json(404,{error:'Administrator call not found.'});let participants=await db('aam_call_participants?select=status,customer_id&call_id=eq.'+encodeURIComponent(id)+'&limit=1');if(calls[0].status==='active'&&participants[0]?.status==='invited'&&Date.now()-new Date(calls[0].created_at).getTime()>45000){const expired=await db('aam_calls?id=eq.'+encodeURIComponent(id)+'&caller_role=eq.admin&admin_session_hash=eq.'+hash+'&status=eq.active',{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'missed',ended_at:new Date().toISOString(),updated_at:new Date().toISOString()})});if(expired.length){await db('aam_call_participants?call_id=eq.'+encodeURIComponent(id)+'&status=in.(invited,accepted)',{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'ended'})});calls=[{...calls[0],status:'missed'}];participants=[{...participants[0],status:'ended'}];}}return json(200,{call:calls[0],participant:participants[0]||null});}
 if(action==='create'){const target=String(b.target_customer_id||''),type=String(b.call_type||'');if(!uuid.test(target)||!['audio','video'].includes(type))return json(400,{error:'Choose a valid customer and audio or video calling.'});const existingAdminCall=await db('aam_calls?select=id&caller_role=eq.admin&admin_session_hash=eq.'+hash+'&status=eq.active&limit=1');if(existingAdminCall.length)return json(409,{error:'End your active administrator call before starting another.'});const existingCustomerCall=await db(`aam_call_participants?select=call_id,call:aam_calls!inner(status)&customer_id=eq.${encodeURIComponent(target)}&status=in.(invited,accepted)&call.status=eq.active&limit=1`);if(existingCustomerCall.length)return json(409,{error:'This customer is already in another call.'});const profiles=await db(`aam_social_profiles?select=customer_id,adult_confirmed_at&customer_id=eq.${encodeURIComponent(target)}&limit=1`);if(!profiles.length||!profiles[0].adult_confirmed_at)return json(403,{error:'The customer must have confirmed they are 18 or older.'});const created=await db('aam_calls',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({caller_id:null,caller_role:'admin',admin_session_hash:hash,call_type:type,status:'active'})});const call=created[0];if(!call?.id)throw new Error('Could not create administrator call.');try{await db('aam_call_participants',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({call_id:call.id,customer_id:target,role:'callee',status:'invited'})});}catch(e){await db(`aam_calls?id=eq.${encodeURIComponent(call.id)}`,{method:'PATCH',body:JSON.stringify({status:'ended',ended_at:new Date().toISOString()})}).catch(()=>{});throw e;}await sendPush({role:'customer',customerId:target,title:type==='video'?'Incoming video call from All Ads Manager':'Incoming voice call from All Ads Manager',body:'An administrator is calling you. Open All Ads Manager to answer.',url:'/?incomingCall='+encodeURIComponent(call.id),tag:'aam-call-'+call.id}).catch(e=>console.warn('Admin call push failed:',e.message));return json(201,{call_id:call.id,call_type:type,status:'ringing'});}
 if(action==='signal_send'||action==='signal_list'){
  const id=String(b.call_id||'');
  if(!uuid.test(id))return json(400,{error:'A valid call ID is required.'});
  const calls=await db(`aam_calls?select=id,status,caller_role,admin_session_hash&id=eq.${encodeURIComponent(id)}&caller_role=eq.admin&admin_session_hash=eq.${hash}&status=eq.active&limit=1`);
  if(!calls.length)return json(403,{error:'This administrator session is not authorised for the call.'});
  const participants=await db(`aam_call_participants?select=customer_id,status&call_id=eq.${encodeURIComponent(id)}&limit=1`);
  const customerId=participants[0]?.customer_id||'';
  if(!uuid.test(customerId)||participants[0]?.status!=='accepted')return json(409,{error:'The customer has not accepted the call yet.'});
  if(action==='signal_send'){
   const type=String(b.signal_type||''),payload=b.payload;
   if(!['offer','answer','ice','hangup'].includes(type))return json(400,{error:'Unsupported call signal.'});
   const encoded=JSON.stringify(payload??null);
   if(encoded.length>24000)return json(413,{error:'Call signal is too large.'});
   if(type==='offer'||type==='answer'){
    if(!payload||typeof payload!=='object'||typeof payload.sdp!=='string'||payload.sdp.length>18000)return json(400,{error:'Invalid session description.'});
   }else if(type==='ice'&&(!payload||typeof payload!=='object'||typeof payload.candidate!=='string'||payload.candidate.length>5000)){
    return json(400,{error:'Invalid ICE candidate.'});
   }
   const inserted=await db('aam_call_signal_events',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({
    call_id:id,sender_identity:'admin:'+hash,recipient_identity:'customer:'+customerId,
    sender_role:'admin',recipient_role:'customer',signal_type:type,payload
   })});
   const signal=inserted[0];
   const realtime_notified=signal?await broadcastCallSignal(id,{id:signal.id,recipient_id:'customer:'+customerId}):false;
   return json(201,{sent:true,realtime_notified});
  }
  const after=String(b.after||'1970-01-01T00:00:00.000Z'),date=new Date(after);
  if(!Number.isFinite(date.getTime()))return json(400,{error:'Invalid signal cursor.'});
  const cursor=date>new Date(Date.now()-180000)?date:new Date(Date.now()-180000);
  const signals=await db(`aam_call_signal_events?select=id,sender_id:sender_identity,recipient_id:recipient_identity,signal_type,payload,created_at&call_id=eq.${encodeURIComponent(id)}&recipient_identity=eq.${encodeURIComponent('admin:'+hash)}&created_at=gt.${encodeURIComponent(cursor.toISOString())}&order=created_at.asc&limit=100`);
  return json(200,{signals});
 }
 if(action==='end'){const id=String(b.call_id||'');if(!uuid.test(id))return json(400,{error:'A valid call ID is required.'});const rows=await db(`aam_calls?id=eq.${encodeURIComponent(id)}&caller_role=eq.admin&admin_session_hash=eq.${hash}&status=eq.active`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:'ended',ended_at:new Date().toISOString(),updated_at:new Date().toISOString()})});if(!rows.length)return json(404,{error:'Administrator call not found or already ended.'});await db(`aam_call_participants?call_id=eq.${encodeURIComponent(id)}&status=in.(invited,accepted)`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'ended'})});return json(200,{status:'ended'});}
 return json(400,{error:'Unsupported administrator call action.'});
 }catch(e){console.error('Administrator LiveKit call:',e.message);if(e.code==='23505')return json(409,{error:'This administrator or customer already has an active call. End it before starting another.'});return json(500,{error:e.message||'Administrator call failed.'});}}
