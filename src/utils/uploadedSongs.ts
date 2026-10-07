import { uploadAsset, listLibrary, listLibraryOrNull, deleteAsset, type LibraryItem } from './partyApi';
import type { UploadedSong } from '../types/movie';
import { formatDuration, formatFileSize } from './uploadedMovies';

/**
 * Storage for user-uploaded local song files — mirrors utils/uploadedMovies.ts
 * exactly (same reasoning: no upload backend exists, so audio blobs live in
 * IndexedDB and metadata in localStorage). Kept as its own IndexedDB database
 * so this addition can never collide with or migrate the existing movie
 * storage's schema.
 */

const DB_NAME = 'tamilflix-uploads-audio';
const DB_VERSION = 1;
const STORE = 'song-files';
const META_KEY = 'tamilflix_uploaded_songs';

export const ALLOWED_EXTENSIONS = ['mp3', 'wav', 'aac', 'm4a', 'ogg'];
export const ALLOWED_MIME_TYPES = [
'audio/mpeg',
'audio/mp3',
'audio/wav',
'audio/x-wav',
'audio/aac',
'audio/mp4',
'audio/x-m4a',
'audio/ogg',
'application/ogg',
''];

export const MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024; // 512MB — generous for local audio

export { formatDuration, formatFileSize };

export interface FileValidationResult {
  ok: boolean;
  error?: string;
}

function extensionOf(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

function safeStorageKey(originalName: string): string {
  const ext = extensionOf(originalName).replace(/[^a-z0-9]/gi, '') || 'bin';
  const id =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ?
  crypto.randomUUID() :
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${id}.${ext}`;
}

export function validateAudioFile(file: File): FileValidationResult {
  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      error: `Unsupported file type ".${ext || 'unknown'}". Allowed formats: ${ALLOWED_EXTENSIONS.
      join(', ')}.`
    };
  }
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type) && !file.type.startsWith('audio/')) {
    return { ok: false, error: 'This file does not look like an audio file. Please choose an audio file.' };
  }
  if (file.size <= 0) {
    return { ok: false, error: 'This file appears to be empty.' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: `File is too large (${(file.size / 1e6).toFixed(0)} MB). Max size is ${(
      MAX_FILE_SIZE_BYTES / 1e6).
      toFixed(0)} MB.`
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

export async function getUploadedSongBlob(storageRef: string): Promise<Blob | null> {
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

function readDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      const cleanup = () => URL.revokeObjectURL(url);
      audio.onloadedmetadata = () => {
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        cleanup();
        resolve(duration);
      };
      audio.onerror = () => {
        cleanup();
        resolve(0);
      };
      audio.src = url;
    } catch {
      resolve(0);
    }
  });
}

function readAllMetadata(): UploadedSong[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as UploadedSong[]) : [];
  } catch {
    return [];
  }
}

function writeAllMetadata(list: UploadedSong[]): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function listMySongs(userId: string): UploadedSong[] {
  return readAllMetadata().
  filter((s) => s.uploaderId === userId).
  sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
}

export function getUploadedSong(id: string): UploadedSong | null {
  return readAllMetadata().find((s) => s.id === id) ?? null;
}

export interface UploadOptions {
  onProgress?: (percent: number) => void;
  /** Identity inside party rooms; used to mark who owns the shared upload. */
  partyUserId?: string;
  /** Abort to cancel the upload. */
  signal?: AbortSignal;
}

export async function uploadSong(
file: File,
title: string,
uploaderId: string,
uploaderName: string,
options: UploadOptions = {})
: Promise<UploadedSong> {
  const validation = validateAudioFile(file);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const duration = await readDuration(file);
  const storageRef = safeStorageKey(file.name);
  const displayTitle = title.trim() || file.name.replace(/\.[^.]+$/, '');
  const owner = options.partyUserId || uploaderId;

  // 1) Upload to the shared server FIRST so every member (any device) can see and stream it.
  let assetId: string;
  try {
    const asset = await uploadAsset(
      file,
      file.name,
      (fraction) => options.onProgress?.(Math.min(95, Math.round(fraction * 95))),
      { kind: 'song', title: displayTitle, uploaderId: owner, uploaderName, duration },
      options.signal
    );
    assetId = asset.assetId;
  } catch (err) {
    throw new Error((err as Error).message || 'Could not upload to the server.');
  }

  // Local copy is only a convenience: do it in the background so the upload finishes immediately.
  void putBlob(storageRef, file).catch(() => {
    /* too large for this browser's storage — the shared server copy is what matters */
  });

  options.onProgress?.(100);

  const meta: UploadedSong = {
    id:
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ?
    crypto.randomUUID() :
    `us-${Date.now()}`,
    title: displayTitle,
    fileName: file.name,
    storageRef,
    assetId,
    partyOwnerId: owner,
    uploaderId,
    uploaderName,
    fileSize: file.size,
    duration,
    mimeType: file.type || 'audio/mpeg',
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

export async function deleteUploadedSong(id: string, requesterId: string): Promise<DeleteResult> {
  const list = readAllMetadata();
  const song = list.find((s) => s.id === id);
  if (!song) {
    return { ok: false, error: 'Song not found.' };
  }
  if (song.uploaderId !== requesterId) {
    return { ok: false, error: 'Only the uploader can delete this song.' };
  }
  await deleteBlob(song.storageRef);
  writeAllMetadata(list.filter((s) => s.id !== id));
  return { ok: true };
}

/** Maps a shared-library entry to the app's song shape (id = server asset id). */
function fromLibrary(item: LibraryItem): UploadedSong {
  return {
    id: item.assetId,
    title: item.title,
    fileName: item.fileName,
    storageRef: '',
    assetId: item.assetId,
    partyOwnerId: item.uploaderId,
    uploaderId: item.uploaderId,
    uploaderName: item.uploaderName,
    fileSize: item.size,
    duration: item.duration,
    mimeType: item.mime,
    uploadDate: new Date(item.createdAt).toISOString()
  };
}

/**
 * Everything visible to the user: the shared server library (uploaded by anyone) plus any older
 * local-only uploads of theirs that never reached the server.
 */
export async function listAllShared(localMine: UploadedSong[]): Promise<UploadedSong[]> {
  const library = await listLibraryOrNull('song');
  const shared = (library ?? []).map(fromLibrary);
  const sharedIds = new Set(shared.map((x) => x.assetId));
  // If the server answered but no longer has one of my uploads (free hosting wipes files when it
  // restarts), drop the dead assetId so the local copy is re-uploaded the next time it is used.
  const legacy = localMine
    .filter((x) => !x.assetId || !sharedIds.has(x.assetId))
    .map((x) => (library && x.assetId ? { ...x, assetId: undefined } : x));
  return [...shared, ...legacy].sort(
    (a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
  );
}

/** Finds a shared-library song by its server asset id (for items uploaded by someone else). */
export async function getSharedSong(assetId: string): Promise<UploadedSong | null> {
  const found = (await listLibrary('song')).find((x) => x.assetId === assetId);
  return found ? fromLibrary(found) : null;
}

/** Whether this user may delete the item (only its uploader can). */
export function canDeleteSong(item: UploadedSong, partyId: string | undefined, localUserId: string): boolean {
  if (item.assetId) return Boolean(partyId) && item.partyOwnerId === partyId;
  return item.uploaderId === localUserId;
}

/** Deletes from the shared server library (if shared) and from this browser. */
export async function deleteSharedSong(
  item: UploadedSong,
  partyId: string | undefined,
  localUserId: string
): Promise<{ ok: boolean; error?: string }> {
  if (item.assetId) {
    try {
      await deleteAsset(item.assetId, partyId ?? '');
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    // also drop any local record pointing at it
    const local = readAllMetadata().find((x) => x.assetId === item.assetId);
    if (local) {
      await deleteBlob(local.storageRef);
      writeAllMetadata(readAllMetadata().filter((x) => x.id !== local.id));
    }
    return { ok: true };
  }
  return deleteUploadedSong(item.id, localUserId);
}
