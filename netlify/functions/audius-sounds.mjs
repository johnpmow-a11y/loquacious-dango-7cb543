const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=60','Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
const allowedLicenses=new Set(['cc0','cc-by','cc-by-sa','public-domain']);
function normalizeLicense(value){
 const raw=String(value||'').toLowerCase().trim().replace(/_/g,'-');
 if(raw==='cc-zero'||raw==='cc0'||raw.includes('public domain'))return {code:'cc0',label:'CC0 / Public domain'};
 if(raw==='cc-by'||raw.includes('creativecommons.org/licenses/by/'))return {code:'cc-by',label:'Creative Commons BY'};
 if(raw==='cc-by-sa'||raw.includes('creativecommons.org/licenses/by-sa/'))return {code:'cc-by-sa',label:'Creative Commons BY-SA'};
 return {code:raw,label:raw||'Licence not specified'};
}
export async function handler(event){
 if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}};
 if(event.httpMethod!=='GET')return json(405,{error:'Method not allowed.'});
 const q=String(event.queryStringParameters?.q||'').trim().slice(0,100);
 if(!q)return json(400,{error:'Enter a search term.'});
 const apiKey=process.env.AUDIUS_API_KEY||'',bearer=process.env.AUDIUS_BEARER_TOKEN||'';
 if(!apiKey&&!bearer)return json(503,{error:'Audius is not configured in Netlify. Add the existing Audius API credentials.'});
 const url='https://api.audius.co/v1/tracks/search?query='+encodeURIComponent(q)+'&limit=12&sort_method=relevant';
 const headers={Accept:'application/json'};
 if(apiKey)headers['x-api-key']=apiKey;
 if(bearer)headers.Authorization='Bearer '+bearer;
 let response=await fetch(url,{headers});
 if(!response.ok&&bearer){const fallbackHeaders={Accept:'application/json'};if(apiKey)fallbackHeaders['x-api-key']=apiKey;response=await fetch(url,{headers:fallbackHeaders});}
 if(!response.ok)return json(502,{error:'Audius did not return search results (HTTP '+response.status+').'});
 const payload=await response.json().catch(()=>({}));
 const tracks=(Array.isArray(payload.data)?payload.data:[]).filter(t=>t&&t.id).map(t=>{
  const license=normalizeLicense(t.license);
  return {id:String(t.id),title:String(t.title||'Untitled').slice(0,180),creator:String(t.user?.name||t.user?.handle||'Unknown artist').slice(0,100),license:license.code,licenseLabel:license.label,permalink:t.permalink||'',streamUrl:'https://api.audius.co/v1/tracks/'+encodeURIComponent(t.id)+'/stream'};
 }).filter(t=>allowedLicenses.has(t.license));
 return json(200,{tracks});
}
