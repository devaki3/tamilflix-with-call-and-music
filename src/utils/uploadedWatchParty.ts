import { io, type Socket } from 'socket.io-client';
import type { MusicPlaybackState, PartyChatMessage, PartyPlaybackState, UploadedPartyRoom } from '../types/movie';
import { PARTY_URL } from './partyApi';

/**
 * Room engine for "Local Movie Upload" watch parties.
 *
 * This used to run entirely in the browser (localStorage + BroadcastChannel),
 * which only ever worked between tabs of the SAME browser on the SAME
 * device — the root cause of "room not found" when a friend joined from
 * another browser/device. It now talks to the real Party Service (see
 * /server) over Socket.IO, so room state, host authority and playback sync
 * are maintained server-side and reachable from anywhere.
 *
 * The public shape of this module (PartyConnection's methods, PartyCallbacks,
 * currentPlaybackPosition/currentMusicPosition) is unchanged on purpose —
 * useUploadedWatchParty.ts and everything above it needed no rework.
 */

export type PartyAction = 'play' | 'pause' | 'seek';

function withDefaults(room: UploadedPartyRoom): UploadedPartyRoom {
  return {
    ...room,
    music: room.music ?? { songId: null, songTitle: null, isPlaying: false, currentTime: 0, updatedAt: Date.now() }
  };
}

/** Live-extrapolated position, the way a joining/reconnecting member should seek to. */
export function currentPlaybackPosition(room: UploadedPartyRoom): number {
  return extrapolate(room.playback);
}

/** Same extrapolation, for the room's shared music player. */
export function currentMusicPosition(room: UploadedPartyRoom): number {
  return extrapolate(withDefaults(room).music);
}

function extrapolate(state: PartyPlaybackState | MusicPlaybackState): number {
  if (!state.isPlaying) return state.currentTime;
  const elapsed = (Date.now() - state.updatedAt) / 1000;
  return Math.max(0, state.currentTime + elapsed);
}

export interface PartyCallbacks {
  onRoom: (room: UploadedPartyRoom) => void;
  onChat: (message: PartyChatMessage) => void;
  onSync: (action: PartyAction, time: number, isPlaying: boolean) => void;
  onMusicSync?: (action: PartyAction, time: number, isPlaying: boolean) => void;
  onRemoved: (reason: string) => void;
  onRoomEnded: (reason: string) => void;
  onError: (message: string) => void;
  onCallMessage?: (kind: string, payload: unknown, senderId: string, senderName?: string) => void;
  onConnectionChange?: (connected: boolean) => void;
}

const CALL_EVENTS = ['party:call-join', 'party:call-leave', 'party:call-signal', 'party:call-status', 'party:call-roster-request'] as const;

/**
 * One Socket.IO connection to a room, for the local session (userId/username).
 * The Party Service is authoritative for room state, host transfer and
 * playback sync — this class is a thin, typed wrapper around its events.
 */
export class PartyConnection {
  private socket: Socket | null = null;
  private closed = false;

  constructor(
    private roomCode: string,
    private userId: string,
    private username: string,
    private callbacks: PartyCallbacks
  ) {}

  /** Joins the room. Pass `create` only when this session is establishing a brand-new
   *  room (the normal flow now creates the room via REST — see utils/partyApi.ts —
   *  before navigating here, so `create` is rarely needed, but stays supported so a
   *  host who lands here first can still self-heal a not-yet-created room). */
  join(create?: { movieId?: string; movieTitle?: string; assetId?: string; assetMime?: string }): void {
    const socket = io(PARTY_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 8000
    });
    this.socket = socket;

    socket.on('connect', () => {
      this.callbacks.onConnectionChange?.(true);
      socket.emit(
        'party:join',
        { roomCode: this.roomCode, userId: this.userId, username: this.username, kind: 'uploaded', create },
        (ack: { ok: boolean; room?: UploadedPartyRoom }) => {
          if (ack?.ok && ack.room) this.callbacks.onRoom(withDefaults(ack.room));
        }
      );
    });

    socket.on('disconnect', () => this.callbacks.onConnectionChange?.(false));
    socket.on('connect_error', () => {
      this.callbacks.onConnectionChange?.(false);
      this.callbacks.onError('Could not reach the watch party server. Retrying…');
    });

    socket.on('party:state', (room: UploadedPartyRoom) => this.callbacks.onRoom(withDefaults(room)));
    socket.on('party:chat', (message: PartyChatMessage) => this.callbacks.onChat(message));
    socket.on('party:sync', (payload: { action: PartyAction; currentTime: number; isPlaying: boolean }) =>
      this.callbacks.onSync(payload.action, payload.currentTime, payload.isPlaying)
    );
    socket.on('party:music-sync', (payload: { action: PartyAction; currentTime: number; isPlaying: boolean }) =>
      this.callbacks.onMusicSync?.(payload.action, payload.currentTime, payload.isPlaying)
    );
    socket.on('party:removed', (payload: { memberId: string; reason: string }) => {
      if (payload.memberId === this.userId) this.callbacks.onRemoved(payload.reason);
    });
    socket.on('party:ended', (payload: { reason?: string }) =>
      this.callbacks.onRoomEnded(payload?.reason || 'The host ended this room.')
    );
    socket.on('party:error', (payload: { message?: string }) => this.callbacks.onError(payload?.message || 'Room error'));

    for (const event of CALL_EVENTS) {
      socket.on(event, (payload: { senderId: string; senderName?: string; [key: string]: unknown }) => {
        this.callbacks.onCallMessage?.(event.replace('party:', ''), payload, payload.senderId, payload.senderName);
      });
    }
  }

  sendChat(message: string): void {
    const trimmed = message.trim();
    if (!trimmed || !this.socket) return;
    this.socket.emit('party:chat', { message: trimmed });
  }

  /** Play/pause/seek. Server enforces host-only — a non-host emit is a safe no-op there. */
  control(action: PartyAction, currentTime: number): void {
    this.socket?.emit('party:control', { action, currentTime });
  }

  controlMusic(action: PartyAction, currentTime: number): void {
    this.socket?.emit('party:music-control', { action, currentTime });
  }

  changeSong(songId: string, songTitle?: string): void {
    this.socket?.emit('party:change-song', { songId, songTitle });
  }

  sendCallMessage(
    kind: 'call-join' | 'call-leave' | 'call-signal' | 'call-status' | 'call-roster-request',
    payload: unknown
  ): void {
    this.socket?.emit(`party:${kind}`, payload as Record<string, unknown>);
  }

  transferHost(newHostId: string): void {
    this.socket?.emit('party:transfer-host', { newHostId });
  }

  removeMember(memberId: string): void {
    this.socket?.emit('party:remove-member', { memberId });
  }

  endRoom(): void {
    this.socket?.emit('party:end-room');
  }

  requestSync(): void {
    this.socket?.emit('party:request-sync');
  }

  leave(notify = true): void {
    if (this.closed) return;
    this.closed = true;
    if (notify) this.socket?.emit('party:leave');
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }
}
