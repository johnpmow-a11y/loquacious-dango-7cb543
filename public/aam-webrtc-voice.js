const SOUND_TOUCH_MODULE='https://esm.sh/@soundtouchjs/audio-worklet@2.1.1?bundle';
const SOUND_TOUCH_PROCESSOR='https://cdn.jsdelivr.net/npm/@soundtouchjs/audio-worklet@2.1.1/.dist/soundtouch-processor.js';
const MODES={
 natural:{pitch:0,low:0,presence:0,high:0,echo:0,robot:0},
 female:{pitch:4.5,low:-4.5,presence:2.2,high:2.5,echo:0,robot:0},
 male:{pitch:-3.5,low:3.5,presence:-1.2,high:-1.5,echo:0,robot:0},
 echo:{pitch:0,low:0,presence:0,high:0,echo:.28,robot:0},
 robot:{pitch:-1,low:0,presence:0,high:0,echo:0,robot:.42}
};

export async function createAamWebRtcVoiceChanger({session,localStream,mode='natural'}={}){
 if(!session||!localStream)throw new Error('An active call is required for voice effects.');
 const originalTrack=localStream.getAudioTracks?.()[0];
 if(!originalTrack||originalTrack.readyState!=='live')throw new Error('Your call microphone is not ready.');
 const originalEnabled=originalTrack.enabled;
 const AudioContextClass=window.AudioContext||window.webkitAudioContext;
 if(!AudioContextClass)throw new Error('Voice effects are not supported by this browser.');
 const context=new AudioContextClass();
 let source,shifter,destination,outputTrack,echoDelay,echoFeedback,echoWet,voiceLow,voicePresence,voiceHigh,robotGain,robotOscillator,robotDepth;
 let stopped=false,replaced=false,muted=!originalEnabled;
 const cleanup=async()=>{
  try{robotOscillator?.stop();}catch(_){}
  source?.disconnect();shifter?.disconnect();voiceLow?.disconnect();voicePresence?.disconnect();voiceHigh?.disconnect();
  echoDelay?.disconnect();echoFeedback?.disconnect();echoWet?.disconnect();robotGain?.disconnect();robotDepth?.disconnect();
  outputTrack?.stop();destination?.stream?.getTracks?.().forEach(track=>track.stop());
  if(context.state!=='closed')await context.close().catch(()=>{});
 };
 try{
  await context.resume();
  const {SoundTouchNode}=await import(SOUND_TOUCH_MODULE);
  await SoundTouchNode.register(context,SOUND_TOUCH_PROCESSOR);
  source=context.createMediaStreamSource(new MediaStream([originalTrack]));
  shifter=new SoundTouchNode({context});
  destination=context.createMediaStreamDestination();
  echoDelay=context.createDelay(.65);echoFeedback=context.createGain();echoWet=context.createGain();
  voiceLow=context.createBiquadFilter();voiceLow.type='lowshelf';voiceLow.frequency.value=180;
  voicePresence=context.createBiquadFilter();voicePresence.type='peaking';voicePresence.frequency.value=2800;voicePresence.Q.value=.8;
  voiceHigh=context.createBiquadFilter();voiceHigh.type='highshelf';voiceHigh.frequency.value=5200;
  robotGain=context.createGain();robotOscillator=context.createOscillator();robotDepth=context.createGain();
  echoDelay.delayTime.value=.22;echoFeedback.gain.value=.24;echoWet.gain.value=0;robotGain.gain.value=1;
  robotOscillator.type='sine';robotOscillator.frequency.value=34;robotDepth.gain.value=0;
  robotOscillator.connect(robotDepth);robotDepth.connect(robotGain.gain);robotOscillator.start();
  source.connect(shifter);shifter.connect(voiceLow);voiceLow.connect(voicePresence);voicePresence.connect(voiceHigh);voiceHigh.connect(robotGain);robotGain.connect(destination);
  shifter.connect(echoDelay);echoDelay.connect(echoFeedback);echoFeedback.connect(echoDelay);echoDelay.connect(echoWet);echoWet.connect(destination);
  outputTrack=destination.stream.getAudioTracks()[0];
  if(!outputTrack)throw new Error('Could not create the processed microphone track.');
  outputTrack.enabled=!muted;
  await session.replaceTrack('audio',outputTrack);replaced=true;
  const controller={
   setMode(nextMode){
    if(stopped)throw new Error('Voice effects have already stopped.');
    const config=MODES[nextMode]||MODES.natural,now=context.currentTime;
    shifter.pitchSemitones.setTargetAtTime(config.pitch,now,.06);
    voiceLow.gain.setTargetAtTime(config.low||0,now,.08);
    voicePresence.gain.setTargetAtTime(config.presence||0,now,.08);
    voiceHigh.gain.setTargetAtTime(config.high||0,now,.08);
    echoWet.gain.setTargetAtTime(config.echo||0,now,.06);
    robotDepth.gain.setTargetAtTime(config.robot||0,now,.06);
   },
   get isMuted(){return muted;},
   setMuted(nextMuted){if(stopped)return;muted=!!nextMuted;originalTrack.enabled=!muted;outputTrack.enabled=!muted;},
   async stop({restoreMic=true}={}){
    if(stopped)return;stopped=true;
    if(replaced&&restoreMic&&originalTrack.readyState==='live'){
     originalTrack.enabled=!muted;
     await session.replaceTrack('audio',originalTrack).catch(()=>{});
    }else if(replaced&&!restoreMic){originalTrack.enabled=originalEnabled;}
    await cleanup();replaced=false;
   }
  };
  controller.setMode(mode);
  return controller;
 }catch(error){
  if(replaced&&originalTrack.readyState==='live'){
   originalTrack.enabled=originalEnabled;
   await session.replaceTrack('audio',originalTrack).catch(()=>{});
  }
  await cleanup();
  throw error;
 }
}
