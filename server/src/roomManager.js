import { createRoom, MAX_PLAYERS } from './room.js';

const EMPTY_ROOM_GRACE_MS = 60_000;

const rooms = new Map(); // code -> Room
const playerIndex = new Map(); // playerId -> code
const emptyRoomTimers = new Map(); // code -> timeout handle

export function makeRoom() {
  const room = createRoom(null, new Set(rooms.keys()));
  rooms.set(room.code, room);
  return room;
}

export function getRoom(code) {
  return rooms.get((code || '').toUpperCase());
}

export function indexPlayer(playerId, code) {
  playerIndex.set(playerId, code);
}

export function findRoomForPlayer(playerId) {
  const code = playerIndex.get(playerId);
  return code ? rooms.get(code) : null;
}

// Rooms a brand-new player could actually join right now: still in the
// lobby (not mid-hand) and not full.
export function listJoinableRooms() {
  return [...rooms.values()]
    .filter((r) => r.status === 'LOBBY' && r.players.length < MAX_PLAYERS)
    .map((r) => ({
      code: r.code,
      hostName: r.findPlayer(r.hostPlayerId)?.name || '房主',
      playerCount: r.players.length,
      buyIn: r.buyIn,
      smallBlind: r.smallBlind,
      bigBlind: r.bigBlind,
    }));
}

export function cancelEmptyRoomCleanup(code) {
  const t = emptyRoomTimers.get(code);
  if (t) {
    clearTimeout(t);
    emptyRoomTimers.delete(code);
  }
}

export function scheduleEmptyRoomCleanup(room) {
  // Test bots never disconnect, so only people keep a room alive.
  const anyoneLeft = room.players.some((p) => p.connected && !p.bot);
  if (anyoneLeft) return;
  cancelEmptyRoomCleanup(room.code);
  const t = setTimeout(() => {
    emptyRoomTimers.delete(room.code);
    const current = rooms.get(room.code);
    if (!current) return;
    const stillEmpty = current.players.every((p) => !p.connected || p.bot);
    if (stillEmpty) {
      current.players.forEach((p) => playerIndex.delete(p.id));
      rooms.delete(room.code);
    }
  }, EMPTY_ROOM_GRACE_MS);
  emptyRoomTimers.set(room.code, t);
}
