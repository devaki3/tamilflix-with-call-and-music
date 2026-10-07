import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { UploadCloudIcon } from 'lucide-react';
import { UploadMovieModal } from '../components/UploadMovieModal';
import { UploadedMovieCard } from '../components/UploadedMovieCard';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { canDeleteMovie, deleteSharedMovie, getUploadedMovieBlob, listAllShared, listMyUploads } from '../utils/uploadedMovies';
import { createServerRoom, uploadAsset } from '../utils/partyApi';
import type { UploadedMovie } from '../types/movie';

import { ownerUserId, partyUserId } from '../utils/partyIdentity';
const EASE = [0.23, 1, 0.32, 1] as const;

export function MyUploadedMovies() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [movies, setMovies] = useState<UploadedMovie[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [creatingPartyId, setCreatingPartyId] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (user) {
      const local = listMyUploads(String(user.id));
      setMovies(local);
      // Shared library: movies uploaded by anyone, so members see them too.
      void listAllShared(local).then(setMovies);
    }
  }, [user]);

  const handleDelete = async (movie: UploadedMovie) => {
    if (!user) return;
    if (!window.confirm(`Delete "${movie.title}"? This cannot be undone.`)) return;
    const result = await deleteSharedMovie(movie, ownerUserId(user), String(user.id));
    if (result.ok) {
      setMovies((prev) => prev.filter((m) => m.id !== movie.id));
      toast('Movie deleted', 'success');
    } else {
      toast(result.error || 'Could not delete this movie.', 'error');
    }
  };

  const handleCreateParty = async (movie: UploadedMovie) => {
    if (!user || creatingPartyId) return;
    setCreatingPartyId(movie.id);
    try {
      let asset: { assetId: string; mime: string };
      if (movie.assetId) {
        asset = { assetId: movie.assetId, mime: movie.mimeType }; // already on the server
      } else {
        const blob = await getUploadedMovieBlob(movie.storageRef);
        if (!blob) {
          toast('This movie file lives only in the browser it was uploaded from.', 'error');
          return;
        }
        toast('Uploading to the watch party server…', 'info');
        asset = await uploadAsset(blob, movie.fileName || `${movie.title}.mp4`);
      }
      const room = await createServerRoom({
        hostId: partyUserId(user) ?? String(user.id),
        ownerId: ownerUserId(user),
        hostName: user.name,
        movieId: movie.id,
        movieTitle: movie.title,
        assetId: asset.assetId,
        assetMime: asset.mime
      });
      toast(`Room ${room.roomCode} created — you're the host`, 'success');
      navigate(`/watch-party/${room.roomCode}`);
    } catch (error) {
      toast((error as Error).message || 'Could not create the watch party.', 'error');
    } finally {
      setCreatingPartyId(null);
    }
  };

  if (!isAuthenticated) {
    return (
      <main className="mx-auto w-full max-w-lg px-5 py-40 text-center sm:px-8">
        <h1 className="font-display text-4xl text-white">My Uploaded Movies</h1>
        <p className="mt-3 text-sm text-muted">Sign in to upload and manage your own movies.</p>
        <Link
          to="/login"
          state={{ from: '/my-uploads' }}
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
            My Uploaded Movies
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted">
            Upload a movie from your computer, then start a synchronized watch party for your
            friends.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-cherry-700 px-6 py-3 text-sm font-bold text-white shadow-cherry transition-[background-color,transform] duration-200 ease-cine hover:bg-rose-400 hover:text-ink active:scale-[0.98]">
          
          <UploadCloudIcon className="h-4 w-4" />
          Upload Movie
        </button>
      </header>

      {movies.length === 0 ?
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="mt-12 rounded-3xl border border-dashed border-white/15 px-6 py-16 text-center">
        
          <p className="text-sm text-muted">
            You haven't uploaded any movies yet.
          </p>
          <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="mt-5 inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-400/10 px-5 py-2.5 text-sm font-bold text-rose-100 transition-colors hover:bg-rose-400/20">
          
            <UploadCloudIcon className="h-4 w-4" />
            Upload your first movie
          </button>
        </motion.div> :

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {movies.map((movie) =>
        <UploadedMovieCard
          key={movie.id}
          movie={movie}
          canDelete={canDeleteMovie(movie, ownerUserId(user), String(user?.id ?? ''))}
          onDelete={handleDelete}
          onCreateParty={handleCreateParty} />

        )}
        </div>
      }

      <UploadMovieModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onUploaded={(movie) => setMovies((prev) => [movie, ...prev])} />
      
    </main>);

}
