import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const root=new URL('../',import.meta.url);
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const has=(path,pattern)=>pattern.test(read(path));
const ui=read('public/social.js');
const css=read('public/social.css');
const index=read('public/index.html');
const chat=read('netlify/functions/social-chat.mjs');
const calls=read('netlify/functions/livekit-calls.mjs');
const adminCalls=read('netlify/functions/admin-livekit-calls.mjs');
const rtc=read('public/aam-webrtc-call.js');
const avatar=read('public/aam-webrtc-avatar.js');
const voice=read('public/aam-webrtc-voice.js');
const ice=read('netlify/functions/webrtc-ice-servers.mjs');
const sw=read('public/sw.js');
const reactions=read('supabase/migrations/20261125100000_chat_message_reactions.sql');
const signalMigration=read('supabase/migrations/20261124150000_unified_webrtc_call_signals.sql');
const nexotp=read('netlify/functions/_nexotp.mjs');
const paystackCreate=read('netlify/functions/paystack-create.mjs');
const paystackVerify=read('netlify/functions/paystack-verify.mjs');
const mail=read('netlify/functions/send-email.mjs');
const deployment=read('DEPLOYMENT_README.txt');
const checks=[
 ['native WebRTC is the active browser calling transport',ui.includes("import('./aam-webrtc-call.js")&&rtc.includes('new RTCPeerConnection')&&rtc.includes('pc.addTrack')&&rtc.includes('pc.ontrack')],
 ['WebRTC uses authenticated database signalling and realtime wake-ups',rtc.includes("channel('aam-call-' + callId")&&rtc.includes("channel.on('broadcast'")&&calls.includes('signal_send')&&signalMigration.includes('aam_call_signals')],
 ['TURN relay credentials are requested server-side from Turnix',ice.includes('TURNIX_API_TOKEN')&&ice.includes('turnix.io/api/v1/credentials/ice')&&ui.includes('/.netlify/functions/webrtc-ice-servers')],
 ['old unused LiveKit token and voice modules are not shipped',!existsSync(new URL('../netlify/functions/livekit-token.mjs',import.meta.url))&&!existsSync(new URL('../public/aam-livekit-voice.js',import.meta.url))&&!ui.includes('livekit-client')],
 ['avatar uses on-device face, pose and hand tracking with canvas video output',avatar.includes('FaceLandmarker')&&avatar.includes('PoseLandmarker')&&avatar.includes('HandLandmarker')&&avatar.includes('captureStream(24)')&&avatar.includes("session.replaceTrack('video',avatarTrack)")],
 ['voice effects support original, female, male, echo and robot modes over WebRTC',voice.includes("female:{pitch:4.5")&&voice.includes("male:{pitch:-3.5")&&voice.includes("echo:{")&&voice.includes("robot:{")&&voice.includes("session.replaceTrack('audio',outputTrack)")&&ui.includes('aam-webrtc-voice.js')],
 ['voice effect controls are wired into calls and microphone mute state',ui.includes('ensureCallVoiceControls()')&&ui.includes('setCallVoiceStyle')&&ui.includes('aamCallVoiceController?.setMuted(!track.enabled)')],
 ['opening a private chat creates a full-screen conversation view',ui.includes("document.body.classList.add('aam-chat-fullscreen-active')")&&css.includes('body.aam-chat-fullscreen-active .topbar')&&css.includes('.aam-social-chat-screen{position:fixed!important;inset:0!important')],
 ['full-screen chat uses safe-area spacing and internal message scrolling',css.includes('env(safe-area-inset-top)')&&css.includes('env(safe-area-inset-bottom)')&&css.includes('overscroll-behavior-y:contain')],
 ['chat inbox remains separate and supports adding a customer by profile ID',ui.includes('aam-chat-inbox-list')&&ui.includes('＋ Add by profile ID')&&ui.includes('lookupChatProfile')],
 ['chat keyboard is not forced open when a conversation is opened',/async function openChat\(id\)[\s\S]*?mount\(/.test(ui)&&!/async function openChat\(id\)[\s\S]*?messageField\.focus\(/.test(ui)],
 ['live typing indicators are sent and surfaced by the chat API',ui.includes("action:'typing'")&&chat.includes("b.action==='typing'")&&chat.includes('typing_at')],
 ['sent and read receipts use one neutral tick and two blue ticks',ui.includes("aria-label=\"Sent\">✓</small>")&&ui.includes("aria-label=\"Read\">✓✓</small>")&&css.includes('.aam-social-message .aam-message-status{color:#64748b!important')&&css.includes('.aam-social-message .aam-read{color:#2563eb!important')],
 ['message reactions are persisted through the chat API and Supabase migration',ui.includes('reactToMessage')&&chat.includes("b.action==='react'")&&reactions.includes('aam_chat_message_reactions')],
 ['long-press message menu uses two seconds and cancels after 12px movement',ui.includes('},2000)')&&ui.includes('Math.hypot(e.clientX-pressStart.x,e.clientY-pressStart.y)>12')],
 ['message actions allow copy, own-message delete and 15-minute own-message edit',ui.includes('Copy</button>')&&ui.includes("own?'<button type=\"button\" onclick=\"AAMSocial.deleteMessage")&&ui.includes('Date.now()-created<=15*60*1000')],
 ['voice notes support recording, preview, sending and waveform playback',ui.includes('new MediaRecorder')&&ui.includes('sendVoiceNote')&&ui.includes('aam-chat-voice-wave')&&ui.includes('toggleVoicePlayback')],
 ['NexOTP country markups match USA 1900, Canada 1500 and all others 1950 naira',nexotp.includes('return 190000')&&nexotp.includes('return 150000')&&nexotp.includes('return 195000')],
 ['UltraSMS has been fully removed from the project source',!/ultrasms/i.test(read('README.txt')+deployment+ui+index+nexotp)],
 ['Paystack checkout and verification reject test keys and require live keys',paystackCreate.includes("startsWith('sk_live_')")&&paystackVerify.includes("startsWith('sk_live_')")],
 ['existing Gmail sender configuration remains server-side',mail.includes('GMAIL_USER')&&mail.includes('GMAIL_APP_PASSWORD')&&mail.includes('nodemailer')],
 ['customer login remains username plus four-digit code with existing session RPC',index.includes('bt_customer_login')&&index.includes('exactly four digits')&&!index.includes('supabase.auth.signInWithPassword')],
 ['service worker caches the current WebRTC call, avatar and voice modules',sw.includes('/aam-webrtc-call.js')&&sw.includes('/aam-webrtc-avatar.js')&&sw.includes('/aam-webrtc-voice.js')],
 ['deployment guide documents WebRTC, TURNIX and the new chat migrations',deployment.includes('WEBRTC AUDIO AND VIDEO CALLING')&&deployment.includes('TURNIX_API_TOKEN')&&deployment.includes('20261125100000_chat_message_reactions.sql')]
];
let failed=0;
for(const [name,ok] of checks){console.log((ok?'PASS ':'FAIL ')+name);if(!ok)failed++;}
console.log(`\\n${checks.length-failed}/${checks.length} current-build checks passed.`);
if(failed)process.exitCode=1;
