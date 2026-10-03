import { customAlphabet } from 'nanoid';

const genCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const MAX_BUY_IN = 10000;

// Fixed blind tiers -- these do NOT scale with buy-in, by design. The host can also pick
// 'custom' and name any pair, see customBlinds.
export const BLIND_PRESETS = [
  { id: 't1', label: '10 / 20', smallBlind: 10, bigBlind: 20 },
  { id: 't2', label: '20 / 40', smallBlind: 20, bigBlind: 40 },
];

// Hands per normal-mode match: null for no limit, otherwise a whole number from 2 to 99.
export function normalizeHandLimit(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(99, Math.max(2, n)) : null;
}

export function blindOptions() {
  return BLIND_PRESETS;
}

// Custom blinds are whole tens (chips move in tens): a small blind of at least 10 and a big
// blind no smaller than it, neither above the largest buy-in. The client applies the same rules.
export function customBlinds(smallBlind, bigBlind) {
  const tens = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n / 10) * 10 : null;
  };
  const small = Math.min(MAX_BUY_IN, Math.max(10, tens(smallBlind) ?? 10));
  const big = Math.min(MAX_BUY_IN, Math.max(small, tens(bigBlind) ?? small * 2));
  return { smallBlind: small, bigBlind: big };
}

export class Room {
  constructor(code, hostPlayerId) {
    this.code = code;
    this.hostPlayerId = hostPlayerId;
    this.status = 'LOBBY'; // LOBBY | PLAYING | FINISHED
    this.buyIn = 1000;
    this.smallBlind = 10;
    this.bigBlind = 20;
    this.raiseMode = 'unlimited'; // 'unlimited' | 'single' (at most one raise per betting round)
    this.gameMode = 'normal'; // 'normal' | 'tricks', fixed once the game begins
    this.trickMatch = null;
    // Normal mode only (a trick match counts its own 16 hands): hands per match, null = no limit,
    // and the counter. A limited hand everyone folded before the flop is replayed under the same
    // number, which replayOf keeps on show until the replay deals.
    this.handLimit = null;
    this.handNumber = 0;
    this.replayOf = null;
    // Set once a match has run its course: its hand limit, or one player left with chips.
    this.matchComplete = false;
    this.maxPotPerRound = null; // cap on the bet-to level within one betting round (street), null = no cap
    this.maxPotPerHand = null; // cap on a player's total contribution across the whole hand, null = no cap
    this.players = []; // { id, name, socketId, chips, seat, connected, eliminated }
    this.dealerSeat = 0;
    this.hand = null; // current HandState, set by gameEngine
    this.kickedNames = new Set(); // names permanently barred from rejoining this room
    this.kickedPlayerIds = new Set();
    this.history = []; // [{ number, results: [{playerId, name, chips}] }]
    this.chat = []; // latest chat lines, see pushChat in socketHandlers.js
    this.awaitingContinue = false; // true between hands, waiting for everyone to click 继续
    this.readyPlayerIds = new Set();
  }

  get playerCount() {
    return this.players.length;
  }

  findPlayer(playerId) {
    return this.players.find((p) => p.id === playerId);
  }

  activePlayersInSeatOrder() {
    return this.players
      .filter((p) => !p.eliminated)
      .sort((a, b) => a.seat - b.seat);
  }
}

export function createRoom(hostPlayerId, existingCodes) {
  let code;
  do {
    code = genCode();
  } while (existingCodes.has(code));
  return new Room(code, hostPlayerId);
}
