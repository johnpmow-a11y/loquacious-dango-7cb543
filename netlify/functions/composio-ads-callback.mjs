import { createHmac, timingSafeEqual } from 'node:crypto';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const html=(statusCode,body)=>({statusCode,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'},body});
const uuid=/^[0-9a-f-]{36}$/i;
async function composio(path,options={}){const key=process.env.COMPOSIO_API_KEY;if(!key)throw new Error('WhatsApp connection service is not configured.');const r=await fetch('https://backend.composio.dev'+path,{...options,headers:{'x-api-key':key,'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||d.message||'WhatsApp provider request failed.');return d;}
async function registerWhatsAppNumbers(connectedId,userId,customerId,wabaId){const schema=await composio('/api/v3.1/tools/WHATSAPP_GET_PHONE_NUMBERS'),root=schema.input_parameters||{},props=root.properties||{},args={};for(const name of Object.keys(props)){const n=name.toLowerCase();if(['business_account_id','waba_id','whatsapp_business_account_id','generic_id'].includes(n))args[name]=wabaId;}const required=Array.isArray(root.required)?root.required:Object.entries(props).filter(([,v])=>v.required).map(([k])=>k);const missing=required.filter(k=>args[k]===undefined);if(missing.length)throw new Error('WhatsApp phone-number lookup requires additional provider fields: '+missing.join(', '));const result=await composio('/api/v3.1/tools/execute/WHATSAPP_GET_PHONE_NUMBERS',{method:'POST',body:JSON.stringify({connected_account_id:connectedId,user_id:userId,version:schema.version,arguments:args})});const data=result.data||result;const found=[];const walk=v=>{if(Array.isArray(v)){for(const x of v)walk(x);return;}if(!v||typeof v!=='object')return;const id=v.id||v.phone_number_id;if(id&&/^\\d{5,40}$/.test(String(id))&&(v.display_phone_number||v.verified_name||v.quality_rating||v.status))found.push(v);for(const x of Object.values(v))if(x&&typeof x==='object')walk(x);};walk(data);const unique=[...new Map(found.map(x=>[String(x.id||x.phone_number_id),x])).values()];if(!unique.length)throw new Error('WhatsApp Business connected, but no phone numbers were returned for this WABA. Check that the selected WABA has an active phone number and reconnect.');const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Customer database service is not configured.');for(const p of unique){const phoneId=String(p.id||p.phone_number_id),r=await fetch(base+'/rest/v1/aam_whatsapp_business_numbers?on_conflict=phone_number_id',{method:'POST',headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({customer_id:customerId,waba_id:wabaId,phone_number_id:phoneId,display_phone_number:p.display_phone_number||p.verified_name||null,connected_account_id:connectedId,connection_status:'ACTIVE',updated_at:new Date().toISOString()})});if(!r.ok)throw new Error('WhatsApp phone number could not be registered in the Inbox.');}return unique.length;}

function h(key){return {'x-api-key':key,'Content-Type':'application/json'};}
async function customer(token){if(!uuid.test(token||''))return null;const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Customer session service is not configured.');const url=base+'/rest/v1/customer_sessions?select=customer_id&token=eq.'+encodeURIComponent(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1';const r=await fetch(url,{headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key})}});const rows=await r.json().catch(()=>[]);return r.ok?rows[0]||null:null;}
export async function handler(event){
 if(event.httpMethod==='GET'){
  const q=event.queryStringParameters||{},uri=String(q.session_uri||''),state=String(q.state||''),accountId=String(q.connected_account_id||'');
  if(uri&&!uri.startsWith('https://'))return html(400,'<h2>Invalid advertising sign-in callback.</h2>');
  if(!uri&&(!state||!accountId||String(q.status||'')!=='success'))return html(400,'<h2>Advertising account connection was not completed.</h2>');
  const payload=JSON.stringify({uri,state,accountId});
  const safe=payload.replace(/</g,'\\u003c');
  return html(200,`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verify account connection</title><main style="font:16px system-ui;max-width:440px;margin:15vh auto;padding:24px;color:#172033"><h2>Confirm your All Ads Manager account</h2><p id="msg">Verifying the customer who authorized this advertising account…</p></main><script>const callback=${safe};(async()=>{const token=sessionStorage.getItem('btToken')||'';const msg=document.getElementById('msg');try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...callback})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not verify this connection.');location.replace('/?ads_connection=success&platform='+encodeURIComponent(d.platform||'ads'));}catch(e){msg.textContent=e.message;}})();</script>`);
 }
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
 try{
  const b=JSON.parse(event.body||'{}'),token=String(b.token||''),s=await customer(token),uri=String(b.uri||''),state=String(b.state||''),accountId=String(b.accountId||'');
  const key=process.env.COMPOSIO_API_KEY;if(!key)return json(503,{error:'Advertising connection is not configured.'});
  let customerId,slug,connectedId,callbackPlatform='',wabaId='';
  if(uri){
   if(!s)return json(401,{error:'Please sign in to the same All Ads Manager account that started this connection.'});
   const r=await fetch('https://backend.composio.dev/api/v3.1/connected_accounts/complete_auth',{method:'POST',headers:h(key),body:JSON.stringify({session_uri:uri,user_id:'aam_customer_'+s.customer_id})});
   const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||d.message||'The advertising account could not be verified.');
   customerId=s.customer_id;slug=d.toolkit_slug||d.toolkit?.slug||'';connectedId=d.connected_account_id||d.id;
  }else{
   const parts=state.split('.');if(parts.length!==2)throw new Error('The account verification signature is invalid.');
   const expected=createHmac('sha256',key).update(parts[0]).digest('base64url');
   const a=Buffer.from(expected),z=Buffer.from(parts[1]);if(a.length!==z.length||!timingSafeEqual(a,z))throw new Error('The account verification signature is invalid.');
   let claims;try{claims=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{throw new Error('The account verification state is invalid.');}
   if(!claims.customer_id||!claims.platform||Number(claims.expires_at)<Date.now())throw new Error('The account verification link has expired.');
   customerId=String(claims.customer_id);callbackPlatform=String(claims.platform);wabaId=String(claims.waba_id||'');slug=callbackPlatform==='tiktok'?'tiktok_ads':callbackPlatform==='facebook_replies'?'facebook':callbackPlatform==='snapchat'?'snapchat':callbackPlatform==='whatsapp'?'whatsapp':'metaads';connectedId=accountId;
   if(!s||String(s.customer_id)!==customerId){
    await fetch('https://backend.composio.dev/api/v3.1/connected_accounts/'+encodeURIComponent(connectedId)+'/revoke',{method:'POST',headers:h(key)}).catch(()=>{});
    return json(403,{error:'This advertising account was authorized in a different customer session. The connection was revoked for your protection. Sign in to the correct account and reconnect.'});
   }
   const check=await fetch('https://backend.composio.dev/api/v3.1/connected_accounts/'+encodeURIComponent(connectedId),{headers:h(key)});
   const account=await check.json().catch(()=>({}));if(!check.ok||account.user_id!=='aam_customer_'+customerId||account.toolkit?.slug!==slug||account.status!=='ACTIVE')throw new Error('The provider connection does not match this customer or is not active.');
  }
  if(!connectedId||!['metaads','tiktok_ads','facebook','snapchat','whatsapp'].includes(slug))throw new Error('The provider returned an unsupported advertising connection.');
  const platform=slug==='tiktok_ads'?'tiktok':slug==='snapchat'?'snapchat':slug==='whatsapp'||callbackPlatform==='whatsapp'?'whatsapp':callbackPlatform==='instagram'?'instagram':'facebook',base=process.env.SUPABASE_URL,keyDb=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const saved=await fetch(base+'/rest/v1/aam_ad_connections?on_conflict=connected_account_id',{method:'POST',headers:{apikey:keyDb,...(keyDb.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+keyDb}),'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({customer_id:customerId,platform,toolkit_slug:slug,connected_account_id:connectedId,connection_status:'ACTIVE',updated_at:new Date().toISOString()})});
  if(!saved.ok)throw new Error('Account connected but its status could not be saved. Please refresh your connection status.');
  let whatsapp_phone_numbers=0;if(platform==='whatsapp'){if(!wabaId)throw new Error('WhatsApp connection is missing its WABA ID. Reconnect WhatsApp Business from the Inbox.');whatsapp_phone_numbers=await registerWhatsAppNumbers(connectedId,'aam_customer_'+customerId,customerId,wabaId);}
  return json(200,{ok:true,platform,connected_account_id:connectedId,...(platform==='whatsapp'?{whatsapp_phone_numbers}:{})});
 }catch(e){return json(502,{error:e.message||'Could not verify advertising account identity.'});}
}
