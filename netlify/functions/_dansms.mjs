const BASE='https://api.dansms.com/api/v1/handler';
const API_ERRORS={
 BAD_KEY:{status:503,message:'DanSMS rejected the API key. Check DANSMS_API_KEY in Netlify.'},
 BAD_ACTION:{status:400,message:'DanSMS rejected the action or its parameters.'},
 BAD_SERVICE:{status:400,message:'This service is not available for the selected country.'},
 BAD_STATUS:{status:400,message:'DanSMS does not support that activation status action.'},
 NO_BALANCE:{status:409,message:'The DanSMS supplier wallet has insufficient USD balance. No number was reserved.'},
 NO_NUMBERS:{status:409,message:'No numbers are available right now. Try again later or choose another service.'},
 NO_ACTIVATION:{status:404,message:'DanSMS could not find this activation.'},
 ACCESS_DISABLED:{status:409,message:'DanSMS already has an active order. Cancel it or wait for its OTP before ordering another.'},
 TOO_MANY_REQUESTS:{status:429,message:'DanSMS rate limit reached. Wait a few seconds before trying again.'},
 ERROR_SQL:{status:502,message:'DanSMS reported an internal error. Please retry shortly.'},
 ERROR_PROVIDER:{status:503,message:'The upstream SMS provider is temporarily unreachable. Please retry shortly.'}
};
export function json(statusCode,body){return{statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)}}
export async function dansms(params){
 const key=process.env.DANSMS_API_KEY;
 if(!key)throw Object.assign(new Error('DANSMS_API_KEY is missing in Netlify.'),{status:503});
 const url=new URL(BASE);
 for(const [k,v] of Object.entries(params||{}))if(v!==undefined&&v!==null&&String(v)!=='')url.searchParams.set(k,String(v));
 const r=await fetch(url,{method:'GET',cache:'no-store',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json,text/plain',Authorization:'Bearer '+key}});
 const raw=(await r.text()).trim();
 if(!r.ok)throw Object.assign(new Error('DanSMS request failed ('+r.status+').'),{status:r.status});
 let data=raw;try{data=JSON.parse(raw)}catch{}
 if(typeof data==='string'){
  const code=data.trim().split(':',1)[0];
  if(API_ERRORS[code]){
   const known=API_ERRORS[code];
   throw Object.assign(new Error(known.message),{status:known.status,providerCode:code,definitive:true});
  }
  if(/^(ERROR|BAD_|NO_|ACCESS_DISABLED|TOO_MANY_REQUESTS)/i.test(data))
   throw Object.assign(new Error('DanSMS returned an unrecognized error: '+data),{status:502,providerCode:code,definitive:true});
 }
 return data;
}
export function customerPriceUsd(cost){
 const rate=Number(process.env.DANSMS_USD_NGN_RATE),markup=Number(process.env.DANSMS_MARKUP_NGN);
 if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(markup)||markup<0)
  throw Object.assign(new Error('DanSMS pricing is not configured. Set DANSMS_USD_NGN_RATE and DANSMS_MARKUP_NGN in Netlify before enabling purchases.'),{status:503});
 const supplierUsd=Number(cost);
 if(!Number.isFinite(supplierUsd)||supplierUsd<=0)throw Object.assign(new Error('DanSMS returned an invalid service price.'),{status:502});
 const markupKobo=Math.round(markup*100);
 const supplierScaled=BigInt(supplierUsd.toFixed(4).replace('.',''));
 const rateScaled=BigInt(rate.toFixed(4).replace('.',''));
 const supplierCostKobo=(supplierScaled*rateScaled*100n+99999999n)/100000000n;
 if(supplierCostKobo>BigInt(Number.MAX_SAFE_INTEGER-markupKobo))throw Object.assign(new Error('DanSMS price is outside the supported range.'),{status:502});
 const customerChargeKobo=Number(supplierCostKobo)+markupKobo;
 return {supplier_usd:supplierUsd,exchange_rate:rate,markup_kobo:markupKobo,customer_charge_kobo:customerChargeKobo,customer_price_ngn:customerChargeKobo/100};
}
export function activationResponse(value){
 const s=String(value||'').trim(),m=s.match(/^ACCESS_NUMBER:([0-9]+):([+]?[0-9]+)$/);
 if(!m)throw Object.assign(new Error('DanSMS did not return a valid activation ID and phone number.'),{status:502});
 return {activation_id:m[1],phone_number:m[2].startsWith('+')?m[2]:'+'+m[2]};
}
