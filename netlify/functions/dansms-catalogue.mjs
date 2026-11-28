import {json,dansms} from './_dansms.mjs';
import {adminSession} from './_nexotp.mjs';

export async function handler(event){
  if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
  try{
    const token=String(event.queryStringParameters?.token||'');
    if(!await adminSession(token))return json(401,{error:'Admin login required.'});

    const rawCountry=event.queryStringParameters?.country;
    const country=rawCountry===undefined||rawCountry===''?'187':String(rawCountry).trim();
    if(!/^\d+$/.test(country))return json(400,{error:'Country must be a numeric DanSMS country ID.'});

    const result=await dansms('getServicesAndCost',{country});
    return json(200,{ok:true,country:Number(country),catalogue:result});
  }catch(error){
    console.error('DanSMS catalogue request failed:',error.message);
    return json(error.status||502,{error:error.message||'Could not load DanSMS catalogue.'});
  }
}
