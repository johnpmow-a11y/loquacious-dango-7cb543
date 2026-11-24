const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
function headers(key){return key.startsWith('sb_secret_')?{apikey:key,'Content-Type':'application/json'}:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};}
async function db(base,key,path){const r=await fetch(base+'/rest/v1/'+path,{headers:headers(key),signal:AbortSignal.timeout(8000)});const data=await r.json().catch(()=>[]);if(!r.ok)throw new Error(data.message||'Wallet database request failed.');return data;}
export async function handler(event){
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 const token=String(event.queryStringParameters?.token||''),base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!uuid.test(token))return json(401,{error:'Customer session expired.'});
 if(!base||!key)return json(503,{error:'Wallet service is not configured.'});
 try{
  const sessions=await db(base,key,'customer_sessions?select=customer_id&token=eq.'+encodeURIComponent(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1');
  if(!sessions.length)return json(401,{error:'Your customer session has expired. Please sign in again.'});
  const customerId=String(sessions[0].customer_id);
  const rows=await db(base,key,'wallet_balances?select=balance_kobo&customer_id=eq.'+encodeURIComponent(customerId)+'&limit=1');
  const kobo=rows.length?Number(rows[0].balance_kobo):0;
  if(!Number.isFinite(kobo)||kobo<0)return json(500,{error:'The wallet balance record is invalid.'});
  return json(200,{customer_id:customerId,balance:kobo/100});
 }catch(error){console.error('Customer wallet balance read failed:',error.message);return json(503,{error:'Could not retrieve your wallet balance right now.'});}
}