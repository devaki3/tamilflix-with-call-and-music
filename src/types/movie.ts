export interface Movie {
  id: number;
  title: string;
  year: number;
  genre: string[];
  mood: string[];
  pace: string;
  hero_type: string;
  ending: string;
  description: string;
  poster: string;
  trailer: string;
  rating: number;
  director: string;
  cast: string[];
  tags: string[];
}

export interface ScoredMovie extends Movie {
  score: number;
}

export interface User {
  id: number | string;
  name: string;
  email: string;
}

export interface QuizAnswers {
  mood?: string;
  storyType?: string;
  preference?: string;
  pace?: string;
  ending?: string;
  heroType?: string;
  tone?: string;
  watchTime?: string;
}

export interface QuizOption {
  value: string;
  emoji: string;
  text: string;
  desc: string;
}

export interface QuizQuestion {
  key: keyof QuizAnswers;
  question: string;
  options: QuizOption[];
}

export interface ChatMessage {
  id?: string;
  type: 'system' | 'user';
  username?: string;
  message: string;
  timestamp?: string | number;
}

export interface RoomJoinResult {
  roomCode: string;
  roomId?: number;
  movie?: Movie | null;
  members?: string[];
  isHost?: boolean;
  local?: boolean;
}

/* ------------------------- local movie upload feature ------------------------ */

/** Metadata for a movie file the user uploaded from their own computer. */
export interface UploadedMovie {
  id: string;
  title: string;
  fileName: string;
  /** Key used to look the file blob up in IndexedDB. */
  storageRef: string;
  uploaderId: string;
  uploaderName: string;
  fileSize: number;
  /** Duration in seconds, 0 if it could not be read. */
  duration: number;
  mimeType: string;
  /** ISO timestamp. */
  uploadDate: string;
  /** Server asset id once uploaded to the shared library (streams on any device). */
  assetId?: string;
  /** Id of the uploader inside party rooms (used to decide who may delete shared items). */
  partyOwnerId?: string;
}

export type PartyRole = 'HOST' | 'MEMBER';

export interface PartyMember {
  userId: string;
  username: string;
  joinedAt: number;
  role: PartyRole;
  /** Server-tracked live socket connection status — false during a brief
   *  reconnect grace window, not an immediate removal. */
  connected?: boolean;
}

export interface PartyPlaybackState {
  isPlaying: boolean;
  currentTime: number;
  /** Server-clock (Date.now()) timestamp this state was last set at, used to
   *  extrapolate the live position for anyone who reads it later. */
  updatedAt: number;
}

/** Server-side-style room record for an uploaded-movie watch party. */
export interface UploadedPartyRoom {
  roomId: string;
  roomCode: string;
  /** Local IndexedDB id of the movie on the ORIGINAL uploader's device (kept for
   *  backward-compat/display only — playback now streams from `assetId`). */
  movieId: string | null;
  movieTitle?: string | null;
  /** Party Service asset id — the movie is streamed from the server from this id,
   *  so any device in the room can watch it, not just the uploader's browser. */
  assetId?: string | null;
  assetMime?: string | null;
  hostId: string;
  members: PartyMember[];
  createdBy: string;
  createdAt: number;
  playback: PartyPlaybackState;
  /** Host-controlled synchronized local-music state, independent of movie playback. */
  music: MusicPlaybackState;
  active: boolean;
  /** Incremented on every host change; guards against stale/duplicate host claims. */
  term: number;
}

/** Synchronized state for the room's shared local-music player (Feature: Local Songs). */
export interface MusicPlaybackState {
  /** Party Service asset id once the song has been uploaded for this room. */
  songId: string | null;
  songTitle?: string | null;
  isPlaying: boolean;
  currentTime: number;
  updatedAt: number;
}

/** Metadata for an audio file the user uploaded from their own computer. */
export interface UploadedSong {
  id: string;
  title: string;
  fileName: string;
  /** Key used to look the file blob up in IndexedDB. */
  storageRef: string;
  uploaderId: string;
  uploaderName: string;
  fileSize: number;
  /** Duration in seconds, 0 if it could not be read. */
  duration: number;
  mimeType: string;
  /** ISO timestamp. */
  uploadDate: string;
  /** Server asset id once uploaded to the shared library (streams on any device). */
  assetId?: string;
  /** Id of the uploader inside party rooms (used to decide who may delete shared items). */
  partyOwnerId?: string;
}

/** Live status of one member inside the room's voice/video call, for the participant view. */
export interface CallParticipantStatus {
  userId: string;
  username: string;
  muted: boolean;
  cameraOff: boolean;
  /** Whether they joined with their camera available at all (audio-only vs video). */
  hasVideo: boolean;
}

export interface PartyChatMessage {
  id?: string;
  type: 'system' | 'user';
  username?: string;
  message: string;
  timestamp: number;
}