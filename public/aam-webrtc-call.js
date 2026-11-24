const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

export async function createAamWebRtcCall({
  callId, callType = 'audio', supabase, localStream, localIdentity,
  sendSignal, listSignals, onRemoteStream = () => {}, onState = () => {},
  iceServers = DEFAULT_ICE_SERVERS, initiator = false
}) {
  if (!callId || !supabase || !localStream || typeof sendSignal !== 'function' || typeof listSignals !== 'function') {
    throw new Error('The WebRTC call is missing its signalling or media setup.');
  }
  if (!window.RTCPeerConnection) throw new Error('This browser does not support WebRTC calling.');

  const pc = new RTCPeerConnection({ iceServers });
  const remoteStream = new MediaStream();
  const seenSignals = new Set();
  let closed = false, channel = null, pollTimer = null, cursor = new Date(0).toISOString(), lastRealtimeWake = 0;
  let offerStarted = false, makingOffer = false, remoteDescriptionSet = false;
  const pendingCandidates = [];

  const send = async (type, payload) => {
    if (closed) return;
    await sendSignal(type, payload);
  };

  const addCandidate = async candidate => {
    if (!candidate || closed) return;
    if (!remoteDescriptionSet) { pendingCandidates.push(candidate); return; }
    try { await pc.addIceCandidate(candidate); }
    catch (error) { if (!closed) onState('ICE candidate skipped: ' + (error.message || 'network changed')); }
  };

  const flushCandidates = async () => {
    while (pendingCandidates.length && remoteDescriptionSet && !closed) {
      const candidate = pendingCandidates.shift();
      await addCandidate(candidate);
    }
  };

  const processSignal = async signal => {
    if (!signal || closed || (signal.id && seenSignals.has(signal.id))) return;
    if (signal.id) seenSignals.add(signal.id);
    if (signal.recipient_id && localIdentity && signal.recipient_id !== localIdentity) return;
    if (signal.sender_id && localIdentity && signal.sender_id === localIdentity) return;

    const type = signal.signal_type;
    const payload = signal.payload;
    if (type === 'hangup') { onState('The other caller ended the call.'); return; }
    if (type === 'offer' && payload?.sdp) {
      if (pc.signalingState !== 'stable') return;
      await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
      remoteDescriptionSet = true;
      await flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await send('answer', { sdp: pc.localDescription.sdp });
      onState('Connecting audio and video…');
    } else if (type === 'answer' && payload?.sdp && pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
      remoteDescriptionSet = true;
      await flushCandidates();
      onState('Connecting audio and video…');
    } else if (type === 'ice' && payload?.candidate) {
      await addCandidate(payload);
    }
  };

  const poll = async () => {
    if (closed) return;
    try {
      const result = await listSignals(cursor);
      for (const signal of result?.signals || []) {
        if (signal.created_at && signal.created_at > cursor) cursor = signal.created_at;
        await processSignal(signal);
      }
    } catch (error) {
      onState('Restoring call connection…');
    }
  };

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.ontrack = event => {
    const streams = event.streams?.length ? event.streams : [new MediaStream([event.track])];
    const incoming = streams[0];
    for (const track of incoming.getTracks()) {
      if (!remoteStream.getTracks().some(existing => existing.id === track.id)) remoteStream.addTrack(track);
    }
    onRemoteStream(remoteStream);
  };
  pc.onicecandidate = event => {
    if (event.candidate) void send('ice', event.candidate.toJSON ? event.candidate.toJSON() : event.candidate).catch(error => onState(error.message));
  };
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'connected') onState('Connected');
    else if (state === 'connecting') onState('Connecting…');
    else if (state === 'disconnected') onState('Connection interrupted. Trying to reconnect…');
    else if (state === 'failed') onState('The network could not establish a direct call. A TURN relay may be required.');
    else if (state === 'closed') onState('Call ended.');
  };
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') onState('Network path failed. Checking available routes…');
  };

  try {
    channel = supabase.channel('aam-call-' + callId, { config: { broadcast: { self: false } } });
    channel.on('broadcast', { event: 'signal' }, () => {
      // Public Realtime broadcasts are wake-up hints only. Actual SDP/ICE is
      // fetched through the authenticated Netlify endpoint for this participant.
      const now = Date.now();
      if (now - lastRealtimeWake < 500) return;
      lastRealtimeWake = now;
      void poll();
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Realtime signalling did not connect.')), 12000);
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timeout); reject(new Error('Realtime signalling is unavailable.'));
        }
      });
    });
  } catch (error) {
    onState('Realtime reconnecting; using secure signal recovery…');
  }

  // REST recovery is deliberately retained: Realtime is fast, but missed events
  // (for example when a phone changes networks) must not break call setup.
  pollTimer = setInterval(() => { void poll(); }, 900);
  await poll();

  if (initiator && !offerStarted) {
    offerStarted = true;
    makingOffer = true;
    try {
      const offer = await pc.createOffer();
      if (closed) throw new Error('Call ended before the offer was ready.');
      await pc.setLocalDescription(offer);
      await send('offer', { sdp: pc.localDescription.sdp });
      onState('Calling… waiting for the other person.');
    } finally { makingOffer = false; }
  }

  return {
    peerConnection: pc,
    remoteStream,
    get localStream() { return localStream; },
    async close({ notify = true } = {}) {
      if (closed) return;
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      if (notify) await sendSignal('hangup', null).catch(() => {});
      try { await channel?.unsubscribe(); } catch (_) {}
      pc.ontrack = null; pc.onicecandidate = null;
      pc.close();
      remoteStream.getTracks().forEach(track => track.stop());
    },
    async setMicrophoneEnabled(enabled) {
      localStream.getAudioTracks().forEach(track => { track.enabled = !!enabled; });
    },
    async setCameraEnabled(enabled) {
      localStream.getVideoTracks().forEach(track => { track.enabled = !!enabled; });
    },
    async replaceTrack(kind, track) {
      const sender = pc.getSenders().find(item => item.track?.kind === kind);
      if (sender) await sender.replaceTrack(track);
      else if (track) pc.addTrack(track, localStream);
    }
  };
}
