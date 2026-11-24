const json=(statusCode,body,cache='public, max-age=0, s-maxage=300, stale-while-revalidate=300')=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':cache,'X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)});
const allowedFormats=new Set(['film','series','music','vertical','experimental']);
const allowedSorts=new Set(['relevance','new','popular']);
function safeHttps(value){try{const u=new URL(String(value||''));return u.protocol==='https:'?u.toString():null;}catch{return null;}}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'},'no-store');
 try{
  const q=event.queryStringParameters||{},params=new URLSearchParams();
  const term=String(q.q||'').trim().slice(0,100),format=String(q.format||''),genre=String(q.genre||'').trim().slice(0,60),sort=String(q.sort||'popular'),limit=Math.max(1,Math.min(24,Number.parseInt(q.limit||'12',10)||12)),cursor=String(q.cursor||'').slice(0,1000);
  if(term)params.set('q',term);
  if(format){if(!allowedFormats.has(format))return json(400,{error:'Choose a valid film format.'},'no-store');params.set('format',format);}
  if(genre)params.set('genre',genre);
  if(!allowedSorts.has(sort))return json(400,{error:'Choose a valid sort order.'},'no-store');params.set('sort',sort);
  params.set('limit',String(limit));if(cursor)params.set('cursor',cursor);
  const upstream=await fetch('https://hollywood.ai/api/agent/search?'+params.toString(),{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  const payload=await upstream.json().catch(()=>null);
  if(!upstream.ok||!payload||!Array.isArray(payload.results))return json(502,{error:'Hollywood.AI could not return its film catalogue right now.'},'no-store');
  const results=payload.results.map(item=>({id:String(item.id||''),title:String(item.title||'Untitled film').slice(0,180),creator:String(item.creator||'Independent creator').slice(0,120),url:safeHttps(item.url),thumbnail:safeHttps(item.thumbnail),runtimeMinutes:Number.isFinite(Number(item.runtimeMinutes))?Number(item.runtimeMinutes):null,language:String(item.language||'').slice(0,12),format:String(item.format||''),genres:Array.isArray(item.genres)?item.genres.slice(0,8).map(x=>String(x).slice(0,40)):[],synopsis:String(item.synopsis||'').slice(0,700),addedAt:item.addedAt||null})).filter(x=>x.url&&/^https:\/\/hollywood\.ai\/watch\//i.test(x.url));
  return json(200,{site:'Hollywood.AI',total:Number(payload.total||results.length),next:payload.next||null,results});
 }catch{return json(502,{error:'Hollywood.AI is temporarily unavailable. Please try again later.'},'no-store');}
}
