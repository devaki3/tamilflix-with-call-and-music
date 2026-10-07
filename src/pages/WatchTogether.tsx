import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { DoorOpenIcon, PlusIcon, UsersIcon } from 'lucide-react';
import { PosterImage } from '../components/PosterImage';
import { useMovies } from '../contexts/MovieContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { checkServerRoom, createServerRoom, deleteRoom, listMyRooms, type MyRoom } from '../utils/partyApi';

import { ownerUserId, partyUserId } from '../utils/partyIdentity';
const EASE = [0.23, 1, 0.32, 1] as const;

export function WatchTogether() {
  const { movies } = useMovies();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const preselected = Number(params.get('movie')) || null;
  const [selected, setSelected] = useState<number | null>(preselected);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [myRooms, setMyRooms] = useState<MyRoom[]>([]);

  // Creator-only history: the server only returns rooms created by this account.
  const owner = ownerUserId(user);
  const refreshMyRooms = () => {
    if (owner) void listMyRooms(owner).then(setMyRooms);
  };
  useEffect(() => {
    refreshMyRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);

  const openMyRoom = (room: MyRoom) => {
    navigate(
      room.kind === 'uploaded' ?
      `/watch-party/${room.roomCode}` :
      `/room/${room.roomCode}${room.movieId ? `?movie=${room.movieId}` : ''}`
    );
  };

  const handleDeleteRoom = async (room: MyRoom) => {
    if (!owner) return;
    if (!window.confirm(`Delete room ${room.roomCode}? Everyone inside will be removed.`)) return;
    try {
      await deleteRoom(room.roomCode, owner);
      toast(`Room ${room.roomCode} deleted`, 'success');
      refreshMyRooms();
    } catch (error) {
      toast((error as Error).message || 'Could not delete the room.', 'error');
    }
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const picks = useMemo(
    () => [...movies].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 12),
    [movies]
  );

  const handleCreate = async () => {
    if (!isAuthenticated || !user) {
      navigate('/login', { state: { from: '/watch-together' } });
      return;
    }
    if (!selected) {
      toast('Pick a film to screen first', 'info');
      return;
    }
    const movie = movies.find((m) => m.id === selected);
    setBusy('create');
    try {
      const room = await createServerRoom({
        hostId: partyUserId(user) ?? String(user.id),
        ownerId: ownerUserId(user),
        hostName: user.name,
        kind: 'existing',
        movieId: String(selected),
        movieTitle: movie?.title
      });
      toast(`Room ${room.roomCode} is live`, 'success');
      navigate(`/room/${room.roomCode}?movie=${selected}`);
    } catch (error) {
      toast((error as Error).message || 'Could not create the room.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleJoin = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    if (!isAuthenticated) {
      navigate('/login', { state: { from: '/watch-together' } });
      return;
    }
    setBusy('join');
    try {
      const result = await checkServerRoom(trimmed);
      if (!result.exists) {
        toast('Room not found. Check the code and try again.', 'error');
        return;
      }
      if (result.kind === 'uploaded') {
        // Uploaded-movie / song rooms live on their own page (the YouTube room page can't play them).
        navigate(`/watch-party/${trimmed}`);
        return;
      }
      navigate(`/room/${trimmed}${result.movieId ? `?movie=${result.movieId}` : ''}`);
    } catch (error) {
      toast((error as Error).message || 'Could not join that room', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="relative isolate mx-auto w-full max-w-6xl px-5 pb-10 pt-28 sm:px-8 sm:pt-36">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-16 -z-10 h-96 w-[36rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(165,18,53,0.28),transparent_65%)] blur-3xl" />
      

      <header className="max-w-2xl">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.42em] text-rose-300">
          Watch Together
        </p>
        <h1 className="mt-3 font-display text-5xl leading-none tracking-wide text-white text-glow-cherry sm:text-6xl">
          Your private virtual cinema
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Host a room, share the code, and everyone watches in sync — same frame, same second, with
          chat down the side. Up to 8 seats per room.
        </p>
      </header>

      {!isAuthenticated &&
      <p className="mt-7 flex flex-wrap items-center gap-2 rounded-2xl border border-rose-400/20 bg-cherry-900/40 px-4 py-3 text-sm text-rose-100">
          Sign in to host or join a room.
          <Link
          to="/login"
          state={{ from: '/watch-together' }}
          className="font-semibold text-rose-300 underline-offset-4 transition-colors duration-200 hover:text-rose-200 hover:underline">
          
            Sign in
          </Link>
        </p>
      }

      <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Host a room — the primary action, so it gets the larger panel */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="rounded-3xl border border-rose-400/15 bg-ink-800/70 p-6 shadow-cherry backdrop-blur-xl sm:p-8"
          aria-labelledby="host-room">
          
          <h2
            id="host-room"
            className="flex items-center gap-2 font-display text-3xl tracking-wide text-white">
            
            <PlusIcon className="h-5 w-5 text-rose-300" />
            Host a room
          </h2>
          <p className="mt-2 text-sm text-muted">Choose tonight's film, then share the code.</p>

          <ul className="no-scrollbar mt-6 grid max-h-[19rem] grid-cols-3 gap-3 overflow-y-auto pr-1 sm:grid-cols-4">
            {picks.map((movie) => {
              const active = selected === movie.id;
              return (
                <li key={movie.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(movie.id)}
                    aria-pressed={active}
                    className={`group block w-full overflow-hidden rounded-xl border text-left transition-[colors,transform,box-shadow] duration-200 ease-cine active:scale-[0.98] ${
                    active ?
                    'border-rose-400/70 shadow-cherry' :
                    'border-white/[0.08] hover:border-rose-400/40'}`
                    }>
                    
                    <PosterImage
                      src={movie.poster}
                      alt={`${movie.title} poster`}
                      title={movie.title}
                      className="aspect-[2/3] w-full" />
                    
                    <span className="block truncate px-2 py-1.5 text-[0.68rem] font-semibold text-white/80">
                      {movie.title}
                    </span>
                  </button>
                </li>);

            })}
          </ul>

          <button
            type="button"
            onClick={handleCreate}
            disabled={busy === 'create'}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-cherry-700 px-6 py-3.5 text-sm font-bold text-white shadow-cherry transition-[background-color,transform,opacity] duration-200 ease-cine hover:bg-rose-400 hover:text-ink active:scale-[0.98] disabled:opacity-60 sm:w-auto">
            
            <UsersIcon className="h-4 w-4" />
            {busy === 'create' ? 'Opening the room…' : 'Create room'}
          </button>
        </motion.section>

        {/* Join a room */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: EASE }}
          className="h-fit rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur-xl sm:p-8"
          aria-labelledby="join-room">
          
          <h2
            id="join-room"
            className="flex items-center gap-2 font-display text-3xl tracking-wide text-white">
            
            <DoorOpenIcon className="h-5 w-5 text-rose-300" />
            Join a room
          </h2>
          <p className="mt-2 text-sm text-muted">Got a code from a friend? Take your seat.</p>

          <form onSubmit={handleJoin} className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted">
                Room code
              </span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="A1B2C3D4"
                aria-label="Room code"
                className="w-full rounded-xl border border-white/10 bg-ink/60 px-4 py-3 font-display text-2xl tracking-[0.24em] text-white placeholder:text-muted/50 outline-none transition-[border-color,box-shadow] duration-200 ease-cine focus:border-rose-400/60 focus:shadow-glow" />
              
            </label>
            <button
              type="submit"
              disabled={busy === 'join' || !code.trim()}
              className="w-full rounded-full border border-rose-400/40 bg-rose-400/10 px-6 py-3.5 text-sm font-bold text-rose-100 transition-[background-color,transform,opacity] duration-200 ease-cine hover:bg-rose-400/20 active:scale-[0.98] disabled:opacity-40">
              
              {busy === 'join' ? 'Joining…' : 'Join room'}
            </button>
          </form>
        </motion.section>
      </div>

      {isAuthenticated && myRooms.length > 0 &&
      <section className="mt-10 rounded-3xl border border-white/[0.08] bg-white/[0.03] p-6 sm:p-8" aria-labelledby="my-rooms">
          <h2 id="my-rooms" className="font-display text-3xl tracking-wide text-white">Your rooms</h2>
          <p className="mt-2 text-sm text-muted">Only you can see this list. Open a room again or delete it.</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {myRooms.map((room) =>
          <li key={room.roomCode} className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-ink-800/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{room.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {room.roomCode} · {room.members} in room · {new Date(room.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                type="button"
                onClick={() => openMyRoom(room)}
                className="rounded-full bg-cherry-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-rose-400 hover:text-ink">
                    Open
                  </button>
                  <button
                type="button"
                onClick={() => handleDeleteRoom(room)}
                className="rounded-full border border-white/[0.12] px-4 py-1.5 text-xs font-semibold text-white/80 hover:border-rose-400/50 hover:text-rose-200">
                    Delete
                  </button>
                </div>
              </li>
          )}
          </ul>
        </section>
      }
    </main>);

}