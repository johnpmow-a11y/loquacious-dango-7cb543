const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function db(path){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Supabase server configuration is missing.');const r=await fetch(`${base}/rest/v1/${path}`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});const data=await r.json().catch(()=>[]);if(!r.ok)throw new Error(data.message||'Could not validate the call session.');return data;}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
 try{
  const body=JSON.parse(event.body||'{}'),token=String(body.token||'');
  if(!uuid.test(token))return json(401,{error:'Please log in again.'});
  const now=encodeURIComponent(new Date().toISOString());
  const [customers,admins]=await Promise.all([
   db(`customer_sessions?select=token&token=eq.${encodeURIComponent(token)}&expires_at=gt.${now}&limit=1`),
   db(`admin_sessions?select=token&token=eq.${encodeURIComponent(token)}&expires_at=gt.${now}&limit=1`)
  ]);
  if(!customers.length&&!admins.length)return json(401,{error:'Your call session has expired.'});

  const apiToken=String(process.env.TURNIX_API_TOKEN||'').trim();
  if(!apiToken){
   console.error('TURNIX_API_TOKEN is not configured for WebRTC ICE credentials.');
   return json(503,{configured:false,iceServers:[],error:'Call relay is not configured yet.'});
  }

  // Netlify supplies the originating client IP. Use it for Turnix region selection.
  const headers=event.headers||{};
  const clientIp=String(headers['x-nf-client-connection-ip']||headers['X-Nf-Client-Connection-Ip']||'').trim();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const requestHeaders={Authorization:`Bearer ${apiToken}`,'Content-Type':'application/json',Accept:'application/json'};
   if(clientIp&&clientIp.length<64)requestHeaders['X-TURN-CLIENT-IP']=clientIp;
   const response=await fetch('https://turnix.io/api/v1/credentials/ice',{
    method:'POST',headers:requestHeaders,body:JSON.stringify({ttl:3600}),signal:controller.signal
   });
   const data=await response.json().catch(()=>null);
   if(!response.ok||!data||!Array.isArray(data.iceServers)||!data.iceServers.length){
    console.warn('Turnix credential request failed with status:',response.status);
    return json(502,{configured:false,iceServers:[],error:'TURN relay credentials are temporarily unavailable.'});
   }
   const iceServers=data.iceServers.filter(item=>item&&((typeof item.urls==='string'&&/^(stun|turn|turns):/i.test(item.urls))||(Array.isArray(item.urls)&&item.urls.length&&item.urls.every(url=>typeof url==='string'&&/^(stun|turn|turns):/i.test(url))))&&(!item.username||typeof item.username==='string')&&(!item.credential||typeof item.credential==='string')).slice(0,12);
   if(!iceServers.length)return json(502,{configured:false,iceServers:[],error:'TURN relay returned invalid connection settings.'});
   return json(200,{configured:true,iceServers,expiresAt:data.expiresAt||null});
  }finally{clearTimeout(timer);}
 }catch(error){console.warn('WebRTC ICE configuration unavailable:',error.name==='AbortError'?'Turnix request timed out.':error.message);return json(502,{configured:false,iceServers:[],error:'Could not load relay connection settings.'});}
 }
}
