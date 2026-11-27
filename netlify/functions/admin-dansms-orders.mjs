import {json,db,adminSession} from './_nexotp.mjs';
export async function handler(event){
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 try{
  const token=String(event.queryStringParameters?.token||'');
  if(!await adminSession(token))return json(401,{error:'Administrator login required.'});
  const rows=await db('dansms_orders?select=id,customer_id,wallet_reference,activation_id,service_code,country_code,phone_number,supplier_cost_usd,customer_charge_kobo,status,expires_at,refunded_at,provider_response,created_at,updated_at&order=created_at.desc&limit=200');
  return json(200,{orders:rows.map(x=>({...x,customer_price_ngn:Number(x.customer_charge_kobo)/100}))});
 }catch(e){return json(e.status||500,{error:e.message||'Could not load DanSMS monitoring.'});}
}
