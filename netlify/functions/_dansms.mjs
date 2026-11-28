const BASE='https://api.dansms.com/api/v1/handler';

const PROVIDER_ERRORS=Object.freeze({
  BAD_KEY:{status:502,message:'DanSMS API key is missing or unrecognized.'},
  BAD_ACTION:{status:502,message:'DanSMS rejected the action or its parameters.'},
  BAD_SERVICE:{status:409,message:'This service is not available for the selected country.'},
  BAD_STATUS:{status:502,message:'DanSMS rejected the activation status value.'},
  NO_BALANCE:{status:503,message:'The DanSMS supplier account has insufficient balance. No new number was issued.'},
  NO_NUMBERS:{status:409,message:'No numbers are available right now. Please try again later.'},
  NO_ACTIVATION:{status:404,message:'DanSMS could not find this activation.'},
  ACCESS_DISABLED:{status:409,message:'DanSMS already has an active order. Wait for its OTP or resolve that order before buying again.'},
  TOO_MANY_REQUESTS:{status:429,message:'DanSMS rate limit reached. Please wait a few seconds before retrying.'},
  ERROR_SQL:{status:502,message:'DanSMS encountered an internal error. Please retry later.'},
  ERROR_PROVIDER:{status:503,message:'The upstream SMS provider is temporarily unavailable. Please retry later.'}
});

export function json(statusCode,body){return{statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)}}

function parseProviderError(value){
  if(typeof value!=='string')return null;
  const code=value.trim().split(/[:\s]/,1)[0].toUpperCase();
  return Object.hasOwn(PROVIDER_ERRORS,code)?{code,...PROVIDER_ERRORS[code]}:null;
}

export async function dansms(action,params={}){
  const key=process.env.DANSMS_API_KEY;
  if(!key)throw Object.assign(new Error('DanSMS is not configured on the server.'),{status:503});
  const url=new URL(BASE);
  url.searchParams.set('api_key',key);
  url.searchParams.set('action',action);
  for(const [name,value] of Object.entries(params)){
    if(value!==undefined&&value!==null&&String(value)!=='')url.searchParams.set(name,String(value));
  }
  let response;
  try{
    response=await fetch(url,{method:'GET',headers:{Accept:'application/json, text/plain'},signal:AbortSignal.timeout(12000)});
  }catch(error){
    throw Object.assign(new Error('DanSMS could not be reached. Please retry shortly.'),{status:503,cause:error});
  }
  const body=await response.text();
  // DanSMS uses plain-text bodies for both success and error responses.
  // Inspect the exact leading error token before attempting JSON parsing.
  const plainError=parseProviderError(body);
  if(plainError){
    throw Object.assign(new Error(plainError.message),{status:plainError.status,providerCode:plainError.code,providerResponse:body});
  }
  if(!response.ok)throw Object.assign(new Error('DanSMS request failed.'),{status:502,providerStatus:response.status});
  let data=body;
  try{data=JSON.parse(body)}catch{}
  // Some provider deployments wrap a plain-text result in a JSON string.
  const wrappedError=parseProviderError(data);
  if(wrappedError){
    throw Object.assign(new Error(wrappedError.message),{status:wrappedError.status,providerCode:wrappedError.code,providerResponse:data});
  }
  return data;
}
