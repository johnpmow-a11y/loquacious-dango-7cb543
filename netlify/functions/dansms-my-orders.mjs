import {json,db,customerSession} from './_nexotp.mjs';
export async function handler(event){
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 try{
  const token=String(event.queryStringParameters?.token||''),session=await customerSession(token);
  if(!session)return json(401,{error:'Please log in again.'});
  const rows=await db('dansms_orders?select=wallet_reference,service_name,country_code,phone_number,otp_code,status,customer_charge_kobo,activation_id,created_at&customer_id=eq.'+encodeURIComponent(session.customer_id)+'&order=created_at.desc&limit=50');
  return json(200,{orders:rows.map(o=>({...o,customer_price_ngn:Number(o.customer_charge_kobo)/100}))});
 }catch(e){return json(e.status||500,{error:e.message||'Could not load DanSMS orders.'});}
}
