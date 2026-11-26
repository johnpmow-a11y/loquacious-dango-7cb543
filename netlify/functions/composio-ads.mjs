import { createHmac, randomUUID } from 'node:crypto';
import { URLSearchParams } from 'node:url';
const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const toolkits={facebook:'metaads',instagram:'metaads',meta:'metaads',tiktok:'tiktok_ads'};
const allowedTools={metaads:['METAADS_GET_AD_ACCOUNTS','METAADS_CREATE_CAMPAIGN','METAADS_CREATE_AD_SET','METAADS_CREATE_AD_CREATIVE','METAADS_CREATE_AD'],tiktok_ads:['TIKTOK_ADS_GET_ADVERTISER_ACCOUNTS','TIKTOK_ADS_CREATE_CAMPAIGN','TIKTOK_ADS_CREATE_AD_GROUP','TIKTOK_ADS_CREATE_ADGROUP','TIKTOK_ADS_CREATE_AD','TIKTOK_ADS_CREATE_ADS']};
function h(key,extra={}){return { 'x-api-key':key,'Content-Type':'application/json',...extra };}
async function db(path,options={}){const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!key)throw new Error('Customer session service is not configured.');const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`}),'Content-Type':'application/json',...(options.headers||{})}});const d=await r.json().catch(()=>[]);if(!r.ok)throw new Error(d.message||'Customer session lookup failed.');return d;}
async function session(token){if(!uuid.test(token))return null;const rows=await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);return rows[0]||null;}
async function comp(path,options={}){const key=process.env.COMPOSIO_API_KEY;if(!key)throw new Error('Advertising connection is not configured on the server.');const r=await fetch('https://backend.composio.dev'+path,{...options,headers:h(key,options.headers||{})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error?.message||d.message||'Advertising provider request failed.');return d;}
function collectIds(value,out={}){if(Array.isArray(value)){for(const item of value)collectIds(item,out);return out;}if(!value||typeof value!=='object')return out;for(const [key,item] of Object.entries(value)){if(item!==null&&item!==undefined&&/^(campaign_id|adset_id|ad_set_id|adgroup_id|ad_group_id|creative_id|ad_id|advertiser_id|account_id|ad_account_id|page_id|post_id|object_story_id|effective_object_story_id|identity_id|identity_type|tiktok_item_id)$/i.test(key)&&(typeof item==='string'||typeof item==='number'))out[key.toLowerCase()]=String(item);if(item&&typeof item==='object')collectIds(item,out);}return out;}
async function saveAdAsset(customerId,platform,toolkit,connectedAccountId,args,result){
 try{
  const ids={...collectIds(args),...collectIds(result)};
  let campaignId=ids.campaign_id||null,existing=[];
  if(campaignId)existing=await db('aam_ad_campaign_assets?select=id,campaign_id&customer_id=eq.'+encodeURIComponent(customerId)+'&platform=eq.'+encodeURIComponent(platform)+'&campaign_id=eq.'+encodeURIComponent(campaignId)+'&limit=1');
  if(!existing.length){
   const parent=ids.adset_id||ids.ad_set_id||ids.adgroup_id||ids.ad_group_id;
   if(parent){const column=(ids.adgroup_id||ids.ad_group_id)?'ad_group_id':'ad_set_id';existing=await db('aam_ad_campaign_assets?select=id,campaign_id&customer_id=eq.'+encodeURIComponent(customerId)+'&platform=eq.'+encodeURIComponent(platform)+'&'+column+'=eq.'+encodeURIComponent(parent)+'&limit=1');if(!campaignId)campaignId=existing[0]?.campaign_id||null;}
  }
  if(!campaignId&&!ids.ad_id)return;
  const row={customer_id:customerId,platform,toolkit_slug:toolkit,connected_account_id:connectedAccountId,
   ad_account_id:ids.ad_account_id||ids.account_id||ids.advertiser_id||null,
   campaign_id:campaignId,ad_set_id:ids.adset_id||ids.ad_set_id||null,ad_group_id:ids.adgroup_id||ids.ad_group_id||null,
   creative_id:ids.creative_id||null,ad_id:ids.ad_id||null,page_id:ids.page_id||null,
   post_id:ids.post_id||null,object_story_id:ids.object_story_id||ids.effective_object_story_id||null,
   provider_result:result,provider_metadata:{identity_id:ids.identity_id||null,identity_type:ids.identity_type||null,tiktok_item_id:ids.tiktok_item_id||null},updated_at:new Date().toISOString()};
  if(existing.length)await db('aam_ad_campaign_assets?id=eq.'+encodeURIComponent(existing[0].id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
  else await db('aam_ad_campaign_assets',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(row)});
 }catch(error){console.warn('Ad campaign ownership metadata was not saved; provider creation remains successful:',error.message);}
}

function reportArgs(schema,values){
 const root=schema?.input_parameters||schema||{},props=root.properties||root,required=Array.isArray(root.required)?root.required:[];
 const out={};
 for(const [key,value] of Object.entries(values)){if(Object.prototype.hasOwnProperty.call(props,key)&&value!==undefined)out[key]=value;}
 const hasExplicitRange=Object.keys(out).some(key=>/time_range/i.test(key));
 for(const [key,def] of Object.entries(props)){if(out[key]!==undefined)continue;const k=key.toLowerCase();
  if(/date_preset/.test(k)){if(!hasExplicitRange)out[key]='last_7d';}
  else if(/time_range/.test(k))out[key]={since:values.start_date||new Date(Date.now()-7*86400000).toISOString().slice(0,10),until:values.end_date||new Date().toISOString().slice(0,10)};
  else if(/page_size|limit/.test(k))out[key]=100;
  else if(def?.default!==undefined)out[key]=def.default;
 }
 const missing=required.filter(k=>out[k]===undefined);
 return {args:out,missing};
}
async function executeReport(slug,account,userId,toolSlug,values){
 const definition=await comp('/api/v3.1/tools/'+encodeURIComponent(toolSlug));
 const built=reportArgs(definition,values);
 if(built.missing.length)throw new Error(toolSlug+' requires fields not yet supported: '+built.missing.join(', '));
 const result=await comp('/api/v3.1/tools/execute/'+encodeURIComponent(toolSlug),{method:'POST',body:JSON.stringify({connected_account_id:account.id,user_id:userId,version:definition.version,arguments:built.args})});
 return result.data||result;
}
function metricNumber(row,...keys){for(const k of keys){const v=row?.[k];if(v!==undefined&&v!==null&&v!=='')return Number(v)||0;}return 0;}
function metricConversions(row){
 const direct=metricNumber(row,'conversions','conversion');
 if(direct)return direct;
 const actions=Array.isArray(row?.actions)?row.actions:[];
 const conversionTypes=/purchase|lead|complete_registration|submit_application|subscribe|contact|schedule|donate|start_trial|add_to_cart|initiate_checkout|offsite_conversion/i;
 return actions.filter(x=>conversionTypes.test(String(x?.action_type||''))).reduce((sum,x)=>sum+(Number(x?.value)||0),0);
}

async function unlockIsPaid(customerId){const now=new Date().toISOString();const rows=await db('aam_ad_unlocks?select=status,expires_at&customer_id=eq.'+encodeURIComponent(customerId)+'&status=eq.paid&expires_at=gt.'+encodeURIComponent(now)+'&order=expires_at.desc&limit=1');return rows.length>0;}
async function userAccounts(userId,slug){const params=new URLSearchParams({user_ids:userId,toolkit_slugs:slug,limit:'100'});const data=await comp('/api/v3.1/connected_accounts?'+params.toString());return (data.items||[]).filter(x=>x.user_id===userId&&x.toolkit?.slug===slug&&x.status==='ACTIVE');}
async function authConfig(slug){const q=new URLSearchParams({toolkit_slug:slug,is_composio_managed:'true'});const listed=await comp('/api/v3/auth_configs?'+q.toString());const found=(listed.items||[]).find(x=>x.toolkit?.slug===slug&&x.is_composio_managed!==false);if(found?.id)return found.id;const made=await comp('/api/v3/auth_configs',{method:'POST',body:JSON.stringify({toolkit:{slug}})});const id=made.id||made.auth_config?.id;if(!id)throw new Error('Composio did not return an advertising authorization configuration.');return id;}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:{'Access-Control-Allow-Origin':process.env.URL||'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST,GET'}};
 try{
  const q=event.queryStringParameters||{};
  if(event.httpMethod==='GET'&&(q.action==='status'||q.action==='schema'||q.action==='accounts')){
   const s=await session(String(q.token||''));if(!s)return json(401,{error:'Please log in again.'});
   const platform=String(q.platform||'facebook').toLowerCase(),slug=toolkits[platform];if(!slug)return json(400,{error:'Unsupported advertising platform.'});
   const userId='aam_customer_'+s.customer_id;
   if(q.action==='accounts'){
    const active=await userAccounts(userId,slug);if(!active.length)return json(409,{error:'Connect your advertising account first.'});
    const toolSlug=slug==='metaads'?'METAADS_GET_AD_ACCOUNTS':'TIKTOK_ADS_GET_ADVERTISER_ACCOUNTS';
    if(slug==='tiktok_ads'&&!String(q.advertiser_id||'').trim())return json(200,{needs_advertiser_id:true,tool_slug:toolSlug});
    const definition=await comp('/api/v3.1/tools/'+encodeURIComponent(toolSlug));
    const args=slug==='tiktok_ads'?{advertiser_ids:[String(q.advertiser_id).trim()]}:{};
    const result=await comp('/api/v3.1/tools/execute/'+encodeURIComponent(toolSlug),{method:'POST',body:JSON.stringify({connected_account_id:active[0].id,user_id:userId,version:definition.version,arguments:args})});
    return json(200,{tool_slug:toolSlug,result:result.data||result});
   }
   if(q.action==='schema'){
    const toolSlug=String(q.tool_slug||'');if(!(allowedTools[slug]||[]).includes(toolSlug))return json(400,{error:'This advertising action is not enabled.'});
    const schema=await comp('/api/v3.1/tools/'+encodeURIComponent(toolSlug));return json(200,{slug:toolSlug,version:schema.version,input_parameters:schema.input_parameters||{},description:schema.description||''});
   }
   const params=new URLSearchParams({user_ids:userId,toolkit_slugs:slug,limit:'100'});
   const data=await comp('/api/v3.1/connected_accounts?'+params.toString());
   const items=(data.items||[]).filter(x=>x.user_id===userId&&x.toolkit?.slug===slug);
   const active=items.filter(x=>x.status==='ACTIVE').map(x=>({id:x.id,status:x.status,toolkit:slug,created_at:x.created_at}));
   return json(200,{connected:active.length>0,accounts:active,pending:items.some(x=>['INITIALIZING','PENDING'].includes(x.status))});
  }
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const b=JSON.parse(event.body||'{}'),s=await session(String(b.token||''));if(!s)return json(401,{error:'Please log in again.'});
  const platform=String(b.platform||'').toLowerCase(),slug=toolkits[platform];if(!slug)return json(400,{error:'Choose Facebook, Instagram or TikTok Ads.'});
  const userId='aam_customer_'+s.customer_id;

  if(b.action==='performance'){
   const platform=String(b.platform||'').toLowerCase(),reportSlug=platform==='facebook'||platform==='instagram'?'metaads':platform==='tiktok'?'tiktok_ads':'';
   if(!reportSlug)return json(400,{error:'Choose Facebook, Instagram or TikTok.'});
   const accounts=await userAccounts(userId,reportSlug);if(!accounts.length)return json(409,{error:'Connect your advertising account first.'});
   const assets=await db('aam_ad_campaign_assets?select=id,platform,connected_account_id,ad_account_id,campaign_id,ad_set_id,ad_group_id,ad_id&customer_id=eq.'+encodeURIComponent(s.customer_id)+'&platform=eq.'+encodeURIComponent(platform)+'&order=updated_at.desc&limit=200');
   const accountIds=[...new Set(assets.map(x=>String(x.ad_account_id||'')).filter(Boolean))];
   if(!accountIds.length)return json(200,{platform,rows:[],message:'No campaign assets have been saved for this account yet. Create or connect a campaign first, then refresh performance.'});
   const startDate=String(b.start_date||new Date(Date.now()-7*86400000).toISOString().slice(0,10)),endDate=String(b.end_date||new Date().toISOString().slice(0,10));
   if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(endDate)||startDate>endDate)return json(400,{error:'Choose a valid reporting date range.'});
   const reports=[];
   for(const accountId of accountIds){
    const account=accounts.find(x=>x.id===assets.find(a=>String(a.ad_account_id)===accountId)?.connected_account_id)||accounts[0];
    try{
     let data;
     if(reportSlug==='metaads'){
      data=await executeReport(reportSlug,account,userId,'METAADS_GET_INSIGHTS',{
       object_id:/^act_/.test(accountId)?accountId:'act_'+accountId,
       level:'campaign',
       fields:'campaign_id,campaign_name,impressions,reach,frequency,clicks,inline_link_clicks,ctr,spend,cpc,cpm,actions,action_values',
       time_range:{since:startDate,until:endDate},
       date_preset:'last_7d'
      });
     }else{
      data=await executeReport(reportSlug,account,userId,'TIKTOK_ADS_GET_REPORT_INTEGRATED',{
       advertiser_id:accountId,
       report_type:'BASIC',
       data_level:'AUCTION_CAMPAIGN',
       dimensions:['campaign_id','campaign_name'],
       metrics:['spend','impressions','clicks','ctr','conversion','cost_per_conversion','reach','cpc','cpm'],
       start_date:startDate,end_date:endDate,
       page_size:100
      });
     }
     const root=data?.data||data,raw=Array.isArray(root)?root:(root?.list||root?.rows||root?.data||root?.report_data||[]);
     const rows=Array.isArray(raw)?raw:[];
     reports.push({account_id:accountId,rows:rows.map(x=>{const row={...(x.dimensions||{}),...(x.metrics||{}),...x};return {campaign_id:row.campaign_id||row.campaignId||'',campaign_name:row.campaign_name||row.campaignName||'Campaign',impressions:metricNumber(row,'impressions'),reach:metricNumber(row,'reach'),clicks:metricNumber(row,'clicks','click'),ctr:metricNumber(row,'ctr'),spend:metricNumber(row,'spend','cost','total_cost'),conversions:metricConversions(row),cpc:metricNumber(row,'cpc'),cpm:metricNumber(row,'cpm'),status:row.effective_status||row.status||row.operation_status||'—'};}),raw_count:rows.length});
    }catch(error){reports.push({account_id:accountId,error:error.message,rows:[]});}
   }
   return json(200,{platform,start_date:startDate,end_date:endDate,reports});
  }

  if(b.action==='execute'){
   const toolSlug=String(b.tool_slug||''),allowed=allowedTools[slug]||[];
   if(!allowed.includes(toolSlug))return json(400,{error:'This advertising action is not enabled.'});
   const args=b.arguments;if(!args||typeof args!=='object'||Array.isArray(args)||JSON.stringify(args).length>45000)return json(400,{error:'Invalid campaign information.'});
   const finalAdAction=(slug==='metaads'&&toolSlug==='METAADS_CREATE_AD')||(slug==='tiktok_ads'&&['TIKTOK_ADS_CREATE_AD','TIKTOK_ADS_CREATE_ADS'].includes(toolSlug));
   if(finalAdAction&&!(await unlockIsPaid(s.customer_id)))return json(402,{error:'Your 20-minute advertising payment unlock has expired. Unlock again for ₦3,800 to create another ad.'});
   const accounts=await userAccounts(userId,slug);if(!accounts.length)return json(409,{error:'Connect your advertising account before creating a campaign.'});
   const account=accounts.find(x=>x.id===String(b.connected_account_id||''))||accounts[0];
   const definition=await comp('/api/v3.1/tools/'+encodeURIComponent(toolSlug));
   const inputSchema=definition.input_parameters||{},properties=inputSchema.properties||inputSchema;
   const createAction=(slug==='metaads'&&['METAADS_CREATE_CAMPAIGN','METAADS_CREATE_AD_SET','METAADS_CREATE_AD'].includes(toolSlug))||(slug==='tiktok_ads'&&['TIKTOK_ADS_CREATE_CAMPAIGN','TIKTOK_ADS_CREATE_AD_GROUP','TIKTOK_ADS_CREATE_ADGROUP','TIKTOK_ADS_CREATE_AD','TIKTOK_ADS_CREATE_ADS'].includes(toolSlug));
   if(createAction){const statusField=slug==='metaads'?'status':'operation_status';if(!properties[statusField])return json(409,{error:'This provider action does not expose a safe paused/draft status. Campaign creation is blocked to prevent accidental ad spend.'});args[statusField]=slug==='metaads'?'PAUSED':'DISABLE';}
   const required=Array.isArray(inputSchema.required)?inputSchema.required:Object.entries(properties).filter(([,v])=>v.required).map(([k])=>k);
   const missing=required.filter(k=>args[k]===undefined||args[k]===null||args[k]==='');
   if(missing.length)return json(400,{error:'Campaign setup is missing required fields: '+missing.join(', ')});
   const result=await comp('/api/v3.1/tools/execute/'+encodeURIComponent(toolSlug),{method:'POST',body:JSON.stringify({connected_account_id:account.id,user_id:userId,version:definition.version,arguments:args})});
   const providerResult=result.data||result;
   if(createAction)await saveAdAsset(s.customer_id,platform==='meta'?'facebook':platform,slug,account.id,args,providerResult);
   return json(200,{ok:true,tool_slug:toolSlug,result:providerResult});
  }
  const auth_config_id=await authConfig(slug);
  const origin=process.env.DEPLOY_PRIME_URL||process.env.URL;if(!origin)throw new Error('The secure advertising callback URL is not configured.');
  const statePayload=Buffer.from(JSON.stringify({customer_id:s.customer_id,platform,expires_at:Date.now()+10*60*1000,nonce:randomUUID()})).toString('base64url');
  const stateSignature=createHmac('sha256',process.env.COMPOSIO_API_KEY).update(statePayload).digest('base64url');
  const callback=new URL('/.netlify/functions/composio-ads-callback',origin);callback.searchParams.set('state',statePayload+'.'+stateSignature);
  const link=await comp('/api/v3.1/connected_accounts/link',{method:'POST',body:JSON.stringify({auth_config_id,user_id:userId,alias:`aam-${s.customer_id}-${platform}-${Date.now()}`,callback_url:callback.toString()})});
  if(!link.redirect_url||!link.connected_account_id)throw new Error('Composio did not return a complete secure connection link.');
  return json(200,{redirect_url:link.redirect_url,connected_account_id:link.connected_account_id,expires_at:link.expires_at,platform});
 }catch(e){return json(502,{error:e.message||'Could not start the advertising account connection.'});}
}
