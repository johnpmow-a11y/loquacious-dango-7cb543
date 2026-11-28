const BASE='https://api.dansms.com/v1';

export async function dansmsV1(path,{method='GET',body}={}){
  const key=process.env.DANSMS_API_KEY;
  if(!key)throw Object.assign(new Error('DanSMS is not configured on the server.'),{status:503});
  const response=await fetch(BASE+path,{
    method,
    headers:{Authorization:'Bearer '+key,Accept:'application/json','Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(12000)
  });
  const raw=await response.text();
  let data=raw;
  try{data=JSON.parse(raw)}catch{}
  if(!response.ok)throw Object.assign(new Error(data?.message||data?.error||'DanSMS request failed.'),{status:response.status,provider:data});
  return data;
}

export function createDanSmsOrder(service,country){
  if(!/^[a-z0-9_-]{1,40}$/i.test(String(service||'')))throw new Error('Invalid DanSMS service code.');
  if(!/^[A-Z]{2}$/.test(String(country||'')))throw new Error('Use a two-letter country code.');
  return dansmsV1('/orders',{method:'POST',body:{service:String(service),country:String(country)}});
}

export function getDanSmsCode(orderId){
  if(!/^[a-z0-9_-]{1,100}$/i.test(String(orderId||'')))throw new Error('Invalid DanSMS order ID.');
  return dansmsV1('/orders/'+encodeURIComponent(String(orderId))+'/code');
}
