/**
 * Tamilflix Party Service
 * ------------------------------------------------------------------
 * ADDITIVE backend. This does NOT replace or touch the existing
 * auth/movies/rooms API (BACKEND_URL in src/utils/api.ts, deployed
 * separately). This service only exists to make three specific things
 * real, server-side, for BOTH watch-party room types:
 *
 *   1. Room state + host authority (create/join/roster/host-transfer/
 *      auto-transfer-on-disconnect), reachable from any browser/device.
 *   2. WebRTC call signaling relay (offer/answer/ICE/join/leave/status).
 *   3. Uploaded video/audio storage + HTTP range streaming, so a movie
 *      or song someone uploads can actually be watched/heard by a
 *      friend on a different device (previously the file only ever
 *      lived in the uploader's own browser's IndexedDB).
 *
 * Two room "kinds" share one engine:
 *   - "uploaded": the full room (playback, music, chat, roster, host).
 *     Used by UploadedWatchParty.tsx / useUploadedWatchParty.ts.
 *   - "existing": a lightweight overlay (roster, host, calls only) that
 *     rides ALONGSIDE the existing real-movie room's own Socket.IO
 *     connection (useWatchParty.ts, untouched) purely to add host
 *     transfer + voice/video calling to it, keyed by the same room code.
 *
 * Persistence: an in-memory store, snapshotted to a local JSON file so
 * room state survives a process restart. See the deployment notes in
 * README.md for why a Render free/hobby instance needs a persistent
 * disk (or swapping this for real object storage) for that to hold
 * across redeploys.
 */

import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import cors from 'cors';
import multer from 'multer';
import { Server as SocketIOServer } from 'socket.io';

/* --------------------------------------------------------------------- */
/*  Config                                                                */
/* --------------------------------------------------------------------- */

const PORT = Number(process.env.PORT) || 4001;
const CORS_ORIGIN = process.env.PARTY_CORS_ORIGIN
  ? process.env.PARTY_CORS_ORIGIN.split(',').map((s) => s.trim())
  : '*';
const DATA_DIR = process.env.PARTY_DATA_DIR || path.join(process.cwd(), 'data');
const UPLOAD_DIR = process.env.PARTY_UPLOAD_DIR || path.join(process.cwd(), 'uploads');
const MAX_UPLOAD_MB = Number(process.env.PARTY_MAX_UPLOAD_MB) || 800;
const ROOM_TTL_MS = (Number(process.env.PARTY_ROOM_TTL_HOURS) || 12) * 60 * 60 * 1000;
// How long we wait after a socket disconnects before treating it as a real
// leave (auto host-transfer / roster removal). Keeps a brief phone-lock or
// wifi blip from ending the room or kicking someone out. Item #12.
const DISCONNECT_GRACE_MS = Number(process.env.PARTY_DISCONNECT_GRACE_MS) || 5000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const ASSETS_FILE = path.join(DATA_DIR, 'assets.json');

/* --------------------------------------------------------------------- */
/*  Persistence (simple JSON snapshot, debounced)                        */
/* --------------------------------------------------------------------- */

function loadJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** roomCode -> Room */
const rooms = new Map(Object.entries(loadJson(ROOMS_FILE, {})));
/** assetId -> { id, mime, size, originalName, ext, createdAt } */
const assets = new Map(Object.entries(loadJson(ASSETS_FILE, {})));

let roomsDirty = false;
let assetsDirty = false;

function persistRoomsToDisk() {
  if (!roomsDirty) return;
  roomsDirty = false;
  const plain = Object.fromEntries(
    [...rooms.entries()].map(([code, room]) => [
      code,
      {
        ...room,
        // socketId / disconnect timers are runtime-only, never persisted
        members: room.members.map(({ socketId, graceTimer, ...m }) => m)
      }
    ])
  );
  fsp.writeFile(ROOMS_FILE, JSON.stringify(plain)).catch(() => {});
}

function persistAssetsToDisk() {
  if (!assetsDirty) return;
  assetsDirty = false;
  const plain = Object.fromEntries(assets.entries());
  fsp.writeFile(ASSETS_FILE, JSON.stringify(plain)).catch(() => {});
}

setInterval(() => {
  persistRoomsToDisk();
  persistAssetsToDisk();
}, 3000).unref();

// Purge stale/inactive rooms and orphaned per-member grace timers.
setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if (!room.active || room.createdAt < cutoff) {
      for (const m of room.members) {
        if (m.graceTimer) clearTimeout(m.graceTimer);
      }
      rooms.delete(code);
      roomsDirty = true;
    }
  }
}, 60000).unref();

/* --------------------------------------------------------------------- */
/*  Room helpers                                                         */
/* --------------------------------------------------------------------- */

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function newRoomId() {
  return crypto.randomUUID();
}

function makeRoom({ roomCode, kind, hostId, hostName, movieId, movieTitle, assetId, assetMime }) {
  const now = Date.now();
  const room = {
    roomId: newRoomId(),
    roomCode,
    kind, // 'uploaded' | 'existing'
    hostId,
    members: [
      { userId: hostId, username: hostName, joinedAt: now, role: 'HOST', connected: true, socketId: null }
    ],
    createdBy: hostId,
    createdAt: now,
    movieId: movieId || null,
    movieTitle: movieTitle || null,
    assetId: assetId || null,
    assetMime: assetMime || null,
    playback: { isPlaying: false, currentTime: 0, updatedAt: now },
    music: { songId: null, songTitle: null, isPlaying: false, currentTime: 0, updatedAt: now },
    active: true,
    term: 1
  };
  rooms.set(roomCode, room);
  roomsDirty = true;
  return room;
}

function currentPlaybackPosition(state) {
  if (!state.isPlaying) return state.currentTime;
  const elapsed = (Date.now() - state.updatedAt) / 1000;
  return Math.max(0, state.currentTime + elapsed);
}

/** Snapshot sent to clients — strips server-only runtime fields. */
function roomSnapshot(room) {
  return {
    roomId: room.roomId,
    roomCode: room.roomCode,
    kind: room.kind,
    hostId: room.hostId,
    members: room.members.map((m) => ({
      userId: m.userId,
      username: m.username,
      joinedAt: m.joinedAt,
      role: m.role,
      connected: m.connected
    })),
    createdBy: room.createdBy,
    createdAt: room.createdAt,
    movieId: room.movieId,
    movieTitle: room.movieTitle,
    assetId: room.assetId,
    assetMime: room.assetMime,
    playback: { ...room.playback, livePosition: currentPlaybackPosition(room.playback) },
    music: { ...room.music, livePosition: currentPlaybackPosition(room.music) },
    active: room.active,
    term: room.term
  };
}

function roomKey(code) {
  return `party:${code}`;
}

function touch(room) {
  roomsDirty = true;
}

/* --------------------------------------------------------------------- */
/*  Asset storage (uploaded video/audio) with HTTP range streaming       */
/* --------------------------------------------------------------------- */

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const id = crypto.randomUUID();
      const ext = path.extname(file.originalname || '') || '';
      cb(null, `${id}${ext}`);
    }
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

/* --------------------------------------------------------------------- */
/*  Express app                                                          */
/* --------------------------------------------------------------------- */

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());


// ---- ICE servers (STUN + TURN) for WebRTC calls --------------------------------------------------
// Calls between different networks (mobile data, campus/office Wi-Fi, CGNAT) need a TURN relay.
// Configure ONE of these on the server (Render env vars):
//   METERED_APP_NAME + METERED_API_KEY   (free account at metered.ca -> fetched dynamically)
//   TURN_URLS (comma list) + TURN_USERNAME + TURN_CREDENTIAL   (any static TURN, e.g. ExpressTURN/coturn)
let iceCache = { at: 0, value: null };
app.get('/api/party/ice-servers', async (req, res) => {
  const stun = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };
  try {
    if (iceCache.value && Date.now() - iceCache.at < 10 * 60 * 1000) return res.json(iceCache.value);
    let result = { iceServers: [stun], turn: false };
    const app_ = process.env.METERED_APP_NAME;
    const key = process.env.METERED_API_KEY;
    if (app_ && key) {
      const r = await fetch(`https://${app_}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
      if (r.ok) {
        const list = await r.json();
        if (Array.isArray(list) && list.length) result = { iceServers: [stun, ...list], turn: true };
      } else {
        console.warn('[ice] Metered credentials request failed:', r.status);
      }
    } else if (process.env.TURN_URLS) {
      result = {
        iceServers: [stun, {
          urls: process.env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean),
          username: process.env.TURN_USERNAME,
          credential: process.env.TURN_CREDENTIAL
        }],
        turn: true
      };
    }
    if (result.turn) iceCache = { at: Date.now(), value: result };
    res.json(result);
  } catch (err) {
    console.warn('[ice] failed:', err?.message);
    res.json({ iceServers: [stun], turn: false });
  }
});

app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: rooms.size, assets: assets.size, uptime: process.uptime() });
});

/** Upload a video/audio asset. Returns an assetId any device can stream from. */
app.post('/api/party/assets', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const id = path.basename(req.file.filename, path.extname(req.file.filename));
  const record = {
    id,
    mime: req.file.mimetype || 'application/octet-stream',
    size: req.file.size,
    originalName: req.file.originalname,
    filename: req.file.filename,
    createdAt: Date.now()
  };
  assets.set(id, record);
  assetsDirty = true;
  res.json({ assetId: id, mime: record.mime, size: record.size });
});

/** Range-enabled streaming so <video>/<audio> elements can seek. */
app.get('/api/party/assets/:id/stream', (req, res) => {
  const asset = assets.get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  const filePath = path.join(UPLOAD_DIR, asset.filename);
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return res.status(404).json({ error: 'Asset file missing on server.' });
  }
  const range = req.headers.range;
  res.setHeader('Content-Type', asset.mime);
  res.setHeader('Accept-Ranges', 'bytes');
  if (!range) {
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match && match[1] ? parseInt(match[1], 10) : 0;
  const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
  const chunkEnd = Math.min(end, stat.size - 1);
  if (start >= stat.size || start > chunkEnd) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${chunkEnd}/${stat.size}`);
  res.setHeader('Content-Length', chunkEnd - start + 1);
  fs.createReadStream(filePath, { start, end: chunkEnd }).pipe(res);
});

/** Create a room. kind 'uploaded' needs assetId (movie already uploaded to /assets);
 *  kind 'existing' just needs movieId/movieTitle — the video itself plays from the
 *  site's own player, this only owns room membership/host/chat/sync/calls. */
app.post('/api/party/rooms', (req, res) => {
  const { hostId, hostName, kind, movieId, movieTitle, assetId, assetMime } = req.body || {};
  if (!hostId || !hostName) return res.status(400).json({ error: 'hostId and hostName are required.' });
  const roomCode = generateRoomCode();
  const room = makeRoom({
    roomCode,
    kind: kind === 'existing' ? 'existing' : 'uploaded',
    hostId,
    hostName,
    movieId,
    movieTitle,
    assetId,
    assetMime
  });
  res.json({ roomCode: room.roomCode, roomId: room.roomId });
});

/** Lightweight existence check, used to show a clean "room not found" before opening a socket. */
app.get('/api/party/rooms/:code', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room || !room.active) return res.status(404).json({ exists: false });
  res.json({
    exists: true,
    kind: room.kind,
    active: room.active,
    movieId: room.movieId,
    movieTitle: room.movieTitle
  });
});

const server = http.createServer(app);

/* --------------------------------------------------------------------- */
/*  Socket.IO — room authority, host transfer, chat, sync, calls         */
/* --------------------------------------------------------------------- */

const io = new SocketIOServer(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] }
});

/** memberKey -> pending removal timeout, for the disconnect grace window. */
const graceTimers = new Map();

function memberKey(roomCode, userId) {
  return `${roomCode}::${userId}`;
}

function findMember(room, userId) {
  return room.members.find((m) => m.userId === userId);
}

function broadcastState(room, systemMessage) {
  touch(room);
  io.to(roomKey(room.roomCode)).emit('party:state', roomSnapshot(room));
  if (systemMessage) {
    io.to(roomKey(room.roomCode)).emit('party:chat', {
      type: 'system',
      message: systemMessage,
      timestamp: Date.now()
    });
  }
}

function autoTransferHost(room, leavingUserId, leavingName) {
  const remaining = room.members.filter((m) => m.userId !== leavingUserId);
  if (remaining.length === 0) {
    room.active = false;
    touch(room);
    io.to(roomKey(room.roomCode)).emit('party:ended', { reason: 'Everyone has left the room.' });
    return;
  }
  const connectedCandidates = remaining.filter((m) => m.connected);
  const candidate = (connectedCandidates.length ? connectedCandidates : remaining).sort(
    (a, b) => a.joinedAt - b.joinedAt
  )[0];
  room.hostId = candidate.userId;
  room.term += 1;
  room.members = remaining.map((m) => ({ ...m, role: m.userId === candidate.userId ? 'HOST' : 'MEMBER' }));
  broadcastState(room, `${leavingName || 'The host'} left. ${candidate.username} is now the host.`);
}

function removeMemberNow(room, userId, { reason } = {}) {
  const member = findMember(room, userId);
  if (!member) return;
  // Tell everyone still in the room that this user's call state is gone, so they
  // close the RTCPeerConnection and drop the tile (also covers disconnect-timeout).
  io.to(roomKey(room.roomCode)).emit('party:call-leave', { senderId: userId, senderName: member.username });
  const key = memberKey(room.roomCode, userId);
  const timer = graceTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    graceTimers.delete(key);
  }
  if (userId === room.hostId) {
    autoTransferHost(room, userId, member.username);
  } else {
    room.members = room.members.filter((m) => m.userId !== userId);
    if (room.members.length === 0) {
      room.active = false;
      touch(room);
      io.to(roomKey(room.roomCode)).emit('party:ended', { reason: 'Everyone has left the room.' });
    } else {
      broadcastState(room, reason || `${member.username} left the room.`);
    }
  }
}

io.on('connection', (socket) => {
  let ctx = null; // { roomCode, userId, username }

  socket.on('party:join', (payload = {}, ack) => {
    try {
      const { roomCode: rawCode, userId, username, kind, create, isInitialHost } = payload;
      const roomCode = (rawCode || '').toUpperCase();
      if (!roomCode || !userId || !username) {
        socket.emit('party:error', { message: 'roomCode, userId and username are required.' });
        return;
      }

      let room = rooms.get(roomCode);

      if (!room) {
        if (!create) {
          socket.emit('party:error', { message: 'Room not found. Check the code and try again.' });
          return;
        }
        room = makeRoom({
          roomCode,
          kind: kind === 'existing' ? 'existing' : 'uploaded',
          hostId: userId,
          hostName: username,
          movieId: create.movieId,
          movieTitle: create.movieTitle,
          assetId: create.assetId,
          assetMime: create.assetMime
        });
      } else if (!room.active) {
        socket.emit('party:error', { message: 'This room has ended.' });
        return;
      }

      // Cancel any pending disconnect-grace removal for this user (reconnect case).
      const key = memberKey(roomCode, userId);
      const pending = graceTimers.get(key);
      if (pending) {
        clearTimeout(pending);
        graceTimers.delete(key);
      }

      let member = findMember(room, userId);
      if (!member) {
        member = {
          userId,
          username,
          joinedAt: Date.now(),
          role: userId === room.hostId ? 'HOST' : 'MEMBER',
          connected: true,
          socketId: socket.id
        };
        room.members.push(member);
        touch(room);
      } else {
        if (member.socketId && member.socketId !== socket.id) {
          // Same user re-joined from a new socket (refresh / reconnect): the old socket is stale.
          const old = io.sockets.sockets.get(member.socketId);
          if (old) {
            old.data.staleSocket = true;
            old.leave(roomKey(roomCode));
          }
        }
        member.username = username;
        member.connected = true;
        member.socketId = socket.id;
        touch(room);
      }

      // Existing-movie overlay: let the real backend's host status reconcile the overlay's
      // host if this device is the actual host but the overlay picked someone else first
      // (e.g. a member's tab opened a split-second earlier).
      if (room.kind === 'existing' && isInitialHost && room.hostId !== userId) {
        room.hostId = userId;
        room.term += 1;
        room.members = room.members.map((m) => ({ ...m, role: m.userId === userId ? 'HOST' : 'MEMBER' }));
      }

      socket.join(roomKey(roomCode));
      ctx = { roomCode, userId, username };

      broadcastState(room, `${username} joined the room.`);
      if (ack) ack({ ok: true, room: roomSnapshot(room) });
    } catch (err) {
      socket.emit('party:error', { message: 'Could not join the room.' });
      if (ack) ack({ ok: false, error: 'join-failed' });
    }
  });

  socket.on('party:request-sync', () => {
    if (!ctx) return;
    const room = rooms.get(ctx.roomCode);
    if (room) socket.emit('party:state', roomSnapshot(room));
  });

  socket.on('party:heartbeat', () => {
    // Keeps the socket/connection alive; no-op beyond socket.io's own ping/pong.
  });

  socket.on('party:chat', (payload = {}) => {
    if (!ctx) return;
    const room = rooms.get(ctx.roomCode);
    if (!room) return;
    const message = String(payload.message || '').trim();
    if (!message) return;
    io.to(roomKey(ctx.roomCode)).emit('party:chat', {
      type: 'user',
      username: ctx.username,
      userId: ctx.userId,
      message,
      timestamp: Date.now()
    });
  });

  socket.on('party:control', (payload = {}) => {
    if (!ctx) return;
    const room = rooms.get(ctx.roomCode);
    if (!room) return;
    if (room.hostId !== ctx.userId) {
      socket.emit('party:error', { message: 'Only the host can control playback.' });
      return;
    }
    const { action, currentTime } = payload;
    // 'seek' must not flip play state: keep whatever the room was doing (or what the host says).
    const isPlaying =
      action === 'seek'
        ? typeof payload.isPlaying === 'boolean' ? payload.isPlaying : room.playback.isPlaying
        : action !== 'pause';
    room.playback = { isPlaying, currentTime: Number(currentTime) || 0, updatedAt: Date.now() };
    touch(room);
    io.to(roomKey(ctx.roomCode)).emit('party:sync', {
      action,
      currentTime: room.playback.currentTime,
      isPlaying: room.playback.isPlaying
    });
  });

  socket.on('party:music-control', (payload = {}) => {
    if (!ctx) return;
    const room = rooms.get(ctx.roomCode);
    if (!room) return;
    if (room.hostId !== ctx.userId) {
      socket.emit('party:error', { message: 'Only the host can control the music.' });
      return;
    }
    const { action, currentTime } = payload;
    room.music = {
      ...room.music,
      isPlaying: action === 'seek' ? (typeof payload.isPlaying === 'boolean' ? payload.isPlaying : room.music.isPlaying) : action !== 'pause',
      currentTime: Number(currentTime) || 0,
      updatedAt: Date.now()
    };
    touch(room);
    io.to(roomKey(ctx.roomCode)).emit('party:music-sync', {
      action,
      currentTime: room.music.currentTime,
      isPlaying: room.music.isPlaying
    });
  });

  socket.on('party:change-song', (payload = {}) => {
    if (!ctx) return;
    const room = rooms.get(ctx.roomCode);
    if (!room) return;
    if (room.hostId !== ctx.userId) {
      socket.emit('party:error', { message: 'Only the host can change the song.' });
      return;
    }
    const { songId, songTitle } = payload;
    room.music = { songId: songId || null, songTitle: songTitle || null, isPlaying: true, currentTime: 0, updatedAt: Date.now() };
    broadcastState(room, songTitle ? `Now playing: ${songTitle}` : 'The song changed.');
  });

  socket.on('party:transfer-host', (payload = {}) => {
    if (!ctx) return;
    const room = rooms.get(ctx.roomCode);
    if (!room) return;
    if (room.hostId !== ctx.userId) {
      socket.emit('party:error', { message: 'Only the host can transfer host.' });
      return;
    }
    const { newHostId } = payload;
    const target = findMember(room, newHostId);
    if (!target) {
      socket.emit('party:error', { message: 'That member is no longer in the room.' });
      return;
    }
    room.hostId = newHostId;
    room.term += 1;
    room.members = room.members.map((m) => ({ ...m, role: m.userId === newHostId ? 'HOST' : 'MEMBER' }));
    broadcastState(room, `${target.username} is now the host.`);
  });

  socket.on('party:remove-member', (payload = {}) => {
    if (!ctx) return;
    const room = rooms.get(ctx.roomCode);
    if (!room) return;
    if (room.hostId !== ctx.userId) {
      socket.emit('party:error', { message: 'Only the host can remove members.' });
      return;
    }
    const { memberId } = payload;
    if (memberId === room.hostId) return;
    const target = findMember(room, memberId);
    if (!target) return;
    room.members = room.members.filter((m) => m.userId !== memberId);
    touch(room);
    broadcastState(room, `${target.username} was removed from the room.`);
    io.to(roomKey(room.roomCode)).emit('party:removed', {
      memberId,
      reason: 'You have been removed from this watch party.'
    });
  });

  socket.on('party:end-room', () => {
    if (!ctx) return;
    const room = rooms.get(ctx.roomCode);
    if (!room) return;
    if (room.hostId !== ctx.userId) {
      socket.emit('party:error', { message: 'Only the host can end the room.' });
      return;
    }
    room.active = false;
    touch(room);
    io.to(roomKey(room.roomCode)).emit('party:ended', { reason: 'The host ended this room.' });
  });

  socket.on('party:leave', () => {
    if (!ctx) return;
    const room = rooms.get(ctx.roomCode);
    socket.leave(roomKey(ctx.roomCode));
    if (room) {
      const m = findMember(room, ctx.userId);
      // Only act if this socket is still the member's current socket.
      if (m && (!m.socketId || m.socketId === socket.id)) removeMemberNow(room, ctx.userId);
    }
    ctx = null;
  });

  // --- WebRTC call signaling: pure relay, scoped to this room's socket.io room ---
  const relayCall = (event) => (payload = {}) => {
    if (!ctx) return;
    socket.to(roomKey(ctx.roomCode)).emit(event, { ...payload, senderId: ctx.userId, senderName: ctx.username });
  };
  socket.on('party:call-join', relayCall('party:call-join'));
  socket.on('party:call-leave', relayCall('party:call-leave'));
  socket.on('party:call-status', relayCall('party:call-status'));
  socket.on('party:call-roster-request', relayCall('party:call-roster-request'));
  socket.on('party:call-signal', (payload = {}) => {
    // Directed signal (offer/answer/ICE) — only relay to the intended target member's socket(s).
    if (!ctx) return;
    const room = rooms.get(ctx.roomCode);
    if (!room) return;
    const target = findMember(room, payload.targetId);
    if (!target || !target.socketId) return;
    io.to(target.socketId).emit('party:call-signal', { ...payload, senderId: ctx.userId, senderName: ctx.username });
  });

  socket.on('disconnect', () => {
    if (!ctx) return;
    const { roomCode, userId, username } = ctx;
    const room = rooms.get(roomCode);
    if (!room) return;
    const member = findMember(room, userId);
    // A newer socket already took over this member (refresh/reconnect) — nothing to do.
    if (member && member.socketId && member.socketId !== socket.id) return;
    if (member) {
      member.connected = false;
      member.socketId = null;
      touch(room);
      io.to(roomKey(roomCode)).emit('party:state', roomSnapshot(room));
      // Their call peer connections are dead now; don't wait for the grace window.
      io.to(roomKey(roomCode)).emit('party:call-leave', { senderId: userId, senderName: username });
    }
    // Temporary-loss grace window (item #12): don't remove/auto-transfer immediately.
    const key = memberKey(roomCode, userId);
    const timer = setTimeout(() => {
      graceTimers.delete(key);
      const stillThere = rooms.get(roomCode);
      if (!stillThere) return;
      const m = findMember(stillThere, userId);
      if (m && !m.connected) {
        removeMemberNow(stillThere, userId, { reason: `${username} disconnected.` });
      }
    }, DISCONNECT_GRACE_MS);
    graceTimers.set(key, timer);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[party-service] listening on :${PORT}`);
});
