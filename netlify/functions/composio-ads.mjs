import { URLSearchParams } from 'node:url';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const toolkits={facebook:'metaads',instagram:'metaads',meta:'metaads',tiktok:'tiktok_ads'};
function h(key,extra={}){return { 'x-api-key':key,'Content-Type':'application/json',...extra };}
async function db(path,options={}){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Customer session service is not configured.');const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||'Customer session lookup failed.');return d;}
async function session(token){if(!uuid.test(token))return null;const rows=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
async function comp(path,options={}){const key=process.env.COMPOSIO_API_KEY;if(!key)throw new Error('Advertising connection is not configured on the server.');const r=await fetch('https://backend.composio.dev'+path,{...options,headers:h(key,options.headers||{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||d.message||'Advertising provider request failed.');return d;}
async function authConfig(slug){const q=new URLSearchParams({toolkit_slug:slug,is_composio_managed:'true'});const listed=await comp('/api/v3/auth_configs?'+q.toString());const found=(listed.items||[]).find(x=>x.toolkit?.slug===slug&&x.is_composio_managed!==false);if(found?.id)return found.id;const made=await comp('/api/v3/auth_configs',{method:'POST',body:JSON.stringify({toolkit:{slug}})});const id=made.id||made.auth_config?.id;if(!id)throw new Error('Composio did not return an advertising authorization configuration.');return id;}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:{'Access-Control-Allow-Origin':process.env.URL||'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,GET'}};
 try{
  const q=event.queryStringParameters||{};
  if(event.httpMethod==='GET'&&q.action==='status'){
   const s=await session(String(q.token||''));if(!s)return json(401,{error:'Please log in again.'});
   const platform=String(q.platform||'facebook').toLowerCase(),slug=toolkits[platform];if(!slug)return json(400,{error:'Unsupported advertising platform.'});
   const userId='aam_customer_'+s.customer_id;
   const params=new URLSearchParams({user_ids:userId,toolkit_slugs:slug,limit:'100'});
   const data=await comp('/api/v3.1/connected_accounts?'+params.toString());
   const items=(data.items||[]).filter(x=>x.user_id===userId&&x.toolkit?.slug===slug);
   const active=items.filter(x=>x.status==='ACTIVE').map(x=>({id:x.id,status:x.status,toolkit:slug,created_at:x.created_at}));
   return json(200,{connected:active.length>0,accounts:active,pending:items.some(x=>['INITIALIZING','PENDING'].includes(x.status))});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const b=JSON.parse(event.body||'{}'),s=await session(String(b.token||''));if(!s)return json(401,{error:'Please log in again.'});
  const platform=String(b.platform||'').toLowerCase(),slug=toolkits[platform];if(!slug)return json(400,{error:'Choose Facebook, Instagram or TikTok Ads.'});
  const userId='aam_customer_'+s.customer_id,auth_config_id=await authConfig(slug);
  const link=await comp('/api/v3.1/connected_accounts/link',{method:'POST',body:JSON.stringify({auth_config_id,user_id:userId,alias:`aam-${s.customer_id}-${platform}-${Date.now()}`})});
  if(!link.redirect_url||!link.connected_account_id)throw new Error('Composio did not return a complete secure connection link.');
  return json(200,{redirect_url:link.redirect_url,connected_account_id:link.connected_account_id,expires_at:link.expires_at,platform});
 }catch(e){return json(502,{error:e.message||'Could not start the advertising account connection.'});}
}
