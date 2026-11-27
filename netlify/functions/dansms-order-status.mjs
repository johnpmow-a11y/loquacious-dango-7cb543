import {json,dansms} from './_dansms.mjs';
import {db,customerSession} from './_nexotp.mjs';
const terminal=['completed','cancelled','expired','failed'];
export async function handler(event){
 try{
  const token=String(event.queryStringParameters?.token||''),activationId=String(event.queryStringParameters?.activation_id||'');
  const session=await customerSession(token);if(!session)return json(401,{error:'Please log in again.'});
  if(!/^\d{1,20}$/.test(activationId))return json(400,{error:'Missing or invalid activation ID.'});
  const rows=await db('dansms_orders?select=*&activation_id=eq.'+encodeURIComponent(activationId)+'&customer_id=eq.'+encodeURIComponent(session.customer_id)+'&limit=1');
  if(!rows.length)return json(404,{error:'DanSMS order not found.'});
  const local=rows[0];
  if(event.httpMethod==='GET'){
   if(terminal.includes(local.status))return json(200,{order:{id:activationId,service:local.service_code,number:local.phone_number,status:local.status,pin:local.otp_code,customer_price_ngn:Number(local.customer_charge_kobo)/100}});
   const claim=await db('rpc/bt_dansms_claim_poll',{method:'POST',body:JSON.stringify({p_token:token,p_activation_id:activationId})});
   if(!claim?.allowed)return json(200,{order:{id:activationId,service:local.service_code,number:local.phone_number,status:local.status,pin:local.otp_code,customer_price_ngn:Number(local.customer_charge_kobo)/100},poll_skipped:claim?.reason||'not_allowed'});
   const raw=await dansms({action:'getStatus',id:activationId}),reply=String(raw||'').trim();
   if(reply==='STATUS_WAIT_CODE'){
    await db('dansms_orders?activation_id=eq.'+encodeURIComponent(activationId),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'waiting',updated_at:new Date().toISOString(),provider_response:{status:reply}})});
    return json(200,{order:{id:activationId,service:local.service_code,number:local.phone_number,status:'waiting',customer_price_ngn:Number(local.customer_charge_kobo)/100}});
   }
   if(reply==='STATUS_CANCEL'){
    await db('rpc/bt_dansms_refund_order',{method:'POST',body:JSON.stringify({p_reference:local.wallet_reference,p_final_status:new Date(local.expires_at)<=new Date()?'expired':'cancelled',p_provider_response:{status:reply,source:'provider_terminal_status'}})});
    return json(200,{order:{id:activationId,service:local.service_code,number:local.phone_number,status:'cancelled',refunded:true,customer_price_ngn:Number(local.customer_charge_kobo)/100}});
   }
   const match=reply.match(/^STATUS_OK:(\d+)$/);
   if(match){
    await db('dansms_orders?activation_id=eq.'+encodeURIComponent(activationId),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'completed',otp_code:match[1],updated_at:new Date().toISOString(),provider_response:{status:'STATUS_OK'}})});
    try{await dansms({action:'setStatus',id:activationId,status:6});}catch(e){console.error('DanSMS code acknowledgement failed:',activationId,e.message);}
    return json(200,{order:{id:activationId,service:local.service_code,number:local.phone_number,status:'completed',pin:match[1],customer_price_ngn:Number(local.customer_charge_kobo)/100}});
   }
   return json(502,{error:'DanSMS returned an unrecognised activation status. Your order remains on record.'});
  }
  if(event.httpMethod==='POST'){
   let body={};try{body=JSON.parse(event.body||'{}')}catch{}
   if(body.action!=='cancel')return json(400,{error:'Unsupported DanSMS order action.'});
   if(local.status!=='waiting'||!local.activation_id)return json(409,{error:'This activation can no longer be cancelled.'});
   const reply=String(await dansms({action:'setStatus',id:activationId,status:8})).trim();
   if(reply==='ACCESS_ACTIVATION')return json(409,{error:'The code has already been received. This activation cannot be refunded.'});
   if(reply!=='ACCESS_CANCEL')return json(502,{error:'DanSMS did not confirm cancellation. Your wallet funds remain held until the order is checked.'});
   await db('rpc/bt_dansms_refund_order',{method:'POST',body:JSON.stringify({p_reference:local.wallet_reference,p_final_status:'cancelled',p_provider_response:{response:reply,source:'customer_cancel'}})});
   return json(200,{success:true,message:'Number cancelled. Your wallet has been refunded.'});
  }
  return json(405,{error:'Method not allowed.'});
 }catch(e){return json(e.status||500,{error:e.message||'Could not update DanSMS order.'});}
}
