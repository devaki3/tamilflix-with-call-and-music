import { useCallback, useEffect, useRef, useState } from 'react';
import type { CallParticipantStatus } from '../types/movie';
import { PARTY_URL } from '../utils/partyApi';

/** Bridge into the room's existing real-time transport — see utils/uploadedWatchParty.ts
 *  (PartyConnection.sendCallMessage / PartyCallbacks.onCallMessage). This hook never talks
 *  to a transport directly, so the call feature always rides the same one room channel. */
export interface CallBridge {
  send: (
  kind: 'call-join' | 'call-leave' | 'call-signal' | 'call-status' | 'call-roster-request',
  payload: unknown) =>
  void;
  subscribe: (
  handler: (kind: string, payload: unknown, senderId: string, senderName?: string) => void) =>
  () => void;
}

interface SignalPayload {
  targetId: string;
  from: string;
  signalType: 'offer' | 'answer' | 'ice';
  data: RTCSessionDescriptionInit | RTCIceCandidateInit;
}

interface StatusPayload {
  inCall: boolean;
  muted: boolean;
  cameraOff: boolean;
  hasVideo: boolean;
}

// Temporary tracing for the call lifecycle. Flip to false (or delete) once verified.
const CALL_DEBUG = true;
const dbg = (...args: unknown[]) => {
  if (CALL_DEBUG) console.log('[CALL DEBUG]', ...args);
};

const STUN_ONLY: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
];

/**
 * Calls between different networks (mobile data, campus/office Wi-Fi) need a TURN relay.
 * The party server hands out STUN+TURN servers at /api/party/ice-servers (configure METERED_* or
 * TURN_* env vars on the server). We fetch them right before joining a call.
 */
async function fetchIceServers(): Promise<{ iceServers: RTCIceServer[]; turn: boolean }> {
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${PARTY_URL}/api/party/ice-servers`, { signal: ctrl.signal });
    window.clearTimeout(timer);
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { iceServers?: RTCIceServer[]; turn?: boolean };
    if (Array.isArray(data.iceServers) && data.iceServers.length) {
      return { iceServers: data.iceServers, turn: Boolean(data.turn) };
    }
  } catch {
    /* fall through to STUN only */
  }
  return { iceServers: STUN_ONLY, turn: false };
}

export interface RemoteParticipant extends CallParticipantStatus {
  stream: MediaStream | null;
  connectionState: RTCPeerConnectionState | 'connecting';
}

interface UseRoomCallResult {
  inCall: boolean;
  connecting: boolean;
  localStream: MediaStream | null;
  participants: RemoteParticipant[];
  muted: boolean;
  cameraOff: boolean;
  error: string | null;
  /** true when the server has no TURN relay configured (calls across networks may not connect) */
  noTurn: boolean;
  joinCall: (withVideo: boolean) => Promise<void>;
  leaveCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => Promise<void>;
}

/**
 * Mesh WebRTC voice/video call scoped to one room. Signaling (offer/answer/ICE,
 * join/leave/status) rides the room's existing BroadcastChannel transport via
 * `bridge`, so only someone who has already joined that exact room (an
 * authenticated member — see UploadedWatchParty.tsx gating) can ever see or
 * answer a signal. No TURN server is configured (none was available to add),
 * so calls work directly or across NATs that allow it; a production
 * deployment behind a real signaling server would add one here.
 */
export function useRoomCall(
bridge: CallBridge | null,
userId: string | undefined,
username: string)
: UseRoomCallResult {
  const [inCall, setInCall] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Map<string, RemoteParticipant>>(new Map());

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const inCallRef = useRef(false);
  const mutedRef = useRef(false);
  const cameraOffRef = useRef(false);
  const hasVideoRef = useRef(false);
  const iceServersRef = useRef<RTCIceServer[]>(STUN_ONLY);
  const [noTurn, setNoTurn] = useState(false);
  /** ICE candidates that arrived before the peer's remote description was set. */
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const setParticipant = useCallback((id: string, patch: Partial<RemoteParticipant>) => {
    setParticipants((prev) => {
      const next = new Map(prev);
      const existing = next.get(id) ?? {
        userId: id,
        username: patch.username || 'Guest',
        muted: false,
        cameraOff: false,
        hasVideo: false,
        stream: null,
        connectionState: 'connecting' as const
      };
      next.set(id, { ...existing, ...patch });
      return next;
    });
  }, []);

  const removeParticipant = useCallback((id: string) => {
    setParticipants((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const closePeer = useCallback((id: string) => {
    const pc = peersRef.current.get(id);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      peersRef.current.delete(id);
      dbg('PEER CLOSED', id);
    }
    pendingIceRef.current.delete(id);
    removeParticipant(id);
  }, [removeParticipant]);

  const createPeer = useCallback(
    (peerId: string, peerName: string) => {
      dbg('PEER CREATE', peerId);
      const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
      peersRef.current.set(peerId, pc);
      setParticipant(peerId, { userId: peerId, username: peerName, connectionState: 'connecting' });

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current as MediaStream);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          dbg('ICE SENT', peerId);
          bridge?.send('call-signal', {
            targetId: peerId,
            from: userId as string,
            signalType: 'ice',
            data: event.candidate.toJSON()
          } satisfies SignalPayload);
        }
      };

      pc.ontrack = (event) => {
        dbg('ONTRACK', peerId, event.track.kind);
        // Prefer the sender's stream; fall back to building one from the raw track.
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        dbg('REMOTE STREAM', peerId, stream.getTracks().map((t) => t.kind));
        setParticipant(peerId, { stream });
      };

      pc.onconnectionstatechange = () => {
        dbg('STATE', peerId, pc.connectionState);
        setParticipant(peerId, { connectionState: pc.connectionState });
        if (pc.connectionState === 'failed' && userId && userId > peerId) {
          // Keep the participant visible (so the UI can say it failed) and retry with a fresh
          // ICE round. Only the deterministic offerer restarts, to avoid glare.
          void (async () => {
            try {
              const offer = await pc.createOffer({ iceRestart: true });
              await pc.setLocalDescription(offer);
              dbg('OFFER SENT (ice restart)', peerId);
              bridge?.send('call-signal', {
                targetId: peerId,
                from: userId as string,
                signalType: 'offer',
                data: offer
              } satisfies SignalPayload);
            } catch {
              /* peer gone */
            }
          })();
        }
      };

      return pc;
    },
    [bridge, userId, setParticipant, closePeer]
  );

  const startOfferTo = useCallback(
    async (peerId: string, peerName: string) => {
      const pc = createPeer(peerId, peerName);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        dbg('OFFER SENT', peerId);
        bridge?.send('call-signal', {
          targetId: peerId,
          from: userId as string,
          signalType: 'offer',
          data: offer
        } satisfies SignalPayload);
      } catch {
        setError('Could not start a call connection with a participant.');
      }
    },
    [createPeer, bridge, userId]
  );

  const broadcastStatus = useCallback(() => {
    bridge?.send('call-status', {
      inCall: inCallRef.current,
      muted: mutedRef.current,
      cameraOff: cameraOffRef.current,
      hasVideo: hasVideoRef.current
    } satisfies StatusPayload);
  }, [bridge]);

  const flushPendingIce = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const queued = pendingIceRef.current.get(peerId);
    pendingIceRef.current.delete(peerId);
    if (!queued) return;
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* candidate for a torn-down negotiation — safe to drop */
      }
    }
  }, []);

  const handleSignal = useCallback(
    async (signal: SignalPayload, peerName: string) => {
      const peerId = signal.from;
      let pc = peersRef.current.get(peerId);

      if (signal.signalType === 'offer') {
        dbg('OFFER RECEIVED', peerId);
        if (!inCallRef.current) return; // ignore calls while not in the call
        // Reuse an existing pc (renegotiation, e.g. camera added later); stale peers from a
        // previous session were already closed on call-join/call-leave.
        pc = pc ?? createPeer(peerId, peerName);
        try {
          await pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
          await flushPendingIce(peerId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          dbg('ANSWER SENT', peerId);
          bridge?.send('call-signal', {
            targetId: peerId,
            from: userId as string,
            signalType: 'answer',
            data: answer
          } satisfies SignalPayload);
        } catch (err) {
          dbg('OFFER HANDLING FAILED', peerId, err);
          setError('Could not answer an incoming call connection.');
        }
      } else if (signal.signalType === 'answer') {
        dbg('ANSWER RECEIVED', peerId);
        if (!pc) return;
        try {
          await pc.setRemoteDescription(signal.data as RTCSessionDescriptionInit);
          await flushPendingIce(peerId, pc);
        } catch {
          /* stale answer after renegotiation — ignore */
        }
      } else if (signal.signalType === 'ice') {
        dbg('ICE RECEIVED', peerId);
        const candidate = signal.data as RTCIceCandidateInit;
        // Candidates can outrun the offer/answer — queue them instead of dropping.
        if (!pc || !pc.remoteDescription) {
          const list = pendingIceRef.current.get(peerId) ?? [];
          list.push(candidate);
          pendingIceRef.current.set(peerId, list);
          return;
        }
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* stale candidate — safe to drop */
        }
      }
    },
    [bridge, userId, createPeer, flushPendingIce]
  );

  // Subscribe to the room's call signaling — always on, even before joining, so the
  // room can show "N in call" and late joiners learn who's already there.
  useEffect(() => {
    if (!bridge || !userId) return;

    const unsubscribe = bridge.subscribe((kind, payload, senderId, senderName) => {
      if (senderId === userId) return;
      switch (kind) {
        case 'call-roster-request': {
          dbg('ROSTER request from', senderId);
          if (inCallRef.current) broadcastStatus();
          break;
        }
        case 'call-status': {
          const status = payload as StatusPayload;
          if (!status.inCall) {
            closePeer(senderId);
            return;
          }
          setParticipant(senderId, {
            username: senderName || 'Guest',
            muted: status.muted,
            cameraOff: status.cameraOff,
            hasVideo: status.hasVideo
          });
          // Deterministic glare-free negotiation: the "greater" id always offers.
          if (inCallRef.current && userId > senderId && !peersRef.current.has(senderId)) {
            void startOfferTo(senderId, senderName || 'Guest');
          }
          break;
        }
        case 'call-join': {
          dbg('JOIN from', senderId);
          // A fresh join means any connection we still hold for this user is from a
          // previous session (refresh / leave+rejoin) — drop it so the new offer starts clean.
          closePeer(senderId);
          setParticipant(senderId, { username: senderName || 'Guest' });
          if (inCallRef.current) {
            broadcastStatus(); // let the newcomer know we're here too
            if (userId > senderId && !peersRef.current.has(senderId)) {
              void startOfferTo(senderId, senderName || 'Guest');
            }
          }
          break;
        }
        case 'call-leave': {
          dbg('LEAVE from', senderId);
          closePeer(senderId);
          break;
        }
        case 'call-signal': {
          const signal = payload as SignalPayload;
          if (signal.targetId !== userId) return;
          void handleSignal(signal, senderName || 'Guest');
          break;
        }
        default:
          break;
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, userId]);

  const joinCall = useCallback(
    async (withVideo: boolean) => {
      if (inCallRef.current) return;
      if (!bridge) {
        setError('Call is not available on this page right now.');
        return;
      }
      if (!userId) {
        setError('Please sign in to join the call.');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser does not support camera/microphone access here (try https, not http).');
        return;
      }
      setConnecting(true);
      setError(null);
      try {
        const ice = await fetchIceServers();
        iceServersRef.current = ice.iceServers;
        setNoTurn(!ice.turn);
        dbg('ICE SERVERS', ice.turn ? 'STUN+TURN' : 'STUN only (no TURN configured on server)');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: withVideo ? { width: { ideal: 640 }, height: { ideal: 360 } } : false
        });
        localStreamRef.current = stream;
        setLocalStream(stream);
        hasVideoRef.current = withVideo;
        mutedRef.current = false;
        cameraOffRef.current = !withVideo;
        setMuted(false);
        setCameraOff(!withVideo);
        inCallRef.current = true;
        setInCall(true);
        dbg('JOIN (self)', userId, { withVideo });
        bridge.send('call-join', { withVideo });
        bridge.send('call-roster-request', {});
        broadcastStatus();
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setError('Microphone/camera access was denied. Allow permissions to join the call.');
        } else if (name === 'NotFoundError') {
          setError('No microphone or camera was found on this device.');
        } else {
          setError('Could not start the call. Check your device permissions and try again.');
        }
      } finally {
        setConnecting(false);
      }
    },
    [bridge, userId, broadcastStatus]
  );

  const leaveCall = useCallback(() => {
    if (!inCallRef.current) return;
    inCallRef.current = false;
    setInCall(false);
    dbg('LEAVE (self)');
    bridge?.send('call-leave', {});
    peersRef.current.forEach((_pc, id) => closePeer(id));
    peersRef.current.clear();
    pendingIceRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setParticipants(new Map());
  }, [bridge, closePeer]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !mutedRef.current;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    mutedRef.current = next;
    setMuted(next);
    broadcastStatus();
  }, [broadcastStatus]);

  const toggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    if (!hasVideoRef.current) {
      // Joined audio-only — add a camera track now.
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const [track] = videoStream.getVideoTracks();
        if (!track) return;
        stream.addTrack(track);
        hasVideoRef.current = true;
        peersRef.current.forEach((pc, peerId) => {
          pc.addTrack(track, stream);
          // Adding a track needs a new offer, otherwise the remote side never sees it.
          void (async () => {
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              dbg('OFFER SENT (renegotiate)', peerId);
              bridge?.send('call-signal', {
                targetId: peerId,
                from: userId as string,
                signalType: 'offer',
                data: offer
              } satisfies SignalPayload);
            } catch {
              /* peer may have closed meanwhile */
            }
          })();
        });
        cameraOffRef.current = false;
        setCameraOff(false);
        setLocalStream(new MediaStream(stream.getTracks()));
        broadcastStatus();
      } catch {
        setError('Could not access the camera.');
      }
      return;
    }
    const next = !cameraOffRef.current;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !next;
    });
    cameraOffRef.current = next;
    setCameraOff(next);
    broadcastStatus();
  }, [broadcastStatus, bridge, userId]);

  // Leave the call cleanly if the component unmounts (navigating away / room ends).
  useEffect(() => {
    return () => {
      if (inCallRef.current) {
        bridge?.send('call-leave', {});
        peersRef.current.forEach((pc) => pc.close());
        peersRef.current.clear();
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    inCall,
    connecting,
    localStream,
    participants: Array.from(participants.values()),
    muted,
    cameraOff,
    error,
    joinCall,
    noTurn,
    leaveCall,
    toggleMute,
    toggleCamera
  };
}
