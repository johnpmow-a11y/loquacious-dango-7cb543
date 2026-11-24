const json=(statusCode,body,cache='public, max-age=0, s-maxage=86400, stale-while-revalidate=86400')=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':cache,'X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)});
const clean=(v,n=500)=>String(v??'').replace(/[\\u0000-\\u001f]/g,' ').trim().slice(0,n);
const https=(v)=>{try{const u=new URL(String(v||''));return u.protocol==='https:'?u.toString():null;}catch{return null;}};
async function get(url,ms=9000){const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(ms)});if(!r.ok)throw new Error('Pixabay video search failed: '+r.status);return r.json();}
function pixabayItem(x){
 const files=Object.values(x.videos||{}).filter(v=>https(v?.url));
 if(!files.length)return null;
 const vertical=files.filter(v=>Number(v.height)>Number(v.width)).sort((a,b)=>Number(b.height)-Number(a.height));
 const chosen=(vertical[0]||files.find(v=>v.quality==='medium')||files.sort((a,b)=>Number(b.width)-Number(a.width))[0]);
 const tags=clean(x.tags,240),duration=Number(x.duration)||0;
 if(duration>240)return null;
 return {id:'pixabay:'+String(x.id),source:'Pixabay',title:tags.split(',').slice(0,3).join(' · ')||'Entertainment video',creator:clean(x.user,80)||'Pixabay creator',description:'',thumbnail:https(chosen.thumbnail)||https(files[0]?.thumbnail),videoUrl:https(chosen.url),duration,format:'video',publishedAt:null,credit:'Video by '+(clean(x.user,80)||'Pixabay contributor')+' on Pixabay'};
}
async function searchPixabay(key,term,page,perPage){
 const p=new URLSearchParams({key,q:term,video_type:'all',per_page:String(perPage),page:String(page),safesearch:'true',order:'popular'});
 const d=await get('https://pixabay.com/api/videos/?'+p.toString());
 return {items:(d.hits||[]).map(pixabayItem).filter(Boolean),hasMore:Number(d.totalHits||0)>page*perPage};
}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'},'no-store');
 const q=event.queryStringParameters||{},term=clean(q.q,100),mode=q.mode==='search'?'search':'feed',limit=Math.max(4,Math.min(12,Number.parseInt(q.limit||'8',10)||8)),page=Math.max(1,Math.min(100,Number.parseInt(q.page||'1',10)||1)),key=process.env.PIXABAY_API_KEY;
 if(!key)return json(503,{mode,query:term,items:[],providers:[{name:'Pixabay',available:false,count:0,hasMore:false}],hasMore:false,error:'Video feed is not configured yet.'},'no-store');
 try{
  const terms=term?[term]:['Nigerian comedy','African comedy skit','funny comedy','short film entertainment'];
  const per=Math.max(4,Math.ceil(limit/terms.length));
  const results=await Promise.all(terms.map(t=>searchPixabay(key,t,page,per)));
  const unique=[...new Map(results.flatMap(x=>x.items).map(x=>[x.id,x])).values()];
  return json(200,{mode,query:term,items:unique.slice(0,limit),providers:[{name:'Pixabay',available:true,count:Math.min(unique.length,limit),hasMore:results.some(x=>x.hasMore)}],hasMore:results.some(x=>x.hasMore),partial:false},'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400');
 }catch{
  return json(200,{mode,query:term,items:[],providers:[{name:'Pixabay',available:false,count:0,hasMore:false}],hasMore:false,partial:true},'no-store');
 }
}
