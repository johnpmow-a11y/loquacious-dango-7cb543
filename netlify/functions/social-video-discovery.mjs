const json=(statusCode,body,cache='public, max-age=0, s-maxage=1800, stale-while-revalidate=3600')=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':cache,'X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)});
const clean=(v,n=500)=>String(v??'').replace(/[\\u0000-\\u001f]/g,' ').trim().slice(0,n);
const https=(v)=>{try{const u=new URL(String(v||''));return u.protocol==='https:'?u.toString():null;}catch{return null;}};
const INSTANCES=['https://sepiasearch.org','https://peertube2.cpy.re'];
const TERMS=['Nigerian comedy','Nigerian skit','African comedy','funny short film','comedy short film','international comedy','entertainment funny'];
async function getJson(url,ms=10000){const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(ms)});if(!r.ok)throw new Error('PeerTube search failed: '+r.status);return r.json();}
function peerTubeItem(x){
 if(!x||x.isLive)return null;
 const privacy=Number(x.privacy?.id??x.privacy);
 if(privacy&&privacy!==1)return null;
 const duration=Number(x.duration)||0;
 if(duration>1200)return null;
 const host=https(x.host||x.account?.host||x.channel?.host||x.url);
 let base='';
 try{base=new URL(x.url||x.embedPath||'').origin;}catch{}
 if(!base&&host)base='https://'+new URL(host.startsWith('http')?host:'https://'+host).host;
 const uuid=clean(x.uuid||x.shortUUID,100);
 if(!base||!uuid)return null;
 const embedPath=String(x.embedPath||('/videos/embed/'+encodeURIComponent(uuid)));
 const embedUrl=new URL(embedPath,base);
 embedUrl.searchParams.set('autoplay','1');
 embedUrl.searchParams.set('muted','1');
 embedUrl.searchParams.set('loop','0');
 embedUrl.searchParams.set('peertubeLink','0');
 embedUrl.searchParams.set('controlBar','0');
 embedUrl.searchParams.set('title','0');
 embedUrl.searchParams.set('warningTitle','0');
 embedUrl.searchParams.set('p2p','0');
 const files=Array.isArray(x.files)?x.files:[];
 const file=files.map(f=>https(f.fileUrl||f.fileDownloadUrl)).find(Boolean);
 const thumb=https(x.thumbnailPath?new URL(x.thumbnailPath,base).toString():x.thumbnailUrl);
 const creator=clean(x.account?.displayName||x.channel?.displayName||x.account?.name||x.channel?.name||'PeerTube creator',100);
 return {id:'peertube:'+uuid,source:'PeerTube',title:clean(x.name||'Entertainment video',180),creator,description:clean(x.description,400),thumbnail:thumb,videoUrl:file||null,embedUrl:embedUrl.toString(),duration,format:'video',publishedAt:x.publishedAt||x.createdAt||null,credit:'By '+creator+' · PeerTube'};
}
async function searchInstance(instance,term,page,count){
 const p=new URLSearchParams({search:term,count:String(count),start:String((page-1)*count),sort:'-publishedAt',nsfw:'false',isLive:'false'});
 const data=await getJson(instance+'/api/v1/search/videos?'+p.toString());
 const rows=Array.isArray(data.data)?data.data:Array.isArray(data.videos)?data.videos:[];
 return {items:rows.map(peerTubeItem).filter(Boolean),hasMore:Number(data.total||data.totalVideos||0)>(page*count)};
}
async function searchPeerTube(term,page,count){
 let lastError;
 for(const instance of INSTANCES){
  try{const result=await searchInstance(instance,term,page,count);if(result.items.length||instance===INSTANCES[INSTANCES.length-1])return result;}
  catch(e){lastError=e;}
 }
 if(lastError)throw lastError;
 return {items:[],hasMore:false};
}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'},'no-store');
 const q=event.queryStringParameters||{},term=clean(q.q,100),mode=q.mode==='search'?'search':'feed',limit=Math.max(4,Math.min(12,Number.parseInt(q.limit||'8',10)||8)),page=Math.max(1,Math.min(100,Number.parseInt(q.page||'1',10)||1));
 try{
  const terms=term?[term]:TERMS;
  const per=Math.max(3,Math.ceil(limit/terms.length));
  const results=await Promise.all(terms.map(t=>searchPeerTube(t,page,per).catch(()=>({items:[],hasMore:false}))));
  const unique=[...new Map(results.flatMap(x=>x.items).map(x=>[x.id,x])).values()];
  const items=unique.sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0)).slice(0,limit);
  const available=items.length>0;
  return json(200,{mode,query:term,items,providers:[{name:'PeerTube',available,count:items.length,hasMore:results.some(x=>x.hasMore)}],hasMore:results.some(x=>x.hasMore),partial:!available},'public, max-age=0, s-maxage=1800, stale-while-revalidate=3600');
 }catch{
  return json(200,{mode,query:term,items:[],providers:[{name:'PeerTube',available:false,count:0,hasMore:false}],hasMore:false,partial:true},'no-store');
 }
}
