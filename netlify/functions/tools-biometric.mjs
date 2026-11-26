import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'},body:JSON.stringify(body)});
const uuid=/^[0-9a-f-]{36}$/i;
const headers=(key,extra={})=>({apikey:key,...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}),'Content-Type':'application/json',...extra});
async function db(path,options={}) {
  const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!key)throw new Error('Biometric security service is not configured.');
  const r=await fetch(base+'/rest/v1/'+path,{...options,headers:headers(key,options.headers||{}),signal:AbortSignal.timeout(10000)});
  const data=await r.json().catch(()=>[]);
  if(!r.ok){const e=new Error(data.message||data.error||'Biometric database request failed.');e.status=r.status;e.code=data.code;throw e;}
  return data;
}
async function customer(token) {
  if(!uuid.test(token))return null;
  const rows=await db('customer_sessions?select=customer_id&token=eq.'+encodeURIComponent(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1');
  return rows[0]||null;
}
function requestOrigin(event) {
  const origin=String(event.headers?.origin||event.headers?.Origin||'');
  const host=String(event.headers?.host||event.headers?.Host||'').split(':')[0].toLowerCase();
  let parsed;
  try{parsed=new URL(origin);}catch{return null;}
  if(parsed.protocol!=='https:'&&!(parsed.hostname==='localhost'&&parsed.protocol==='http:'))return null;
  if(parsed.hostname.toLowerCase()!==host)return null;
  return {origin:parsed.origin,rpID:parsed.hostname};
}
async function saveChallenge(customerId,action,challenge) {
  await db('aam_tools_webauthn_challenges',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({customer_id:customerId,action,challenge,expires_at:new Date(Date.now()+5*60*1000).toISOString()})});
}
async function takeChallenge(customerId,action,challenge) {
  const rows=await db('aam_tools_webauthn_challenges?select=id,challenge&customer_id=eq.'+encodeURIComponent(customerId)+'&action=eq.'+encodeURIComponent(action)+'&challenge=eq.'+encodeURIComponent(challenge)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&order=created_at.desc&limit=1');
  if(!rows.length)return null;
  await db('aam_tools_webauthn_challenges?id=eq.'+encodeURIComponent(rows[0].id),{method:'DELETE',headers:{Prefer:'return=minimal'}});
  return rows[0].challenge;
}
async function credentials(customerId) {
  return db('aam_tools_webauthn_credentials?select=id,credential_id,public_key,counter,transports&customer_id=eq.'+encodeURIComponent(customerId));
}
export async function handler(event) {
  if(event.httpMethod==='OPTIONS')return json(204,{});
  if(event.httpMethod!=='POST')return json(405,{error:'Method not allowed.'});
  const origin=requestOrigin(event);
  if(!origin)return json(403,{error:'Biometric requests must come from this secure All Ads Manager site.'});
  try {
    const body=JSON.parse(event.body||'{}'),token=String(body.token||''),action=String(body.action||'');
    const session=await customer(token);
    if(!session)return json(401,{error:'Your customer session has expired. Please sign in again.'});
    const customerId=String(session.customer_id),rpName='All Ads Manager';
    if(action==='register-options') {
      const existing=await credentials(customerId);
      const options=await generateRegistrationOptions({
        rpName,rpID:origin.rpID,userID:new TextEncoder().encode(customerId),
        userName:'customer-'+customerId,userDisplayName:'All Ads Manager customer',
        attestationType:'none',supportedAlgorithmIDs:[-7,-257],
        excludeCredentials:existing.map(c=>({id:c.credential_id,transports:c.transports||[]})),
        authenticatorSelection:{authenticatorAttachment:'platform',residentKey:'preferred',userVerification:'required'},
      });
      await saveChallenge(customerId,'registration',options.challenge);
      return json(200,{options});
    }
    if(action==='register-verify') {
      const response=body.response;
      if(!response?.id||!response?.response?.clientDataJSON)return json(400,{error:'Invalid biometric registration response.'});
      const challenge=await takeChallenge(customerId,'registration',response.response.clientDataJSON?undefined:undefined);
      // The challenge is looked up from the submitted clientDataJSON after decoding it.
      const clientData=JSON.parse(Buffer.from(response.response.clientDataJSON,'base64url').toString('utf8'));
      const expectedChallenge=await takeChallenge(customerId,'registration',clientData.challenge);
      if(!expectedChallenge)return json(400,{error:'Registration expired. Please try again.'});
      const verification=await verifyRegistrationResponse({response,expectedChallenge,expectedOrigin:origin.origin,expectedRPID:origin.rpID,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});
      if(!verification.verified||!verification.registrationInfo)return json(400,{error:'Your device could not verify this passkey. Please try again.'});
      const info=verification.registrationInfo,cred=info.credential;
      await db('aam_tools_webauthn_credentials',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
        customer_id:customerId,credential_id:cred.id,public_key:Buffer.from(cred.publicKey).toString('base64url'),
        counter:cred.counter,transports:cred.transports||[],device_type:info.credentialDeviceType||'unknown',
        backed_up:!!info.credentialBackedUp
      })});
      return json(200,{verified:true,registered:true});
    }
    if(action==='auth-options') {
      const existing=await credentials(customerId);
      if(!existing.length)return json(409,{error:'No device passkey is registered for this account yet.'});
      const options=await generateAuthenticationOptions({rpID:origin.rpID,allowCredentials:existing.map(c=>({id:c.credential_id,transports:c.transports||[]})),userVerification:'required'});
      await saveChallenge(customerId,'authentication',options.challenge);
      return json(200,{options});
    }
    if(action==='auth-verify') {
      const response=body.response;
      if(!response?.id||!response?.response?.clientDataJSON)return json(400,{error:'Invalid biometric verification response.'});
      const clientData=JSON.parse(Buffer.from(response.response.clientDataJSON,'base64url').toString('utf8'));
      const expectedChallenge=await takeChallenge(customerId,'authentication',clientData.challenge);
      if(!expectedChallenge)return json(400,{error:'Verification expired. Please try again.'});
      const rows=await db('aam_tools_webauthn_credentials?select=id,credential_id,public_key,counter,transports&customer_id=eq.'+encodeURIComponent(customerId)+'&credential_id=eq.'+encodeURIComponent(response.id)+'&limit=1');
      if(!rows.length)return json(403,{error:'This device is not registered to your account.'});
      const row=rows[0];
      const verification=await verifyAuthenticationResponse({
        response,expectedChallenge,expectedOrigin:origin.origin,expectedRPID:origin.rpID,requireUserVerification:true,
        credential:{id:row.credential_id,publicKey:Buffer.from(row.public_key,'base64url'),counter:Number(row.counter||0),transports:row.transports||[]}
      });
      if(!verification.verified)return json(403,{error:'Device verification failed.'});
      await db('aam_tools_webauthn_credentials?id=eq.'+encodeURIComponent(row.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({counter:verification.authenticationInfo.newCounter,updated_at:new Date().toISOString()})});
      return json(200,{verified:true});
    }
    return json(400,{error:'Unknown biometric security action.'});
  } catch(error) {
    console.error('Tools biometric verification failed:',error.message);
    const status=error.status&&error.status>=400&&error.status<500?error.status:503;
    return json(status,{error:status===503?'Biometric verification is temporarily unavailable. Please try again.':error.message});
  }
}
