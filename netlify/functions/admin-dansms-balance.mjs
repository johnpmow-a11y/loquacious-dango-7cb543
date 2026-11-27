import {json,dansms} from './_dansms.mjs';
import {adminSession} from './_nexotp.mjs';
export async function handler(event){
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 try{
  const token=String(event.queryStringParameters?.token||'');
  if(!await adminSession(token))return json(401,{error:'Admin login required.'});
  const raw=await dansms({action:'getBalance'});
  const text=String(raw);
  const match=text.match(/ACCESS_BALANCE:([0-9]+(?:\.[0-9]+)?)/i);
  if(!match)return json(502,{error:'DanSMS returned an unrecognized balance response.'});
  return json(200,{provider:'DanSMS',balance_usd:Number(match[1]),currency:'USD'});
 }catch(e){return json(e.status||502,{error:e.message||'Could not check DanSMS balance.'});}
}