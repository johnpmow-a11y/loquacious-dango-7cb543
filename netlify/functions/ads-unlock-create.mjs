import { randomUUID } from 'node:crypto';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
function headers(key){return {apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}), 'Content-Type':'application/json'};}
async function db(path,options={}){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error('Payment service is not configured.');const r=await fetch(`${u}/rest/v1/${path}`,{...options,headers:{...headers(k),...(options.headers||{})}});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||'Payment record could not be saved.');return d;}
async function customer(token){if(!uuid.test(token||''))return null;const rows=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
async function verify(reference,row){const secret=process.env.PAYSTACK_SECRET_KEY;if(!secret||!secret.startsWith('sk_live_'))throw new Error('Live Paystack verification is not configured.');const r=await fetch('https://api.paystack.co/transaction/verify/'+encodeURIComponent(reference),{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(12000)});const d=await r.json().catch(()=>({}));if(!r.ok||!d.status||d.data?.status!=='success')return false;const t=d.data;if(Number(t.amount)!==380000||String(t.currency)!=='NGN'||String(t.reference)!==reference||String(t.metadata?.customer_id||'')!==String(row.customer_id))throw new Error('The payment details do not match this unlock request.');await db('aam_ad_unlocks?customer_id=eq.'+encodeURIComponent(row.customer_id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'paid',unlocked_at:new Date().toISOString(),updated_at:new Date().toISOString(),payment_method:t.channel||row.payment_method})});return true;}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:{'Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET,POST'}};
 try{
  if(event.httpMethod==='GET'&&event.queryStringParameters?.action==='status'){
   const s=await customer(String(event.queryStringParameters?.token||''));if(!s)return json(401,{error:'Please log in again.'});
   const rows=await db('aam_ad_unlocks?select=status,reference&customer_id=eq.'+encodeURIComponent(s.customer_id)+'&limit=1');const row=rows[0];if(row?.status==='pending'&&row.reference){try{await verify(row.reference,{...row,customer_id:s.customer_id});}catch(e){console.warn('Unlock payment status check:',e.message);}}
   const fresh=await db('aam_ad_unlocks?select=status,unlocked_at&customer_id=eq.'+encodeURIComponent(s.customer_id)+'&limit=1');return json(200,{unlocked:fresh[0]?.status==='paid',status:fresh[0]?.status||'not_started'});
  }
  if(event.httpMethod==='GET'){
   const reference=String(event.queryStringParameters?.reference||'');if(!/^aamunlock[a-f0-9]{24,40}$/i.test(reference))return {statusCode:302,headers:{Location:'/?ads_unlock=invalid','Cache-Control':'no-store'}};
   const rows=await db('aam_ad_unlocks?select=customer_id,status,amount_kobo,reference,payment_method&reference=eq.'+encodeURIComponent(reference)+'&limit=1');const row=rows[0];if(!row)return {statusCode:302,headers:{Location:'/?ads_unlock=not_found','Cache-Control':'no-store'}};
   await verify(reference,row);return {statusCode:302,headers:{Location:'/?ads_unlock=success','Cache-Control':'no-store'}};
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const b=JSON.parse(event.body||'{}'),s=await customer(String(b.token||''));if(!s)return json(401,{error:'Please log in again.'});
  const email=String(b.email||'').trim().toLowerCase(),method=String(b.method||'bank_transfer');
  if(!/^\S+@\S+\.\S+$/.test(email))return json(400,{error:'Enter a valid receipt email.'});
  if(!['card','bank_transfer'].includes(method))return json(400,{error:'Choose a supported payment method.'});
  const customerId=s.customer_id;
  let rows=await db('aam_ad_unlocks?select=*&customer_id=eq.'+encodeURIComponent(customerId)+'&limit=1'),row=rows[0];
  if(row?.status==='paid')return json(200,{unlocked:true});
  if(row?.status==='pending'&&row.authorization_url)return json(200,{authorization_url:row.authorization_url,reference:row.reference,reused:true});
  const reference='aamunlock'+randomUUID().replace(/-/g,'').slice(0,28);
  if(row)await db('aam_ad_unlocks?customer_id=eq.'+encodeURIComponent(customerId),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'pending',reference,authorization_url:null,receipt_email:email,payment_method:method,amount_kobo:380000,updated_at:new Date().toISOString()})});
  else await db('aam_ad_unlocks',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({customer_id:customerId,status:'pending',reference,receipt_email:email,payment_method:method,amount_kobo:380000})});
  const secret=process.env.PAYSTACK_SECRET_KEY;if(!secret||!secret.startsWith('sk_live_'))throw new Error('Live Paystack payments are required for advertising unlock.');
  const origin='https://'+String(event.headers.host||'').replace(/[^a-z0-9.:-]/gi,'');const payload={email,amount:'380000',currency:'NGN',reference,channels:method==='card'?['card']:['bank_transfer'],callback_url:origin+'/.netlify/functions/ads-unlock-create?reference='+encodeURIComponent(reference),metadata:{customer_id:customerId,product:'All Ads Manager advertising payment unlock',unlock_fee_ngn:3800}};
  const r=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});const d=await r.json().catch(()=>({}));if(!r.ok||!d.status||!d.data?.authorization_url){await db('aam_ad_unlocks?customer_id=eq.'+encodeURIComponent(customerId),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:'failed',updated_at:new Date().toISOString()})});throw new Error(d.message||'Paystack could not start the unlock payment.');}
  await db('aam_ad_unlocks?customer_id=eq.'+encodeURIComponent(customerId),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({authorization_url:d.data.authorization_url,updated_at:new Date().toISOString()})});
  return json(200,{authorization_url:d.data.authorization_url,reference});
 }catch(e){return json(502,{error:e.message||'Could not start advertising unlock payment.'});}
}
