const BASE='https://www.nexotp.com/api/v1';
export function json(statusCode,body){return{statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)}}
export async function supplier(path,options={}){
 const key=process.env.NEXOTP_API_KEY;if(!key)throw new Error('NEXOTP_API_KEY is missing in Netlify.');
 const r=await fetch(BASE+path,{...options,signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+key,Accept:'application/json',...(options.headers||{})}});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||d.message||'NexOTP request failed.'),{status:r.status,details:d});return d;
}
export async function db(path,options={}){
 const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Supabase server settings are missing.');
 const r=await fetch(base+'/rest/v1/'+path,{...options,signal:AbortSignal.timeout(12000),headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json',...(options.headers||{})}});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.message||d.error||'Database request failed.'),{status:r.status,details:d});return d;
}
export async function customerSession(token){if(!/^[0-9a-f-]{36}$/i.test(token))return null;const rows=await db('customer_sessions?select=customer_id&token=eq.'+encodeURIComponent(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1');return rows[0]||null;}
export async function adminSession(token){if(!/^[0-9a-f-]{36}$/i.test(token))return false;const rows=await db('admin_sessions?select=token&token=eq.'+encodeURIComponent(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1');return rows.length>0;}
const COUNTRY_MARKUP_KOBO = {
  UK:80000, GB:80000, "UNITED KINGDOM":80000,
  CA:100000, CANADA:100000,
  GH:100000, GHANA:100000,
  NG:100000, NIGERIA:100000,
  KE:100000, KENYA:100000,
  BR:100000, BRAZIL:100000,
  ZA:100000, "SOUTH AFRICA":100000,
  AU:101500, AUSTRALIA:101500,
  DE:101500, GERMANY:101500,
  IN:100000, INDIA:100000,
  FR:150000, FRANCE:150000,
  BE:120000, BELGIUM:120000,
  CN:150000, CHINA:150000,
  DK:100000, DENMARK:100000,
  IT:150000, ITALY:150000,
};
function countryKey(value){
  const raw=String(value||'').trim().toUpperCase();
  const aliases={USA:'US','UNITED STATES':'US','UNITED STATES OF AMERICA':'US',UK:'UK','GREAT BRITAIN':'UK'};
  return aliases[raw]||raw;
}
export function markupFor(country,service={}){
  const c=countryKey(country||'US');
  const name=String(service.name||service.service_name||'').toLowerCase();
  const supplierPrice=Number(service.price_ngn||0);
  if((c==='US'||c==='USA')&&/whatsapp/.test(name))return 180000;
  if((c==='US'||c==='USA')&&(/e-?sim/.test(name)||Math.round(supplierPrice*100)===4500000))return 300000;
  if(/google voice/.test(name))return 200000;
  if(c==='BR'||c==='BRAZIL'){
    if(Math.round(supplierPrice*100)===463500)return 150000;
    return 100000;
  }
  if(Object.prototype.hasOwnProperty.call(COUNTRY_MARKUP_KOBO,c))return COUNTRY_MARKUP_KOBO[c];
  if(Math.round(supplierPrice*100)===42000)return 30000;
  return 100000;
}
export function normalizeType(value){return ['short_term','long_term','other_countries'].includes(value)?value:'short_term';}
export function customerPrice(service,type){
  const country=type==='other_countries'
    ?(service.country||service.country_code||service.country_name||'')
    :'US';
  const markup=markupFor(country,service);
  return{country:String(country||''),markup_kobo:markup,price_ngn:Number(service.price_ngn||0)+markup/100};
}
