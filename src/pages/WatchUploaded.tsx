import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UsersIcon } from 'lucide-react';
import { getSharedMovie, getUploadedMovie, getUploadedMovieBlob } from '../utils/uploadedMovies';
import { listLibraryOrNull } from '../utils/partyApi';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { assetStreamUrl, createServerRoom, uploadAsset } from '../utils/partyApi';
import { useNavigate } from 'react-router-dom';
import type { UploadedMovie } from '../types/movie';

import { ownerUserId, partyUserId } from '../utils/partyIdentity';
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
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      // Local record first, otherwise a movie someone else shared to the library.
      const meta = getUploadedMovie(id) ?? (await getSharedMovie(id));
      if (cancelled) return;
      setMovie(meta);
      if (!meta) return;
      if (meta.assetId) {
        // Only stream from the server if it still has the file (it can be wiped on restart).
        const library = await listLibraryOrNull('movie');
        if (cancelled) return;
        if (!library || library.some((x) => x.assetId === meta.assetId)) {
          setSrc(assetStreamUrl(meta.assetId)); // streams from the server on any device
          return;
        }
        meta.assetId = undefined;
        setMovie({ ...meta });
      }
      const blob = await getUploadedMovieBlob(meta.storageRef);
      if (cancelled) return;
      if (blob) {
        url = URL.createObjectURL(blob);
        setSrc(url);
      } else {
        setNotFoundLocally(true);
      }
    })();
    return () => {
      cancelled = true;
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
              let asset: { assetId: string; mime: string };
              if (movie.assetId) {
                asset = { assetId: movie.assetId, mime: movie.mimeType };
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
