const BASE='https://api.dansms.com/api/v1/handler';
export function json(statusCode,body){return{statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)}}
export async function dansms(params){
 const key=process.env.DANSMS_API_KEY;
 if(!key)throw Object.assign(new Error('DANSMS_API_KEY is missing in Netlify.'),{status:503});
 const url=new URL(BASE);url.searchParams.set('api_key',key);
 for(const [k,v] of Object.entries(params||{}))if(v!==undefined&&v!==null&&String(v)!=='')url.searchParams.set(k,String(v));
 const r=await fetch(url,{method:'GET',cache:'no-store',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json,text/plain'}});
 const raw=(await r.text()).trim();
 if(!r.ok)throw Object.assign(new Error('DanSMS request failed ('+r.status+').'),{status:r.status});
 let data=raw;try{data=JSON.parse(raw)}catch{}
 if(typeof data==='string'&&/^(ERROR|BAD_|NO_|ACCESS_DENIED)/i.test(data))throw Object.assign(new Error(data),{status:409});
 return data;
}
export function customerPriceUsd(cost){
 const rate=Number(process.env.DANSMS_USD_NGN_RATE),markup=Number(process.env.DANSMS_MARKUP_NGN);
 if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(markup)||markup<0)
  throw Object.assign(new Error('DanSMS pricing is not configured. Set DANSMS_USD_NGN_RATE and DANSMS_MARKUP_NGN in Netlify before enabling purchases.'),{status:503});
 const supplierUsd=Number(cost);
 if(!Number.isFinite(supplierUsd)||supplierUsd<=0)throw Object.assign(new Error('DanSMS returned an invalid service price.'),{status:502});
 const markupKobo=Math.round(markup*100);
 const customerChargeKobo=Math.ceil(supplierUsd*rate*100)+markupKobo;
 return {supplier_usd:supplierUsd,exchange_rate:rate,markup_kobo:markupKobo,customer_charge_kobo:customerChargeKobo,customer_price_ngn:customerChargeKobo/100};
}
export function activationResponse(value){
 const s=String(value||'').trim(),m=s.match(/^ACCESS_NUMBER:(\d+):(\+?\d+)$/);
 if(!m)throw Object.assign(new Error('DanSMS did not return a valid activation ID and phone number.'),{status:502});
 return {activation_id:m[1],phone_number:m[2].startsWith('+')?m[2]:'+'+m[2]};
}
