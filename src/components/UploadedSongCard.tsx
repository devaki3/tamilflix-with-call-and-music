import React from 'react';
import { MusicIcon, PlayIcon, Trash2Icon, UsersIcon } from 'lucide-react';
import type { UploadedSong } from '../types/movie';
import { formatDuration } from '../utils/uploadedSongs';

interface UploadedSongCardProps {
  song: UploadedSong;
  onDelete: (song: UploadedSong) => void;
  onCreateParty?: (song: UploadedSong) => void;
  onSelect?: (song: UploadedSong) => void;
  selectMode?: boolean;
}

export function UploadedSongCard({
  song,
  onDelete,
  onCreateParty,
  onSelect,
  selectMode
}: UploadedSongCardProps) {
  return (
    <div className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] transition-colors hover:border-rose-400/30">
      <div className="flex items-center gap-3 p-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-cherry-900/50">
          <MusicIcon className="h-5 w-5 text-rose-300/70" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-base text-white">{song.title}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {new Date(song.uploadDate).toLocaleDateString()} · {formatDuration(song.duration)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {selectMode ?
        <button
          type="button"
          onClick={() => onSelect?.(song)}
          className="inline-flex items-center gap-1.5 rounded-full bg-cherry-700 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-rose-400 hover:text-ink">
          
            <PlayIcon className="h-3.5 w-3.5" />
            Play in room
          </button> :

        <>
            {onCreateParty &&
          <button
            type="button"
            onClick={() => onCreateParty(song)}
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-rose-400/10 px-3.5 py-2 text-xs font-bold text-rose-100 transition-colors hover:bg-rose-400/20">
            
                <UsersIcon className="h-3.5 w-3.5" />
                Add to Watch Party
              </button>
          }
            <button
            type="button"
            onClick={() => onDelete(song)}
            aria-label={`Delete ${song.title}`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] px-3 py-2 text-xs font-semibold text-white/60 transition-colors hover:border-rose-400/50 hover:text-rose-200">
            
              <Trash2Icon className="h-3.5 w-3.5" />
            </button>
          </>
        }
      </div>
    </div>);

}
