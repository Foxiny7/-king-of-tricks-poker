import { nanoid } from 'nanoid';
import { MIN_PLAYERS, MAX_PLAYERS, MAX_BUY_IN, BLIND_PRESETS, blindOptions, customBlinds, normalizeHandLimit } from './room.js';
import { createProfileStore, normalizeNameplate, weekStart } from './profiles.js';
import { TRICKS, beginTrickMatch, beginTrickSelection, chooseTrick, refreshTrickOffer, autoChooseTricks, useTrick,
  TRICK_PHASE_HANDS, TRICK_PHASES } from './tricks.js';
import {
  startHand,
  applyAction,
  forceTimeoutAction,
  forceFoldFromHand,
  getPublicState,
  settleEliminations,
  payToPeek,
  revealFoldedCards,
  TURN_SECONDS,
  currentActor,
} from './gameEngine.js';
import {
  makeRoom,
  getRoom,
  indexPlayer,
  findRoomForPlayer,
  scheduleEmptyRoomCleanup,
  cancelEmptyRoomCleanup,
  listJoinableRooms,
} from './roomManager.js';

const socketsByPlayer = new Map(); // playerId -> socket

// Room chat, like a MOBA's: short lines to everyone in the room, plus the emotes and gifts sent
// there. The room keeps the latest lines so a reconnect or a late arrival sees what was said.
const CHAT_KEEP = 40;
const CHAT_MAX_LENGTH = 60;
const CHAT_GAP_MS = 800;
function pushChat(room, entry) {
  const line = { id: nanoid(8), ...entry };
  room.chat = [...(room.chat || []), line].slice(-CHAT_KEEP);
  room.players.forEach((p) => socketsByPlayer.get(p.id)?.emit('chat', line));
}
// Test bots take their turn after this pause, so people can see what they did.
const BOT_THINK_MS = 900;
const timers = new Map(); // roomCode -> timeout handle

// A room removed after everyone left may still hold timers; they stop instead of playing on.
const roomIsGone = (room) => getRoom(room.code) !== room;

function clearRoomTimer(code) {
  const t = timers.get(code);
  if (t) {
    clearTimeout(t);
    timers.delete(code);
  }
}

function broadcast(room) {
  room.players.forEach((p) => {
    const sock = socketsByPlayer.get(p.id);
    if (sock && sock.connected) {
      sock.emit('room_state', getPublicState(room, p.id));
    }
  });
}

function scheduleTurnTimer(room) {
  clearRoomTimer(room.code);
  if (!room.hand || room.hand.stage === 'SHOWDOWN') return;
  // A bot plays the same move a timed-out player would: check if it can, otherwise fold.
  const delay = currentActor(room)?.bot ? BOT_THINK_MS : Math.max(0, room.hand.turnDeadline - Date.now());
  const t = setTimeout(() => {
    if (roomIsGone(room) || !room.hand || room.hand.stage === 'SHOWDOWN') return;
    try {
      const result = forceTimeoutAction(room);
      afterHandProgress(room, result);
    } catch (e) {
      // no legal actor at this moment, ignore
    }
  }, delay + 50);
  timers.set(room.code, t);
}

function finishTrickSelection(room) {
  if (!room.trickMatch?.selection || room.status !== 'PLAYING') return;
  clearRoomTimer(room.code);
  autoChooseTricks(room);
  const phase = Math.floor(room.trickMatch.handNumber / TRICK_PHASE_HANDS) + 1;
  if (room.players.some((p) => !p.kicked && !p.eliminated && !p.waitingForNextHand &&
      p.chips >= room.bigBlind && (room.trickMatch.picks.get(p.id) || 0) < phase)) {
    beginTrickSelection(room);
    scheduleTrickSelection(room);
    return;
  }
  if (!startHand(room)) {
    recordHistoryAndReturnToLobby(room);
    broadcast(room);
    return;
  }
  afterHandProgress(room, room.hand.stage === 'SHOWDOWN' ? { event: 'HAND_COMPLETE' } : null);
}

// Bots take the first candidate they are allowed to (a series another player holds can refuse it).
function botsChooseTricks(room) {
  const selection = room.trickMatch?.selection;
  let allChosen = false;
  for (const bot of room.players.filter((p) => p.bot && selection?.offers.has(p.id) && !selection.chosen.has(p.id))) {
    for (const trickId of selection.offers.get(bot.id)) {
      try {
        allChosen = chooseTrick(room, bot.id, trickId);
        break;
      } catch {
        // try the next candidate
      }
    }
  }
  return allChosen;
}

function scheduleTrickSelection(room) {
  clearRoomTimer(room.code);
  const selection = room.trickMatch?.selection;
  if (!selection) return;
  if (botsChooseTricks(room)) {
    finishTrickSelection(room);
    return;
  }
  if (selection.offers.size === 0) {
    finishTrickSelection(room);
    return;
  }
  const delay = Math.max(0, selection.deadline - Date.now());
  timers.set(room.code, setTimeout(() => { if (!roomIsGone(room)) finishTrickSelection(room); }, delay + 50));
  broadcast(room);
}

function playersAwaitedForContinue(room) {
  return room.players.filter(
    (p) => p.connected && !p.bot && !p.eliminated && !p.kicked && !p.waitingForNextHand
  );
}

function proceedToNextHand(room) {
  clearRoomTimer(room.code);
  room.awaitingContinue = false;
  room.readyPlayerIds = new Set();
  room.players = room.players.filter((p) => !p.kicked);
  room.players.forEach((p) => {
    p.waitingForNextHand = false;
  });
  const nextPhase = room.trickMatch ? Math.floor(room.trickMatch.handNumber / TRICK_PHASE_HANDS) + 1 : 0;
  if (room.trickMatch && room.trickMatch.handNumber < TRICK_PHASE_HANDS * TRICK_PHASES &&
      room.players.some((p) => !p.kicked && !p.eliminated && p.chips >= room.bigBlind &&
        (room.trickMatch.picks.get(p.id) || 0) < nextPhase)) {
    beginTrickSelection(room);
    scheduleTrickSelection(room);
    return;
  }
  if (!startHand(room)) {
    recordHistoryAndReturnToLobby(room);
    broadcast(room);
    return;
  }
  afterHandProgress(room, room.hand.stage === 'SHOWDOWN' ? { event: 'HAND_COMPLETE' } : null);
}

function enterAwaitingContinue(room) {
  clearRoomTimer(room.code);
  room.awaitingContinue = true;
  room.readyPlayerIds = new Set();
  // safety net so the table never gets permanently stuck if someone goes AFK
  const t = setTimeout(() => {
    if (roomIsGone(room) || room.status !== 'PLAYING' || !room.awaitingContinue) return;
    proceedToNextHand(room);
  }, 45000);
  timers.set(room.code, t);
  broadcast(room);
}

function maybeProceedIfAllReady(room) {
  if (!room.awaitingContinue) return;
  const awaited = playersAwaitedForContinue(room);
  if (awaited.length > 0 && awaited.every((p) => room.readyPlayerIds.has(p.id))) {
    proceedToNextHand(room);
  }
}

// A match only goes into the history once it got past its first hand, and a match with a set
// length (every trick match, or a limited normal one) only when it ran its course. Hands replayed
// after everyone folded preflop don't add to the count.
function matchCounts(room) {
  const played = room.trickMatch ? room.trickMatch.handNumber : room.replayOf ?? room.handNumber;
  const limited = !!room.trickMatch || !!room.handLimit;
  return played > 1 && (!limited || room.matchComplete);
}

function recordHistoryAndReturnToLobby(room) {
  if (matchCounts(room)) recordHistory(room);
  room.status = 'LOBBY';
  room.hand = null;
  room.trickMatch = null;
  room.handNumber = 0;
  room.replayOf = null;
  room.matchComplete = false;
  room.dealerSeat = 0;
  room.awaitingContinue = false;
  room.readyPlayerIds = new Set();
  room.players = room.players.filter((p) => !p.kicked && !p.pendingKick);
  room.players.forEach((p) => {
    p.eliminated = false;
    p.chips = room.buyIn;
    p.folded = false;
    p.allIn = false;
    p.holeCards = null;
    p.betThisRound = 0;
    p.betThisHand = 0;
    p.lastAction = null;
    p.waitingForNextHand = false;
  });
}

function recordHistory(room) {
  const ranked = room.players
    .filter((p) => !p.kicked && !p.waitingForNextHand)
    .slice()
    .sort((a, b) =>
      (b.chips + (room.hand?.stage !== 'SHOWDOWN' ? b.betThisHand : 0)) -
      (a.chips + (room.hand?.stage !== 'SHOWDOWN' ? a.betThisHand : 0))
    );
  const results = ranked.map((p) => ({
    playerId: p.id, name: p.name,
    chips: p.chips + (room.hand && room.hand.stage !== 'SHOWDOWN' ? p.betThisHand : 0),
    tricks: room.trickMatch?.owned.get(p.id)?.map((id) => TRICKS[id].name) || [],
  }));
  room.history.push({ number: room.history.length + 1, results });
  for (const result of results.filter((item) => !room.findPlayer(item.playerId)?.bot))
    profiles.recordMatch(result.name, { mode: room.gameMode === 'tricks' ? 'tricks' : 'normal', score: result.chips });
}

function scheduleReturnToLobby(room) {
  clearRoomTimer(room.code);
  const t = setTimeout(() => {
    if (room.status !== 'PLAYING') return;
    recordHistoryAndReturnToLobby(room);
    broadcast(room);
  }, 45000);
  timers.set(room.code, t);
}

let profiles = createProfileStore();

function recordShowdownWins(room) {
  const h = room.hand;
  if (!h?.revealed?.showCards || h.profileRecorded) return;
  h.profileRecorded = true;
  const winnerIds = new Set(h.revealed.pots.filter((pot) => pot.handName).flatMap((pot) => pot.winnerIds));
  for (const id of winnerIds) {
    const player = room.players.find((p) => p.id === id);
    if (player && !player.bot) profiles.recordWin(player.name, player.holeCards, h.community);
  }
}

function afterHandProgress(room, result) {
  broadcast(room);
  if (result && result.event === 'HAND_COMPLETE') {
    recordShowdownWins(room);
    room.players.forEach((p) => {
      if (p.pendingKick) {
        p.pendingKick = false;
        p.kicked = true;
        p.eliminated = true;
      }
    });
    const finished = settleEliminations(room);
    const lastHand = room.trickMatch ? room.trickMatch.handNumber >= TRICK_PHASE_HANDS * TRICK_PHASES
      : !!room.handLimit && room.handNumber >= room.handLimit;
    if (finished || lastHand) room.matchComplete = true;
    if (room.trickMatch && room.matchComplete) room.trickMatch.ended = true;
    broadcast(room);
    if (room.matchComplete) scheduleReturnToLobby(room);
    else enterAwaitingContinue(room);
  } else {
    scheduleTurnTimer(room);
  }
}

function normalizeAvatar(avatar) {
  if (avatar == null || avatar === '') return null;
  if (typeof avatar !== 'string') throw new Error('头像格式错误');
  if (/^preset-[1-7]$/.test(avatar)) return avatar;
  if (avatar.length <= 120000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(avatar)) return avatar;
  throw new Error('头像格式无效或图片过大');
}

// A one-line self-introduction shown on the player's profile to the rest of the table.
const normalizeBio = (bio) => (typeof bio === 'string' ? bio.trim().slice(0, 40) : '');

function attachPlayer(room, playerId, socket, name, avatar, nameplate, bio) {
  let player = room.players.find((p) => p.id === playerId);
  if (!player) {
    const seat = room.players.length
      ? Math.max(...room.players.map((p) => p.seat)) + 1
      : 0;
    player = {
      id: playerId,
      name,
      avatar: avatar || 'preset-1',
      nameplate: normalizeNameplate(nameplate),
      bio: normalizeBio(bio),
      seat,
      chips: room.buyIn,
      connected: true,
      eliminated: false,
      kicked: false,
      holeCards: null,
      folded: false,
      allIn: false,
      betThisRound: 0,
      betThisHand: 0,
      lastAction: null,
      inVoice: false,
      waitingForNextHand: room.status === 'PLAYING',
    };
    room.players.push(player);
    if (!room.hostPlayerId) room.hostPlayerId = playerId;
  } else {
    player.connected = true;
    if (name) player.name = name;
    if (avatar) player.avatar = avatar;
    if (nameplate) player.nameplate = normalizeNameplate(nameplate);
    if (typeof bio === 'string') player.bio = normalizeBio(bio);
  }
  const previousSocket = socketsByPlayer.get(playerId);
  if (previousSocket && previousSocket !== socket) {
    previousSocket.data.playerId = null;
    previousSocket.disconnect(true);
  }
  indexPlayer(playerId, room.code);
  socketsByPlayer.set(playerId, socket);
  cancelEmptyRoomCleanup(room.code);
  return player;
}

export function registerSocketHandlers(io, options = {}) {
  if (options.profiles) profiles = options.profiles;
  const friendStore = options.friends;
  const onlineFriends = new Map();
  const notifyFriend = (code) => onlineFriends.get(code)?.forEach((peer) => peer.emit('friend_update', {}));
  // Someone came online, went offline or changed name: every open 在线玩家 list re-reads.
  const announceOnline = () => onlineFriends.forEach((sockets) => sockets.forEach((peer) => peer.emit('online_update', {})));
  // Everyone connected with a friend identity, once each however many tabs they have open: where
  // they are (no room codes) and how they stand with the asker.
  function onlinePeople(selfCode) {
    const self = friendStore.account(selfCode);
    return [...onlineFriends].filter(([code, sockets]) => sockets.size && code !== selfCode && friendStore.account(code))
      .map(([code, sockets]) => {
        const rooms = [...sockets].map((peer) => findRoomForPlayer(peer.data.playerId)).filter(Boolean);
        const where = rooms.some((room) => room.status === 'PLAYING') ? 'playing' : rooms.length ? 'room' : 'idle';
        const relation = self.friends.includes(code) ? 'friend'
          : friendStore.account(code).requests.includes(selfCode) ? 'requested'
          : self.requests.includes(code) ? 'incoming' : null;
        return { ...friendStore.publicInfo(code), where, relation };
      });
  }
  io.on('connection', (socket) => {
    socket.use((packet, next) => {
      const payload = packet[1];
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        packet.find((arg) => typeof arg === 'function')?.({ ok: false, error: '请求格式错误' });
        return next(new Error('请求格式错误'));
      }
      if (['create_room', 'join_room', 'list_rooms', 'get_blind_options'].includes(packet[0]) &&
          typeof packet[2] !== 'function') return next(new Error('缺少请求回执'));
      next();
    });
    socket.on('error', () => {});

    socket.on('friend_auth', ({ token, name, avatar }, cb) => {
      if (!friendStore) return cb?.({ ok: false, error: '好友功能不可用' });
      if (socket.data.friendCode) onlineFriends.get(socket.data.friendCode)?.delete(socket);
      const identity = friendStore.register(token, name, avatar);
      socket.data.friendCode = identity.code;
      if (!onlineFriends.has(identity.code)) onlineFriends.set(identity.code, new Set());
      onlineFriends.get(identity.code).add(socket);
      cb?.({ ok: true, ...identity });
      friendStore.account(identity.code).friends.forEach(notifyFriend);
      announceOnline();
    });

    socket.on('online_players', (_payload, cb) => {
      if (!friendStore?.account(socket.data.friendCode)) return cb?.({ ok: false, error: '请先连接好友服务' });
      cb?.({ ok: true, players: onlinePeople(socket.data.friendCode) });
    });

    socket.on('friend_list', (_payload, cb) => {
      const self = friendStore?.account(socket.data.friendCode);
      if (!self) return cb?.({ ok: false, error: '请先连接好友服务' });
      cb?.({ ok: true, code: socket.data.friendCode,
        friends: self.friends.map((code) => ({ ...friendStore.publicInfo(code), online: !!onlineFriends.get(code)?.size })),
        requests: self.requests.map(friendStore.publicInfo).filter(Boolean) });
    });

    socket.on('friend_request', ({ code }, cb) => {
      const self = socket.data.friendCode;
      if (!self) return cb?.({ ok: false, error: '请先连接好友服务' });
      const target = String(code || '').trim().toUpperCase();
      const error = friendStore.request(self, target);
      cb?.(error ? { ok: false, error } : { ok: true });
      if (!error) notifyFriend(target);
    });

    // 加好友 from a player's ··· menu: the request goes to the friend identity behind that seat. If they
    // had already asked this player, it is accepted instead.
    socket.on('friend_request_player', ({ playerId: targetId }, cb) => {
      const self = socket.data.friendCode;
      if (!self || !friendStore) return cb?.({ ok: false, error: '请先连接好友服务' });
      const target = findRoomForPlayer(socket.data.playerId)?.findPlayer(targetId);
      if (!target || target.id === socket.data.playerId) return cb?.({ ok: false, error: '玩家不存在' });
      if (target.bot) return cb?.({ ok: false, error: '机器人不能加好友' });
      const targetCode = socketsByPlayer.get(target.id)?.data.friendCode;
      if (!targetCode) return cb?.({ ok: false, error: '对方暂时无法接收好友申请' });
      if (friendStore.account(self).requests.includes(targetCode)) {
        const error = friendStore.reply(self, targetCode, true);
        cb?.(error ? { ok: false, error } : { ok: true, accepted: true });
      } else {
        const error = friendStore.request(self, targetCode);
        cb?.(error ? { ok: false, error } : { ok: true });
        if (error) return;
      }
      notifyFriend(targetCode);
      notifyFriend(self);
    });

    socket.on('friend_reply', ({ code, accept }, cb) => {
      const self = socket.data.friendCode;
      if (!self) return cb?.({ ok: false, error: '请先连接好友服务' });
      const error = friendStore.reply(self, String(code || '').toUpperCase(), !!accept);
      cb?.(error ? { ok: false, error } : { ok: true });
      if (!error) notifyFriend(String(code || '').toUpperCase());
    });

    socket.on('friend_invite', ({ code }, cb) => {
      const self = friendStore?.account(socket.data.friendCode);
      const target = String(code || '').toUpperCase();
      if (!self?.friends.includes(target)) return cb?.({ ok: false, error: '对方不是好友' });
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '请先进入房间' });
      const peers = onlineFriends.get(target);
      if (!peers?.size) return cb?.({ ok: false, error: '好友不在线' });
      peers.forEach((peer) => peer.emit('friend_invite', { from: friendStore.publicInfo(socket.data.friendCode), roomCode: room.code }));
      cb?.({ ok: true });
    });

    socket.on('list_rooms', (_payload, cb) => {
      cb({ ok: true, rooms: listJoinableRooms() });
    });

    socket.on('get_profile', ({ name }, cb) => {
      if (typeof name !== 'string' || !name.trim()) return cb?.({ ok: false, error: '请先填写昵称' });
      const nickname = name.trim().slice(0, 20);
      cb?.({ ok: true, weekStart: weekStart(), best: profiles.weeklyBest(nickname),
        matches: profiles.matches(nickname), stats: profiles.stats(nickname) });
    });

    socket.on('set_nameplate', ({ nameplate }, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      const player = room?.findPlayer(socket.data.playerId);
      if (!player) return cb?.({ ok: false, error: '当前不在房间中' });
      player.nameplate = normalizeNameplate(nameplate);
      cb?.({ ok: true });
      broadcast(room);
    });

    socket.on('create_room', ({ name, avatar, nameplate, bio }, cb) => {
      if (name != null && typeof name !== 'string') return cb?.({ ok: false, error: '昵称格式错误' });
      let safeAvatar;
      try { safeAvatar = normalizeAvatar(avatar); } catch (e) { return cb?.({ ok: false, error: e.message }); }
      if (socket.data.playerId && findRoomForPlayer(socket.data.playerId))
        return cb?.({ ok: false, error: '请先离开当前房间' });
      const room = makeRoom();
      const playerId = nanoid(10);
      attachPlayer(room, playerId, socket, (name || '玩家').slice(0, 20), safeAvatar, nameplate, bio);
      socket.data.playerId = playerId;
      cb({ ok: true, playerId, roomCode: room.code });
      broadcast(room);
    });

    socket.on('join_room', ({ code, name, avatar, nameplate, bio, playerId: existingId }, cb) => {
      if (typeof code !== 'string' || (name != null && typeof name !== 'string'))
        return cb?.({ ok: false, error: '房间号或昵称格式错误' });
      let safeAvatar;
      try { safeAvatar = normalizeAvatar(avatar); } catch (e) { return cb?.({ ok: false, error: e.message }); }
      const room = getRoom(code);
      if (!room) return cb({ ok: false, error: '房间不存在' });
      const currentRoom = findRoomForPlayer(socket.data.playerId);
      if (currentRoom && (currentRoom !== room || existingId !== socket.data.playerId))
        return cb?.({ ok: false, error: '请先离开当前房间' });
      const trimmedName = (name || '').trim().slice(0, 20);

      if (trimmedName && room.kickedNames.has(trimmedName)) {
        return cb({ ok: false, kicked: true, error: '你已被房主移出房间' });
      }
      if (existingId && room.kickedPlayerIds.has(existingId)) {
        return cb({ ok: false, kicked: true, error: '你已被房主移出房间' });
      }

      // reconnect via saved player id (same device/browser)
      const byId = existingId && room.players.find((p) => p.id === existingId);
      if (byId) {
        if (byId.kicked || byId.pendingKick) return cb({ ok: false, kicked: true, error: '你已被房主移出房间' });
        const player = attachPlayer(room, byId.id, socket, trimmedName || byId.name, safeAvatar, nameplate, bio);
        socket.data.playerId = player.id;
        cb({ ok: true, playerId: player.id, roomCode: room.code });
        broadcast(room);
        return;
      }

      // reconnect via matching name to a currently-disconnected player (different device)
      const byName =
        trimmedName && room.players.find((p) => p.name === trimmedName && !p.connected);
      if (byName) {
        if (byName.kicked || byName.pendingKick) return cb({ ok: false, kicked: true, error: '你已被房主移出房间' });
        const player = attachPlayer(room, byName.id, socket, trimmedName, safeAvatar, nameplate, bio);
        socket.data.playerId = player.id;
        cb({ ok: true, playerId: player.id, roomCode: room.code });
        broadcast(room);
        return;
      }

      if (trimmedName && room.players.some((p) => p.name === trimmedName && p.connected)) {
        return cb({ ok: false, error: '这个名字已经在房间里了，换一个名字试试' });
      }

      if (room.status !== 'LOBBY' && room.status !== 'PLAYING') {
        return cb({ ok: false, error: '游戏已经开始，无法加入' });
      }
      if (room.players.length >= MAX_PLAYERS) {
        return cb({ ok: false, error: '房间已满' });
      }
      const playerId = nanoid(10);
      const player = attachPlayer(room, playerId, socket, trimmedName || '玩家', safeAvatar, nameplate, bio);
      socket.data.playerId = player.id;
      cb({
        ok: true,
        playerId: player.id,
        roomCode: room.code,
        waitingForNextHand: player.waitingForNextHand,
      });
      broadcast(room);
    });

    socket.on(
      'set_room_config',
      ({ buyIn, blindPresetId, smallBlind, bigBlind, raiseMode, maxPotPerRound, maxPotPerHand, gameMode, handLimit }, cb) => {
        const room = findRoomForPlayer(socket.data.playerId);
        if (!room) return cb?.({ ok: false, error: '房间不存在' });
        if (room.hostPlayerId !== socket.data.playerId)
          return cb?.({ ok: false, error: '只有房主可以设置' });
        if (room.status !== 'LOBBY') return cb?.({ ok: false, error: '游戏已开始' });

        const rawBuyIn = Number(buyIn);
        const buyInNum = Math.min(
          MAX_BUY_IN,
          Math.max(
            100,
            Math.round((Number.isFinite(rawBuyIn) && rawBuyIn > 0 ? rawBuyIn : room.buyIn) / 10) * 10
          )
        );
        room.buyIn = buyInNum;
        room.players.forEach((p) => {
          p.chips = buyInNum;
        });
        const blinds = blindPresetId === 'custom'
          ? customBlinds(smallBlind, bigBlind)
          : BLIND_PRESETS.find((o) => o.id === blindPresetId) || BLIND_PRESETS[0];
        room.smallBlind = blinds.smallBlind;
        room.bigBlind = blinds.bigBlind;

        room.raiseMode = raiseMode === 'single' ? 'single' : 'unlimited';
        room.gameMode = gameMode === 'tricks' ? 'tricks' : 'normal';
        room.handLimit = normalizeHandLimit(handLimit);

        const rawMaxPot = Number(maxPotPerRound);
        room.maxPotPerRound =
          Number.isFinite(rawMaxPot) && rawMaxPot > 0
            ? Math.max(10, Math.round(rawMaxPot / 10) * 10)
            : null;

        const rawMaxPotHand = Number(maxPotPerHand);
        room.maxPotPerHand =
          Number.isFinite(rawMaxPotHand) && rawMaxPotHand > 0
            ? Math.max(10, Math.round(rawMaxPotHand / 10) * 10)
            : null;

        cb?.({ ok: true });
        broadcast(room);
      }
    );

    socket.on('get_blind_options', (_payload, cb) => {
      cb(blindOptions());
    });

    socket.on('start_game', (_payload, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      if (room.hostPlayerId !== socket.data.playerId)
        return cb?.({ ok: false, error: '只有房主可以开始' });
      if (room.status !== 'LOBBY') return cb?.({ ok: false, error: '游戏已经开始' });
      if (room.buyIn < room.bigBlind)
        return cb?.({ ok: false, error: `初始筹码不能低于一个大盲（${room.bigBlind}）` });
      if (room.players.length < MIN_PLAYERS)
        return cb?.({ ok: false, error: `至少需要 ${MIN_PLAYERS} 人` });
      if (room.players.length > MAX_PLAYERS)
        return cb?.({ ok: false, error: `最多 ${MAX_PLAYERS} 人` });
      if (room.players.filter((p) => !p.kicked && !p.eliminated && p.chips >= room.bigBlind).length < MIN_PLAYERS)
        return cb?.({ ok: false, error: '至少需要两位筹码足够的玩家' });

      room.status = 'PLAYING';
      room.dealerSeat = -1;
      room.handNumber = 0;
      room.replayOf = null;
      room.matchComplete = false;
      if (room.gameMode === 'tricks') {
        beginTrickMatch(room);
        cb?.({ ok: true });
        scheduleTrickSelection(room);
        return;
      }
      startHand(room);
      cb?.({ ok: true });
      afterHandProgress(room, room.hand.stage === 'SHOWDOWN' ? { event: 'HAND_COMPLETE' } : null);
    });

    socket.on('player_action', ({ type, amount }, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room || !room.hand) return cb?.({ ok: false, error: '游戏未进行' });
      try {
        const result = applyAction(room, socket.data.playerId, type, amount);
        cb?.({ ok: true });
        afterHandProgress(room, result);
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('choose_trick', ({ trickId }, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      try {
        const allChosen = chooseTrick(room, socket.data.playerId, trickId);
        cb?.({ ok: true });
        if (allChosen) finishTrickSelection(room);
        else broadcast(room);
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('refresh_trick_offer', ({ slotIndex }, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      try {
        refreshTrickOffer(room, socket.data.playerId, slotIndex);
        cb?.({ ok: true });
        broadcast(room);
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('use_trick', ({ trickId, options }, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      try {
        const result = useTrick(room, socket.data.playerId, trickId, options);
        cb?.({ ok: true });
        if (result?.foldPlayerIds?.length) {
          let progress = null;
          for (const id of result.foldPlayerIds) {
            if (room.hand?.stage === 'SHOWDOWN') break;
            progress = forceFoldFromHand(room, id) || progress;
          }
          afterHandProgress(room, progress);
        } else broadcast(room);
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('ready_for_next_hand', (_payload, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room || !room.awaitingContinue) return cb?.({ ok: false, error: '当前不在等待中' });
      if (!playersAwaitedForContinue(room).some((p) => p.id === socket.data.playerId))
        return cb?.({ ok: false, error: '你将在下一局入座，无需确认本局' });
      room.readyPlayerIds.add(socket.data.playerId);
      cb?.({ ok: true });
      broadcast(room);
      maybeProceedIfAllReady(room);
    });

    socket.on('peek_folded_cards', ({ playerId: targetId }, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      try {
        payToPeek(room, socket.data.playerId, targetId);
        cb?.({ ok: true });
        broadcast(room);
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('reveal_folded_cards', (_payload, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      try {
        revealFoldedCards(room, socket.data.playerId);
        cb?.({ ok: true });
        broadcast(room);
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('add_bot', (_payload, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      if (room.hostPlayerId !== socket.data.playerId)
        return cb?.({ ok: false, error: '只有房主可以添加机器人' });
      if (room.status !== 'LOBBY' && room.status !== 'PLAYING')
        return cb?.({ ok: false, error: '现在不能添加机器人' });
      if (room.players.length >= MAX_PLAYERS) return cb?.({ ok: false, error: '房间已满' });
      let number = 1;
      const taken = (name) => room.players.some((p) => p.name === name) || room.kickedNames.has(name);
      while (taken(`机器人${number}`)) number++;
      const id = nanoid(10);
      room.players.push({
        id,
        name: `机器人${number}`,
        bot: true,
        avatar: `preset-${((number - 1) % 7) + 1}`,
        nameplate: 'plain',
        bio: '只会过牌，遇到下注就弃牌',
        seat: Math.max(-1, ...room.players.map((p) => p.seat)) + 1,
        chips: room.buyIn,
        connected: true,
        eliminated: false,
        kicked: false,
        holeCards: null,
        folded: false,
        allIn: false,
        betThisRound: 0,
        betThisHand: 0,
        lastAction: null,
        inVoice: false,
        // Mid-match a bot sits out until the next hand, like any newcomer.
        waitingForNextHand: room.status === 'PLAYING',
      });
      indexPlayer(id, room.code);
      cb?.({ ok: true, playerId: id });
      broadcast(room);
    });

    socket.on('kick_player', ({ playerId: targetId }, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      if (room.hostPlayerId !== socket.data.playerId)
        return cb?.({ ok: false, error: '只有房主可以踢人' });
      if (targetId === socket.data.playerId)
        return cb?.({ ok: false, error: '不能踢自己' });
      const target = room.players.find((p) => p.id === targetId);
      if (!target) return cb?.({ ok: false, error: '玩家不存在' });
      if (target.kicked || target.pendingKick)
        return cb?.({ ok: false, error: '玩家已被移出房间' });

      const settleBeforeKick = room.status === 'PLAYING' && room.hand?.stage !== 'SHOWDOWN' &&
        room.hand?.actingOrder.includes(targetId) && target.allIn && !target.folded;
      if (settleBeforeKick) target.pendingKick = true;
      else {
        target.kicked = true;
        target.eliminated = true;
      }
      room.kickedNames.add(target.name);
      room.kickedPlayerIds.add(targetId);

      const targetSocket = socketsByPlayer.get(targetId);
      socketsByPlayer.delete(targetId);
      if (targetSocket) {
        targetSocket.emit('kicked', { error: '你已被房主移出房间' });
        targetSocket.disconnect(true);
      }
      target.connected = false;
      target.inVoice = false;

      cb?.({ ok: true });
      if (settleBeforeKick) {
        broadcast(room);
        return;
      }

      if (room.status === 'LOBBY') {
        room.players = room.players.filter((p) => p.id !== targetId);
        broadcast(room);
        return;
      }

      if (room.status === 'PLAYING') {
        const remaining = room.players.filter((p) => !p.kicked);
        if (remaining.length < MIN_PLAYERS) {
          clearRoomTimer(room.code);
          recordHistoryAndReturnToLobby(room);
          broadcast(room);
          return;
        }
        if (room.hand) {
          const result = forceFoldFromHand(room, targetId);
          if (result) {
            afterHandProgress(room, result);
            return;
          }
        }
      }

      broadcast(room);
      maybeProceedIfAllReady(room);
    });

    socket.on('voice_signal', ({ to, data }) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room || !room.players.some((p) => p.id === to && !p.kicked)) return;
      const targetSocket = socketsByPlayer.get(to);
      if (targetSocket?.connected) {
        targetSocket.emit('voice_signal', { from: socket.data.playerId, data });
      }
    });

    socket.on('voice_state', ({ inVoice }) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return;
      const player = room.players.find((p) => p.id === socket.data.playerId);
      if (!player) return;
      player.inVoice = !!inVoice;
      broadcast(room);
    });

    socket.on('chat_send', ({ text }, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      const player = room?.findPlayer(socket.data.playerId);
      if (!player) return cb?.({ ok: false, error: '房间不存在' });
      const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH) : '';
      if (!clean) return cb?.({ ok: false, error: '消息不能为空' });
      const now = Date.now();
      if (now - (socket.data.lastChatAt || 0) < CHAT_GAP_MS) return cb?.({ ok: false, error: '发得太快了' });
      socket.data.lastChatAt = now;
      pushChat(room, { kind: 'text', from: player.id, name: player.name, text: clean });
      cb?.({ ok: true });
    });

    socket.on('chat_history', (_payload, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      cb?.({ ok: true, lines: room.chat || [] });
    });

    socket.on('send_gesture', ({ type, icon, targetId }, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      const EMOTES = new Set([
        '👍', '👎', '😂', '😮', '😢', '🔥', '🤝', '🖕', '🤡', '💤',
        '😱', '🤔', '😎', '🙄', '👏', '🙏', '💪', '🤦', '😏', '🥳',
      ]);
      const GIFTS = new Set([
        '🌹', '🍺', '👑', '🎉', '💎', '🍕', '🚀', '🐷',
        '🍾', '🏆', '💰', '🎂', '🍫', '🧧', '🎁', '🌟', '🍷', '🦄', '🎈', '🍀',
      ]);
      const sender = room.findPlayer(socket.data.playerId);
      if (type === 'emote') {
        if (!EMOTES.has(icon)) return cb?.({ ok: false, error: '无效表情' });
        room.players.forEach((p) => {
          const sock = socketsByPlayer.get(p.id);
          if (sock) sock.emit('gesture', { type, icon, from: socket.data.playerId });
        });
        pushChat(room, { kind: 'emote', from: sender.id, name: sender.name, icon });
        return cb?.({ ok: true });
      }
      if (type === 'gift') {
        if (!GIFTS.has(icon)) return cb?.({ ok: false, error: '无效礼物' });
        const target = room.players.find((p) => p.id === targetId);
        if (!target) return cb?.({ ok: false, error: '玩家不存在' });
        room.players.forEach((p) => {
          const sock = socketsByPlayer.get(p.id);
          if (sock) sock.emit('gesture', { type, icon, from: socket.data.playerId, to: targetId });
        });
        pushChat(room, { kind: 'gift', from: sender.id, name: sender.name, to: target.name, icon });
        return cb?.({ ok: true });
      }
      cb?.({ ok: false, error: '未知类型' });
    });

    socket.on('return_to_lobby', (_payload, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      if (room.hostPlayerId !== socket.data.playerId)
        return cb?.({ ok: false, error: '只有房主可以返回大厅' });
      clearRoomTimer(room.code);
      recordHistoryAndReturnToLobby(room);
      cb?.({ ok: true });
      broadcast(room);
    });

    socket.on('rebuy_player', ({ playerId: targetId }, cb) => {
      const room = findRoomForPlayer(socket.data.playerId);
      if (!room) return cb?.({ ok: false, error: '房间不存在' });
      if (room.hostPlayerId !== socket.data.playerId)
        return cb?.({ ok: false, error: '只有房主可以操作' });
      if (room.status !== 'PLAYING' || room.hand?.stage !== 'SHOWDOWN' || !room.hand.revealed)
        return cb?.({ ok: false, error: '只能在每局结束后的结算界面补筹码' });
      if (room.trickMatch?.ended)
        return cb?.({ ok: false, error: '千术模式已完成最终结算' });
      const target = room.players.find((p) => p.id === targetId);
      if (!target) return cb?.({ ok: false, error: '玩家不存在' });
      if (target.kicked) return cb?.({ ok: false, error: '该玩家已被移出房间' });
      if (!target.eliminated) return cb?.({ ok: false, error: '该玩家还在游戏中' });
      if (room.buyIn < room.bigBlind)
        return cb?.({ ok: false, error: '补充筹码必须至少够一个大盲' });
      target.chips = room.buyIn;
      target.eliminated = false;
      target.waitingForNextHand = true;
      cb?.({ ok: true });
      if (!room.awaitingContinue && room.players.filter(
        (p) => !p.kicked && !p.eliminated && p.chips >= room.bigBlind
      ).length >= MIN_PLAYERS) {
        enterAwaitingContinue(room);
        return;
      }
      broadcast(room);
    });

    socket.on('disconnect', () => {
      const friendCode = socket.data.friendCode;
      if (friendCode) {
        onlineFriends.get(friendCode)?.delete(socket);
        friendStore.account(friendCode)?.friends.forEach(notifyFriend);
        if (!onlineFriends.get(friendCode)?.size) announceOnline();
      }
      const playerId = socket.data.playerId;
      if (!playerId) return;
      const room = findRoomForPlayer(playerId);
      if (!room) return;
      const player = room.players.find((p) => p.id === playerId);
      if (player) {
        player.connected = false;
        player.inVoice = false;
      }
      socketsByPlayer.delete(playerId);
      broadcast(room);
      maybeProceedIfAllReady(room);
      scheduleEmptyRoomCleanup(room);
    });
  });
}
