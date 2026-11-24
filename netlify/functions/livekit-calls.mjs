import { sendPush } from './_push.mjs';
const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function headers(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}
async function db(path, options = {}) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error('Supabase server configuration is missing.');
  const response = await fetch(`${base}/rest/v1/${path}`, { ...options, headers: headers(key, options.headers || {}) });
  const data = await response.json().catch(() => []);
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'Call request failed.');
    error.code = data.code || '';
    error.status = response.status;
    throw error;
  }
  return data;
}
async function broadcastCallSignal(callId, signal) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return false;
  try {
    const response = await fetch(`${base}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify({
        messages: [{
          topic: `aam-call-${callId}`,
          event: 'signal',
          payload: signal
        }]
      })
    });
    if (!response.ok) {
      console.warn('Call Realtime broadcast failed:', response.status, (await response.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (error) {
    console.warn('Call Realtime broadcast unavailable:', error.message);
    return false;
  }
}

async function currentCustomer(token) {
  if (!uuid.test(token)) return null;
  const rows = await db(`customer_sessions?select=customer_id&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
  return rows[0]?.customer_id || null;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  try {
    const body = JSON.parse(event.body || '{}');
    const customerId = await currentCustomer(String(body.token || ''));
    if (!customerId) return json(401, { error: 'Please log in again.' });
    const action = String(body.action || '');

    if (action === 'avatar_payment') {
      const callId = String(body.call_id || '');
      if (!uuid.test(callId)) return json(400, { error: 'A valid video call is required.' });
      const payment = await db('rpc/aam_social_charge_call_avatar', {
        method: 'POST',
        body: JSON.stringify({ p_token: String(body.token || ''), p_call_id: callId })
      });
      return json(200, payment || { paid: true });
    }

    if (action === 'list') {
      // Invitations expire after 45 seconds. Mark the call missed and close its
      // outstanding invitation so stale ringing calls cannot remain active forever.
      const cutoff = new Date(Date.now() - 45_000).toISOString();
      const [staleIncoming, staleOutgoing] = await Promise.all([
        db(`aam_call_participants?select=call_id,call:aam_calls!inner(id,created_at,status)&customer_id=eq.${encodeURIComponent(customerId)}&status=eq.invited&call.status=eq.active&call.created_at=lt.${encodeURIComponent(cutoff)}`),
        db(`aam_calls?select=id,participants:aam_call_participants!inner(status)&caller_id=eq.${encodeURIComponent(customerId)}&status=eq.active&created_at=lt.${encodeURIComponent(cutoff)}&participants.status=eq.invited`)
      ]);
      const staleIds = [...new Set([...staleIncoming.map(row => row.call_id), ...staleOutgoing.map(row => row.id)].filter(id => uuid.test(id)))];
      if (staleIds.length) {
        await db(`aam_calls?id=in.(${staleIds.join(',')})&status=eq.active`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'missed', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        });
        await db(`aam_call_participants?call_id=in.(${staleIds.join(',')})&status=in.(invited,accepted)`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'ended' })
        });
      }
      const participants = await db(`aam_call_participants?select=call_id,role,status,invited_at,call:aam_calls!inner(id,caller_id,call_type,status,created_at)&customer_id=eq.${encodeURIComponent(customerId)}&status=in.(invited,accepted)&call.status=eq.active&order=invited_at.desc&limit=20`);
      return json(200, { calls: participants });
    }

    const callId = String(body.call_id || '');

    if (action === 'create') {
      const targetId = String(body.target_customer_id || '');
      const callType = String(body.call_type || '');
      if (!uuid.test(targetId) || targetId === customerId) return json(400, { error: 'Choose a valid person to call.' });
      if (!['audio','video'].includes(callType)) return json(400, { error: 'Choose audio or video calling.' });

      const existingCall = await db(`aam_call_participants?select=call_id,customer_id,call:aam_calls!inner(status)&customer_id=in.(${encodeURIComponent(customerId)},${encodeURIComponent(targetId)})&status=in.(invited,accepted)&call.status=eq.active&limit=1`);
      if (existingCall.length) return json(409, { error: existingCall[0].customer_id === targetId ? 'This customer is already in another call.' : 'You already have an active call. End it before starting another.' });
      const profiles = await db(`aam_social_profiles?select=customer_id,adult_confirmed_at&customer_id=in.(${customerId},${targetId})`);
      if (profiles.length !== 2 || profiles.some(p => !p.adult_confirmed_at)) return json(403, { error: 'Both customers must have confirmed they are 18 or older.' });

      const mine = await db(`aam_chat_participants?select=conversation_id,conversation:aam_chat_conversations!inner(conversation_type)&customer_id=eq.${encodeURIComponent(customerId)}&conversation.conversation_type=eq.direct`);
      const conversationIds = mine.map(x => x.conversation_id);
      if (!conversationIds.length) return json(403, { error: 'Start a private chat with this person before calling.' });
      const shared = await db(`aam_chat_participants?select=conversation_id&customer_id=eq.${encodeURIComponent(targetId)}&conversation_id=in.(${conversationIds.join(',')})&limit=1`);
      if (!shared.length) return json(403, { error: 'You can only call someone you have a private chat with.' });

      const created = await db('aam_calls', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ caller_id: customerId, call_type: callType, status: 'active' })
      });
      const call = created[0];
      if (!call?.id) throw new Error('Could not create the call.');
      try {
        await db('aam_call_participants', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify([
            { call_id: call.id, customer_id: customerId, role: 'caller', status: 'accepted' },
            { call_id: call.id, customer_id: targetId, role: 'callee', status: 'invited' }
          ])
        });
      } catch (error) {
        await db(`aam_calls?id=eq.${encodeURIComponent(call.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'ended', ended_at: new Date().toISOString() }) }).catch(() => {});
        throw error;
      }
      // Alert the invited customer even when they are outside the private-chat screen.
      // Push delivery is best-effort: a missing/disabled push subscription must not cancel a valid call.
      const pushResult = await sendPush({
        role: 'customer',
        customerId: targetId,
        title: callType === 'video' ? 'Incoming video call' : 'Incoming voice call',
        body: 'Open All Ads Manager and enter your private chat to answer.',
        url: '/?incomingCall=' + encodeURIComponent(call.id),
        tag: 'aam-call-' + call.id,
        eventType: null
      }).catch(error => { console.warn('Incoming-call push could not be sent:', error.message); return { status: 'error' }; });
      return json(201, { call_id: call.id, call_type: callType, status: 'ringing', notification_status: pushResult.status || 'unknown' });
    }

    if (!uuid.test(callId)) return json(400, { error: 'A valid call ID is required.' });
    const mine = await db(`aam_call_participants?select=call_id,status,role&call_id=eq.${encodeURIComponent(callId)}&customer_id=eq.${encodeURIComponent(customerId)}&limit=1`);
    if (!mine.length) return json(403, { error: 'You are not part of this call.' });
    const participant = mine[0];

    if (action === 'accept') {
      if (participant.status !== 'invited') return json(409, { error: 'This call is no longer waiting for your answer.' });
      const activeCall = await db(`aam_calls?select=id,status,created_at&id=eq.${encodeURIComponent(callId)}&status=eq.active&limit=1`);
      if (!activeCall.length) return json(409, { error: 'This call has already ended.' });
      if (Date.now() - new Date(activeCall[0].created_at).getTime() > 45_000) {
        await db(`aam_calls?id=eq.${encodeURIComponent(callId)}&status=eq.active`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'missed', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        });
        await db(`aam_call_participants?call_id=eq.${encodeURIComponent(callId)}&status=in.(invited,accepted)`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'ended' })
        });
        return json(409, { error: 'This call expired. You can call again.' });
      }
      const accepted = await db(`aam_call_participants?call_id=eq.${encodeURIComponent(callId)}&customer_id=eq.${encodeURIComponent(customerId)}&status=eq.invited`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'accepted', joined_at: new Date().toISOString() })
      });
      if (!accepted.length) return json(409, { error: 'This invitation was already answered.' });
      return json(200, { status: 'accepted', call_id: callId });
    }
    if (action === 'signal_send') {
      const signalType = String(body.signal_type || '');
      const payload = body.payload;
      if (!['offer','answer','ice','hangup'].includes(signalType)) return json(400, { error: 'Unsupported call signal.' });
      if (participant.status !== 'accepted') return json(403, { error: 'Accept the call before sending media signals.' });
      const peers = await db(`aam_call_participants?select=customer_id,status&call_id=eq.${encodeURIComponent(callId)}&customer_id=neq.${encodeURIComponent(customerId)}&status=eq.accepted&limit=1`);
      const targetId = peers[0]?.customer_id || '';
      if (!uuid.test(targetId)) return json(409, { error: 'The other caller has not accepted this call yet.' });
      const encoded = JSON.stringify(payload ?? null);
      if (encoded.length > 24000) return json(413, { error: 'Call signal is too large.' });
      if (signalType === 'offer' || signalType === 'answer') {
        if (!payload || typeof payload !== 'object' || typeof payload.sdp !== 'string' || payload.sdp.length > 18000) return json(400, { error: 'Invalid session description.' });
      } else if (signalType === 'ice') {
        if (!payload || typeof payload !== 'object' || typeof payload.candidate !== 'string' || payload.candidate.length > 5000) return json(400, { error: 'Invalid ICE candidate.' });
      }
      const other = await db(`aam_call_participants?select=customer_id,status&call_id=eq.${encodeURIComponent(callId)}&customer_id=eq.${encodeURIComponent(targetId)}&status=eq.accepted&limit=1`);
      if (!other.length) return json(403, { error: 'The other caller has not accepted this call.' });
      const inserted = await db('aam_call_signals', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ call_id: callId, sender_id: customerId, recipient_id: targetId, signal_type: signalType, payload })
      });
      const signal = inserted[0];
      // Broadcast is the low-latency path. The existing authenticated signal_list
      // endpoint remains available as a fallback if Realtime is temporarily offline.
      const realtime_notified = signal ? await broadcastCallSignal(callId, {
        id: signal.id,
        sender_id: customerId,
        recipient_id: targetId,
        signal_type: signalType,
        payload,
        created_at: signal.created_at
      }) : false;
      return json(201, { sent: true, realtime_notified });
    }

    if (action === 'signal_list') {
      if (participant.status !== 'accepted') return json(403, { error: 'Accept the call before receiving media signals.' });
      const after = String(body.after || '1970-01-01T00:00:00.000Z');
      const afterDate = new Date(after);
      if (!Number.isFinite(afterDate.getTime())) return json(400, { error: 'Invalid signal cursor.' });
      const oldestAllowed = new Date(Date.now()-180000);
      const cursor = afterDate > oldestAllowed ? afterDate : oldestAllowed;
      const signals = await db(`aam_call_signals?select=id,sender_id,signal_type,payload,created_at&call_id=eq.${encodeURIComponent(callId)}&recipient_id=eq.${encodeURIComponent(customerId)}&created_at=gt.${encodeURIComponent(cursor.toISOString())}&order=created_at.asc&limit=100`);
      return json(200, { signals });
    }

    if (action === 'decline' || action === 'end') {
      await db(`aam_call_participants?call_id=eq.${encodeURIComponent(callId)}&customer_id=eq.${encodeURIComponent(customerId)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: action === 'decline' ? 'declined' : 'ended' })
      });
      // Close the other participant's active row too, otherwise accepted callers
      // can remain stuck as active after the call itself has ended.
      await db(`aam_call_participants?call_id=eq.${encodeURIComponent(callId)}&status=in.(invited,accepted)`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'ended' })
      });
      await db(`aam_calls?id=eq.${encodeURIComponent(callId)}&status=eq.active`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: action === 'decline' ? 'declined' : 'ended', ended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      });
      return json(200, { status: action === 'decline' ? 'declined' : 'ended', call_id: callId });
    }
    return json(400, { error: 'Unsupported call action.' });
  } catch (error) {
    // The unique active-call index is the final authority during simultaneous
    // calls/answers from multiple devices. Present its conflict as a normal
    // busy response rather than an unexplained server error.
    if (error.code === '23505') return json(409, { error: 'You or this customer is already in another call. End the current call before trying again.' });
    return json(500, { error: error.message || 'Call service failed.' });
  }
}
