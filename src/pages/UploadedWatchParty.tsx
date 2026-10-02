import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckIcon, CopyIcon, CrownIcon, LogOutIcon } from 'lucide-react';
import { UploadedVideoPlayer } from '../components/UploadedVideoPlayer';
import { RoomMembersPanel } from '../components/RoomMembersPanel';
import { RoomChat } from '../components/RoomChat';
import { SharedMusicPlayer } from '../components/SharedMusicPlayer';
import { SongPickerModal } from '../components/SongPickerModal';
import { CallPanel } from '../components/CallPanel';
import { FloatingCallOverlay } from '../components/FloatingCallOverlay';
import { useUploadedWatchParty } from '../hooks/useUploadedWatchParty';
import { useRoomCall } from '../hooks/useRoomCall';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getUploadedMovie } from '../utils/uploadedMovies';
import { getUploadedSongBlob } from '../utils/uploadedSongs';
import { assetStreamUrl, uploadAsset } from '../utils/partyApi';
import type { UploadedMovie, UploadedSong } from '../types/movie';

const EASE = [0.23, 1, 0.32, 1] as const;

export function UploadedWatchParty() {
  const { code } = useParams<{code: string;}>();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [copied, setCopied] = useState(false);
  const [movie, setMovie] = useState<UploadedMovie | null>(null);
  const [songUploading, setSongUploading] = useState(false);
  const [songPickerOpen, setSongPickerOpen] = useState(false);

  const party = useUploadedWatchParty(code, user ? String(user.id) : undefined, user?.name || 'Guest');
  const call = useRoomCall(party.callBridge, user ? String(user.id) : undefined, user?.name || 'Guest');
  const [floatingCall, setFloatingCall] = useState(true);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  // The movie itself streams from the Party Service (works on any device — see assetId
  // below). This local lookup is only used for extra display metadata when it happens
  // to be available on this device (e.g. the host's own browser).
  useEffect(() => {
    const movieId = party.room?.movieId;
    if (!movieId) {
      setMovie(null);
      return;
    }
    setMovie(getUploadedMovie(movieId));
  }, [party.room?.movieId]);

  // Video/audio now stream directly from the server by asset id, so playback works
  // identically for the host and for anyone who joined from a different browser/device.
  const videoSrc = party.room?.assetId ? assetStreamUrl(party.room.assetId) : null;
  const songSrc = party.room?.music.songId ? assetStreamUrl(party.room.music.songId) : null;
  const songTitle = party.room?.music.songTitle ?? null;

  const handlePickSong = async (picked: UploadedSong) => {
    if (songUploading) return;
    setSongUploading(true);
    try {
      const blob = await getUploadedSongBlob(picked.storageRef);
      if (!blob) {
        toast('This song file lives only in the browser it was uploaded from.', 'error');
        return;
      }
      const asset = await uploadAsset(blob, picked.fileName || `${picked.title}.mp3`);
      party.changeSong(asset.assetId, picked.title);
    } catch (error) {
      toast((error as Error).message || 'Could not share that song with the room.', 'error');
    } finally {
      setSongUploading(false);
      setSongPickerOpen(false);
    }
  };

  useEffect(() => {
    if (party.removedReason) toast(party.removedReason, 'error');
  }, [party.removedReason]);

  useEffect(() => {
    if (call.error) toast(call.error, 'error');
  }, [call.error]);

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/watch-party/${code}`);
      setCopied(true);
      toast('Invite link copied', 'success');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('Copy failed — select the code manually', 'error');
    }
  };

  if (!isAuthenticated) {
    return (
      <main className="mx-auto w-full max-w-lg px-5 py-40 text-center sm:px-8">
        <h1 className="font-display text-4xl text-white">Sign in required</h1>
        <p className="mt-3 text-sm text-muted">You need an account to join a private watch party.</p>
        <Link
          to="/login"
          state={{ from: `/watch-party/${code}` }}
          className="mt-8 inline-flex rounded-full bg-cherry-700 px-6 py-3 text-sm font-bold text-white shadow-cherry transition-colors hover:bg-rose-400 hover:text-ink">
          
          Sign in
        </Link>
      </main>);

  }

  if (party.endedReason || party.removedReason) {
    return (
      <main className="mx-auto w-full max-w-lg px-5 py-40 text-center sm:px-8">
        <h1 className="font-display text-4xl leading-none text-white">
          {party.removedReason ? 'You were removed' : 'The room has closed'}
        </h1>
        <p className="mt-3 text-sm text-muted">{party.removedReason || party.endedReason}</p>
        <Link
          to="/my-uploads"
          className="mt-8 inline-flex rounded-full bg-cherry-700 px-6 py-3 text-sm font-bold text-white shadow-cherry transition-colors hover:bg-rose-400 hover:text-ink">
          
          Back to My Uploaded Movies
        </Link>
      </main>);

  }

  if (party.error && !party.room) {
    return (
      <main className="mx-auto w-full max-w-lg px-5 py-40 text-center sm:px-8">
        <h1 className="font-display text-4xl leading-none text-white">Room not found</h1>
        <p className="mt-3 text-sm text-muted">{party.error}</p>
        <Link
          to="/my-uploads"
          className="mt-8 inline-flex rounded-full bg-cherry-700 px-6 py-3 text-sm font-bold text-white shadow-cherry transition-colors hover:bg-rose-400 hover:text-ink">
          
          Back to My Uploaded Movies
        </Link>
      </main>);

  }

  const room = party.room;
  const username = user?.name || 'Guest';

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-10 pt-24 sm:px-8 sm:pt-28">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.42em] text-rose-300">
            Private screening · Uploaded movie
          </p>
          <h1 className="mt-2 font-display text-4xl leading-none tracking-wide text-white text-glow-cherry sm:text-5xl">
            {party.room?.movieTitle || movie?.title || 'Watch Party'}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span
              className={`inline-flex items-center gap-1.5 ${
              party.connected ? 'text-rose-200' : 'text-muted'}`
              }>
              
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                party.connected ? 'bg-rose-400' : 'bg-muted/60'}`
                } />
              
              {party.connected ? 'Synced' : 'Connecting…'}
            </span>
            {party.isHost ?
            <span className="inline-flex items-center gap-1 text-rose-200">
                <CrownIcon className="h-3.5 w-3.5" /> You are the host
              </span> :

            room &&
            <span>
                Host: {room.members.find((m) => m.userId === room.hostId)?.username ?? 'Unknown'}
              </span>

            }
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyCode}
            className="inline-flex items-center gap-2 rounded-full border border-rose-400/30 bg-cherry-900/50 px-4 py-2.5 font-display text-lg tracking-[0.2em] text-rose-100 transition-[colors,transform] duration-200 ease-cine hover:border-rose-400/60 active:scale-[0.98]">
            
            {code}
            {copied ? <CheckIcon className="h-4 w-4 text-rose-300" /> : <CopyIcon className="h-4 w-4 text-rose-300" />}
          </button>
          {party.isHost ?
          <button
            type="button"
            onClick={() => {
              party.endRoom();
              navigate('/my-uploads');
            }}
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] px-4 py-2.5 text-sm font-semibold text-white/80 transition-[colors,transform] duration-200 ease-cine hover:border-rose-400/50 hover:text-rose-200 active:scale-[0.98]">
            
              <LogOutIcon className="h-4 w-4" />
              End room
            </button> :

          <Link
            to="/my-uploads"
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] px-4 py-2.5 text-sm font-semibold text-white/80 transition-[colors,transform] duration-200 ease-cine hover:border-rose-400/50 hover:text-rose-200">
            
              <LogOutIcon className="h-4 w-4" />
              Leave
            </Link>
          }
        </div>
      </header>

      {party.error &&
      <p className="mt-5 rounded-2xl border border-rose-400/20 bg-cherry-900/40 px-4 py-3 text-xs text-rose-100">
          {party.error}
        </p>
      }

      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <motion.div
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.42, ease: EASE }}>
          
          <UploadedVideoPlayer
            src={videoSrc}
            isHost={party.isHost}
            lastSync={party.lastSync}
            initialPosition={party.initialPosition}
            onControl={party.control}
            overlay={call.inCall && floatingCall ?
            <FloatingCallOverlay
              localStream={call.localStream}
              participants={call.participants}
              username={username}
              muted={call.muted}
              cameraOff={call.cameraOff} /> :
            null} />
          

          {!party.isHost &&
          <p className="mt-3 text-xs text-muted">
              The host controls playback — play, pause and seek stay in sync for everyone.
            </p>
          }
        </motion.div>

        <aside className="flex flex-col gap-5">
          {room &&
          <RoomMembersPanel
            members={room.members}
            currentUserId={String(user?.id ?? '')}
            hostId={room.hostId}
            isHost={party.isHost}
            onTransferHost={party.transferHost}
            onRemoveMember={party.removeMember} />

          }
          <SharedMusicPlayer
            src={songSrc}
            songTitle={songTitle}
            isHost={party.isHost}
            lastSync={party.lastMusicSync}
            initialPosition={party.initialMusicPosition}
            onControl={party.controlMusic}
            onOpenLibrary={() => setSongPickerOpen(true)} />
          
          <CallPanel
            inCall={call.inCall}
            connecting={call.connecting}
            localStream={call.localStream}
            participants={call.participants}
            muted={call.muted}
            cameraOff={call.cameraOff}
            error={call.error}
            noTurn={call.noTurn}
            floating={floatingCall}
            onToggleFloating={() => setFloatingCall((f) => !f)}
            username={username}
            onJoin={(withVideo: boolean) => {
              if (!party.connected) {
                toast('Still connecting to the watch party server — try again in a moment.', 'error');
                return;
              }
              call.joinCall(withVideo);
            }}
            onLeave={call.leaveCall}
            onToggleMute={call.toggleMute}
            onToggleCamera={() => void call.toggleCamera()} />
          
          <RoomChat messages={party.messages} username={username} onSend={party.sendMessage} />
        </aside>
      </div>

      {user &&
      <SongPickerModal
        open={songPickerOpen}
        userId={String(user.id)}
        onClose={() => setSongPickerOpen(false)}
        onPick={handlePickSong} />

      }
      {songUploading &&
      <div className="fixed bottom-6 right-6 z-[90] rounded-2xl border border-rose-400/20 bg-ink-800/95 px-4 py-2.5 text-xs font-semibold text-rose-100 shadow-cherry backdrop-blur-xl">
          Sharing song with the room…
        </div>
      }
    </main>);

}
