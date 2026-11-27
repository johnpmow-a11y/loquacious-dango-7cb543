import {json,dansms,customerPriceUsd} from './_dansms.mjs';
import {customerSession} from './_nexotp.mjs';
export async function handler(event){
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 try{
  const token=String(event.queryStringParameters?.token||'');
  if(!await customerSession(token))return json(401,{error:'Please log in again.'});
  const country=String(event.queryStringParameters?.country||'').trim();
  if(!/^\d{1,5}$/.test(country))return json(400,{error:'Choose a valid DanSMS country code.'});
  const raw=await dansms({action:'getServicesAndCost',country});
  const parsed=typeof raw==='string'?JSON.parse(raw):raw;
  const services=Object.entries(parsed||{}).map(([code,value])=>{
   const cost=Number(value?.cost),count=Number(value?.count||0);
   const price=customerPriceUsd(cost);
   return {service_code:String(code),supplier_price_usd:price.supplier_usd,customer_price_ngn:price.customer_price_ngn,available:Number.isFinite(count)?count:0};
  }).filter(x=>/^[a-z0-9_-]{1,20}$/i.test(x.service_code));
  return json(200,{provider:'DanSMS',country,services});
 }catch(e){return json(e.status||502,{error:e.message||'Could not load DanSMS services.'});}
}