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
export function uploadAsset(
  file: Blob,
  fileName: string,
  onProgress?: (fraction: number) => void
): Promise<UploadAssetResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file, fileName);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${PARTY_URL}/api/party/assets`);
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Upload succeeded but the response could not be read.'));
        }
      } else {
        reject(new Error(`Upload failed (${xhr.status}). The file may be too large.`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection and try again.'));
    xhr.send(form);
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
