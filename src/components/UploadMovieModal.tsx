import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FilmIcon, UploadCloudIcon, XIcon } from 'lucide-react';
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES, uploadMovie, validateVideoFile } from
'../utils/uploadedMovies';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import type { UploadedMovie } from '../types/movie';

interface UploadMovieModalProps {
  open: boolean;
  onClose: () => void;
  onUploaded: (movie: UploadedMovie) => void;
}

const EASE = [0.23, 1, 0.32, 1] as const;

export function UploadMovieModal({ open, onClose, onUploaded }: UploadMovieModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => {
    setFile(null);
    setTitle('');
    setError(null);
    setProgress(null);
    setDragOver(false);
  };

  const close = () => {
    if (progress !== null && progress < 100) return; // don't allow closing mid-upload
    reset();
    onClose();
  };

  const pickFile = (candidate: File | null) => {
    if (!candidate) return;
    const validation = validateVideoFile(candidate);
    if (!validation.ok) {
      setError(validation.error || 'Invalid file.');
      setFile(null);
      return;
    }
    setError(null);
    setFile(candidate);
    if (!title) setTitle(candidate.name.replace(/\.[^.]+$/, ''));
  };

  const handleUpload = async () => {
    if (!file || !user) return;
    setError(null);
    setProgress(0);
    try {
      const movie = await uploadMovie(file, title, String(user.id), user.name, {
        onProgress: (pct) => setProgress(pct)
      });
      toast(`"${movie.title}" uploaded`, 'success');
      onUploaded(movie);
      reset();
      onClose();
    } catch (err) {
      setProgress(null);
      const message = (err as Error).message || 'Upload failed. Please try again.';
      setError(message);
      toast(message, 'error');
    }
  };

  return (
    <AnimatePresence>
      {open &&
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[95] grid place-items-center bg-black/70 px-4 backdrop-blur-sm"
        onClick={close}>
        
          <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.22, ease: EASE }}
          onClick={(event) => event.stopPropagation()}
          className="w-full max-w-md rounded-3xl border border-rose-400/15 bg-ink-800/95 p-6 shadow-cherry backdrop-blur-xl">
          
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[0.62rem] font-semibold uppercase tracking-[0.4em] text-rose-300">
                  Local upload
                </p>
                <h2 className="mt-1 font-display text-2xl text-white">Upload movie</h2>
              </div>
              <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-full text-white/60 transition-colors hover:text-rose-200">
              
                <XIcon className="h-4 w-4" />
              </button>
            </div>

            <label
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              pickFile(event.dataTransfer.files?.[0] ?? null);
            }}
            className={`mt-5 flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragOver ? 'border-rose-400/70 bg-rose-400/5' : 'border-white/15 hover:border-rose-400/40'}`
            }>
            
              <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/webm,video/x-matroska,video/quicktime,.mp4,.webm,.mkv,.mov"
              className="hidden"
              onChange={(event) => pickFile(event.target.files?.[0] ?? null)} />
            
              {file ?
            <>
                  <FilmIcon className="h-8 w-8 text-rose-300" />
                  <span className="max-w-full truncate text-sm text-white">{file.name}</span>
                  <span className="text-xs text-muted">{(file.size / 1e6).toFixed(1)} MB</span>
                </> :

            <>
                  <UploadCloudIcon className="h-8 w-8 text-rose-300" />
                  <span className="text-sm text-white/80">Click to choose or drag a video file</span>
                  <span className="text-xs text-muted">
                    {ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(', ')} · up to{' '}
                    {(MAX_FILE_SIZE_BYTES / 1e9).toFixed(0)}GB
                  </span>
                </>
            }
            </label>

            {file &&
          <label className="mt-4 block">
                <span className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-muted">
                  Title
                </span>
                <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Movie title"
              className="w-full rounded-xl border border-white/10 bg-ink/60 px-4 py-2.5 text-sm text-white placeholder:text-muted/50 outline-none transition-[border-color] duration-200 ease-cine focus:border-rose-400/60" />
              
              </label>
          }

            {error &&
          <p className="mt-3 rounded-xl border border-rose-400/20 bg-cherry-900/40 px-3 py-2 text-xs text-rose-100">
                {error}
              </p>
          }

            {progress !== null &&
          <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div
                className="h-full rounded-full bg-cherry-600 transition-[width] duration-200"
                style={{ width: `${progress}%` }} />
              
                </div>
                <p className="mt-1.5 text-right text-xs text-muted">{progress}%</p>
              </div>
          }

            <div className="mt-6 flex justify-end gap-2">
              <button
              type="button"
              onClick={close}
              disabled={progress !== null && progress < 100}
              className="rounded-full border border-white/[0.12] px-5 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:border-rose-400/50 hover:text-rose-200 disabled:opacity-40">
              
                Cancel
              </button>
              <button
              type="button"
              onClick={handleUpload}
              disabled={!file || (progress !== null && progress < 100)}
              className="inline-flex items-center gap-2 rounded-full bg-cherry-700 px-6 py-2.5 text-sm font-bold text-white shadow-cherry transition-[background-color,transform,opacity] duration-200 ease-cine hover:bg-rose-400 hover:text-ink active:scale-[0.98] disabled:opacity-40">
              
                {progress !== null && progress < 100 ? 'Uploading…' : 'Upload'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      }
    </AnimatePresence>);

}
