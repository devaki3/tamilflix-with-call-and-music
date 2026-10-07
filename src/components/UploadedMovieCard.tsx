import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FilmIcon, PlayIcon, Trash2Icon, UsersIcon } from 'lucide-react';
import type { UploadedMovie } from '../types/movie';
import { formatDuration } from '../utils/uploadedMovies';

interface UploadedMovieCardProps {
  movie: UploadedMovie;
  onDelete: (movie: UploadedMovie) => void;
  onCreateParty: (movie: UploadedMovie) => void;
  canDelete?: boolean;
}

export function UploadedMovieCard({ movie, onDelete, onCreateParty, canDelete = true }: UploadedMovieCardProps) {
  const navigate = useNavigate();

  return (
    <div className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] transition-colors hover:border-rose-400/30">
      <div className="grid aspect-video place-items-center bg-cherry-900/50">
        <FilmIcon className="h-10 w-10 text-rose-300/60" />
      </div>
      <div className="p-4">
        <h3 className="truncate font-display text-lg text-white">{movie.title}</h3>
        <p className="mt-0.5 text-xs text-muted">
          {new Date(movie.uploadDate).toLocaleDateString()} · {formatDuration(movie.duration)}
          {movie.uploaderName ? ` · by ${movie.uploaderName}` : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate(`/watch-uploaded/${movie.id}`)}
            className="inline-flex items-center gap-1.5 rounded-full bg-cherry-700 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-400 hover:text-ink">
            
            <PlayIcon className="h-3.5 w-3.5" />
            Watch
          </button>
          <button
            type="button"
            onClick={() => onCreateParty(movie)}
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-rose-400/10 px-3.5 py-2 text-xs font-bold text-rose-100 transition-colors hover:bg-rose-400/20">
            
            <UsersIcon className="h-3.5 w-3.5" />
            Create Watch Party
          </button>
          {canDelete &&
          <button
            type="button"
            onClick={() => onDelete(movie)}
            aria-label={`Delete ${movie.title}`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] px-3 py-2 text-xs font-semibold text-white/60 transition-colors hover:border-rose-400/50 hover:text-rose-200">
            
            <Trash2Icon className="h-3.5 w-3.5" />
          </button>
          }
        </div>
      </div>
    </div>);

}
