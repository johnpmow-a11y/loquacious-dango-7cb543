import {randomUUID} from 'node:crypto';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const mimeExt={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'};const audioExt={'audio/mpeg':'mp3','audio/mp3':'mp3','audio/mp4':'m4a','audio/aac':'aac','audio/wav':'wav','audio/x-wav':'wav','audio/ogg':'ogg','audio/webm':'webm'};
function h(k,x={}){return {apikey:k,...(k.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${k}`}),...x};}
async function db(path,options={}){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!u||!k)throw new Error('Social storage is not configured.');const r=await fetch(`${u}/rest/v1/${path}`,{...options,headers:h(k,{'Content-Type':'application/json',...(options.headers||{})})});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||d.error||'Social database request failed.');return d;}
async function session(token,admin=false){if(!uuid.test(token))return null;const t=admin?'admin_sessions':'customer_sessions';const rows=await db(`${t}?select=${admin?'token':'customer_id'}&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
function publicAdminName(value){const name=String(value||'').trim();return !name||/\badmin(?:istrator)?\b/i.test(name)?'All Ads Manager':name;}
async function adultConfirmed(customerId){const rows=await db(`aam_social_profiles?select=adult_confirmed_at&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`);return !!rows[0]?.adult_confirmed_at;}
async function signedRead(path){const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;const r=await fetch(`${u}/storage/v1/object/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:JSON.stringify({expiresIn:1800})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Could not prepare media preview.');const p=d.signedURL||d.signedUrl||'';return /^https?:\/\//i.test(p)?p:u+(p.startsWith('/storage/v1/')?p:'/storage/v1'+(p.startsWith('/')?p:'/'));}


export async function handler(event){
 if(event.httpMethod==='OPTIONS')return json(204,{});
 try{
  if(event.httpMethod==='GET'){
   const q=event.queryStringParameters||{},token=String(q.token||''),s=await session(token);
   if(!s)return json(401,{error:'Please log in again.'});
   if(!await adultConfirmed(s.customer_id))return json(403,{error:'Confirm that you are 18 or older to continue.'});
   const [posts,profiles,follows,unlocks,likes,comments,mineLikes,adminProfile]=await Promise.all([
    db('aam_social_posts?select=*&moderation_status=neq.removed&order=created_at.desc&limit=60'),
    db('aam_social_profiles?select=customer_id,display_name,bio,avatar_path,is_private,comments_enabled'),
    db(`aam_social_follows?select=followed_id&follower_id=eq.${encodeURIComponent(s.customer_id)}`),
    db(`aam_social_video_unlocks?select=post_id&customer_id=eq.${encodeURIComponent(s.customer_id)}`),
    db('aam_social_likes?select=post_id'),
    db('aam_social_comments?select=post_id'),
    db(`aam_social_likes?select=post_id&customer_id=eq.${encodeURIComponent(s.customer_id)}`),
    db('aam_social_admin_profile?select=display_name,avatar_path,follower_count,is_verified&id=eq.true&limit=1')
   ]);
   const profileMap=new Map(profiles.map(p=>[p.customer_id,p])),following=new Set(follows.map(f=>f.followed_id)),unlocked=new Set(unlocks.map(x=>x.post_id)),liked=new Set(mineLikes.map(x=>x.post_id));
   const visible=posts.filter(p=>p.author_role==='admin'||p.customer_id===s.customer_id||!profileMap.get(p.customer_id)?.is_private||following.has(p.customer_id));
   const feed=await Promise.all(visible.slice(0,30).map(async p=>{
    const owner=p.customer_id?profileMap.get(p.customer_id):null,admin=adminProfile[0]||{};
    const locked=p.author_role==='admin'&&p.media_type==='video'&&p.is_locked===true&&!unlocked.has(p.id);
    const {author_role,media_path,thumbnail_path,audio_path,customer_id,...publicPost}=p;return {...publicPost,is_following:!!(owner&&following.has(owner.customer_id)),comments_enabled:p.comments_enabled!==false&&owner?.comments_enabled!==false,like_count:likes.filter(x=>x.post_id===p.id).length,follower_count:p.author_role==='admin'?Number(admin.follower_count||0):undefined,following_count:p.author_role==='admin'?0:undefined,verified:p.author_role==='admin'?!!admin.is_verified:false,comment_count:comments.filter(x=>x.post_id===p.id).length,liked:liked.has(p.id),locked_video:locked,professional_video:locked,creator:{id:p.customer_id||null,name:p.author_role==='admin'?publicAdminName(admin.display_name):(owner?.display_name||'Creator'),bio:owner?.bio||'',avatar_url:(p.author_role==='admin'?admin.avatar_path:owner?.avatar_path)?await signedRead(p.author_role==='admin'?admin.avatar_path:owner.avatar_path):null,followers:p.author_role==='admin'?Number(admin.follower_count||0):null,following:p.author_role==='admin'?0:null},media_url:locked||p.media_type==='text'?null:await signedRead(p.media_path),audio_url:p.audio_path?await signedRead(p.audio_path):null,background_color:p.background_color||null,thumbnail_url:p.thumbnail_path?await signedRead(p.thumbnail_path):null};
   }));
   return json(200,{posts:feed.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const b=JSON.parse(event.body||'{}'),token=String(b.token||''),action=String(b.action||''),admin=b.role==='admin';
  const s=await session(token,admin);if(!s)return json(401,{error:'Please log in again.'});
  const customerId=admin?null:s.customer_id;
  if(!admin&&!await adultConfirmed(customerId))return json(403,{error:'Confirm that you are 18 or older to continue.'});
  if(action==='delete_upload'){const path=String(b.path||''),allowed=[`${customerId}/`,`post-audio/${customerId}/`,`thumbnails/${customerId}/`];if(admin||path.length>500||path.includes('..')||!allowed.some(prefix=>path.startsWith(prefix)))return json(400,{error:'Invalid upload path.'});const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY,r=await fetch(`${u}/storage/v1/object/aam-social-media/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'DELETE',headers:h(k)});if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.message||'Could not clean up unused upload.');}return json(200,{ok:true});}
  if(action==='sign_thumbnail_upload'){
   if(admin)return json(403,{error:'Admin thumbnails are uploaded with admin media.'});
   const path=`thumbnails/${customerId}/${randomUUID()}.jpg`,u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
   const r=await fetch(`${u}/storage/v1/object/upload/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:'{}'});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json(502,{error:d.message||'Could not prepare video preview.'});
   return json(200,{path,token:d.token});
  }
  if(action==='sign_avatar_upload'){
   if(admin)return json(403,{error:'Use administrator creator settings for the admin picture.'});
   const mime=String(b.mime_type||''),ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime];if(!ext)return json(400,{error:'Choose a JPG, PNG or WebP profile picture.'});
   const path=`avatars/${customerId}/${randomUUID()}.${ext}`,u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
   const r=await fetch(`${u}/storage/v1/object/upload/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:'{}'});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json(502,{error:d.message||'Could not prepare profile picture upload.'});
   return json(200,{path,token:d.token});
  }
  if(action==='sign_wallpaper_upload'){
   if(admin)return json(403,{error:'Only customer profiles can set a personal wallpaper.'});
   const mime=String(b.mime_type||''),ext={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp' }[mime];
   if(!ext)return json(400,{error:'Choose a JPG, PNG or WebP wallpaper image.'});
   const path=`wallpapers/${customerId}/${randomUUID()}.${ext}`,u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
   const r=await fetch(`${u}/storage/v1/object/upload/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:'{}'});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json(502,{error:d.message||'Could not prepare wallpaper upload.'});
   return json(200,{path,token:d.token});
  }
  if(action==='publish_text_post'){
   if(admin)return json(403,{error:'Text posts are available from customer accounts.'});
   const body=String(b.body||'').trim().slice(0,2200),background=String(b.background_color||'#172554');
   const allowed=new Set(['#172554','#0f766e','#be123c','#7c3aed','#f59e0b','#111827','#fce7f3','#dcfce7']);
   if(!body)return json(400,{error:'Write something first.'});if(!allowed.has(background))return json(400,{error:'Choose a valid background.'});
   const rows=await db('aam_social_posts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify([{customer_id:customerId,author_role:'customer',media_type:'text',media_path:null,caption:body,background_color:background,moderation_status:'published'}])});
   return json(200,{ok:true,post:rows[0]});
  }
  if(action==='sign_audio_upload'){
   if(admin)return json(403,{error:'Audio tracks can only be added to customer posts.'});
   const mime=String(b.mime_type||''),ext=audioExt[mime];if(!ext)return json(400,{error:'Choose a supported audio track.'});
   const path=`post-audio/${customerId}/${randomUUID()}.${ext}`,u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
   const r=await fetch(`${u}/storage/v1/object/upload/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:'{}'});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json(502,{error:d.message||'Could not prepare the audio upload.'});
   return json(200,{path,token:d.token});
  }
  if(action==='sign_upload'){
   const mime=String(b.mime_type||''),ext=mimeExt[mime];if(!ext)return json(400,{error:'Choose a supported image or video.'});
   const path=`${admin?'admin':customerId}/${randomUUID()}.${ext}`;
   const u=process.env.SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY;
   const r=await fetch(`${u}/storage/v1/object/upload/sign/aam-social-media/${path}`,{method:'POST',headers:h(k,{'Content-Type':'application/json'}),body:'{}'});
   const d=await r.json().catch(()=>({}));if(!r.ok)return json(502,{error:d.message||'Could not prepare the upload.'});
   return json(200,{path,token:d.token,signed_url:d.signedURL||d.signedUrl||null});
  }
  if(action==='publish_post'){
   const path=String(b.media_path||''),mime=String(b.mime_type||''),ext=mimeExt[mime],prefix=admin?'admin/':customerId+'/';
   const thumb=String(b.thumbnail_path||''),audioPath=String(b.audio_path||'');
   if(!ext||!path.startsWith(prefix)||path.includes('..')||(thumb&&(!thumb.startsWith('thumbnails/'+customerId+'/')||thumb.includes('..')))||
      (audioPath&&(!audioPath.startsWith('post-audio/'+customerId+'/')||audioPath.includes('..'))))return json(400,{error:'Invalid uploaded media or audio track.'});
   const caption=String(b.caption||'').trim().slice(0,2200),type=mime.startsWith('video/')?'video':'image';
   const rows=await db('aam_social_posts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify([{customer_id:customerId,author_role:admin?'admin':'customer',media_type:type,media_path:path,thumbnail_path:thumb||null,...(audioPath?{audio_path:audioPath}:{}),caption,moderation_status:'published',is_locked:admin&&type==='video'&&b.is_locked===true}])});
   return json(200,{ok:true,post:rows[0]});
  }
  return json(400,{error:'Unsupported feed action.'});
 }catch(e){return json(400,{error:e.message||'Could not load the social feed.'});}
}
