import {json,dansms} from './_dansms.mjs';
import {customerSession} from './_nexotp.mjs';
import {DANSMS_WHATSAPP_PRICES_NGN,DANSMS_LEGACY_COUNTRY_IDS} from './_dansms-pricing.mjs';

const COUNTRIES=Object.entries(DANSMS_LEGACY_COUNTRY_IDS).map(([code,id])=>({code,id}));
export async function handler(event){
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 try{
  const token=String(event.queryStringParameters?.token||'');
  if(!await customerSession(token))return json(401,{error:'Please log in again.'});
  const countryRaw=String(event.queryStringParameters?.country||'US').toUpperCase();
  const country=COUNTRIES.find(x=>x.code===countryRaw);
  if(!country)return json(400,{error:'Choose a supported country.'});
  const data=await dansms('getServicesAndCost',{country:country.id});
  const catalogue=data&&typeof data==='object'?data:{};
  const services=Object.entries(catalogue).map(([code,item])=>{
   const name=String(item?.name||item?.service||(code==='wa'?'WhatsApp':code));
   const wa=code.toLowerCase()==='wa'||/whats ?app/i.test(name+' '+code);
   const fixed=wa?DANSMS_WHATSAPP_PRICES_NGN[country.code]:null;
   return {service_code:String(code),name,country:country.code,available:Number(item?.count||0),
    customer_price_ngn:fixed?.customer??null,orderable:Boolean(fixed&&Number(item?.count||0)>0)};
  });
  return json(200,{country:country.code,countries:COUNTRIES,services});
 }catch(e){return json(e.status||502,{error:e.message||'Could not load DanSMS services.'});}
}
