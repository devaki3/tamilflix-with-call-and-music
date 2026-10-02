import type { UploadedMovie } from '../types/movie';

/**
 * Storage for user-uploaded local movie files.
 *
 * The existing project has no file-upload backend (the deployed API at
 * BACKEND_URL only serves movie metadata, auth and rooms — see utils/api.ts).
 * To stay additive and keep this feature working out of the box, uploaded
 * video files are stored in the browser's IndexedDB (this origin only) and
 * metadata is kept in localStorage, mirroring the "existing backend/storage
 * architecture" pattern already used for auth (localStorage) elsewhere in the
 * app. If/when a real upload endpoint exists, only `putBlob`/`getBlob` below
 * need to be swapped for `fetch` calls — everything above this module is
 * unaffected.
 */

const DB_NAME = 'tamilflix-uploads';
const DB_VERSION = 1;
const STORE = 'movie-files';
const META_KEY = 'tamilflix_uploaded_movies';

export const ALLOWED_EXTENSIONS = ['mp4', 'webm', 'mkv', 'mov'];
export const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/x-matroska',
  'video/quicktime',
  // Some browsers report no/blank MIME type for .mkv — extension check covers that.
  ''
];
export const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024 * 1024; // 4GB, generous local-storage ceiling

export interface FileValidationResult {
  ok: boolean;
  error?: string;
}

function extensionOf(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/** Generates a filesystem-safe, collision-resistant storage key — never trusts the original name. */
function safeStorageKey(originalName: string): string {
  const ext = extensionOf(originalName).replace(/[^a-z0-9]/gi, '') || 'bin';
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ?
    crypto.randomUUID() :
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${id}.${ext}`;
}

export function validateVideoFile(file: File): FileValidationResult {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      error: `Unsupported file type ".${ext || 'unknown'}". Allowed formats: ${ALLOWED_EXTENSIONS.
      join(', ')}.`
    };
  }
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type) && !file.type.startsWith('video/')) {
    return { ok: false, error: 'This file does not look like a video. Please choose a video file.' };
  }
  if (file.size <= 0) {
    return { ok: false, error: 'This file appears to be empty.' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `File is too large (${(file.size / 1e9).toFixed(2)} GB). Max size is ${(
      MAX_FILE_SIZE_BYTES / 1e9).
      toFixed(0)} GB.`
    };
  }
  return { ok: true };
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not support local file storage.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local storage.'));
  });
}

async function putBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Could not save the file.'));
  });
  db.close();
}

export async function getUploadedMovieBlob(storageRef: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(storageRef);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => reject(req.error || new Error('Could not read the file.'));
    });
    db.close();
    return blob;
  } catch {
    return null;
  }
}

async function deleteBlob(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not delete the file.'));
    });
    db.close();
  } catch {
    /* best effort */
  }
}

/** Reads the video duration by briefly loading it into an off-DOM <video> element. */
function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      const cleanup = () => URL.revokeObjectURL(url);
      video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        cleanup();
        resolve(duration);
      };
      video.onerror = () => {
        cleanup();
        resolve(0);
      };
      video.src = url;
    } catch {
      resolve(0);
    }
  });
}

function readAllMetadata(): UploadedMovie[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as UploadedMovie[]) : [];
  } catch {
    return [];
  }
}

function writeAllMetadata(list: UploadedMovie[]): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function listMyUploads(userId: string): UploadedMovie[] {
  return readAllMetadata().
  filter((m) => m.uploaderId === userId).
  sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
}

export function getUploadedMovie(id: string): UploadedMovie | null {
  return readAllMetadata().find((m) => m.id === id) ?? null;
}

export interface UploadOptions {
  onProgress?: (percent: number) => void;
}

/**
 * Validates, reads and stores an uploaded movie file, then saves its metadata.
 * Progress is driven by the browser's real FileReader progress events (the
 * file is read once to report progress + confirm it's readable, then the
 * original File/Blob is written to IndexedDB directly to avoid doubling
 * memory use).
 */
export async function uploadMovie(
file: File,
title: string,
uploaderId: string,
uploaderName: string,
options: UploadOptions = {})
: Promise<UploadedMovie> {
  const validation = validateVideoFile(file);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  await new Promise<void>((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable && options.onProgress) {
        options.onProgress(Math.min(95, Math.round(event.loaded / event.total * 95)));
      }
    };
    reader.onload = () => resolve();
    reader.onerror = () => reject(new Error('Could not read the file. It may be corrupted.'));
    // Read as ArrayBuffer purely to get real progress + validate readability;
    // the buffer itself is discarded, the original File is stored below.
    reader.readAsArrayBuffer(file);
  });

  const duration = await readDuration(file);
  const storageRef = safeStorageKey(file.name);

  try {
    await putBlob(storageRef, file);
  } catch {
    throw new Error('Could not save the video to local storage. It may be too large for this browser.');
  }

  options.onProgress?.(100);

  const meta: UploadedMovie = {
    id:
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ?
    crypto.randomUUID() :
    `um-${Date.now()}`,
    title: title.trim() || file.name.replace(/\.[^.]+$/, ''),
    fileName: file.name,
    storageRef,
    uploaderId,
    uploaderName,
    fileSize: file.size,
    duration,
    mimeType: file.type || 'video/mp4',
    uploadDate: new Date().toISOString()
  };

  const list = readAllMetadata();
  list.push(meta);
  writeAllMetadata(list);

  return meta;
}

export interface DeleteResult {
  ok: boolean;
  error?: string;
}

export async function deleteUploadedMovie(id: string, requesterId: string): Promise<DeleteResult> {
  const list = readAllMetadata();
  const movie = list.find((m) => m.id === id);
  if (!movie) {
    return { ok: false, error: 'Movie not found.' };
  }
  // Only the uploader may delete their own upload — the app has no other
  // permission/roles system to defer to.
  if (movie.uploaderId !== requesterId) {
    return { ok: false, error: 'Only the uploader can delete this movie.' };
  }
  await deleteBlob(movie.storageRef);
  writeAllMetadata(list.filter((m) => m.id !== id));
  return { ok: true };
}

export function formatDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
