import React, { useEffect, useRef, useState } from 'react';
import { ListMusicIcon, PauseIcon, PlayIcon } from 'lucide-react';
import type { UploadedSyncSignal } from '../hooks/useUploadedWatchParty';
import type { PartyAction } from '../utils/uploadedWatchParty';

interface SharedMusicPlayerProps {
  src: string | null;
  songTitle: string | null;
  isHost: boolean;
  lastSync: UploadedSyncSignal | null;
  initialPosition: number;
  onControl: (action: PartyAction, currentTime: number) => void;
  onOpenLibrary: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Host-controlled synchronized audio player — independent of movie playback so both can run
 *  together (Feature: Local Songs). Mirrors UploadedVideoPlayer's sync pattern. */
export function SharedMusicPlayer({
  src,
  songTitle,
  isHost,
  lastSync,
  initialPosition,
  onControl,
  onOpenLibrary
}: SharedMusicPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const suppress = useRef(false);
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const [blocked, setBlocked] = useState(false);
  const appliedNonce = useRef(0);
  const appliedInitial = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    appliedInitial.current = false;
    appliedNonce.current = 0; // new song/element: re-apply the room's current state to it
    setBlocked(false);
  }, [src]);

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setDuration(audio.duration || 0);
    if (!appliedInitial.current && initialPosition > 0) {
      suppress.current = true;
      audio.currentTime = initialPosition;
      appliedInitial.current = true;
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !lastSync || lastSync.nonce === appliedNonce.current) return;
    appliedNonce.current = lastSync.nonce;

    // The server echoes the host's own action back to the host. Only arm echo-suppression when
    // applying the signal will really change the element (so an event will fire to clear it),
    // otherwise the flag sticks and swallows the host's next genuine play/pause.
    const needsSeek = Math.abs(audio.currentTime - lastSync.currentTime) > 1;
    const needsStateChange = lastSync.isPlaying === audio.paused;
    if (!needsSeek && !needsStateChange) return;
    if (isHostRef.current) {
      suppress.current = true;
      window.setTimeout(() => {
        suppress.current = false;
      }, 800);
    }
    if (needsSeek) audio.currentTime = lastSync.currentTime;
    if (lastSync.isPlaying) {
      // Browsers can block audio until the user taps — show a "Tap to listen" button instead of staying silent.
      audio.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
    } else {
      audio.pause();
    }
  }, [lastSync, src]);

  const emit = (action: PartyAction) => {
    if (suppress.current) {
      suppress.current = false;
      return;
    }
    if (!isHost) return;
    const audio = audioRef.current;
    if (!audio) return;
    onControl(action, audio.currentTime);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !isHost) return;
    if (audio.paused) audio.play().catch(() => undefined);
    else audio.pause();
  };

  const seekTo = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !isHost) return;
    audio.currentTime = value; // the element's 'seeked' event emits the seek
  };

  return (
    <section
      aria-label="Shared music"
      className="rounded-3xl border border-rose-400/10 bg-ink-800/70 p-5 backdrop-blur-xl">
      
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-xl tracking-wide text-white">
          <ListMusicIcon className="h-4 w-4 text-rose-300" />
          Music
        </h2>
        {isHost &&
        <button
          type="button"
          onClick={onOpenLibrary}
          className="rounded-full border border-rose-400/40 bg-rose-400/10 px-3 py-1.5 text-xs font-bold text-rose-100 transition-colors hover:bg-rose-400/20">
          
            Change song
          </button>
        }
      </div>

      {!src ?
      <p className="mt-3 text-xs text-muted">
          {isHost ?
        'No song playing. Pick one from your uploaded songs.' :
        'The host hasn\u2019t started a song yet.'}
        </p> :

      <>
          <p className="mt-3 truncate text-sm font-semibold text-white">{songTitle}</p>
          {blocked && !isHost &&
        <button
          type="button"
          onClick={() => audioRef.current?.play().then(() => setBlocked(false)).catch(() => undefined)}
          className="mt-2 rounded-full bg-cherry-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-400 hover:text-ink">
              Tap to listen
            </button>
        }
          <audio
          ref={audioRef}
          src={src}
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
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)} />
        

          <div className="mt-3 flex items-center gap-3">
            <button
            type="button"
            onClick={togglePlay}
            disabled={!isHost}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cherry-700 text-white transition-transform duration-150 active:scale-95 disabled:opacity-40">
            
              {isPlaying ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
            </button>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-white/70">
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
            aria-label="Seek song"
            className="h-1 flex-1 accent-rose-400 disabled:opacity-40" />
          
            <span className="w-10 shrink-0 text-xs tabular-nums text-white/50">
              {formatTime(duration)}
            </span>
          </div>
          {!isHost &&
        <p className="mt-2 text-[0.65rem] text-muted">The host controls the music too.</p>
        }
        </>
      }
    </section>);

}
