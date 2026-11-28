import {json,dansms} from './_dansms.mjs';
import {db,customerSession} from './_nexotp.mjs';

export async function handler(event){
 if(!['GET','POST'].includes(event.httpMethod))return json(405,{error:'Method not allowed.'});
 try{
  const token=String(event.queryStringParameters?.token||'');
  const session=await customerSession(token);
  if(!session)return json(401,{error:'Please log in again.'});
  const reference=String(event.queryStringParameters?.reference||'');
  if(!reference)return json(400,{error:'Missing order reference.'});
  const rows=await db('dansms_orders?select=*&wallet_reference=eq.'+encodeURIComponent(reference)+'&customer_id=eq.'+encodeURIComponent(session.customer_id)+'&limit=1');
  if(!rows.length)return json(404,{error:'Order not found.'});
  const order=rows[0];
  if(event.httpMethod==='POST')return json(409,{error:'Cancellation is disabled until DanSMS cancellation status codes are confirmed. Your number remains active.'});
  if(!order.activation_id)return json(202,{order:{reference,status:order.status,number:order.phone_number||null,otp:null},pending:true});
  if(order.otp_code)return json(200,{order:{reference,status:order.status,number:order.phone_number,otp:order.otp_code,customer_price_ngn:Number(order.customer_charge_kobo)/100}});
  const result=await dansms('getStatus',{id:order.activation_id});
  const raw=typeof result==='string'?result:String(result?.status||result?.response||'');
  if(raw.startsWith('STATUS_OK:')){
   const otp=raw.slice('STATUS_OK:'.length).trim();
   if(!otp)return json(502,{error:'DanSMS returned an empty OTP.'});
   await db('dansms_orders?wallet_reference=eq.'+encodeURIComponent(reference),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({otp_code:otp,status:'received',updated_at:new Date().toISOString()})});
   // Mark activation complete only after the OTP has been safely saved.
   try{await dansms('setStatus',{id:order.activation_id,status:6});}
   catch(e){console.error('DanSMS activation completion pending:',order.activation_id,e.message);}
   return json(200,{order:{reference,status:'received',number:order.phone_number,otp,customer_price_ngn:Number(order.customer_charge_kobo)/100}});
  }
  const status=raw.startsWith('STATUS_CANCEL')?'cancelled':raw.startsWith('STATUS_WAIT_CODE')?'waiting':'waiting';
  if(status==='cancelled'){
   await db('rpc/bt_dansms_refund_order',{method:'POST',body:JSON.stringify({p_reference:reference,p_status:'cancelled',p_provider_response:result})});
   return json(200,{order:{reference,status:'cancelled',number:order.phone_number,otp:null},refunded:true});
  }
  return json(200,{order:{reference,status,number:order.phone_number,otp:null},pending:true});
 }catch(e){return json(e.status||502,{error:e.message||'Could not refresh DanSMS OTP.',provider_code:e.providerCode||null,pending:e.providerCode==='TOO_MANY_REQUESTS'||e.providerCode==='ERROR_PROVIDER'});}
}
