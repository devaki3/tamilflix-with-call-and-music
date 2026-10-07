import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PartyChatMessage, UploadedPartyRoom } from '../types/movie';
import {
  PartyConnection,
  currentMusicPosition,
  currentPlaybackPosition,
  type PartyAction } from
'../utils/uploadedWatchParty';
import type { CallBridge } from './useRoomCall';

export interface UploadedSyncSignal {
  action: PartyAction;
  currentTime: number;
  isPlaying: boolean;
  nonce: number;
}

type CallMessageHandler = (
kind: string,
payload: unknown,
senderId: string,
senderName?: string)
=> void;

interface State {
  room: UploadedPartyRoom | null;
  connected: boolean;
  messages: PartyChatMessage[];
  lastSync: UploadedSyncSignal | null;
  lastMusicSync: UploadedSyncSignal | null;
  removedReason: string | null;
  endedReason: string | null;
  error: string | null;
}

/**
 * Watch-party client for uploaded movies, songs, and call signaling — all
 * riding the ONE room connection (PartyConnection). See
 * utils/uploadedWatchParty.ts for the room-authority architecture. Mirrors
 * the shape of hooks/useWatchParty.ts so the two systems feel consistent,
 * without touching that existing hook.
 */
export interface CreateOnJoin {
  movieId?: string;
  movieTitle?: string;
  assetId?: string;
  assetMime?: string;
}

export function useUploadedWatchParty(
roomCode: string | undefined,
userId: string | undefined,
username: string,
/** Only needed as a self-heal path — the normal flow creates the room via
 *  partyApi.createServerRoom() before ever navigating to this hook. */
createOnJoin?: CreateOnJoin)
{
  const connRef = useRef<PartyConnection | null>(null);
  const nonce = useRef(0);
  const musicNonce = useRef(0);
  const callHandlersRef = useRef<Set<CallMessageHandler>>(new Set());
  const [state, setState] = useState<State>({
    room: null,
    connected: false,
    messages: [],
    lastSync: null,
    lastMusicSync: null,
    removedReason: null,
    endedReason: null,
    error: null
  });

  useEffect(() => {
    if (!roomCode || !userId) return;

    const conn = new PartyConnection(roomCode, userId, username, {
      onRoom: (r) => {
        musicNonce.current += 1;
        setState((prev) => {
          // First snapshot after (re)joining: adopt the room's current play state so a late
          // joiner / rejoiner starts playing at the live position if the host is mid-movie.
          let initialSync = prev.lastSync;
          if (!prev.room && !prev.lastSync) {
            nonce.current += 1;
            initialSync = {
              action: r.playback.isPlaying ? 'play' : 'pause',
              currentTime: currentPlaybackPosition(r),
              isPlaying: r.playback.isPlaying,
              nonce: nonce.current
            };
          }
          return {
          ...prev,
          lastSync: initialSync,
          room: r,
          error: null,
          lastMusicSync: {
            action: r.music.isPlaying ? 'play' : 'pause',
            currentTime: r.music.currentTime,
            isPlaying: r.music.isPlaying,
            nonce: musicNonce.current
          }
        };
        });
      },
      onChat: (m) =>
      setState((prev) =>
      m.id && prev.messages.some((x) => x.id === m.id) ?
      prev :
      { ...prev, messages: [...prev.messages.slice(-199), m] }),
      onChatHistory: (history) =>
      setState((prev) => ({ ...prev, messages: history.slice(-200) })),
      onSync: (action, currentTime, isPlaying) => {
        nonce.current += 1;
        setState((prev) => ({
          ...prev,
          lastSync: { action, currentTime, isPlaying, nonce: nonce.current }
        }));
      },
      onMusicSync: (action, currentTime, isPlaying) => {
        musicNonce.current += 1;
        setState((prev) => ({
          ...prev,
          lastMusicSync: { action, currentTime, isPlaying, nonce: musicNonce.current }
        }));
      },
      onRemoved: (reason) => setState((prev) => ({ ...prev, removedReason: reason })),
      onRoomEnded: (reason) => setState((prev) => ({ ...prev, endedReason: reason })),
      onError: (message) => setState((prev) => ({ ...prev, error: message })),
      onConnectionChange: (connected) => setState((prev) => ({ ...prev, connected })),
      onCallMessage: (kind, payload, senderId, senderName) => {
        callHandlersRef.current.forEach((handler) => handler(kind, payload, senderId, senderName));
      }
    });
    connRef.current = conn;
    conn.join(createOnJoin);
    conn.requestSync();

    // Tab close / refresh / navigating away: unmount cleanup doesn't reliably run, so tell the
    // server explicitly (it also falls back to disconnect handling).
    const onPageHide = () => conn.leave(true);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      conn.leave(true);
      connRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, userId]);

  const sendMessage = useCallback((message: string) => {
    connRef.current?.sendChat(message);
  }, []);

  const control = useCallback((action: PartyAction, currentTime: number) => {
    connRef.current?.control(action, currentTime);
  }, []);

  const controlMusic = useCallback((action: PartyAction, currentTime: number) => {
    connRef.current?.controlMusic(action, currentTime);
  }, []);

  const changeSong = useCallback((songId: string, songTitle?: string) => {
    connRef.current?.changeSong(songId, songTitle);
  }, []);

  const transferHost = useCallback((newHostId: string) => {
    connRef.current?.transferHost(newHostId);
  }, []);

  const removeMember = useCallback((memberId: string) => {
    connRef.current?.removeMember(memberId);
  }, []);

  const endRoom = useCallback(() => {
    connRef.current?.endRoom();
  }, []);

  // Stable bridge object (identity never changes) so useRoomCall's effects don't re-subscribe
  // on every render — it always reaches the *current* PartyConnection via the refs above.
  const callBridge = useMemo<CallBridge>(
    () => ({
      send: (kind, payload) => connRef.current?.sendCallMessage(kind, payload),
      subscribe: (handler) => {
        callHandlersRef.current.add(handler);
        return () => callHandlersRef.current.delete(handler);
      }
    }),
    []
  );

  const isHost = Boolean(state.room && userId && state.room.hostId === userId);
  const initialPosition = useMemo(
    () => state.room ? currentPlaybackPosition(state.room) : 0,
    // Only compute once per room identity change (used for late-join sync); the
    // live `lastSync` stream drives ongoing updates after that.
    [state.room?.roomId]
  );
  const initialMusicPosition = useMemo(
    () => state.room ? currentMusicPosition(state.room) : 0,
    [state.room?.roomId]
  );

  return {
    ...state,
    isHost,
    initialPosition,
    initialMusicPosition,
    callBridge,
    sendMessage,
    control,
    controlMusic,
    changeSong,
    transferHost,
    removeMember,
    endRoom
  };
}
