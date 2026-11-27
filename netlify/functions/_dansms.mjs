const BASE='https://api.dansms.com/api/v1/handler';

export function json(statusCode,body){return{statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)}}

export async function dansms(action,params={}){
  const key=process.env.DANSMS_API_KEY;
  if(!key)throw Object.assign(new Error('DanSMS is not configured on the server.'),{status:503});
  const url=new URL(BASE);
  url.searchParams.set('api_key',key);
  url.searchParams.set('action',action);
  for(const [name,value] of Object.entries(params)){
    if(value!==undefined&&value!==null&&String(value)!=='')url.searchParams.set(name,String(value));
  }
  const response=await fetch(url,{method:'GET',headers:{Accept:'application/json, text/plain'},signal:AbortSignal.timeout(12000)});
  const text=await response.text();
  if(!response.ok)throw Object.assign(new Error('DanSMS request failed.'),{status:502,providerStatus:response.status});
  let data=text;
  try{data=JSON.parse(text)}catch{}
  if(typeof data==='string'&&/^(BAD_KEY|BAD_ACTION|NO_BALANCE|NO_NUMBERS|BAD_SERVICE|NO_ACTIVATION|ERROR)/i.test(data)){
    throw Object.assign(new Error('DanSMS returned: '+data),{status:502,providerCode:data});
  }
  return data;
}
