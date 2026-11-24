const json=(statusCode,body,cache='public, max-age=0, s-maxage=180, stale-while-revalidate=300')=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':cache,'X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)});
const PEERTUBE='https://sepiasearch.org';
const clean=(v,n=500)=>String(v??'').replace(/[\\u0000-\\u001f]/g,' ').trim().slice(0,n);
const https=(v)=>{try{const u=new URL(String(v||''));return u.protocol==='https:'?u.toString():null;}catch{return null;}};
async function get(url,ms=7000){const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(ms)});if(!r.ok)throw new Error('Video source unavailable: '+r.status);return r.json();}
function peerItem(x){
 const candidate=clean(x?.account?.host||x?.channel?.host||x?.host||'',180),domain=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$/i,host=domain.test(candidate)?candidate:'',rawPage=https(x.url),pageHost=rawPage?new URL(rawPage).hostname:'',base=host?'https://'+host:(domain.test(pageHost)?new URL(rawPage).origin:PEERTUBE),uuid=clean(x.uuid||x.shortUUID||x.id,100);
 if(!uuid)return null;
 const embed=base+'/videos/embed/'+encodeURIComponent(x.uuid||x.shortUUID),files=Array.isArray(x.files)?x.files:[],file=files.find(f=>https(f.fileUrl));
 return {id:'peertube:'+uuid,source:'Creator video',title:clean(x.name,180)||'Video',creator:clean(x.account?.displayName||x.channel?.displayName||x.account?.name||'Creator',100),description:clean(x.description||x.truncatedDescription,500),thumbnail:https(x.thumbnailUrl)||(x.thumbnailPath?https(new URL(x.thumbnailPath,base).toString()):null),embedUrl:embed,videoUrl:https(file?.fileUrl),language:clean(x.language?.id||'',20),duration:Number(x.duration)||null,format:'video',publishedAt:x.publishedAt||x.createdAt||null};
}
async function sourcePeerTube(q,limit,page){
 const terms=q?[q]:['Nigerian AI comedy','Nigerian AI skits','Nigerian Pidgin comedy','Nigerian AI short film'];
 const per=Math.max(2,Math.ceil(limit/terms.length));
 const results=await Promise.all(terms.map(async term=>{
  const p=new URLSearchParams({search:term,count:String(per),start:String(page*per),sort:'-publishedAt',isLive:'false',nsfw:'false'});
  const d=await get(PEERTUBE+'/api/v1/search/videos?'+p);
  return {items:(d.data||[]).map(peerItem).filter(Boolean),hasMore:Number(d.total)>Number(page*per+per)};
 }));
 return {items:[...new Map(results.flatMap(x=>x.items).map(x=>[x.id,x])).values()].slice(0,limit),hasMore:results.some(x=>x.hasMore)};
}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'},'no-store');
 const q=event.queryStringParameters||{},term=clean(q.q,100),mode=q.mode==='search'?'search':'feed',limit=Math.max(4,Math.min(12,Number.parseInt(q.limit||'8',10)||8)),page=Math.max(0,Math.min(100,Number.parseInt(q.page||'0',10)||0));
 try{
  const result=await sourcePeerTube(term,limit,page),items=result.items.filter(x=>x.videoUrl||x.embedUrl);
  return json(200,{mode,query:term,items,providers:[{name:'PeerTube creator videos',available:true,count:items.length,hasMore:result.hasMore}],cursors:{},hasMore:result.hasMore,partial:false},'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400');
 }catch{
  return json(200,{mode,query:term,items:[],providers:[{name:'PeerTube creator videos',available:false,count:0,hasMore:false}],cursors:{},hasMore:false,partial:true},'no-store');
 }
}
