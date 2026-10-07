/**
 * Client for the new Party Service (see /server) — the additive backend
 * that gives BOTH watch-party room types real server-side room state,
 * host authority/transfer, WebRTC signaling relay, and uploaded-media
 * storage/streaming. It is separate from BACKEND_URL (utils/api.ts),
 * which keeps handling auth, the movie catalog and the existing-movie
 * room's own playback sync/chat untouched.
 *
 * Configure with VITE_PARTY_API_URL in production (Netlify env var).
 * Falls back to localhost for local development.
 */

export const PARTY_URL: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PARTY_API_URL ||
  'http://localhost:4001';

function partyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  return fetch(`${PARTY_URL}${path}`, options).then(async (res) => {
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) ||
        `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data as T;
  });
}

export interface CreatePartyRoomPayload {
  hostId: string;
  hostName: string;
  kind?: 'existing' | 'uploaded';
  movieId?: string;
  movieTitle?: string;
  assetId?: string;
  assetMime?: string;
  /** Music-only room: the song everyone listens to together. */
  songId?: string;
  songTitle?: string;
  /** Stable id of the creating account — enables the creator-only room history / delete. */
  ownerId?: string;
}

export function createServerRoom(payload: CreatePartyRoomPayload) {
  return partyFetch<{ roomCode: string; roomId: string }>('/api/party/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export interface RoomCheckResult {
  exists: boolean;
  kind?: string;
  active?: boolean;
  movieId?: string | null;
  movieTitle?: string | null;
}

export function checkServerRoom(roomCode: string): Promise<RoomCheckResult> {
  return partyFetch<RoomCheckResult>(`/api/party/rooms/${encodeURIComponent(roomCode)}`).catch(
    () => ({ exists: false }) as RoomCheckResult
  );
}

export interface UploadAssetResult {
  assetId: string;
  mime: string;
  size: number;
}

/** Uploads a movie/song blob so any device can stream it — not just the uploader's browser. */
export interface AssetMeta {
  kind: 'movie' | 'song';
  title: string;
  uploaderId: string;
  uploaderName: string;
  duration: number;
}

export function uploadAsset(
  file: Blob,
  fileName: string,
  onProgress?: (fraction: number) => void,
  meta?: AssetMeta,
  signal?: AbortSignal
): Promise<UploadAssetResult> {
  const buildForm = () => {
    const form = new FormData();
    // Text fields first so the server has them when the file arrives.
    if (meta) {
      form.append('kind', meta.kind);
      form.append('title', meta.title);
      form.append('uploaderId', meta.uploaderId);
      form.append('uploaderName', meta.uploaderName);
      form.append('duration', String(meta.duration || 0));
    }
    form.append('file', file, fileName);
    return form;
  };

  // One attempt. `retryable` marks failures worth retrying (network drop, or a sleeping/overloaded
  // free-tier server answering 502/503/504); cancelling or a real rejection is never retried.
  const attempt = () =>
  new Promise<UploadAssetResult>((resolve, reject) => {
    const cancelled = () => Object.assign(new Error('Upload cancelled.'), { name: 'AbortError' });
    if (signal?.aborted) return reject(cancelled());
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PARTY_URL}/api/party/assets`);
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) onProgress(event.loaded / event.total);
    };
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);
    xhr.onabort = () => {
      done();
      reject(cancelled());
    };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Upload succeeded but the response could not be read.'));
        }
      } else {
        const err = new Error(`Upload failed (${xhr.status}). The file may be too large.`) as Error & { retryable?: boolean };
        err.retryable = [502, 503, 504].includes(xhr.status);
        reject(err);
      }
    };
    xhr.onerror = () => {
      done();
      const err = new Error('Upload failed — check your connection and try again.') as Error & { retryable?: boolean };
      err.retryable = true;
      reject(err);
    };
    xhr.send(buildForm());
  });

  return attempt().catch(async (err: Error & { retryable?: boolean }) => {
    if (!err.retryable || signal?.aborted) throw err;
    onProgress?.(0);
    await new Promise((r) => setTimeout(r, 2500)); // give a waking server a moment
    return attempt();
  });
}

export function assetStreamUrl(assetId: string): string {
  return `${PARTY_URL}/api/party/assets/${encodeURIComponent(assetId)}/stream`;
}

/** Stable per-browser-tab-session identity for members of an "existing movie" room overlay,
 *  which — unlike the uploaded-room system — has no authenticated numeric user id available
 *  from the real backend (see hooks/useWatchParty.ts, which only ever sends usernames). */
export function getOverlayClientId(): string {
  const KEY = 'tamilflix_overlay_client_id';
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c-${Date.now()}-${Math.random()}`;
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `c-${Date.now()}-${Math.random()}`;
  }
}

export interface LibraryItem {
  assetId: string;
  kind: 'movie' | 'song';
  title: string;
  fileName: string;
  mime: string;
  size: number;
  duration: number;
  uploaderId: string;
  uploaderName: string;
  createdAt: number;
}

/** Everything uploaded to the shared library (visible to every user, not only the uploader). */
export function listLibrary(kind: 'movie' | 'song'): Promise<LibraryItem[]> {
  return partyFetch<LibraryItem[]>(`/api/party/library?kind=${kind}`).catch(() => []);
}

/** Like listLibrary but null when the server could not be reached (so callers can tell "empty" from "down"). */
export function listLibraryOrNull(kind: 'movie' | 'song', uploaderId?: string): Promise<LibraryItem[] | null> {
  const q = uploaderId ? `&uploaderId=${encodeURIComponent(uploaderId)}` : '';
  return partyFetch<LibraryItem[]>(`/api/party/library?kind=${kind}${q}`).catch(() => null);
}

export function deleteAsset(assetId: string, uploaderId: string) {
  return partyFetch<{ ok: boolean }>(
    `/api/party/assets/${encodeURIComponent(assetId)}?uploaderId=${encodeURIComponent(uploaderId)}`,
    { method: 'DELETE' }
  );
}

export interface MyRoom {
  roomCode: string;
  kind: 'uploaded' | 'existing';
  movieId: string | null;
  hasMovie: boolean;
  title: string;
  createdAt: number;
  members: number;
}

/** Rooms this account created (the creator's private history). */
export function listMyRooms(ownerId: string): Promise<MyRoom[]> {
  return partyFetch<MyRoom[]>(`/api/party/my-rooms?ownerId=${encodeURIComponent(ownerId)}`).catch(() => []);
}

export function deleteRoom(roomCode: string, ownerId: string) {
  return partyFetch<{ ok: boolean }>(
    `/api/party/rooms/${encodeURIComponent(roomCode)}?ownerId=${encodeURIComponent(ownerId)}`,
    { method: 'DELETE' }
  );
}
