const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const html=(statusCode,body)=>({statusCode,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'},body});
const uuid=/^[0-9a-f-]{36}$/i;
function h(key){return {'x-api-key':key,'Content-Type':'application/json'};}
async function customer(token){if(!uuid.test(token||''))return null;const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Customer session service is not configured.');const r=await fetch(`${base}/rest/v1/customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,{headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`)}});const rows=await r.json().catch(()=>[]);return r.ok?rows[0]||null:null;}
export async function handler(event){
 if(event.httpMethod==='GET'){
  const uri=String(event.queryStringParameters?.session_uri||'');
  if(!uri||!uri.startsWith('https://'))return html(400,'<h2>Invalid advertising sign-in callback.</h2>');
  const safe=JSON.stringify(uri).replace(/</g,'\\u003c');
  return html(200,`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verify account connection</title><main style="font:16px system-ui;max-width:440px;margin:15vh auto;padding:24px;color:#172033"><h2>Confirm your All Ads Manager account</h2><p id="msg">Checking your signed-in customer session…</p></main><script>const uri=${safe};(async()=>{const token=sessionStorage.getItem('btToken');const msg=document.getElementById('msg');if(!token){msg.textContent='Your session is not available in this browser. Return to All Ads Manager, sign in, and reconnect your ad account.';return;}try{const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,session_uri:uri})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not verify this connection.');location.replace('/?ads_connection=success&platform='+encodeURIComponent(d.platform||'ads'));}catch(e){msg.textContent=e.message;}})();</script>`);
 }
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
 try{
  const b=JSON.parse(event.body||'{}'),s=await customer(String(b.token||'')),uri=String(b.session_uri||'');
  if(!s)return json(401,{error:'Please sign in to the same All Ads Manager account that started this connection.'});
  if(!uri.startsWith('https://'))return json(400,{error:'The provider callback is invalid.'});
  const key=process.env.COMPOSIO_API_KEY;if(!key)return json(503,{error:'Advertising connection is not configured.'});
  const r=await fetch('https://backend.composio.dev/api/v3.1/connected_accounts/complete_auth',{method:'POST',headers:h(key),body:JSON.stringify({session_uri:uri,user_id:'aam_customer_'+s.customer_id})});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||d.message||'The advertising account could not be verified.');
  const slug=d.toolkit_slug||d.toolkit?.slug||'';
  const platform=slug==='metaads'?'facebook':slug==='tiktok_ads'?'tiktok':'ads';
  if(platform!=='ads'){const base=process.env.SUPABASE_URL,keyDb=process.env.SUPABASE_SERVICE_ROLE_KEY;const saved=await fetch(base+'/rest/v1/aam_ad_connections?on_conflict=connected_account_id',{method:'POST',headers:{apikey:keyDb,...(keyDb.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+keyDb}),'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({customer_id:s.customer_id,platform,toolkit_slug:slug,connected_account_id:d.connected_account_id||d.id,connection_status:'ACTIVE',updated_at:new Date().toISOString()})});if(!saved.ok)throw new Error('Account connected but its status could not be saved. Please refresh your connection status.');}
  return json(200,{ok:true,platform,connected_account_id:d.connected_account_id||d.id});
 }catch(e){return json(502,{error:e.message||'Could not verify advertising account identity.'});}
}
