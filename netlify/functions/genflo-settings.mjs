const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const dbHeaders=key=>key.startsWith('sb_secret_')?{apikey:key,'Content-Type':'application/json'}:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
async function adminSession(base,key,token){
 if(!uuid.test(token))return false;
 const r=await fetch(base+'/rest/v1/admin_sessions?select=token&token=eq.'+encodeURIComponent(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1',{headers:dbHeaders(key),signal:AbortSignal.timeout(9000)});
 const rows=await r.json().catch(()=>[]);
 if(!r.ok)throw new Error('Could not verify administrator session.');
 return Array.isArray(rows)&&rows.length>0;
}
export async function handler(event){
 const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!base||!key)return json(503,{error:'Secure provider settings are not configured.'});
 try{
  const method=event.httpMethod;
  let body={};
  if(method==='POST'){try{body=JSON.parse(event.body||'{}')}catch{return json(400,{error:'Invalid request.'})}}
  else if(method!=='GET')return json(405,{error:'Method not allowed.'});
  const token=String(method==='GET'?(event.queryStringParameters?.token||''):(body.token||''));
  if(!await adminSession(base,key,token))return json(401,{error:'Administrator session expired. Please sign in again.'});
  const table=base+'/rest/v1/aam_provider_api_keys';
  if(method==='GET'){
   const r=await fetch(table+'?select=updated_at,api_key&provider=eq.genflo&limit=1',{headers:dbHeaders(key),signal:AbortSignal.timeout(9000)});
   const rows=await r.json().catch(()=>[]);
   if(!r.ok)throw new Error('Could not read the Genflo connection.');
   const row=rows[0];
   const envKey=String(process.env.GENFLO_API_KEY||'').trim();
   const activeKey=envKey||String(row?.api_key||'');
   return json(200,{connected:!!activeKey,source:envKey?'netlify':'secure_settings',updated_at:envKey?null:(row?.updated_at||null),key_hint:activeKey?'••••'+activeKey.slice(-4):null});
  }
  const apiKey=String(body.api_key||'').trim();
  if(apiKey.length<12||apiKey.length>300)return json(400,{error:'Enter a valid Genflo API key.'});
  const check=await fetch('https://api.genflo.io/api/saas?task_id=0',{headers:{'x-apikey':apiKey},signal:AbortSignal.timeout(12000)});
  const result=await check.json().catch(()=>({}));
  if(check.status===401)return json(400,{error:'Genflo rejected this API key. Check the key and try again.'});
  if(check.status!==404&&check.ok===false)return json(400,{error:result?.error?.message||result?.detail||'Genflo could not verify this key right now.'});
  const row={provider:'genflo',api_key:apiKey,updated_at:new Date().toISOString()};
  const saved=await fetch(table+'?on_conflict=provider',{method:'POST',headers:{...dbHeaders(key),Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(row),signal:AbortSignal.timeout(9000)});
  if(!saved.ok){const err=await saved.json().catch(()=>({}));throw new Error(err.message||'Could not save the new Genflo key.');}
  return json(200,{success:true,message:'Genflo API key saved and verified.'});
 }catch(error){console.error('Genflo settings error:',error.message);return json(503,{error:'Genflo settings could not be updated. Please try again.'});}
}