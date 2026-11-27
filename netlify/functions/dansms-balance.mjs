import {json,dansms} from './_dansms.mjs';
import {adminSession} from './_nexotp.mjs';

export async function handler(event){
  if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
  try{
    const token=String(event.queryStringParameters?.token||'');
    if(!await adminSession(token))return json(401,{error:'Admin login required.'});
    const result=await dansms('getBalance');
    const raw=typeof result==='string'?result:(result?.balance??result?.data?.balance??null);
    const match=typeof raw==='string'?raw.match(/(?:ACCESS_BALANCE:)?([0-9]+(?:\.[0-9]+)?)/):null;
    const balance=match?Number(match[1]):(typeof raw==='number'?raw:null);
    return json(200,{ok:true,balance,raw:balance===null?result:undefined});
  }catch(error){
    console.error('DanSMS balance check failed:',error.message);
    return json(error.status||502,{error:error.message||'Could not check DanSMS balance.'});
  }
}
