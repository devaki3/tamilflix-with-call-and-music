import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ListMusicIcon, UploadCloudIcon, XIcon } from 'lucide-react';
import { UploadSongModal } from './UploadSongModal';
import { UploadedSongCard } from './UploadedSongCard';
import { listMySongs } from '../utils/uploadedSongs';
import type { UploadedSong } from '../types/movie';

interface SongPickerModalProps {
  open: boolean;
  userId: string;
  onClose: () => void;
  onPick: (song: UploadedSong) => void;
}

const EASE = [0.23, 1, 0.32, 1] as const;

export function SongPickerModal({ open, userId, onClose, onPick }: SongPickerModalProps) {
  const [songs, setSongs] = useState<UploadedSong[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    if (open) setSongs(listMySongs(userId)); // private: your own songs only
  }, [open, userId]);

  return (
    <>
      <AnimatePresence>
        {open &&
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] grid place-items-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={onClose}>
          
            <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.22, ease: EASE }}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-rose-400/15 bg-ink-800/95 p-6 shadow-cherry backdrop-blur-xl">
            
              <div className="flex items-start justify-between">
                <h2 className="flex items-center gap-2 font-display text-2xl text-white">
                  <ListMusicIcon className="h-5 w-5 text-rose-300" />
                  Choose a song
                </h2>
                <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-full text-white/60 transition-colors hover:text-rose-200">
                
                  <XIcon className="h-4 w-4" />
                </button>
              </div>

              <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-400/10 px-4 py-2.5 text-xs font-bold text-rose-100 transition-colors hover:bg-rose-400/20">
              
                <UploadCloudIcon className="h-3.5 w-3.5" />
                Upload a new song
              </button>

              {songs.length === 0 ?
            <p className="mt-6 text-sm text-muted">
                  You haven't uploaded any songs yet. Upload one to play it in this room.
                </p> :

            <div className="mt-5 space-y-3">
                  {songs.map((song) =>
              <UploadedSongCard
                key={song.id}
                song={song}
                selectMode
                onDelete={() => undefined}
                onSelect={(picked) => {
                  onPick(picked);
                  onClose();
                }} />

              )}
                </div>
            }
            </motion.div>
          </motion.div>
        }
      </AnimatePresence>

      <UploadSongModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={(song) => {
          setSongs((prev) => [song, ...prev]);
          onPick(song);
          setUploadOpen(false);
          onClose();
        }} />
      
    </>);

}
