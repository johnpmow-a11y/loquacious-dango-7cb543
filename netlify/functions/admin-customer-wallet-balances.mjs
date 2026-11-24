const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
function headers(key){return key.startsWith('sb_secret_')?{apikey:key,'Content-Type':'application/json'}:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};}
async function db(base,key,path){const r=await fetch(base+'/rest/v1/'+path,{headers:headers(key),signal:AbortSignal.timeout(9000)});const data=await r.json().catch(()=>[]);if(!r.ok)throw new Error(data.message||'Wallet database request failed.');return data;}
export async function handler(event){
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 const token=String(event.queryStringParameters?.token||''),base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!uuid.test(token))return json(401,{error:'Administrator session expired.'});
 if(!base||!key)return json(503,{error:'Wallet service is not configured.'});
 try{
  const sessions=await db(base,key,'admin_sessions?select=token&token=eq.'+encodeURIComponent(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1');
  if(!sessions.length)return json(401,{error:'Your administrator session has expired.'});
  const [customers,wallets]=await Promise.all([
   db(base,key,'customers?select=id,name&order=name.asc'),
   db(base,key,'wallet_balances?select=customer_id,balance_kobo,updated_at')
  ]);
  const byCustomer=new Map(wallets.map(row=>[String(row.customer_id),row]));
  const balances=customers.map(customer=>{const wallet=byCustomer.get(String(customer.id));const kobo=wallet?Number(wallet.balance_kobo):0;return {customer_id:customer.id,customer_name:customer.name,balance:Number.isFinite(kobo)&&kobo>=0?kobo/100:0,updated_at:wallet?.updated_at||null};});
  return json(200,{balances});
 }catch(error){console.error('Admin customer wallet balances failed:',error.message);return json(503,{error:'Could not retrieve customer wallet balances right now.'});}
}