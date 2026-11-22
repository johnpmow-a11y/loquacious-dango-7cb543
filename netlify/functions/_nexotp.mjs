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
export function markupFor(country){const c=String(country||'US').trim().toUpperCase();if(c==='US'||c==='USA'||c.includes('UNITED STATES'))return 190000;if(c==='CA'||c==='CANADA')return 150000;return 195000;}
export function normalizeType(value){return ['short_term','long_term','other_countries'].includes(value)?value:'short_term';}
export function customerPrice(service,type){const country=type==='other_countries'?(service.country||service.country_code||service.country_name||''):'US';const markup=markupFor(country);return{country:String(country||''),markup_kobo:markup,price_ngn:Number(service.price_ngn||0)+markup/100};}
