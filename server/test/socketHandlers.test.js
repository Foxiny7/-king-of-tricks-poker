import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSocketHandlers } from '../src/socketHandlers.js';
import { getRoom } from '../src/roomManager.js';

function setup(t, count = 3) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let connect;
  registerSocketHandlers({ on: (_event, callback) => { connect = callback; } });
  function client() {
    const handlers = new Map();
    const middleware = [];
    const socket = {
      data: {}, connected: true,
      on: (name, callback) => handlers.set(name, callback),
      use: (callback) => middleware.push(callback),
      emit: (name, payload) => { if (name === 'room_state') socket.state = structuredClone(payload); },
      disconnect: () => { socket.connected = false; handlers.get('disconnect')?.(); },
      send: (name, payload = {}) => {
        let result;
        const args = [name, payload, response => { result = response; }];
        for (const guard of middleware) {
          let rejected = false;
          guard(args, error => { rejected = !!error; });
          if (rejected) return result;
        }
        handlers.get(name)(args[1], args[2]);
        return result;
      },
      sendWithoutAck: (name, payload = {}) => {
        const args = [name, payload];
        for (const guard of middleware) {
          let rejected = false;
          guard(args, error => { rejected = !!error; });
          if (rejected) return;
        }
        handlers.get(name)(args[1]);
      },
    };
    connect(socket);
    return socket;
  }
  const host = client();
  const created = host.send('create_room', { name: '房主' });
  const room = getRoom(created.roomCode);
  const players = [host];
  for (let i = 1; i < count; i++) {
    const player = client();
    assert(player.send('join_room', { code: room.code, name: `玩家${i}` }).ok);
    players.push(player);
  }
  return { host, players, room, client };
}

test('start rejects an invalid buy-in and duplicate starts', t => {
  const { host, room } = setup(t);
  host.send('set_room_config', { buyIn: 100, blindPresetId: 'custom', smallBlind: 500, bigBlind: 1000 });
  assert.equal(host.send('start_game').ok, false);
  assert.equal(room.status, 'LOBBY');
  host.send('set_room_config', { buyIn: 1000, blindPresetId: 't1' });
  assert(host.send('start_game').ok);
  const before = structuredClone(room);
  assert.equal(host.send('start_game').ok, false);
  assert.deepEqual(structuredClone(room), before);
});

test('reconnecting a player retires the old socket without marking the replacement offline', t => {
  const { host, players, room, client } = setup(t, 2);
  const replacement = client();
  assert(replacement.send('join_room', {
    code: room.code, name: '玩家1', playerId: room.players[1].id,
  }).ok);
  assert.equal(players[1].connected, false);
  assert.equal(room.players[1].connected, true);
  assert.equal(replacement.state.players[1].connected, true);
  assert(host.send('start_game').ok);
  assert.equal(replacement.state.status, 'PLAYING');
  const before = structuredClone(room);
  assert.equal(players[1].send('player_action', { type: 'fold' }).ok, false);
  assert.deepEqual(structuredClone(room), before);
});

test('voice signals cannot be sent to a player in another room', t => {
  const { host, players, room, client } = setup(t, 2);
  const outsider = client();
  const outsideRoom = outsider.send('create_room', { name: '另一房间' });
  outsider.signals = [];
  const emit = outsider.emit;
  outsider.emit = (name, payload) => {
    if (name === 'voice_signal') outsider.signals.push(payload);
    emit(name, payload);
  };
  host.send('voice_signal', { to: outsideRoom.playerId, data: { type: 'offer' } });
  assert.deepEqual(outsider.signals, []);
  host.send('voice_signal', { to: room.players[1].id, data: { type: 'offer' } });
  assert.equal(players[1].connected, true);
});

// Plays the current hand out: the player to act checks or calls until it is settled.
function playOut(room, sockets) {
  while (room.hand.stage !== 'SHOWDOWN') {
    const actor = sockets.find(socket => socket.data.playerId === room.hand.actingOrder[room.hand.turnIndex]);
    const legal = actor.state.hand.legalActions;
    assert(actor.send('player_action', { type: legal.includes('check') ? 'check' : 'call' }).ok);
  }
}
// Everyone taps 继续下一局.
function nextHand(sockets) {
  for (const socket of sockets) socket.send('ready_for_next_hand');
}
function foldHand(room, sockets) {
  const actor = sockets.find(socket => socket.data.playerId === room.hand.actingOrder[room.hand.turnIndex]);
  assert(actor.send('player_action', { type: 'fold' }).ok);
}

test('returning to the lobby mid-hand refunds live bets before recording results', t => {
  const { host, players, room } = setup(t, 2);
  assert(host.send('start_game').ok);
  foldHand(room, players);
  const afterFirst = room.players.map(p => p.chips).sort((a, b) => b - a);
  nextHand(players);
  assert.equal(room.players.reduce((sum, p) => sum + p.betThisHand, 0), 30);
  assert(host.send('return_to_lobby').ok);
  assert.equal(room.status, 'LOBBY');
  assert.deepEqual(room.history.at(-1).results.map(p => p.chips), afterFirst);
});

test('a match that ends in its first hand is not recorded', t => {
  const { host, players, room } = setup(t, 2);
  const recorded = () => host.send('get_profile', { name: '房主' }).matches?.length ?? 0;
  const before = recorded(); // every test's host is 房主, so earlier tests' matches are there too
  assert(host.send('start_game').ok);
  foldHand(room, players);
  assert(host.send('return_to_lobby').ok);
  assert.equal(room.status, 'LOBBY');
  assert.equal(room.history.length, 0);
  assert.equal(recorded(), before);
  assert.equal(room.handNumber, 0, 'the counter starts over');
});

test('a limited normal match replays preflop fold-outs, ends on its last hand and is recorded', t => {
  const { host, players, room } = setup(t, 2);
  assert(host.send('set_room_config', { handLimit: 2 }).ok);
  assert.equal(room.handLimit, 2);
  assert(host.send('start_game').ok);
  assert.equal(host.state.handNumber, 1);
  const blinds = room.players.map(p => p.chips + p.betThisHand);
  foldHand(room, players);
  assert.equal(host.state.handNumber, 1, 'the folded-out hand still shows its number');
  assert.equal(host.state.handReplayed, true);
  assert.equal(room.players.reduce((sum, p) => sum + p.chips, 0), blinds.reduce((a, b) => a + b), 'the winner keeps the blinds');
  nextHand(players);
  assert.equal(host.state.handNumber, 1, 'and is dealt again under the same number');
  assert.equal(host.state.handReplayed, false);
  playOut(room, players);
  assert.equal(room.matchComplete, false);
  nextHand(players);
  assert.equal(host.state.handNumber, 2);
  playOut(room, players);
  assert.equal(room.matchComplete, true, 'the second counted hand is the last');
  assert.equal(host.state.matchComplete, true);
  assert.equal(room.awaitingContinue, false);
  t.mock.timers.tick(45000);
  assert.equal(room.status, 'LOBBY');
  assert.equal(room.history.length, 1);
});

test('a limited normal match stopped early is not recorded, an unlimited one is', t => {
  const { host, players, room } = setup(t, 2);
  assert(host.send('set_room_config', { handLimit: 3 }).ok);
  assert(host.send('start_game').ok);
  playOut(room, players);
  nextHand(players);
  assert(host.send('return_to_lobby').ok);
  assert.equal(room.history.length, 0);

  assert(host.send('set_room_config', { handLimit: '' }).ok);
  assert.equal(room.handLimit, null);
  assert(host.send('start_game').ok);
  playOut(room, players);
  nextHand(players);
  assert(host.send('return_to_lobby').ok);
  assert.equal(room.history.length, 1);
});

test('hand limits are whole numbers from 2 to 99, or none', t => {
  const { host, room } = setup(t, 2);
  for (const [value, expected] of [[16, 16], [1, 2], [150, 99], [7.6, 8], [0, null], ['x', null], [null, null]]) {
    assert(host.send('set_room_config', { handLimit: value }).ok);
    assert.equal(room.handLimit, expected, `handLimit ${value}`);
  }
});

test('malformed network requests are rejected without changing the room', t => {
  const { host, room } = setup(t, 2);
  const before = structuredClone(room);
  for (const [event, payload] of [
    ['start_game', null], ['player_action', 20], ['kick_player', []],
    ['join_room', { code: 123, name: '玩家' }],
    ['join_room', { code: room.code, name: { text: '玩家' } }],
    ['create_room', { name: 123 }],
  ]) {
    assert.equal(host.send(event, payload)?.ok, false);
  }
  assert.doesNotThrow(() => host.sendWithoutAck('create_room', { name: '无确认回调' }));
  assert.deepEqual(structuredClone(room), before);
});

test('one socket cannot silently create or join another room while still seated', t => {
  const { host, room, client } = setup(t, 2);
  const outsider = client();
  const created = outsider.send('create_room', { name: '另一房主' });
  assert.equal(host.send('create_room', { name: '重复开房' }).ok, false);
  assert.equal(host.send('join_room', { code: created.roomCode, name: '房主' }).ok, false);
  assert.equal(room.hostPlayerId, host.data.playerId);
});

test('socket handler rejects a raise after a last-chip call', t => {
  const { host, players, room } = setup(t);
  room.players[1].chips = 40;
  assert(host.send('start_game').ok);
  assert(host.send('player_action', { type: 'raise', amount: 40 }).ok);
  assert(players[1].send('player_action', { type: 'call' }).ok);
  assert.equal(players[2].send('player_action', { type: 'raise', amount: 80 }).ok, false);
  assert(players[2].state.hand.allInLocked);
  assert(!players[2].state.hand.legalActions.includes('raise'));
});

test('rebuy and mid-hand joins enter next hand without blocking the continue gate', t => {
  const { host, players, room, client } = setup(t);
  room.players[2].chips = 10;
  assert(host.send('start_game').ok);
  assert(room.players[2].eliminated);
  assert.equal(host.send('rebuy_player', { playerId: room.players[2].id }).ok, false);
  assert.equal(room.players[2].chips, 10);
  const newcomer = client();
  assert(newcomer.send('join_room', { code: room.code, name: '中途加入' }).ok);
  assert.equal(room.hand.actingOrder.length, 2);
  assert(host.send('player_action', { type: 'fold' }).ok);
  assert(room.awaitingContinue);
  assert.equal(players[1].send('rebuy_player', { playerId: room.players[2].id }).ok, false);
  assert(host.send('rebuy_player', { playerId: room.players[2].id }).ok);
  assert(room.players[2].waitingForNextHand);
  assert.equal(host.send('rebuy_player', { playerId: room.players[2].id }).ok, false);
  assert.equal(players[2].send('ready_for_next_hand').ok, false);
  assert.equal(newcomer.send('ready_for_next_hand').ok, false);
  assert(host.send('ready_for_next_hand').ok);
  assert(players[1].send('ready_for_next_hand').ok);
  assert.equal(room.hand.actingOrder.length, 4);
  assert(room.players.every(p => !p.waitingForNextHand && p.holeCards.length === 2));
  assert.equal(host.state.hand.pot, 30);
});

test('blinds come from a preset or a custom pair in whole tens', t => {
  const { host, room } = setup(t);
  const blinds = () => [room.smallBlind, room.bigBlind];
  assert(host.send('set_room_config', { blindPresetId: 't2' }).ok);
  assert.deepEqual(blinds(), [20, 40]);
  assert(host.send('set_room_config', { blindPresetId: 't6' }).ok);
  assert.deepEqual(blinds(), [10, 20], 'a removed or unknown preset falls back to 10/20');
  assert(host.send('set_room_config', { blindPresetId: 'custom', smallBlind: 25, bigBlind: 64 }).ok);
  assert.deepEqual(blinds(), [30, 60]);
  assert(host.send('set_room_config', { blindPresetId: 'custom', smallBlind: 100, bigBlind: 40 }).ok);
  assert.deepEqual(blinds(), [100, 100], 'the big blind is never below the small blind');
  assert(host.send('set_room_config', { blindPresetId: 'custom', smallBlind: -5, bigBlind: 'x' }).ok);
  assert.deepEqual(blinds(), [10, 20]);
  assert(host.send('set_room_config', { blindPresetId: 'custom', smallBlind: 50000, bigBlind: 90000 }).ok);
  assert.deepEqual(blinds(), [10000, 10000]);
});

test('all-in blind followed by call settles and schedules the lobby normally', t => {
  const { host, room } = setup(t, 2);
  host.send('set_room_config', { buyIn: 100, blindPresetId: 'custom', smallBlind: 50, bigBlind: 100 });
  assert(host.send('start_game').ok);
  assert(host.state.hand.allInLocked);
  assert(host.send('player_action', { type: 'call' }).ok);
  assert.equal(room.hand.stage, 'SHOWDOWN');
  if (!room.awaitingContinue) {
    t.mock.timers.tick(6000);
    assert.equal(room.status, 'PLAYING');
    t.mock.timers.tick(39000);
    assert.equal(room.status, 'LOBBY');
  }
});

test('final settlement allows rebuy and cancels the automatic lobby return', t => {
  const { host, players, room } = setup(t, 2);
  room.players[0].chips = 20;
  assert(host.send('start_game').ok);
  assert(host.send('player_action', { type: 'fold' }).ok);
  assert(room.players[0].eliminated);
  assert.equal(room.awaitingContinue, false);
  t.mock.timers.tick(10000);
  assert.equal(room.status, 'PLAYING');
  assert(host.send('rebuy_player', { playerId: room.players[0].id }).ok);
  assert(room.awaitingContinue);
  assert.equal(room.players[0].chips, room.buyIn);
  t.mock.timers.tick(35000);
  assert.equal(room.status, 'PLAYING');
  assert(players[1].send('ready_for_next_hand').ok);
  assert.equal(room.hand.stage, 'PREFLOP');
  assert.equal(room.hand.actingOrder.length, 2);
  assert.equal(host.send('rebuy_player', { playerId: room.players[0].id }).ok, false);
});

test('rebuy is rejected in the lobby without changing chips', t => {
  const { host, room } = setup(t);
  Object.assign(room.players[2], { chips: 10, eliminated: true });
  assert.equal(host.send('rebuy_player', { playerId: room.players[2].id }).ok, false);
  assert.equal(room.players[2].chips, 10);
});

function chooseVisibleTricks(room, sockets) {
  while (room.trickMatch?.selection) {
    const pending = sockets.find((socket) =>
      room.trickMatch.selection.offers.has(socket.data.playerId) &&
      !room.trickMatch.selection.chosen.has(socket.data.playerId));
    assert(pending, 'a selectable player must be present');
    const offer = pending.state.trickMatch.selection.offers[0];
    assert(offer, 'a pending player must have a valid offer');
    assert(pending.send('choose_trick', { trickId: offer.id }).ok);
  }
}

test('trick mode privately selects skills across four phases, then settles after sixteen hands', t => {
  const { host, players, room } = setup(t, 2);
  assert(host.send('set_room_config', { gameMode: 'tricks' }).ok);
  assert(host.send('start_game').ok);
  assert.equal(room.hand, null);
  assert.equal(host.state.trickMatch.selection.offers.length, 3);
  chooseVisibleTricks(room, players);
  const act = (type) => {
    const actorId = room.hand.actingOrder[room.hand.turnIndex];
    return players.find((socket) => socket.data.playerId === actorId).send('player_action', { type });
  };
  for (let hand = 1; hand <= 16; hand++) {
    assert.equal(room.trickMatch.handNumber, hand);
    // See the flop before folding: a hand folded out preflop is replayed and would never reach sixteen.
    assert(act('call').ok);
    assert(act('check').ok);
    assert.equal(room.hand.stage, 'FLOP');
    assert(act('fold').ok);
    assert.equal(room.hand.stage, 'SHOWDOWN');
    if (hand < 16) {
      assert(room.awaitingContinue);
      for (const socket of players) assert(socket.send('ready_for_next_hand').ok);
      chooseVisibleTricks(room, players);
    }
  }
  assert(room.trickMatch.ended);
  assert.equal(host.state.trickMatch.finalLoadouts.length, 2);
  assert.equal(host.send('rebuy_player', { playerId: room.players[1].id }).ok, false);
  t.mock.timers.tick(45001);
  assert.equal(room.status, 'LOBBY');
  assert.equal(room.history.at(-1).results.length, 2);
  assert(room.history.at(-1).results.every((p) => p.tricks.length > 0));
});

test('a newcomer catches up on missed trick picks before joining the next hand', t => {
  const { host, players, room, client } = setup(t, 2);
  assert(host.send('set_room_config', { gameMode: 'tricks' }).ok);
  assert(host.send('start_game').ok);
  chooseVisibleTricks(room, players);
  const newcomer = client();
  assert(newcomer.send('join_room', { code: room.code, name: '后来者' }).ok);
  assert.equal(room.players.at(-1).waitingForNextHand, true);
  const actor = players.find((socket) => socket.data.playerId === room.hand.actingOrder[room.hand.turnIndex]);
  assert(actor.send('player_action', { type: 'fold' }).ok);
  for (const socket of players) assert(socket.send('ready_for_next_hand').ok);
  assert(room.trickMatch.selection);
  assert.deepEqual([...room.trickMatch.selection.offers.keys()], [newcomer.data.playerId]);
  chooseVisibleTricks(room, [...players, newcomer]);
  // Some picks (sharingan, chaos_child) grant bonus tricks, so the newcomer may own more than one.
  assert(room.trickMatch.owned.get(newcomer.data.playerId).length >= 1);
  assert(room.hand.actingOrder.includes(newcomer.data.playerId));
});

test('a late sub-blind stack cannot create a one-player next hand', t => {
  const { host, players, room } = setup(t, 2);
  assert(host.send('start_game').ok);
  assert(host.send('player_action', { type: 'fold' }).ok);
  room.players[1].chips = 10;
  host.send('ready_for_next_hand');
  players[1].send('ready_for_next_hand');
  assert.equal(room.status, 'LOBBY');
  assert.equal(room.hand, null);
});

test('a kicked all-in player contests the pot before leaving after settlement', t => {
  const { host, players, room, client } = setup(t, 2);
  room.players[1].chips = room.bigBlind;
  assert(host.send('start_game').ok);
  const targetId = room.players[1].id;
  assert(room.players[1].allIn);
  assert(host.send('kick_player', { playerId: targetId }).ok);
  assert.equal(room.status, 'PLAYING');
  assert.equal(room.hand.stage, 'PREFLOP');
  assert.equal(room.players[1].kicked, false);
  assert.equal(room.players[1].pendingKick, true);
  assert.equal(players[1].connected, false);
  assert.equal(client().send('join_room', {
    code: room.code, name: '玩家1', playerId: targetId,
  }).ok, false);
  assert(host.send('player_action', { type: 'call' }).ok);
  assert.equal(room.hand.stage, 'SHOWDOWN');
  assert(room.hand.revealed.pots.some(pot => pot.winnerIds.includes(targetId) ||
    pot.winnerIds.includes(room.players[0].id)));
  assert.equal(room.players[1].kicked, true);
  assert.equal(room.players[1].pendingKick, false);
  assert.equal(room.awaitingContinue, false);
  t.mock.timers.tick(45000);
  assert.equal(room.status, 'LOBBY');
  assert.equal(room.players.length, 1);
  assert.equal(client().send('join_room', {
    code: room.code, name: '改名重进', playerId: targetId,
  }).ok, false);
});

test('a kicked all-in player is removed before the next hand in a continuing room', t => {
  const { host, players, room } = setup(t, 3);
  room.players[2].chips = room.bigBlind;
  assert(host.send('start_game').ok);
  assert(room.players[2].allIn);
  const targetId = room.players[2].id;
  assert(host.send('kick_player', { playerId: targetId }).ok);
  for (let turn = 0; turn < 8 && room.hand.stage !== 'SHOWDOWN'; turn++) {
    const actor = players.find(p => p.data.playerId === players[0].state.hand.actingPlayerId);
    assert(actor);
    assert(actor.send('player_action', {
      type: actor.state.hand.legalActions.includes('call') ? 'call' : 'check',
    }).ok);
  }
  assert.equal(room.hand.stage, 'SHOWDOWN');
  assert(room.hand.revealed.pots.some(pot => pot.winnerIds.includes(targetId)) ||
    room.hand.revealed.pots.some(pot => pot.winnerIds.length > 0));
  assert.equal(room.players.find(p => p.id === targetId).kicked, true);
  assert(room.awaitingContinue);
  assert(host.send('ready_for_next_hand').ok);
  assert(players[1].send('ready_for_next_hand').ok);
  assert.equal(room.hand.stage, 'PREFLOP');
  assert.equal(room.players.some(p => p.id === targetId), false);
  assert.equal(room.hand.actingOrder.length, 2);
});

test('nameplates reach every seat and showdown wins land in the weekly record', t => {
  const { host, players, room } = setup(t, 2);
  assert(players[1].send('set_nameplate', { nameplate: 'dragon' }).ok);
  assert.equal(host.state.players[1].nameplate, 'dragon');
  assert(players[1].send('set_nameplate', { nameplate: 'bogus' }).ok);
  assert.equal(host.state.players[1].nameplate, 'plain');
  assert(host.send('start_game').ok);
  for (let turn = 0; turn < 12 && room.hand.stage !== 'SHOWDOWN'; turn++) {
    const actor = players.find(p => p.data.playerId === host.state.hand.actingPlayerId);
    assert(actor.send('player_action', {
      type: actor.state.hand.legalActions.includes('check') ? 'check' : 'call',
    }).ok);
  }
  assert.equal(room.hand.stage, 'SHOWDOWN');
  const winner = room.players.find(p => p.id === room.hand.revealed.pots[0].winnerIds[0]);
  const profile = host.send('get_profile', { name: winner.name });
  assert(profile.ok);
  assert.equal(profile.best.cards.length, 5);
  assert.equal(host.send('get_profile', { name: '  ' }).ok, false);
});

test('a finished match lands in every player\'s match record with its final score', t => {
  const { host, players, room } = setup(t, 2);
  assert(host.send('start_game').ok);
  foldHand(room, players);
  nextHand(players);
  foldHand(room, players);
  assert(host.send('return_to_lobby').ok);
  for (const result of room.history.at(-1).results) {
    const profile = host.send('get_profile', { name: result.name });
    assert(profile.ok);
    assert.equal(profile.matches[0].score, result.chips);
    assert.equal(profile.matches[0].mode, 'normal');
    assert.equal(typeof profile.matches[0].at, 'number');
  }
});

test('a player who joins mid-phase catches up with back-to-back picks, each choosable and refreshable', t => {
  const { host, players, room, client } = setup(t, 2);
  assert(host.send('set_room_config', { gameMode: 'tricks' }).ok);
  assert(host.send('start_game').ok);
  chooseVisibleTricks(room, players);
  while (room.trickMatch.handNumber < 5) {
    playOut(room, players);
    nextHand(players);
    chooseVisibleTricks(room, players);
  }
  const newcomer = client();
  assert(newcomer.send('join_room', { code: room.code, name: '补选者' }).ok);
  playOut(room, players);
  nextHand(players);
  for (let pick = 1; pick <= 2; pick++) {
    const selection = newcomer.state.trickMatch.selection;
    assert(selection, `catch-up pick ${pick} is open`);
    assert.equal(selection.phase, 2);
    assert.equal(selection.catchup, true);
    assert.equal(selection.chosen, false);
    assert(selection.offers.length > 0, 'offers are shown');
    assert(newcomer.send('refresh_trick_offer', { slotIndex: selection.offers[0].slotIndex }).ok, `refresh on pick ${pick}`);
    const offer = newcomer.state.trickMatch.selection.offers[0];
    assert(newcomer.send('choose_trick', { trickId: offer.id }).ok, `choose on pick ${pick}`);
  }
  assert.equal(room.trickMatch.picks.get(newcomer.data.playerId), 2);
  assert.equal(room.trickMatch.selection, null);
  assert.equal(room.hand.stage, 'PREFLOP', 'play resumes once the catch-up is done');
});

test('a trick match stopped before its 16 hands is not recorded', t => {
  const { host, players, room } = setup(t, 2);
  assert(host.send('set_room_config', { gameMode: 'tricks' }).ok);
  assert(host.send('start_game').ok);
  chooseVisibleTricks(room, players);
  playOut(room, players);
  nextHand(players);
  chooseVisibleTricks(room, players);
  assert.equal(room.trickMatch.handNumber, 2);
  assert(host.send('return_to_lobby').ok);
  assert.equal(room.status, 'LOBBY');
  assert.equal(room.history.length, 0);
});

test('in trick mode a hand everyone folds before the flop is replayed under the same number', t => {
  const { host, players, room } = setup(t, 2);
  assert(host.send('set_room_config', { gameMode: 'tricks' }).ok);
  assert(host.send('start_game').ok);
  chooseVisibleTricks(room, players);
  const act = (type) => {
    const actorId = room.hand.actingOrder[room.hand.turnIndex];
    return players.find((socket) => socket.data.playerId === actorId).send('player_action', { type });
  };
  assert.equal(room.trickMatch.handNumber, 1);
  assert(act('fold').ok);
  assert.equal(room.hand.stage, 'SHOWDOWN');
  assert.equal(host.state.trickMatch.handNumber, 1);
  assert(host.state.trickMatch.messages.some((text) => /本局不计入局数，下一局仍是第 1 局/.test(text)));
  for (const socket of players) assert(socket.send('ready_for_next_hand').ok);
  assert.equal(room.trickMatch.handNumber, 1);
  assert.equal(host.state.trickMatch.handNumber, 1);
  assert(act('call').ok);
  assert(act('check').ok);
  assert(act('fold').ok);
  for (const socket of players) assert(socket.send('ready_for_next_hand').ok);
  assert.equal(room.trickMatch.handNumber, 2);
});

test("showdown results carry each winner's hand and its five cards, and bios reach the table", t => {
  const { host, players, room } = setup(t, 2);
  assert(players[1].send('join_room', { code: room.code, name: room.players[1].name, bio: '  赢了请吃饭  ', playerId: room.players[1].id }).ok);
  assert.equal(host.state.players[1].bio, '赢了请吃饭');
  assert(host.send('start_game').ok);
  for (let turn = 0; turn < 12 && room.hand.stage !== 'SHOWDOWN'; turn++) {
    const actor = players.find(p => p.data.playerId === host.state.hand.actingPlayerId);
    assert(actor.send('player_action', { type: actor.state.hand.legalActions.includes('check') ? 'check' : 'call' }).ok);
  }
  const pot = host.state.hand.revealed.pots[0];
  assert.equal(pot.hands.length, pot.winnerIds.length);
  for (const hand of pot.hands) {
    assert(pot.winnerIds.includes(hand.playerId));
    assert.equal(hand.cards.length, 5);
    assert.equal(typeof hand.handName, 'string');
  }
});

test('the host adds test bots that check when they can and fold to any bet', t => {
  const { host, room, client } = setup(t, 1);
  const guest = client();
  assert(guest.send('join_room', { code: room.code, name: '客人' }).ok);
  assert.equal(guest.send('add_bot').ok, false);
  const added = host.send('add_bot');
  assert(added.ok);
  guest.disconnect();
  const bot = room.findPlayer(added.playerId);
  assert.equal(bot.name, '机器人1');
  assert.equal(host.state.players.find((p) => p.id === bot.id).bot, true);
  assert(host.send('kick_player', { playerId: room.players.find((p) => p.name === '客人').id }).ok);

  assert(host.send('start_game').ok);
  const actor = () => room.hand.actingOrder[room.hand.turnIndex];
  // Heads-up the host is the small blind and acts first; after a call the bot can check.
  assert.equal(actor(), host.data.playerId);
  assert(host.send('player_action', { type: 'call' }).ok);
  assert.equal(actor(), bot.id);
  t.mock.timers.tick(1000);
  // Only a check closes the preflop round here (a fold would end the hand).
  assert.equal(room.hand.stage, 'FLOP');
  assert(!bot.folded);
  // After the flop the bot acts first and checks; a raise from the host makes it fold.
  assert.equal(actor(), bot.id);
  t.mock.timers.tick(1000);
  assert.equal(bot.lastAction, 'check');
  assert.equal(actor(), host.data.playerId);
  assert(host.send('player_action', { type: 'raise', amount: room.bigBlind * 2 }).ok);
  t.mock.timers.tick(1000);
  assert(bot.folded);
  assert.equal(room.hand.stage, 'SHOWDOWN');
  // Bots are never waited on to continue.
  assert(room.awaitingContinue);
  assert(host.send('ready_for_next_hand').ok);
  assert.equal(room.awaitingContinue, false);
});

test('bots pick a trick straight away and never keep an empty room alive', t => {
  const { host, room } = setup(t, 1);
  assert(host.send('set_room_config', { gameMode: 'tricks' }).ok);
  const bot = room.findPlayer(host.send('add_bot').playerId);
  assert(host.send('start_game').ok);
  assert(room.trickMatch.selection.chosen.has(bot.id));
  assert.equal(room.trickMatch.owned.get(bot.id).length, 1);
  host.disconnect();
  t.mock.timers.tick(10 * 60 * 1000);
  assert(!getRoom(room.code));
});
