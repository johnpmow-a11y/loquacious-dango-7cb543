import {json,dansms,adminSession} from './_dansms.mjs';

export async function handler(event){
  if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
  try{
    const token=String(event.queryStringParameters?.token||'');
    if(!await adminSession(token))return json(401,{error:'Admin login required.'});
    const result=await dansms('getServicesAndCost');
    return json(200,{ok:true,catalogue:result});
  }catch(error){
    console.error('DanSMS catalogue request failed:',error.message);
    return json(error.status||502,{error:error.message||'Could not load DanSMS catalogue.'});
  }
}
