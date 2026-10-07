import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { UploadCloudIcon } from 'lucide-react';
import { UploadSongModal } from '../components/UploadSongModal';
import { UploadedSongCard } from '../components/UploadedSongCard';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { deleteSharedSong, getUploadedSongBlob, listMySongs } from '../utils/uploadedSongs';
import { createServerRoom, uploadAsset } from '../utils/partyApi';
import { ownerUserId, partyUserId } from '../utils/partyIdentity';
import type { UploadedSong } from '../types/movie';

const EASE = [0.23, 1, 0.32, 1] as const;

export function MyUploadedSongs() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [songs, setSongs] = useState<UploadedSong[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    // Songs are private: only the uploader sees their own songs (this browser's list).
    if (user) setSongs(listMySongs(String(user.id)));
  }, [user]);

  const handleDelete = async (song: UploadedSong) => {
    if (!user) return;
    if (!window.confirm(`Delete "${song.title}"? This cannot be undone.`)) return;
    const result = await deleteSharedSong(song, ownerUserId(user), String(user.id));
    if (result.ok) {
      setSongs((prev) => prev.filter((s) => s.id !== song.id));
      toast('Song deleted', 'success');
    } else {
      toast(result.error || 'Could not delete this song.', 'error');
    }
  };

  // Start a music room: everyone who joins hears the song in sync, with chat + voice/video call.
  const handleCreateParty = async (song: UploadedSong) => {
    if (!user || creatingId) return;
    setCreatingId(song.id);
    try {
      let assetId = song.assetId;
      if (!assetId) {
        const blob = await getUploadedSongBlob(song.storageRef);
        if (!blob) {
          toast('This song file lives only in the browser it was uploaded from.', 'error');
          return;
        }
        toast('Uploading to the watch party server…', 'info');
        assetId = (await uploadAsset(blob, song.fileName || `${song.title}.mp3`)).assetId;
      }
      const room = await createServerRoom({
        hostId: partyUserId(user) ?? String(user.id),
        ownerId: ownerUserId(user),
        hostName: user.name,
        movieTitle: song.title,
        songId: assetId,
        songTitle: song.title
      });
      toast(`Room ${room.roomCode} created — you're the host`, 'success');
      navigate(`/watch-party/${room.roomCode}`);
    } catch (error) {
      toast((error as Error).message || 'Could not create the music room.', 'error');
    } finally {
      setCreatingId(null);
    }
  };

  if (!isAuthenticated) {
    return (
      <main className="mx-auto w-full max-w-lg px-5 py-40 text-center sm:px-8">
        <h1 className="font-display text-4xl text-white">My Uploaded Songs</h1>
        <p className="mt-3 text-sm text-muted">Sign in to upload and manage your own songs.</p>
        <Link
          to="/login"
          state={{ from: '/my-songs' }}
          className="mt-8 inline-flex rounded-full bg-cherry-700 px-6 py-3 text-sm font-bold text-white shadow-cherry transition-colors hover:bg-rose-400 hover:text-ink">
          
          Sign in
        </Link>
      </main>);

  }

  return (
    <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-28 sm:px-8 sm:pt-36">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.42em] text-rose-300">
            Your library
          </p>
          <h1 className="mt-2 font-display text-4xl leading-none tracking-wide text-white text-glow-cherry sm:text-5xl">
            My Uploaded Songs
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted">
            Upload songs from your computer, then play them together inside any watch party you
            host.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-cherry-700 px-6 py-3 text-sm font-bold text-white shadow-cherry transition-[background-color,transform] duration-200 ease-cine hover:bg-rose-400 hover:text-ink active:scale-[0.98]">
          
          <UploadCloudIcon className="h-4 w-4" />
          Upload Song
        </button>
      </header>

      {songs.length === 0 ?
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="mt-12 rounded-3xl border border-dashed border-white/15 px-6 py-16 text-center">
        
          <p className="text-sm text-muted">You haven't uploaded any songs yet.</p>
          <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="mt-5 inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-400/10 px-5 py-2.5 text-sm font-bold text-rose-100 transition-colors hover:bg-rose-400/20">
          
            <UploadCloudIcon className="h-4 w-4" />
            Upload your first song
          </button>
        </motion.div> :

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {songs.map((song) =>
        <UploadedSongCard
          key={song.id}
          song={song}
          onDelete={handleDelete}
          onCreateParty={handleCreateParty}
          createLabel={creatingId === song.id ? 'Creating room…' : 'Start Music Party'} />
        )}
        </div>
      }

      <UploadSongModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onUploaded={(song) => setSongs((prev) => [song, ...prev])} />
      
    </main>);

}
