import React, { useEffect, useRef, useState } from 'react';
import { PauseIcon, PlayIcon, MaximizeIcon, Volume2Icon, VolumeXIcon } from 'lucide-react';
import type { UploadedSyncSignal } from '../hooks/useUploadedWatchParty';
import type { PartyAction } from '../utils/uploadedWatchParty';

interface UploadedVideoPlayerProps {
  src: string | null;
  isHost: boolean;
  lastSync: UploadedSyncSignal | null;
  initialPosition: number;
  onControl: (action: PartyAction, currentTime: number) => void;
  /** floating call tiles etc., rendered on top of the video (inside fullscreen too) */
  overlay?: React.ReactNode;
  unavailableMessage?: string | null;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * <video>-based player for locally uploaded movies. Host interactions drive
 * the room's playback state; non-host members only ever reflect incoming
 * `lastSync` signals — their native controls are hidden to prevent
 * independent playback, matching the spec's host-controlled sync model.
 */
export function UploadedVideoPlayer({
  src,
  isHost,
  lastSync,
  initialPosition,
  onControl,
  unavailableMessage,
  overlay
}: UploadedVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const suppress = useRef(false);
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const appliedNonce = useRef(0);
  const appliedInitial = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  // Late-join / reconnect: seek to the room's live-extrapolated position once metadata is ready.
  useEffect(() => {
    appliedInitial.current = false;
  }, [src]);

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration || 0);
    if (!appliedInitial.current && initialPosition > 0) {
      suppress.current = true;
      video.currentTime = initialPosition;
      appliedInitial.current = true;
    }
  };

  // Apply incoming host sync signals.
  // The server broadcasts to the WHOLE room, so the host receives its own echo too. We only arm the
  // echo-suppression flag when applying the signal will really change the element (so it will fire
  // an event); otherwise the flag would stay stuck and swallow the host's next genuine action.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !lastSync || lastSync.nonce === appliedNonce.current) return;
    appliedNonce.current = lastSync.nonce;

    const needsSeek = Math.abs(video.currentTime - lastSync.currentTime) > 1;
    const needsStateChange = lastSync.isPlaying === video.paused;
    if (!needsSeek && !needsStateChange) return;

    if (!isHostRef.current) {
      // Members never emit, so no suppression is needed for them.
    } else {
      suppress.current = true;
      window.setTimeout(() => {
        suppress.current = false;
      }, 800);
    }
    if (needsSeek) video.currentTime = lastSync.currentTime;
    if (lastSync.isPlaying) {
      video.play().catch(() => {
        // Autoplay with sound can be blocked for a member who hasn't interacted yet — retry muted.
        video.muted = true;
        video.play().catch(() => undefined);
      });
    } else {
      video.pause();
    }
  }, [lastSync]);

  const emit = (action: PartyAction) => {
    if (suppress.current) {
      suppress.current = false;
      return;
    }
    if (!isHost) return;
    const video = videoRef.current;
    if (!video) return;
    onControl(action, video.currentTime);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video || !isHost) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  };

  const seekTo = (value: number) => {
    const video = videoRef.current;
    if (!video || !isHost) return;
    video.currentTime = value; // the element's 'seeked' event emits the seek
  };

  const toggleFullscreen = () => {
    // Fullscreen the whole player (video + floating call tiles + control bar) so the call tiles
    // stay visible and the host's controls are still reachable.
    const container = videoRef.current?.closest<HTMLElement>('[data-player-root]');
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (container?.requestFullscreen) container.requestFullscreen().catch(() => undefined);
  };

  if (!src) {
    return (
      <div className="relative grid aspect-video w-full place-items-center rounded-3xl border border-rose-400/15 bg-black px-6 text-center text-sm text-muted">
        {overlay}
        {unavailableMessage ||
        'This uploaded movie is not available on this device. The video file lives only in the browser that uploaded it.'}
      </div>);

  }

  return (
    <div data-player-root className="group relative flex flex-col overflow-hidden rounded-3xl border border-rose-400/15 bg-black shadow-cherry group-[:fullscreen]:h-screen group-[:fullscreen]:rounded-none">
      <div className="relative aspect-video w-full group-[:fullscreen]:aspect-auto group-[:fullscreen]:min-h-0 group-[:fullscreen]:flex-1">
        {overlay}
        <video
          ref={videoRef}
          src={src}
          className="h-full w-full object-contain"
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => {
            setIsPlaying(true);
            emit('play');
          }}
          onPause={() => {
            setIsPlaying(false);
            emit('pause');
          }}
          onSeeked={() => emit('seek')}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
          onVolumeChange={(event) => {
            setMuted(event.currentTarget.muted);
            setVolume(event.currentTarget.volume);
          }} />
        

        {!isHost &&
        <div className="pointer-events-none absolute inset-0 grid place-items-end p-4">
            <span className="rounded-full bg-black/60 px-3 py-1 text-[0.65rem] uppercase tracking-widest text-white/70">
              Host controls playback
            </span>
          </div>
        }
      </div>

      <div className="flex items-center gap-3 border-t border-white/[0.06] bg-ink-800/80 px-4 py-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!isHost}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cherry-700 text-white transition-transform duration-150 active:scale-95 disabled:opacity-40">
          
          {isPlaying ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
        </button>

        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-white/70">
          {formatTime(current)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.5}
          value={current}
          disabled={!isHost}
          onChange={(event) => seekTo(Number(event.target.value))}
          aria-label="Seek"
          className="h-1 flex-1 accent-rose-400 disabled:opacity-40" />
        
        <span className="w-12 shrink-0 text-xs tabular-nums text-white/50">
          {formatTime(duration)}
        </span>

        <button
          type="button"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            video.muted = !video.muted;
          }}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/70 transition-colors hover:text-rose-200">
          
          {muted || volume === 0 ? <VolumeXIcon className="h-4 w-4" /> : <Volume2Icon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label="Fullscreen"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/70 transition-colors hover:text-rose-200">
          
          <MaximizeIcon className="h-4 w-4" />
        </button>
      </div>
    </div>);

}
