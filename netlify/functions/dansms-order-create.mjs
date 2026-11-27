import {randomUUID} from 'node:crypto';
import {json,dansms,customerPriceUsd,activationResponse} from './_dansms.mjs';
import {db,customerSession} from './_nexotp.mjs';
export async function handler(event){
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
 let reference='';
 try{
  const b=JSON.parse(event.body||'{}'),token=String(b.token||''),country=String(b.country??'187').trim(),serviceCode=String(b.service_code||'').trim();
  if(!/^\d{1,5}$/.test(country)||!/^[a-z0-9_-]{1,20}$/i.test(serviceCode))return json(400,{error:'Choose a valid DanSMS country and service.'});
  const session=await customerSession(token);if(!session)return json(401,{error:'Please log in again.'});
  const raw=await dansms({action:'getServicesAndCost',country}),catalog=typeof raw==='string'?JSON.parse(raw):raw;
  const service=catalog?.[serviceCode],stock=Number(service?.count||0);
  if(!service||!Number.isFinite(stock)||stock<1)return json(409,{error:'This DanSMS service is out of stock. Refresh the catalogue.'});
  const price=customerPriceUsd(service.cost);
  reference='dansms-'+Date.now()+'-'+randomUUID().replace(/-/g,'').slice(0,12);
  const reserved=await db('rpc/bt_dansms_reserve_order',{method:'POST',body:JSON.stringify({
   p_token:token,p_reference:reference,p_service_code:serviceCode,p_country_code:country,
   p_supplier_cost_usd:price.supplier_usd,p_exchange_rate:price.exchange_rate,
   p_markup_kobo:price.markup_kobo,p_customer_charge_kobo:price.customer_charge_kobo
  })});
  let provider,supplierCreated=false;
  try{provider=await dansms({action:'getNumber',service:serviceCode,country});}
  catch(e){
   if(!e.status||e.definitive!==true&&(e.status>=500||e.status===429)){
    try{await db('dansms_orders?wallet_reference=eq.'+encodeURIComponent(reference),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'supplier_pending',provider_response:{uncertain:true,error:e.message},updated_at:new Date().toISOString()})});}catch(saveError){console.error('DanSMS uncertain reservation needs reconciliation:',reference,saveError.message);}
    return json(202,{pending:true,reference,message:'DanSMS confirmation is uncertain. Your wallet funds are held safely. Do not purchase again.'});
   }
   await db('rpc/bt_dansms_refund_order',{method:'POST',body:JSON.stringify({p_reference:reference,p_final_status:'failed',p_provider_response:{error:e.message}})});
   return json(e.status||502,{error:'DanSMS could not reserve the number. Your wallet has been refunded.'});
  }
  supplierCreated=true;
  let activation;
  try{activation=activationResponse(provider);}catch(e){
   await db('dansms_orders?wallet_reference=eq.'+encodeURIComponent(reference),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'supplier_pending',provider_response:{unrecognized_response:String(provider)},updated_at:new Date().toISOString()})});
   return json(202,{pending:true,reference,message:'DanSMS returned an unexpected response. Your funds are held while the order is checked. Do not purchase again.'});
  }
  await db('dansms_orders?wallet_reference=eq.'+encodeURIComponent(reference),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({
   activation_id:activation.activation_id,phone_number:activation.phone_number,status:'waiting',
   provider_response:{activation_created:true},updated_at:new Date().toISOString()
  })});
  return json(200,{order:{id:activation.activation_id,service:serviceCode,number:activation.phone_number,status:'waiting',customer_price_ngn:price.customer_price_ngn,expires_at:new Date(Date.now()+20*60*1000).toISOString()},balance:reserved.balance});
 }catch(e){
  if(reference&&supplierCreated){try{await db('dansms_orders?wallet_reference=eq.'+encodeURIComponent(reference),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'supplier_pending',provider_response:{reconciliation_required:true,error:e.message},updated_at:new Date().toISOString()})});}catch(saveError){console.error('DanSMS issued activation needs reconciliation:',reference,saveError.message);}return json(202,{pending:true,reference,message:'DanSMS may have issued your number, but saving its details failed. Your funds remain held. Do not purchase again.'});}
  if(reference){try{const rows=await db('dansms_orders?select=activation_id,status&wallet_reference=eq.'+encodeURIComponent(reference)+'&limit=1');if(rows[0]&&!rows[0].activation_id&&rows[0].status==='creating')await db('rpc/bt_dansms_refund_order',{method:'POST',body:JSON.stringify({p_reference:reference,p_final_status:'failed',p_provider_response:{error:e.message}})});}catch(refundError){console.error('DanSMS refund recovery required:',reference,refundError.message);}}
  return json(e.status||500,{error:e.message||'Could not create DanSMS order.'});
 }
}
