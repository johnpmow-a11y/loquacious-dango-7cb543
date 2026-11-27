import {json,dansms} from './_dansms.mjs';
import {adminSession} from './_nexotp.mjs';

export async function handler(event){
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 try{
  const token=String(event.queryStringParameters?.token||'');
  if(!await adminSession(token))return json(401,{error:'Administrator login required.'});
  // Read-only capability probe. This never reserves, cancels, or acknowledges a number.
  const raw=await dansms({action:'getCountries'});
  const parsed=typeof raw==='string'?JSON.parse(raw):raw;
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
   return json(502,{error:'DanSMS returned an unexpected country-list response.'});
  const source=parsed.countries&&typeof parsed.countries==='object'?parsed.countries:parsed;
  const countries=Object.entries(source).filter(([id,value])=>/^\\d{1,5}$/.test(id)&&value&&typeof value==='object'||/^\\d{1,5}$/.test(id)&&typeof value==='string')
   .map(([id,value])=>({id,name:typeof value==='string'?value:String(value.name||value.eng||value.country||value.title||value.name_en||('Country '+id))}))
   .sort((a,b)=>a.name.localeCompare(b.name));
  if(!countries.length)return json(502,{error:'DanSMS responded, but no numeric country IDs were found.',raw_shape:Object.keys(parsed).slice(0,20)});
  return json(200,{provider:'DanSMS',countries,count:countries.length});
 }catch(e){
  if(e.providerCode==='BAD_ACTION')return json(200,{provider:'DanSMS',supported:false,countries:[],message:'DanSMS does not support the getCountries action on this API connection.'});
  return json(e.status||502,{error:e.message||'Could not retrieve the DanSMS country list.'});
 }
}
