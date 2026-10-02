import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UsersIcon } from 'lucide-react';
import { getUploadedMovie, getUploadedMovieBlob } from '../utils/uploadedMovies';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { createServerRoom, uploadAsset } from '../utils/partyApi';
import { useNavigate } from 'react-router-dom';
import type { UploadedMovie } from '../types/movie';

export function WatchUploaded() {
  const { id } = useParams<{id: string;}>();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [movie, setMovie] = useState<UploadedMovie | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [notFoundLocally, setNotFoundLocally] = useState(false);
  const [creatingParty, setCreatingParty] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (!id) return;
    const meta = getUploadedMovie(id);
    setMovie(meta);
    if (!meta) return;
    let url: string | null = null;
    getUploadedMovieBlob(meta.storageRef).then((blob) => {
      if (blob) {
        url = URL.createObjectURL(blob);
        setSrc(url);
      } else {
        setNotFoundLocally(true);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  if (!movie) {
    return (
      <main className="mx-auto w-full max-w-lg px-5 py-40 text-center sm:px-8">
        <h1 className="font-display text-4xl text-white">Movie unavailable</h1>
        <p className="mt-3 text-sm text-muted">This uploaded movie could not be found.</p>
        <Link
          to="/my-uploads"
          className="mt-8 inline-flex rounded-full bg-cherry-700 px-6 py-3 text-sm font-bold text-white shadow-cherry transition-colors hover:bg-rose-400 hover:text-ink">
          
          Back to My Uploaded Movies
        </Link>
      </main>);

  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-10 pt-24 sm:px-8 sm:pt-28">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl leading-none tracking-wide text-white text-glow-cherry sm:text-5xl">
          {movie.title}
        </h1>
        {user &&
        <button
          type="button"
          disabled={creatingParty}
          onClick={async () => {
            setCreatingParty(true);
            try {
              const blob = await getUploadedMovieBlob(movie.storageRef);
              if (!blob) {
                toast('This movie file lives only in the browser it was uploaded from.', 'error');
                return;
              }
              toast('Uploading to the watch party server…', 'info');
              const asset = await uploadAsset(blob, movie.fileName || `${movie.title}.mp4`);
              const room = await createServerRoom({
                hostId: String(user.id),
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
              setCreatingParty(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-400/10 px-5 py-2.5 text-sm font-bold text-rose-100 transition-colors hover:bg-rose-400/20 disabled:opacity-50">
          
            <UsersIcon className="h-4 w-4" />
            {creatingParty ? 'Setting up room…' : 'Create Watch Party'}
          </button>
        }
      </header>

      <div className="mt-7">
        {src ?
        <video src={src} controls autoPlay className="w-full rounded-3xl border border-rose-400/15 bg-black shadow-cherry" /> :

        <div className="grid aspect-video place-items-center rounded-3xl border border-rose-400/15 bg-black px-6 text-center text-sm text-muted">
            {notFoundLocally ?
          'This movie file lives only in the browser it was uploaded from. Open it there to watch.' :
          'Loading…'}
          </div>
        }
      </div>
    </main>);

}
