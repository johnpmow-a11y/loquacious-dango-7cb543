const THREE_URL='https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
const VISION_URL='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs';
const WASM_URL='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const FACE_MODEL='https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const POSE_MODEL='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const HAND_MODEL='https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,t=.25)=>a+(b-a)*t;
async function landmarker(klass,vision,path,extra={}) {
  try{return await klass.createFromOptions(vision,{baseOptions:{modelAssetPath:path,delegate:'GPU'},runningMode:'VIDEO',...extra});}
  catch(_){return klass.createFromOptions(vision,{baseOptions:{modelAssetPath:path,delegate:'CPU'},runningMode:'VIDEO',...extra});}
}
function capsule(THREE,r,len,material){return new THREE.Mesh(new THREE.CapsuleGeometry(r,len,4,8),material);}
export async function createAamWebRtcAvatar({photoFile,cameraTrack,localStream,session,mediaElement,onStatus=()=>{},bodyStyle='sarah'}){
  if(!photoFile||!photoFile.type?.startsWith('image/'))throw new Error('Choose a JPG, PNG or WebP picture for your avatar.');
  if(photoFile.size>12*1024*1024)throw new Error('Choose a picture smaller than 12 MB.');
  if(!cameraTrack||cameraTrack.readyState!=='live')throw new Error('Turn on your camera before creating your moving avatar.');
  if(!HTMLCanvasElement.prototype.captureStream)throw new Error('This browser cannot send an animated avatar video.');
  const THREE=await import(THREE_URL);
  const vision=await import(VISION_URL);
  const files=await vision.FilesetResolver.forVisionTasks(WASM_URL);
  onStatus('Preparing face, body and hand tracking…');
  const video=document.createElement('video');
  video.autoplay=true;video.muted=true;video.playsInline=true;video.srcObject=new MediaStream([cameraTrack]);
  video.style.cssText='position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:-10px;top:-10px';
  document.body.appendChild(video);
  try {
    await video.play();
    if(video.readyState<2)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Camera did not become ready for avatar tracking.')),8000);video.addEventListener('loadeddata',()=>{clearTimeout(timer);resolve();},{once:true});});
  } catch(error) {
    video.pause();video.srcObject=null;video.remove();
    throw error;
  }
  const trackers=await Promise.allSettled([
    landmarker(vision.FaceLandmarker,files,FACE_MODEL,{numFaces:1,outputFaceBlendshapes:true,outputFacialTransformationMatrixes:true}),
    landmarker(vision.PoseLandmarker,files,POSE_MODEL,{numPoses:1}),
    landmarker(vision.HandLandmarker,files,HAND_MODEL,{numHands:2})
  ]);
  // Face tracking is essential; pose and hand tracking are optional so a
  // phone that cannot initialise every model can still run the photo avatar.
  if(trackers[0].status==='rejected'){
    trackers.filter(item=>item.status==='fulfilled').forEach(item=>item.value.close());
    video.pause();video.srcObject=null;video.remove();
    throw trackers[0].reason;
  }
  const face=trackers[0].value;
  const pose=trackers[1].status==='fulfilled'?trackers[1].value:null;
  const hands=trackers[2].status==='fulfilled'?trackers[2].value:null;
  if(!pose||!hands)onStatus('Face tracking is ready. Some body or hand movements may be limited on this device.');
  const canvas=document.createElement('canvas');canvas.width=480;canvas.height=640;
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
  renderer.setPixelRatio(1);renderer.setSize(480,640,false);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#eaf0f8');
  const camera=new THREE.PerspectiveCamera(32,0.75,.1,30);camera.position.set(0,1.45,5.4);camera.lookAt(0,1.35,0);
  scene.add(new THREE.HemisphereLight(0xffffff,0x71809a,2));
  const key=new THREE.DirectionalLight(0xffffff,2.2);key.position.set(-2,4,5);scene.add(key);
  const fill=new THREE.DirectionalLight(0xc5ddff,1.1);fill.position.set(3,2,-2);scene.add(fill);
  const mat=(color,roughness=.8)=>new THREE.MeshStandardMaterial({color,roughness});
  const skin=mat(bodyStyle==='walter'?'#bd896f':'#d6a184'), shirt=mat(bodyStyle==='walter'?'#254b73':'#6748a5'), pants=mat('#26364b'), dark=mat('#30241f'), white=mat('#ffffff'), black=mat('#171717');
  const root=new THREE.Group();scene.add(root);
  const torso=new THREE.Group();torso.position.y=1.25;root.add(torso);
  const chest=new THREE.Mesh(new THREE.CapsuleGeometry(.34,.48,5,12),shirt);chest.scale.set(1,1,.58);torso.add(chest);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.09,.11,.18,12),skin);neck.position.y=.48;torso.add(neck);
  const head=new THREE.Group();head.position.set(0,.83,0);torso.add(head);
  const skull=new THREE.Mesh(new THREE.SphereGeometry(.31,24,20),skin);skull.scale.set(.83,1.08,.78);head.add(skull);
  const photoUrl=URL.createObjectURL(photoFile);
  let photoImage;
  try {
    photoImage=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Could not read the selected avatar picture.'));image.src=photoUrl;});
  } catch(error) {
    face.close();pose?.close();hands?.close();video.pause();video.srcObject=null;video.remove();URL.revokeObjectURL(photoUrl);
    throw error;
  }
  const faceCanvas=document.createElement('canvas');faceCanvas.width=512;faceCanvas.height=584;const faceCtx=faceCanvas.getContext('2d');
  if(!faceCtx){face.close();pose?.close();hands?.close();video.pause();video.srcObject=null;video.remove();URL.revokeObjectURL(photoUrl);throw new Error('Photo avatar rendering is not supported on this device.');}const targetAspect=faceCanvas.width/faceCanvas.height;let sx=0,sy=0,sw=photoImage.naturalWidth,sh=photoImage.naturalHeight;if(sw/sh>targetAspect){sw=sh*targetAspect;sx=(photoImage.naturalWidth-sw)/2;}else{sh=sw/targetAspect;sy=Math.max(0,(photoImage.naturalHeight-sh)*.18);}faceCtx.drawImage(photoImage,sx,sy,sw,sh,0,0,faceCanvas.width,faceCanvas.height);const texture=new THREE.CanvasTexture(faceCanvas);texture.colorSpace=THREE.SRGBColorSpace;
  const facePlate=new THREE.Mesh(new THREE.PlaneGeometry(.42,.48),new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide}));
  facePlate.position.set(0,.015,.245);head.add(facePlate);
  const mouth=new THREE.Mesh(new THREE.CircleGeometry(.045,20),black);mouth.position.set(0,-.145,.254);mouth.scale.y=.35;head.add(mouth);
  const eyeL=new THREE.Mesh(new THREE.SphereGeometry(.018,10,8),white),eyeR=eyeL.clone();eyeL.position.set(-.095,.09,.26);eyeR.position.set(.095,.09,.26);head.add(eyeL,eyeR);
  const armMat=skin,arms=[];
  for(const side of [-1,1]){
    const shoulder=new THREE.Group();shoulder.position.set(side*.37,.35,0);torso.add(shoulder);
    const upper=capsule(THREE,.105,.37,shirt);upper.position.y=-.22;shoulder.add(upper);
    const elbow=new THREE.Group();elbow.position.y=-.43;shoulder.add(elbow);
    const fore=capsule(THREE,.075,.35,armMat);fore.position.y=-.2;elbow.add(fore);
    const palm=new THREE.Mesh(new THREE.SphereGeometry(.09,12,10),skin);palm.scale.set(.85,1.15,.42);palm.position.y=-.42;elbow.add(palm);
    const fingers=[];
    for(let f=0;f<4;f++){const pivot=new THREE.Group();pivot.position.set((f-1.5)*.037,-.48,.005);elbow.add(pivot);const seg=capsule(THREE,.018,.065,skin);seg.position.y=-.045;pivot.add(seg);const tip=new THREE.Group();tip.position.y=-.09;pivot.add(tip);const seg2=capsule(THREE,.015,.05,skin);seg2.position.y=-.03;tip.add(seg2);fingers.push({pivot,tip});}
    arms.push({shoulder,elbow,fingers,side});
  }
  for(const side of [-1,1]){const leg=new THREE.Group();leg.position.set(side*.17,.95,0);root.add(leg);const thigh=capsule(THREE,.13,.43,pants);thigh.position.y=-.26;leg.add(thigh);const shin=capsule(THREE,.105,.43,pants);shin.position.y=-.75;leg.add(shin);const shoe=new THREE.Mesh(new THREE.BoxGeometry(.18,.09,.32),dark);shoe.position.set(0,-1.02,.08);leg.add(shoe);}
  const capture=canvas.captureStream(24),avatarTrack=capture.getVideoTracks()[0];
  if(!avatarTrack)throw new Error('Could not create the animated avatar video.');
  let stopped=false,raf=0,lastDetect=0,lastVideoTime=-1,lastFace=null,lastPose=null,lastHands=null,headTarget={x:0,y:0,z:0},mouthTarget=0;
  let audioContext=null,analyser=null,audioData=null;
  try{const mic=localStream?.getAudioTracks?.()[0];if(mic){audioContext=new (window.AudioContext||window.webkitAudioContext)();const source=audioContext.createMediaStreamSource(new MediaStream([mic]));analyser=audioContext.createAnalyser();analyser.fftSize=256;source.connect(analyser);audioData=new Uint8Array(analyser.frequencyBinCount);}}catch(_){}
  const poseAngle=(a,b)=>Math.atan2(b.x-a.x,a.y-b.y);
  const draw=now=>{
    if(stopped)return;
    if(video.readyState>=2&&now-lastDetect>70&&video.currentTime!==lastVideoTime){
      lastDetect=now;lastVideoTime=video.currentTime;
      // Run each tracker independently: an unavailable optional pose or hand
      // model must never interrupt face tracking or the other tracker.
      try{lastFace=face.detectForVideo(video,now);}catch(_){}
      if(pose){try{lastPose=pose.detectForVideo(video,now);}catch(_){}}
      if(hands){try{lastHands=hands.detectForVideo(video,now);}catch(_){}}
      const matrix=lastFace?.facialTransformationMatrixes?.[0]?.data;
      if(matrix?.length===16){const m=new THREE.Matrix4().fromArray(Array.from(matrix)),q=new THREE.Quaternion();m.decompose(new THREE.Vector3(),q,new THREE.Vector3());const e=new THREE.Euler().setFromQuaternion(q,'YXZ');headTarget={x:clamp(e.x,-.4,.4),y:clamp(e.y,-.55,.55),z:clamp(e.z,-.4,.4)};}
      const cats=lastFace?.faceBlendshapes?.[0]?.categories||[];
      mouthTarget=Math.max(0,...cats.filter(c=>['jawOpen','mouthOpen'].includes(c.categoryName)).map(c=>c.score||0));
    }
    const p=lastPose?.landmarks?.[0];
    if(p?.length>16){
      arms.forEach((arm,index)=>{const shoulder=p[index===0?12:11],elbow=p[index===0?14:13],wrist=p[index===0?16:15];if(shoulder&&elbow&&wrist){const a=poseAngle(shoulder,elbow),b=poseAngle(elbow,wrist);arm.shoulder.rotation.z=smooth(arm.shoulder.rotation.z,clamp(a*1.05,-2.3,2.3),.32);arm.elbow.rotation.z=smooth(arm.elbow.rotation.z,clamp((b-a)*.9,-2.2,2.2),.32);}});
      const tilt=Math.atan2((p[12]?.y||0)-(p[11]?.y||0),(p[12]?.x||1)-(p[11]?.x||0));
      torso.rotation.z=smooth(torso.rotation.z,clamp(tilt,-.28,.28),.18);
      root.position.x=smooth(root.position.x,clamp((((p[23]?.x||.5)+(p[24]?.x||.5))/2-.5)*.5,-.18,.18),.16);
    }
    if(lastHands?.landmarks?.length){lastHands.landmarks.forEach((points,i)=>{const arm=arms[i===0?0:1];if(!arm)return;[0,1,2,3].forEach(f=>{const a=points[[5,9,13,17][f]],b=points[[6,10,14,18][f]],c=points[[8,12,16,20][f]];if(a&&b&&c){const bend=clamp(Math.hypot(c.x-a.x,c.y-a.y)/Math.max(.001,Math.hypot(b.x-a.x,b.y-a.y)),.65,2.1);arm.fingers[f].pivot.rotation.z=smooth(arm.fingers[f].pivot.rotation.z,(1.6-bend)*.65,.25);}});});}
    if(analyser&&audioData){analyser.getByteTimeDomainData(audioData);let sum=0;for(const v of audioData){const n=(v-128)/128;sum+=n*n;}mouthTarget=Math.max(mouthTarget,clamp(Math.sqrt(sum/audioData.length)*5,0,.8));}
    head.rotation.x=smooth(head.rotation.x,headTarget.x,.24);head.rotation.y=smooth(head.rotation.y,headTarget.y,.24);head.rotation.z=smooth(head.rotation.z,headTarget.z,.24);
    mouth.scale.y=smooth(mouth.scale.y,.25+mouthTarget*2.4,.3);
    renderer.render(scene,camera);raf=requestAnimationFrame(draw);
  };
  try{await session.replaceTrack('video',avatarTrack);if(audioContext?.state==='suspended')await audioContext.resume();raf=requestAnimationFrame(draw);}
  catch(error){
    stopped=true;
    // If video replacement succeeded but a later setup step failed, restore the
    // original camera before stopping the generated avatar track.
    if(cameraTrack.readyState==='live')await session.replaceTrack('video',cameraTrack).catch(()=>{});
    video.pause();video.srcObject=null;video.remove();
    avatarTrack.stop();capture.getTracks().forEach(t=>t.stop());
    renderer.dispose();texture.dispose();URL.revokeObjectURL(photoUrl);
    face.close();pose?.close();hands?.close();
    if(audioContext)await audioContext.close().catch(()=>{});
    throw error;
  }
  if(mediaElement){const preview=document.createElement('video');preview.autoplay=true;preview.muted=true;preview.playsInline=true;preview.dataset.local='true';preview.dataset.avatar='true';preview.className='aam-social-local-preview';preview.srcObject=new MediaStream([avatarTrack]);mediaElement.querySelectorAll('video[data-local="true"]').forEach(el=>el.remove());mediaElement.prepend(preview);await preview.play().catch(()=>{});}
  onStatus('Your moving avatar is live. Face, head, arm and hand tracking are active where supported.');
  return {
    async stop({restoreCamera=true}={}){
      if(stopped)return;stopped=true;cancelAnimationFrame(raf);
      if(restoreCamera&&cameraTrack.readyState==='live')await session.replaceTrack('video',cameraTrack).catch(()=>{});
      const preview=mediaElement?.querySelector('video[data-avatar="true"]');if(preview){preview.pause();preview.srcObject=null;preview.remove();}
      avatarTrack.stop();capture.getTracks().forEach(t=>t.stop());video.pause();video.srcObject=null;video.remove();
      face.close();pose?.close();hands?.close();renderer.dispose();texture.dispose();URL.revokeObjectURL(photoUrl);
      if(audioContext&&audioContext.state!=='closed')await audioContext.close().catch(()=>{});
    },
    async setBodyStyle(style){shirt.color.set(style==='walter'?'#254b73':'#6748a5');skin.color.set(style==='walter'?'#bd896f':'#d6a184');}
  };
}
