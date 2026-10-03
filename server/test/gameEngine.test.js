import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/room.js';
import { startHand, currentActor, applyAction, legalActions, getPublicState, settleEliminations, forceFoldFromHand, maxAllInTo, payToPeek, revealFoldedCards } from '../src/gameEngine.js';

function makeRoom(stacks = [1000, 1000, 1000]) {
  const room = new Room('TEST', 'p0');
  room.status = 'PLAYING';
  room.dealerSeat = -1;
  room.players = stacks.map((chips, seat) => ({
    id: `p${seat}`, name: `玩家${seat}`, seat, chips, connected: true,
    eliminated: false, kicked: false, waitingForNextHand: false,
    holeCards: null, folded: false, allIn: false, betThisRound: 0, betThisHand: 0,
  }));
  return room;
}

test('single-raise mode rejects a second raise through all-in without mutating the hand', () => {
  const room = makeRoom();
  room.raiseMode = 'single';
  startHand(room);
  applyAction(room, 'p0', 'raise', 40);
  applyAction(room, 'p1', 'raise', 60);
  applyAction(room, 'p2', 'call');
  const before = structuredClone(room);
  assert.deepEqual(legalActions(room, 'p0'), ['fold', 'call']);
  assert.throws(() => applyAction(room, 'p0', 'allin'));
  assert.deepEqual(structuredClone(room), before);
  applyAction(room, 'p0', 'call');
  assert.equal(room.hand.stage, 'FLOP');
  assert(legalActions(room, currentActor(room).id).includes('allin'));
});

test('unlimited raises still allow a capped all-in that locks the entire hand', () => {
  const room = makeRoom();
  room.maxPotPerRound = 100;
  startHand(room);
  applyAction(room, 'p0', 'raise', 40);
  applyAction(room, 'p1', 'raise', 60);
  applyAction(room, 'p2', 'call');
  assert(legalActions(room, 'p0').includes('allin'));
  applyAction(room, 'p0', 'allin');
  assert.equal(room.players[0].chips, 900);
  assert.equal(room.hand.currentBet, 100);
  assert(room.hand.allInLocked);
});

test('single-raise mode still permits an all-in call after using the raise', () => {
  const room = makeRoom();
  room.raiseMode = 'single';
  startHand(room);
  applyAction(room, 'p0', 'raise', 40);
  applyAction(room, 'p1', 'raise', 60);
  applyAction(room, 'p2', 'call');
  // Cover the defensive short-stack call branch independently of raise caps.
  room.players[0].chips = 10;
  assert(legalActions(room, 'p0').includes('allin'));
  applyAction(room, 'p0', 'allin');
  assert.equal(room.players[0].chips, 0);
  assert.equal(room.players[0].betThisHand, 50);
});

test('public raise explanation matches the rule that blocked the current player', () => {
  const room = makeRoom();
  startHand(room);
  assert.equal(getPublicState(room, 'p0').hand.raiseBlockedReason, null);
  room.maxPotPerRound = 30;
  assert.match(getPublicState(room, 'p0').hand.raiseBlockedReason, /单轮下注上限/);
  room.maxPotPerRound = null;
  room.maxPotPerHand = 30;
  assert.match(getPublicState(room, 'p0').hand.raiseBlockedReason, /整局下注上限/);
  room.maxPotPerHand = null;
  room.players[1].chips = 20;
  assert.match(getPublicState(room, 'p0').hand.raiseBlockedReason, /其他玩家筹码/);
  room.raiseMode = 'single';
  room.hand.raisedPlayerIds.add('p0');
  assert.match(getPublicState(room, 'p0').hand.raiseBlockedReason, /本轮已加注一次/);
  room.hand.allInLocked = true;
  assert.match(getPublicState(room, 'p0').hand.raiseBlockedReason, /本局已有玩家全下/);
  assert.equal(getPublicState(room, 'p1').hand.raiseBlockedReason, null);
});

test('server rejects raises and repeated all-in after someone goes all-in', () => {
  const room = makeRoom([100, 1000, 1000]);
  startHand(room);
  applyAction(room, 'p0', 'allin');
  const before = structuredClone(room);
  assert.throws(() => applyAction(room, 'p1', 'raise', 200));
  assert.deepEqual(structuredClone(room), before);
  assert.throws(() => applyAction(room, 'p1', 'allin'));
});

test('looking at publicly revealed folded cards never charges a viewer', () => {
  const room = makeRoom([1000, 1000]);
  startHand(room);
  applyAction(room, 'p0', 'fold');
  revealFoldedCards(room, 'p0');
  const before = room.players.map(p => p.chips);
  assert.throws(() => payToPeek(room, 'p1', 'p0'));
  assert.deepEqual(room.players.map(p => p.chips), before);
});

test('all-in lock persists through flop, turn and river', () => {
  const room = makeRoom([100, 1000, 1000]);
  startHand(room);
  applyAction(room, 'p0', 'allin');
  applyAction(room, 'p1', 'call');
  applyAction(room, 'p2', 'call');
  for (const stage of ['FLOP', 'TURN', 'RIVER']) {
    assert.equal(room.hand.stage, stage);
    assert.deepEqual(legalActions(room, currentActor(room).id), ['fold', 'check']);
    applyAction(room, currentActor(room).id, 'check');
    applyAction(room, currentActor(room).id, 'check');
  }
  assert.equal(room.hand.stage, 'SHOWDOWN');
  assert.equal(room.players.reduce((s, p) => s + p.chips, 0), 2100);
});

test('using the raise button to spend all chips also locks raises', () => {
  const room = makeRoom([100, 1000, 1000]);
  startHand(room);
  applyAction(room, 'p0', 'raise', 100);
  assert.equal(room.players[0].allIn, true);
  assert(!legalActions(room, 'p1').includes('raise'));
  assert.throws(() => applyAction(room, 'p1', 'raise', 200));
});

test('calling with the last chips also locks raises', () => {
  const room = makeRoom([1000, 40, 1000]);
  startHand(room);
  applyAction(room, 'p0', 'raise', 40);
  applyAction(room, 'p1', 'call');
  assert.equal(room.players[1].allIn, true);
  assert(!legalActions(room, 'p2').includes('raise'));
});

test('posting the big blind with the last chips locks raises', () => {
  const room = makeRoom([1000, 1000, 20]);
  startHand(room);
  assert(!legalActions(room, 'p0').includes('raise'));
  assert.throws(() => applyAction(room, 'p0', 'raise', 40));
});

test('players below one big blind cannot enter a new hand', () => {
  const room = makeRoom([1000, 10, 19, 1000]);
  startHand(room);
  assert.deepEqual(room.hand.actingOrder, ['p0', 'p3']);
  assert(room.players[1].eliminated && room.players[2].eliminated);
  assert.equal(room.players[1].holeCards, null);
  assert.equal(room.players[1].chips, 10);
});

test('insufficient eligible players do not start a one-player hand', () => {
  const room = makeRoom([1000, 10]);
  assert.equal(startHand(room), null);
});

test('settlement eliminates sub-blind stacks, not live all-ins before settlement', () => {
  const room = makeRoom([10, 1000, 19]);
  assert.equal(settleEliminations(room), true);
  assert(room.players[0].eliminated && room.players[2].eliminated);
});

test('previous hand contributions and cards are cleared for eliminated players', () => {
  const room = makeRoom([1000, 1000, 0]);
  Object.assign(room.players[2], { eliminated: true, betThisHand: 100, betThisRound: 100, holeCards: ['As', 'Ah'] });
  startHand(room);
  assert.equal(getPublicState(room, 'p0').hand.pot, 30);
  assert.equal(room.players[2].holeCards, null);
  applyAction(room, 'p0', 'fold');
  assert.equal(room.players.reduce((s, p) => s + p.chips, 0), 2000);
});

test('blind all-ins never leave the turn on a player with no chips', () => {
  const room = makeRoom([20, 20]);
  startHand(room);
  applyAction(room, currentActor(room).id, 'call');
  assert.equal(room.hand.stage, 'SHOWDOWN');
  assert.equal(currentActor(room), null);
  assert.equal(room.players.reduce((s, p) => s + p.chips, 0), 40);
});

test('all-in cannot refund an existing bet when a round cap is below the blind', () => {
  const room = makeRoom();
  room.maxPotPerRound = 10;
  startHand(room);
  applyAction(room, 'p0', 'call');
  applyAction(room, 'p1', 'call');
  assert(!legalActions(room, 'p2').includes('allin'));
  assert(maxAllInTo(room, room.players[2]) >= room.players[2].betThisRound);
  assert.throws(() => applyAction(room, 'p2', 'allin'));
});

test('a per-hand cap blocks a raise that a looser round cap alone would allow', () => {
  const room = makeRoom();
  room.maxPotPerHand = 30;
  startHand(room);
  const actor = currentActor(room);
  const before = structuredClone(room);
  assert(!legalActions(room, actor.id).includes('raise'));
  assert.throws(() => applyAction(room, actor.id, 'raise', 40));
  assert.deepEqual(structuredClone(room), before);
});

test('waiting players cannot act or disturb a hand when removed', () => {
  const room = makeRoom();
  startHand(room);
  room.players.push({ id: 'waiting', name: '旁观', seat: 3, chips: 1000, waitingForNextHand: true, betThisHand: 0, betThisRound: 0 });
  const before = structuredClone(room.hand);
  assert.deepEqual(legalActions(room, 'waiting'), []);
  assert.equal(forceFoldFromHand(room, 'waiting'), null);
  assert.deepEqual(room.hand, before);
});

test('invalid raise amounts cannot mutate chips', () => {
  const room = makeRoom();
  startHand(room);
  const before = structuredClone(room);
  for (const amount of [NaN, Infinity, -10, 0, 25, 99999]) {
    assert.throws(() => applyAction(room, 'p0', 'raise', amount));
    assert.deepEqual(structuredClone(room), before);
  }
});

test('removing a player at showdown cannot settle the pot twice', () => {
  const room = makeRoom([1000, 1000]);
  startHand(room);
  applyAction(room, 'p0', 'fold');
  const before = structuredClone(room);
  assert.equal(forceFoldFromHand(room, 'p1'), null);
  assert.deepEqual(structuredClone(room), before);
});

test('all-in lock is cleared only when the next hand starts', () => {
  const room = makeRoom([100, 1000, 1000]);
  startHand(room);
  applyAction(room, 'p0', 'allin');
  assert(room.hand.allInLocked);
  while (room.hand.stage !== 'SHOWDOWN') {
    const actor = currentActor(room);
    const actions = legalActions(room, actor.id);
    applyAction(room, actor.id, actions.includes('call') ? 'call' : 'check');
  }
  assert(room.hand.allInLocked);
  startHand(room);
  assert.equal(room.hand.allInLocked, false);
  assert(legalActions(room, currentActor(room).id).includes('raise'));
});

test('public state includes each contribution so UI can display net winnings', () => {
  const room = makeRoom();
  startHand(room);
  const state = getPublicState(room, 'p0');
  assert.equal(state.players.find(p => p.id === 'p1').betThisHand, 10);
  assert.equal(state.players.find(p => p.id === 'p2').betThisHand, 20);
  assert.deepEqual(state.players.find(p => p.id === 'p1').holeCards, [null, null]);
});

test('multiple hands preserve chips and always advance to settlement', () => {
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let round = 0; round < 30; round++) {
    const room = makeRoom(Array.from({ length: 2 + round % 9 }, () => 20 + Math.floor(random() * 100) * 10));
    const total = room.players.reduce((s, p) => s + p.chips, 0);
    for (let hand = 0; hand < 5; hand++) {
      if (!startHand(room)) break;
      let actions = 0;
      while (room.hand.stage !== 'SHOWDOWN') {
        assert(++actions < 250, 'hand got stuck');
        assert.equal(room.players.reduce((s, p) => s + p.chips + p.betThisHand, 0), total);
        assert(room.players.every(p => Number.isFinite(p.chips) && p.chips >= 0));
        const actor = currentActor(room);
        const legal = legalActions(room, actor.id);
        assert(legal.length > 0, 'turn is on an ineligible player');
        const action = legal[Math.floor(random() * legal.length)];
        applyAction(room, actor.id, action, action === 'raise' ? room.hand.currentBet + room.hand.minRaise : undefined);
      }
      assert.equal(room.players.reduce((s, p) => s + p.chips, 0), total);
      assert(room.players.every(p => p.chips % 10 === 0));
    }
  }
});

function tiedSettlement(contributions, dealerSeat = 0, liveCount = contributions.length - 1) {
  const room = makeRoom(contributions.map(() => 1000));
  startHand(room);
  room.dealerSeat = dealerSeat;
  room.players.forEach((p, i) => Object.assign(p, {
    chips: 1000 - contributions[i], betThisHand: contributions[i], betThisRound: 0,
    holeCards: [`${i + 2}c`, `${i + 2}d`],
    folded: i >= liveCount,
  }));
  Object.assign(room.hand, {
    stage: 'RIVER', community: ['As', 'Ks', 'Qs', 'Js', 'Ts'], currentBet: 0,
    needsToAct: new Set(room.players.filter(p => !p.folded).map(p => p.id)), turnIndex: 0,
  });
  while (room.hand.stage !== 'SHOWDOWN') applyAction(room, currentActor(room).id, 'check');
  return room;
}

test('1010 tied chips pay 500 and 510, with the extra ten left of the dealer', () => {
  for (const dealer of [0, 1]) {
    const room = tiedSettlement([500, 500, 10], dealer);
    const amounts = Object.fromEntries(room.players.map(p => [p.id, 0]));
    for (const pot of room.hand.revealed.pots) {
      assert.equal(pot.payouts.reduce((sum, payout) => sum + payout.amount, 0), pot.amount);
      for (const payout of pot.payouts) amounts[payout.playerId] += payout.amount;
    }
    assert.equal(amounts.p0, dealer === 0 ? 500 : 510);
    assert.equal(amounts.p1, dealer === 0 ? 510 : 500);
    assert.equal(amounts.p2, 0);
    assert.equal(room.players.reduce((sum, p) => sum + p.chips, 0), 3000);
    assert(room.players.every(p => p.chips % 10 === 0));
  }
});

test('three-way splits and side pots conserve chips in units of ten', () => {
  const room = tiedSettlement([330, 330, 330, 10]);
  const payouts = room.hand.revealed.pots.flatMap(pot => pot.payouts);
  assert(payouts.every(payout => payout.amount % 10 === 0));
  assert.equal(payouts.reduce((sum, payout) => sum + payout.amount, 0), 1000);
  assert.deepEqual(room.players.slice(0, 3).map(p => p.chips), [1000, 1010, 1000]);
});

test('uncontested winnings include the actual payout for display', () => {
  const room = makeRoom([1000, 1000]);
  startHand(room);
  applyAction(room, 'p0', 'fold');
  assert.deepEqual(room.hand.revealed.pots[0].payouts, [{ playerId: 'p1', amount: 30 }]);
});

test('folded contribution layers do not repeatedly award the same odd chip', () => {
  const room = tiedSettlement([500, 500, 30, 20, 10], 0, 2);
  assert.deepEqual(room.players.slice(0, 2).map(p => p.chips), [1030, 1030]);
});

test('unequal all-in contributions produce exact payouts for each side pot', () => {
  const room = tiedSettlement([100, 200, 300, 10]);
  assert.deepEqual(room.hand.revealed.pots.map(pot => pot.amount), [310, 200, 100]);
  for (const pot of room.hand.revealed.pots) {
    assert.equal(pot.payouts.reduce((sum, p) => sum + p.amount, 0), pot.amount);
    assert(pot.payouts.every(p => p.amount % 10 === 0));
  }
  assert.equal(room.players.reduce((sum, p) => sum + p.chips, 0), 4000);
});

test('a side pot whose contributors all folded goes to the last folder, not lost', () => {
  const room = makeRoom([1000, 1000, 1000]);
  startHand(room);
  room.players.forEach((p, i) => Object.assign(p, {
    chips: 1000 - [100, 500, 500][i], betThisHand: [100, 500, 500][i], betThisRound: 0,
    folded: i > 0,
  }));
  room.hand.foldOrder = ['p2', 'p1'];
  Object.assign(room.hand, { stage: 'RIVER', community: ['As', 'Ks', 'Qs', 'Js', 'Ts'], currentBet: 0,
    needsToAct: new Set(['p0']), turnIndex: room.hand.actingOrder.indexOf('p0') });
  applyAction(room, 'p0', 'check');
  assert.equal(room.players.reduce((s, p) => s + p.chips, 0), 3000);
  assert.deepEqual(room.players.map(p => p.chips), [1200, 1300, 500]);
});

test('an ordinary raise is capped at the shortest other stack, same as all-in', () => {
  const room = makeRoom([2000, 200]);
  startHand(room);
  const actor = currentActor(room).id;
  assert.throws(() => applyAction(room, actor, 'raise', 2000));
  assert.equal(getPublicState(room, actor).hand.maxRaiseTo, 200);
});
