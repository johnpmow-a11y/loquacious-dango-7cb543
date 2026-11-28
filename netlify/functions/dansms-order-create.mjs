import {randomUUID} from 'node:crypto';
import {json,dansms} from './_dansms.mjs';
import {db,customerSession} from './_nexotp.mjs';
import {DANSMS_WHATSAPP_PRICES_NGN,DANSMS_LEGACY_COUNTRY_IDS} from './_dansms-pricing.mjs';

export async function handler(event){
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
 let reference='',providerNumberIssued=false;
 try{
  const body=JSON.parse(event.body||'{}'),token=String(body.token||''),code=String(body.service_code||'').trim(),country=String(body.country||'US').toUpperCase();
  if(!await customerSession(token))return json(401,{error:'Please log in again.'});
  const countryId=DANSMS_LEGACY_COUNTRY_IDS[country],fixed=DANSMS_WHATSAPP_PRICES_NGN[country];
  if(!code||!countryId||!fixed)return json(400,{error:'This DanSMS service has no confirmed customer price and cannot be ordered.'});
  const catalogue=await dansms('getServicesAndCost',{country:countryId});
  const item=catalogue?.[code];
  if(!item||Number(item.count||0)<1||!(code.toLowerCase()==='wa'||/whats ?app/i.test(String(item.name||item.service||code))))
   return json(409,{error:'This WhatsApp service is unavailable. Refresh the catalogue.'});
  const supplierKobo=Math.round(fixed.supplier*100),markupKobo=Math.round(fixed.markup*100),chargeKobo=Math.round(fixed.customer*100);
  if(supplierKobo+markupKobo!==chargeKobo)return json(503,{error:'DanSMS price configuration needs administrator review.'});
  reference='dansms-'+Date.now()+'-'+randomUUID().replace(/-/g,'').slice(0,10);
  const reserved=await db('rpc/bt_dansms_reserve_order',{method:'POST',body:JSON.stringify({
   p_token:token,p_reference:reference,p_service_code:code,p_service_name:String(item.name||item.service||code),
   p_country_id:countryId,p_country_code:country,p_supplier_price_kobo:supplierKobo,p_markup_kobo:markupKobo,p_customer_charge_kobo:chargeKobo
  })});
  let response;
  try{response=await dansms('getNumber',{service:code,country:countryId});}
  catch(e){
   if(['BAD_KEY','BAD_ACTION','BAD_SERVICE','NO_BALANCE','NO_NUMBERS','ACCESS_DISABLED','TOO_MANY_REQUESTS'].includes(e.providerCode)){
    await db('rpc/bt_dansms_refund_order',{method:'POST',body:JSON.stringify({p_reference:reference,p_status:'failed',p_provider_response:{provider_code:e.providerCode}})});
    return json(409,{error:'DanSMS could not issue a number. Your wallet has been refunded.'});
   }
   await db('dansms_orders?wallet_reference=eq.'+encodeURIComponent(reference),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'supplier_pending',provider_response:{uncertain:true,message:e.message},updated_at:new Date().toISOString()})});
   return json(202,{pending:true,reference,message:'DanSMS confirmation is uncertain. Your funds are held safely while the order is checked. Do not buy again.'});
  }
  const raw=typeof response==='string'?response:String(response?.response||response?.data||'');
  const match=raw.match(/^ACCESS_NUMBER:([^:]+):(.+)$/);
  if(!match){
   await db('dansms_orders?wallet_reference=eq.'+encodeURIComponent(reference),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'supplier_pending',provider_response:response,updated_at:new Date().toISOString()})});
   return json(202,{pending:true,reference,message:'DanSMS returned an unrecognized activation response. Funds are held for reconciliation; do not buy again.'});
  }
  const [,activationId,phone]=match;providerNumberIssued=true;
  await db('dansms_orders?wallet_reference=eq.'+encodeURIComponent(reference),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({activation_id:activationId,phone_number:phone,status:'waiting',provider_response:response,updated_at:new Date().toISOString()})});
  return json(200,{order:{reference,activation_id:activationId,service:String(item.name||code),country,number:phone,status:'waiting',customer_price_ngn:fixed.customer},balance:reserved.balance});
 }catch(e){
  if(reference&&providerNumberIssued){
   try{await db('dansms_orders?wallet_reference=eq.'+encodeURIComponent(reference),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'supplier_pending',provider_response:{reconciliation_required:true,message:e.message},updated_at:new Date().toISOString()})});}catch(saveError){console.error('DanSMS issued activation needs reconciliation:',reference,saveError.message);}
   return json(202,{pending:true,reference,message:'DanSMS issued the number, but its details are still being saved. Funds are held safely; do not buy again.'});
  }
  if(reference){
   try{await db('rpc/bt_dansms_refund_order',{method:'POST',body:JSON.stringify({p_reference:reference,p_status:'failed',p_provider_response:{error:e.message}})});}
   catch(refundError){console.error('DanSMS refund recovery required:',reference,refundError.message);}
  }
  return json(e.status||500,{error:e.message||'Could not create DanSMS order.'});
 }
}
