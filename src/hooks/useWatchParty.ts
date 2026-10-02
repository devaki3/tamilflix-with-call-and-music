import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { PARTY_URL } from '../utils/partyApi';
import type { ChatMessage, PartyMember } from '../types/movie';
import type { CallBridge } from './useRoomCall';

export type VideoAction = 'play' | 'pause' | 'seek';

export interface SyncSignal {
  action: VideoAction;
  currentTime: number;
  isPlaying?: boolean;
  nonce: number;
}

interface WatchPartyState {
  connected: boolean;
  isHost: boolean;
  hostId: string | null;
  members: string[];
  memberList: PartyMember[];
  hostUsername: string | null;
  movieId: string | null;
  messages: ChatMessage[];
  lastSync: SyncSignal | null;
  closedReason: string | null;
  error: string | null;
}

/**
 * Watch Together room engine. This previously connected straight to a
 * separate, external Node/Socket.IO backend (BACKEND_URL) whose actual
 * uptime and event contract couldn't be verified or fixed here — which is
 * why creating a room could silently fall back to a fake local-only code
 * (see the old utils/api.ts createRoom) while joining that same code from
 * another device failed outright with no fallback at all.
 *
 * It now runs on the same Party Service used for uploaded-movie rooms
 * (server/), which is verified working end-to-end (see server/index.mjs and
 * its test suite). Room creation happens via partyApi.createServerRoom()
 * BEFORE navigating here (see WatchTogether.tsx) — this hook only joins.
 * Host identity is the real account id (userId), so it's stable across
 * devices for the same account, not just a per-tab id.
 */
export function useWatchParty(roomCode: string | undefined, userId: string | undefined, username: string) {
  const socketRef = useRef<Socket | null>(null);
  const nonce = useRef(0);
  const callHandlersRef = useRef<Set<(kind: string, payload: unknown, senderId: string, senderName?: string) => void>>(
    new Set()
  );
  const [state, setState] = useState<WatchPartyState>({
    connected: false,
    isHost: false,
    hostId: null,
    members: [],
    memberList: [],
    hostUsername: null,
    movieId: null,
    messages: [],
    lastSync: null,
    closedReason: null,
    error: null
  });

  useEffect(() => {
    if (!roomCode || !userId) return;

    const socket = io(PARTY_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 8000
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setState((prev) => ({ ...prev, connected: true, error: null }));
      socket.emit('party:join', { roomCode, userId, username, kind: 'existing' });
    });

    socket.on('disconnect', () => setState((prev) => ({ ...prev, connected: false })));
    socket.on('connect_error', () => {
      setState((prev) => ({
        ...prev,
        connected: false,
        error: 'Could not reach the watch party server. Retrying…'
      }));
    });

    socket.on(
      'party:state',
      (room: { hostId: string; members: PartyMember[]; movieId: string | null }) => {
        const hostMember = room.members.find((m) => m.userId === room.hostId);
        setState((prev) => ({
          ...prev,
          hostId: room.hostId,
          isHost: room.hostId === userId,
          members: room.members.map((m) => m.username),
          memberList: room.members,
          hostUsername: hostMember?.username ?? prev.hostUsername,
          movieId: room.movieId ?? prev.movieId,
          error: null
        }));
      }
    );

    socket.on('party:chat', (payload: ChatMessage) => {
      setState((prev) => ({ ...prev, messages: [...prev.messages.slice(-199), payload] }));
    });

    socket.on(
      'party:sync',
      (payload: { action: VideoAction; currentTime: number; isPlaying?: boolean }) => {
        nonce.current += 1;
        setState((prev) => ({
          ...prev,
          lastSync: {
            action: payload.action,
            currentTime: payload.currentTime ?? 0,
            isPlaying: payload.isPlaying,
            nonce: nonce.current
          }
        }));
      }
    );

    socket.on('party:ended', (payload: { reason?: string }) => {
      setState((prev) => ({ ...prev, closedReason: payload?.reason || 'The host ended this room.' }));
    });

    socket.on('party:error', (payload: { message?: string }) => {
      setState((prev) => ({ ...prev, error: payload?.message || 'Room error' }));
    });

    for (const event of ['party:call-join', 'party:call-leave', 'party:call-signal', 'party:call-status', 'party:call-roster-request']) {
      socket.on(event, (payload: { senderId: string; senderName?: string; [key: string]: unknown }) => {
        callHandlersRef.current.forEach((handler) =>
          handler(event.replace('party:', ''), payload, payload.senderId, payload.senderName)
        );
      });
    }

    const onPageHide = () => {
      socket.emit('party:leave');
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      socket.emit('party:leave');
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, userId, username]);

  const sendMessage = useCallback((message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    socketRef.current?.emit('party:chat', { message: trimmed });
  }, []);

  const control = useCallback((action: VideoAction, currentTime: number) => {
    socketRef.current?.emit('party:control', { action, currentTime });
  }, []);

  const closeRoom = useCallback(() => {
    socketRef.current?.emit('party:end-room');
  }, []);

  const transferHost = useCallback((newHostId: string) => {
    socketRef.current?.emit('party:transfer-host', { newHostId });
  }, []);

  const removeMember = useCallback((memberId: string) => {
    socketRef.current?.emit('party:remove-member', { memberId });
  }, []);

  const callBridge = useMemo<CallBridge>(
    () => ({
      send: (kind, payload) => socketRef.current?.emit(`party:${kind}`, payload as Record<string, unknown>),
      subscribe: (handler) => {
        callHandlersRef.current.add(handler);
        return () => callHandlersRef.current.delete(handler);
      }
    }),
    []
  );

  return useMemo(
    () => ({ ...state, sendMessage, control, closeRoom, transferHost, removeMember, callBridge }),
    [state, sendMessage, control, closeRoom, transferHost, removeMember, callBridge]
  );
}
