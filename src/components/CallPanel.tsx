import React, { useEffect, useRef, useState } from 'react';
import {
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  PhoneOffIcon,
  VideoIcon,
  VideoOffIcon } from
'lucide-react';
import type { RemoteParticipant } from '../hooks/useRoomCall';

interface CallPanelProps {
  inCall: boolean;
  connecting: boolean;
  localStream: MediaStream | null;
  participants: RemoteParticipant[];
  muted: boolean;
  cameraOff: boolean;
  error: string | null;
  noTurn?: boolean;
  /** when true the tiles are shown floating on the movie, so the panel only shows controls */
  floating?: boolean;
  onToggleFloating?: () => void;
  username: string;
  onJoin: (withVideo: boolean) => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
}

export function VideoTile({
  stream,
  label,
  isSelf,
  muted,
  cameraOff,
  connectionState
}: {stream: MediaStream | null;label: string;isSelf?: boolean;muted?: boolean;cameraOff?: boolean;connectionState?: string;}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [, force] = useState(0);

  // The <video> element is ALWAYS mounted (hidden when there is no picture) so remote audio keeps
  // playing with the camera off, and srcObject is never lost by an element re-mounting.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = Boolean(isSelf); // local preview muted (no echo); remote never muted
    if (el.srcObject !== stream) el.srcObject = stream;
    if (!stream) return;
    setNeedsTap(false);
    el.play().catch(() => setNeedsTap(true)); // autoplay blocked -> show tap-to-play
  }, [stream, isSelf]);

  // Re-render when tracks are added/removed on the same MediaStream (e.g. camera turned on later).
  useEffect(() => {
    if (!stream) return;
    const bump = () => force((n) => n + 1);
    stream.addEventListener('addtrack', bump);
    stream.addEventListener('removetrack', bump);
    return () => {
      stream.removeEventListener('addtrack', bump);
      stream.removeEventListener('removetrack', bump);
    };
  }, [stream]);

  const hasVideo = Boolean(stream && stream.getVideoTracks().length > 0) && !cameraOff;

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl border border-white/[0.08] bg-ink-900">
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`h-full w-full object-cover ${hasVideo ? '' : 'invisible absolute inset-0'}`} />
      
      {!hasVideo &&
      <div className="grid h-full w-full place-items-center bg-cherry-900/50">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-cherry-800 font-display text-lg uppercase text-rose-200">
            {label.charAt(0)}
          </span>
        </div>
      }
      {!isSelf && connectionState && connectionState !== 'connected' &&
      <div className="absolute inset-x-0 top-0 bg-black/70 px-2 py-1 text-center text-[0.65rem] font-semibold text-rose-100">
          {connectionState === 'failed' ?
        'Connection failed — retrying (network may block calls)' :
        connectionState === 'disconnected' ? 'Reconnecting…' : 'Connecting…'}
        </div>
      }
      {needsTap && !isSelf &&
      <button
        type="button"
        onClick={() => {
          ref.current?.play().then(() => setNeedsTap(false)).catch(() => undefined);
        }}
        className="absolute inset-0 grid place-items-center bg-black/60 text-xs font-semibold text-white">
        
          Tap to enable audio/video
        </button>
      }
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
        <span className="truncate text-xs font-semibold text-white/90">
          {label}
          {isSelf && ' (you)'}
        </span>
        {muted && <MicOffIcon className="h-3.5 w-3.5 shrink-0 text-rose-300" />}
      </div>
    </div>);

}

export function CallPanel({
  inCall,
  connecting,
  localStream,
  participants,
  muted,
  cameraOff,
  error,
  noTurn,
  floating,
  onToggleFloating,
  username,
  onJoin,
  onLeave,
  onToggleMute,
  onToggleCamera
}: CallPanelProps) {
  return (
    <section
      aria-label="Voice and video call"
      className="rounded-3xl border border-rose-400/10 bg-ink-800/70 p-5 backdrop-blur-xl">
      
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-xl tracking-wide text-white">
          <PhoneIcon className="h-4 w-4 text-rose-300" />
          Call
        </h2>
        {inCall &&
        <span className="text-xs text-muted">{participants.length + 1} in call</span>
        }
      </div>

      {error &&
      <p className="mt-3 rounded-xl border border-rose-400/20 bg-cherry-900/40 px-3 py-2 text-xs text-rose-100">
          {error}
        </p>
      }

      {inCall && noTurn && participants.some((p) => p.connectionState !== 'connected') &&
      <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-900/30 px-3 py-2 text-xs text-amber-100">
          Stuck on “Connecting…”? This server has no TURN relay set up, so calls between different
          networks can't connect. The site owner needs to add TURN (METERED_APP_NAME + METERED_API_KEY) on the server.
        </p>
      }

      {!inCall ?
      <div className="mt-4 flex flex-wrap gap-2">
          <button
          type="button"
          onClick={() => onJoin(false)}
          disabled={connecting}
          className="inline-flex items-center gap-2 rounded-full bg-cherry-700 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-rose-400 hover:text-ink disabled:opacity-50">
          
            <MicIcon className="h-3.5 w-3.5" />
            {connecting ? 'Connecting…' : 'Join voice'}
          </button>
          <button
          type="button"
          onClick={() => onJoin(true)}
          disabled={connecting}
          className="inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-400/10 px-4 py-2.5 text-xs font-bold text-rose-100 transition-colors hover:bg-rose-400/20 disabled:opacity-50">
          
            <VideoIcon className="h-3.5 w-3.5" />
            Join with video
          </button>
        </div> :

      <>
          {floating ?
        <p className="mt-4 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-white/70">
              Video tiles are floating on the movie screen — drag them anywhere, tap S/M/L to resize.
            </p> :
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <VideoTile stream={localStream} label={username} isSelf muted={muted} cameraOff={cameraOff} />
            {participants.map((p) =>
          <VideoTile
            key={p.userId}
            stream={p.stream}
            label={p.username}
            muted={p.muted}
            cameraOff={p.cameraOff}
            connectionState={p.connectionState} />

          )}
          </div>
        }
          {onToggleFloating &&
        <button
          type="button"
          onClick={onToggleFloating}
          className="mt-3 w-full rounded-full border border-white/10 py-2 text-xs font-semibold text-white/80 hover:bg-white/10">
              {floating ? 'Move videos into this panel' : 'Show videos on movie screen'}
            </button>
        }

          <div className="mt-4 flex items-center justify-center gap-3">
            <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            className={`grid h-10 w-10 place-items-center rounded-full transition-colors ${
            muted ? 'bg-rose-500 text-white' : 'bg-white/10 text-white/80 hover:bg-white/20'}`
            }>
            
              {muted ? <MicOffIcon className="h-4 w-4" /> : <MicIcon className="h-4 w-4" />}
            </button>
            <button
            type="button"
            onClick={onToggleCamera}
            aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
            className={`grid h-10 w-10 place-items-center rounded-full transition-colors ${
            cameraOff ? 'bg-white/10 text-white/50' : 'bg-white/10 text-white/80 hover:bg-white/20'}`
            }>
            
              {cameraOff ? <VideoOffIcon className="h-4 w-4" /> : <VideoIcon className="h-4 w-4" />}
            </button>
            <button
            type="button"
            onClick={onLeave}
            aria-label="Leave call"
            className="grid h-10 w-10 place-items-center rounded-full bg-rose-600 text-white transition-colors hover:bg-rose-500">
            
              <PhoneOffIcon className="h-4 w-4" />
            </button>
          </div>
        </>
      }
    </section>);

}
