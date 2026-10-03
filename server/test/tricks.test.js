import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/room.js';
import { startHand, getPublicState, applyAction, forceFoldFromHand, legalActions } from '../src/gameEngine.js';
import { TRICKS, beginTrickMatch, beginTrickSelection, chooseTrick, autoChooseTricks, plannedBoard,
  trickTurnSeconds, useTrick, onTrickNextBoard, refreshTrickOffer,
  onTrickSettlement, TRICK_PHASE_HANDS, TRICK_PHASES } from '../src/tricks.js';

function roomWithPlayers(count = 3) {
  const room = new Room('TRICK', 'p0');
  room.status = 'PLAYING';
  room.gameMode = 'tricks';
  room.dealerSeat = -1;
  room.players = Array.from({ length: count }, (_, seat) => ({
    id: `p${seat}`, name: `玩家${seat}`, seat, chips: 1000,
    connected: true, eliminated: false, kicked: false,
    waitingForNextHand: false, holeCards: null, folded: false,
    allIn: false, betThisRound: 0, betThisHand: 0,
  }));
  return room;
}

test('selection is private, takes one candidate per player and auto-upgrades a series', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  const selection = beginTrickSelection(room, () => 0);
  assert.equal(selection.offers.get('p0').length, 3);
  assert.equal(new Set(selection.offers.get('p0').map(id => id.split('_')[0])).size, 3);
  const first = selection.offers.get('p0')[0];
  assert.equal(first, 'mark_one');
  assert.equal(getPublicState(room, 'p0').trickMatch.selection.offers[0].id, first);
  assert.equal(getPublicState(room, 'p0').trickMatch.selection.phase, 1);
  assert.equal(getPublicState(room, 'p1').trickMatch.owned.length, 0);
  assert.equal(chooseTrick(room, 'p0', first), false);
  assert.throws(() => chooseTrick(room, 'p0', selection.offers.get('p0')[1]));
  autoChooseTricks(room);
  assert.equal(room.trickMatch.owned.get('p0')[0], first);
  room.trickMatch.handNumber = 4;
  beginTrickSelection(room, () => 0).offers.set('p0', ['peek_rank']);
  assert.throws(() => chooseTrick(room, 'p0', 'mark_both'), /不在候选/);
  assert.equal(chooseTrick(room, 'p0', 'peek_rank'), false);
  assert.deepEqual(room.trickMatch.owned.get('p0'), ['mark_both', 'peek_rank']);
});

test('phase one excludes legendary offers and phase four excludes common offers', () => {
  for (const { phase, random, forbidden } of [
    { phase: 1, random: () => 0.999, forbidden: 'legendary' },
    { phase: 4, random: () => 0, forbidden: 'common' },
  ]) {
    const room = roomWithPlayers(2);
    beginTrickMatch(room);
    room.trickMatch.handNumber = (phase - 1) * 4;
    const selection = beginTrickSelection(room, random);
    assert.equal(selection.phase, phase);
    for (const offers of selection.offers.values())
      assert(offers.every((id) => TRICKS[id].rarity !== forbidden));
    autoChooseTricks(room, random);
    assert([...room.trickMatch.owned.values()].flat().every((id) =>
      phase !== 1 || TRICKS[id].rarity !== 'legendary'));
  }
});

test('configured match-wide and per-phase limits are shown and enforced by the server', () => {
  const limits = [
    ['control_five', 2, '整场限用 2 次'],
    ['exchange', 2, '每阶段限用 2 次'],
    ['intuition', 8, '整场限用 8 次'],
    ['drain_quarter', 2, '整场限用 2 次'],
    ['peek_both', 2, '每阶段限用 2 次'],
    ['steal_hole', 2, '每阶段限用 2 次'],
    ['swap_five', 6, '整场限用 6 次'],
    ['strength_count', 2, '每阶段限用 2 次'],
    ['suit_count', 2, '每阶段限用 2 次'],
    ['disable_tricks', 4, '整场限用 4 次'],
    ['river_report', 2, '每阶段限用 2 次'],
  ];
  for (const [trickId, limit, label] of limits) {
    assert.equal(TRICKS[trickId].usage, label, trickId);
    const room = roomWithPlayers(3);
    beginTrickMatch(room);
    room.trickMatch.selection = null;
    room.trickMatch.owned.set('p0', [trickId]);
    startHand(room);
    room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
    room.trickMatch.uses.set(`p0:${trickId}`, Array.from({ length: limit }, () => 1));
    assert.throws(() => useTrick(room, 'p0', trickId), /次数|上限/ , trickId);
  }
});

test('owned tricks report remaining uses in their matching hand, phase, or match window', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['king_card', 'exchange', 'peek_rank']);
  startHand(room);
  const view = () => Object.fromEntries(getPublicState(room, 'p0').trickMatch.owned
    .map((trick) => [trick.id, trick.remainingUsage]));
  assert.equal(view().king_card, '整场剩余 2 / 2 次');
  assert.equal(view().exchange, '本阶段剩余 2 / 2 次');
  assert.equal(view().peek_rank, '本局剩余 1 / 1 次');
  room.trickMatch.uses.set('p0:king_card', [1]);
  room.trickMatch.uses.set('p0:exchange', [1]);
  room.hand.trickUsedThisHand.add('p0:peek_rank');
  assert.equal(view().king_card, '整场剩余 1 / 2 次');
  assert.equal(view().exchange, '本阶段剩余 1 / 2 次');
  assert.equal(view().peek_rank, '本局剩余 0 / 1 次');
});

test('rare read clocks stack for other players, with no duplicate self bonus', () => {
  const room = roomWithPlayers(5);
  beginTrickMatch(room);
  room.trickMatch.owned.set('p1', ['clock_rare']);
  assert.equal(trickTurnSeconds(room, 'p0'), 15, 'each 夺时 held by someone else takes 15 seconds');
  assert.equal(trickTurnSeconds(room, 'p1'), 40, 'its holder gains 10 once');
  for (let i = 2; i <= 4; i++) room.trickMatch.owned.set(`p${i}`, ['clock_rare']);
  assert.equal(trickTurnSeconds(room, 'p0'), 5, 'never below five seconds');
});

test('fate swap exchanges exactly two real cards with the flop leader and respects epic guard', () => {
  const room = roomWithPlayers();
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['fate_swap']);
  startHand(room);
  const [p0, p1, p2] = room.players;
  room.hand.stage = 'FLOP';
  room.hand.community = ['Ah', 'Kd', '2c'];
  p0.holeCards = ['3d', '4d'];
  p1.holeCards = ['As', 'Ac'];
  p2.holeCards = ['Kh', 'Ks'];
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  room.trickMatch.owned.set('p1', ['guard_epic']);
  assert.throws(() => useTrick(room, 'p0', 'fate_swap'), /没有可交换/);
  assert.equal(room.trickMatch.uses.get('p0:fate_swap'), undefined);
  room.trickMatch.owned.delete('p1');
  useTrick(room, 'p0', 'fate_swap', { targetId: 'p2' });
  assert.deepEqual(p0.holeCards, ['As', 'Ac']);
  assert.deepEqual(p1.holeCards, ['3d', '4d']);
  assert.equal(room.trickMatch.uses.get('p0:fate_swap').length, 1);
});

test('river report includes folded hands but exposes the category only to its owner', () => {
  const room = roomWithPlayers();
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['river_report']);
  startHand(room);
  room.hand.stage = 'RIVER';
  room.hand.community = ['Ah', 'Kh', 'Qh', '2c', '3d'];
  room.players[0].holeCards = ['4s', '5s'];
  room.players[1].holeCards = ['Jh', 'Th'];
  room.players[1].folded = true;
  room.players[2].holeCards = ['2d', '3c'];
  useTrick(room, 'p0', 'river_report');
  const ownerState = getPublicState(room, 'p0');
  const otherState = getPublicState(room, 'p2');
  assert.match(ownerState.trickMatch.messages.at(-1), /河牌公报/);
  assert.deepEqual(otherState.trickMatch.messages, []);
  assert.match(otherState.trickMatch.publicAnnouncements[0], /两对/);
  assert.deepEqual(ownerState.players[1].holeCards, [null, null]);
});

test('catalog contains at least sixty playable choices and retention belongs to only one player', () => {
  assert(Object.keys(TRICKS).length >= 60);
  assert(Object.values(TRICKS).every((trick) => trick.usage && trick.condition));
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection.offers = new Map([
    ['p0', ['retention_common']],
    ['p1', ['retention_common', 'high_probe']],
  ]);
  chooseTrick(room, 'p0', 'retention_common');
  assert.throws(() => chooseTrick(room, 'p1', 'retention_common'), /留底/);
  autoChooseTricks(room);
  assert.deepEqual(room.trickMatch.owned.get('p1'), ['high_probe']);
});

test('retention draws extra cards without reusing them in the deck', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['retention_legendary']);
  startHand(room);
  assert.equal(room.hand.deck.length, 40);
  const activeCards = [...room.players.flatMap((p) => p.holeCards), ...room.hand.deck];
  assert.equal(new Set(activeCards).size, activeCards.length);
});

test('all retention cards are private intel, with nonselectable cards shown separately', () => {
  for (const [trickId, count, selectable] of [
    ['retention_common', 5, 3], ['retention_rare', 7, 3],
    ['retention_epic', 8, 4], ['retention_legendary', 10, 5],
  ]) {
    const room = roomWithPlayers(2);
    beginTrickMatch(room);
    room.trickMatch.selection = null;
    room.trickMatch.owned.set('p0', [trickId]);
    startHand(room);
    const owner = getPublicState(room, 'p0').trickMatch;
    const other = getPublicState(room, 'p1').trickMatch;
    const views = owner.views.filter((view) => view.label.startsWith('留底'));
    assert.equal(views[0].cards.length, selectable);
    assert.equal(views[1].cards.length, count - selectable);
    assert.deepEqual([...views[0].cards, ...views[1].cards], room.hand.trickRetention.get('p0').cards);
    assert.deepEqual(views[0].cards.slice(0, 2), room.players[0].holeCards);
    assert.equal(other.views.some((view) => view.label.startsWith('留底')), false);
  }
});

test('legendary retention keeps exactly two hole cards through preflop and river selections', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['retention_legendary']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  useTrick(room, 'p0', 'retention_legendary');
  const first = getPublicState(room, 'p0').trickMatch.pendingChoice.cards;
  assert.equal(first.length, 5);
  useTrick(room, 'p0', 'retention_legendary', { choiceIndexes: [0, 4] });
  assert.deepEqual(room.players[0].holeCards, [first[0], first[4]]);
  assert.equal(room.players[0].holeCards.length, 2);
  room.hand.stage = 'RIVER';
  room.hand.community = Array.from({ length: 5 }, () => room.hand.deck.pop());
  useTrick(room, 'p0', 'retention_legendary');
  const river = getPublicState(room, 'p0').trickMatch.pendingChoice;
  assert.equal(river.cards.length, 7);
  assert.equal(river.river, true);
  useTrick(room, 'p0', 'retention_legendary', { choiceIndexes: [0, 2] });
  assert.deepEqual(room.players[0].holeCards, [river.cards[2], first[4]]);
  assert.equal(room.trickMatch.uses.get('p0:retention_legendary').length, 1);
  assert(!room.hand.deck.includes(river.cards[2]));
});

test('phase two common offer upgrades automatically and each slot refreshes twice', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.handNumber = 4;
  const selection = beginTrickSelection(room, () => 0);
  selection.offers.set('p0', ['mark_one', 'peek_rank', 'blind_box']);
  const refreshed = refreshTrickOffer(room, 'p0', 2, () => 0.9);
  assert.notEqual(refreshed, 'blind_box');
  refreshTrickOffer(room, 'p0', 2, () => 0.8);
  assert.throws(() => refreshTrickOffer(room, 'p0', 2), /已经刷新/);
  assert.equal(getPublicState(room, 'p0').trickMatch.selection.offers[0].autoUpgradeTo,
    TRICKS.mark_both.name);
  chooseTrick(room, 'p0', 'mark_one');
  assert.deepEqual(room.trickMatch.owned.get('p0'), ['mark_both']);
});

test('ace alarm and face tally are one series with a common-to-rare upgrade', () => {
  assert.equal(TRICKS.ace_alarm.family, TRICKS.face_tally.family);
  assert.equal(TRICKS.ace_alarm.name, '牌兆·王牌气息');
  assert.equal(TRICKS.face_tally.name, '牌兆·花牌点名');
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.handNumber = 4;
  const selection = beginTrickSelection(room, () => 0);
  selection.offers.set('p0', ['ace_alarm']);
  assert.equal(getPublicState(room, 'p0').trickMatch.selection.offers[0].autoUpgradeTo,
    TRICKS.face_tally.name);
  chooseTrick(room, 'p0', 'ace_alarm');
  assert.deepEqual(room.trickMatch.owned.get('p0'), ['face_tally']);
});

test('phase two common offer grants the card and upgrades the first eligible owned trick', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.handNumber = 4;
  const selection = beginTrickSelection(room, () => 0);
  room.trickMatch.owned.set('p0', ['mark_one', 'reveal_one']);
  selection.offers.set('p0', ['peek_rank']);
  const view = getPublicState(room, 'p0').trickMatch.selection;
  assert.equal(view.offers[0].autoUpgradeTo, null);
  assert.equal(view.upgrades, undefined);
  chooseTrick(room, 'p0', 'peek_rank');
  assert.deepEqual(room.trickMatch.owned.get('p0'), ['mark_both', 'reveal_one', 'peek_rank']);
});

test('phase three common offer upgrades itself only without an owned upgrade', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.handNumber = 8;
  const selection = beginTrickSelection(room, () => 0);
  selection.offers.set('p0', ['mark_one']);
  chooseTrick(room, 'p0', 'mark_one');
  assert.deepEqual(room.trickMatch.owned.get('p0'), ['mark_both']);
});

test('meditation promotes the next phase offer rarity after the usual rarity roll', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection.offers.set('p0', ['trick_meditation']);
  chooseTrick(room, 'p0', 'trick_meditation');
  room.trickMatch.handNumber = 4;
  const selection = beginTrickSelection(room, () => 0);
  assert.equal(TRICKS[selection.offers.get('p0')[0]].rarity, 'rare');
});

test('extra refresh allows three refreshes in each offer slot', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection.offers.set('p0', ['extra_refresh']);
  chooseTrick(room, 'p0', 'extra_refresh');
  room.trickMatch.handNumber = 4;
  const selection = beginTrickSelection(room, () => 0);
  assert.equal(getPublicState(room, 'p0').trickMatch.selection.refreshLimit, 3);
  refreshTrickOffer(room, 'p0', 0, () => 0.8);
  refreshTrickOffer(room, 'p0', 0, () => 0.9);
  refreshTrickOffer(room, 'p0', 0, () => 0.8);
  assert.equal(getPublicState(room, 'p0').trickMatch.selection.refreshCounts[0], 3);
  assert.throws(() => refreshTrickOffer(room, 'p0', 0), /已经刷新/);
  assert.equal(selection.refreshed.get('p0').get(1), undefined);
});

test('common offer ignores removed manual upgrade field and upgrades an owned trick automatically', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.handNumber = 4;
  const selection = beginTrickSelection(room, () => 0);
  room.trickMatch.owned.set('p0', ['mark_one']);
  selection.offers.set('p0', ['peek_rank']);
  chooseTrick(room, 'p0', 'peek_rank', 'reveal_one');
  assert.deepEqual(room.trickMatch.owned.get('p0'), ['mark_both', 'peek_rank']);
  assert.equal(selection.chosen.has('p0'), true);
});

test('sharingan copies one random owned trick from each opponent', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.handNumber = 12;
  room.trickMatch.owned.set('p1', ['mark_both', 'peek_one', 'shoe_shine']);
  const selection = beginTrickSelection(room, () => 0.9);
  selection.offers.set('p0', ['sharingan']);
  selection.offers.set('p1', ['pocket_names']);
  chooseTrick(room, 'p0', 'sharingan');
  const copied = room.trickMatch.owned.get('p0');
  assert.equal(copied.length, 2);
  assert(['mark_both', 'peek_one', 'shoe_shine'].includes(copied[1]));
  chooseTrick(room, 'p1', 'pocket_names');
  assert.deepEqual(room.trickMatch.owned.get('p0'), copied);
});

test('blindfold masks only the target until river and all-card peek stays private', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['blindfold', 'peek_all']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  useTrick(room, 'p0', 'blindfold', { targetId: 'p1' });
  useTrick(room, 'p0', 'peek_all');
  room.hand.stage = 'FLOP';
  room.hand.community = Array.from({ length: 3 }, () => room.hand.deck.pop());
  assert.deepEqual(getPublicState(room, 'p1').hand.community, [null, null, null]);
  assert.deepEqual(getPublicState(room, 'p0').hand.community, room.hand.community);
  assert.deepEqual(getPublicState(room, 'p0').players[1].holeCards, room.players[1].holeCards);
  assert.deepEqual(getPublicState(room, 'p2').players[1].holeCards, [null, null]);
  room.hand.stage = 'RIVER';
  room.hand.community.push(room.hand.deck.pop(), room.hand.deck.pop());
  assert.deepEqual(getPublicState(room, 'p1').hand.community, room.hand.community);
});

test('single-card peek turns over only the chosen opponent card at the table', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['peek_one']);
  startHand(room);
  useTrick(room, 'p0', 'peek_one', { targetId: 'p1', cardIndex: 1 });
  assert.deepEqual(getPublicState(room, 'p0').players[1].holeCards,
    [null, room.players[1].holeCards[1]]);
  assert.deepEqual(getPublicState(room, 'p1').players[0].holeCards, [null, null]);
});

test('future-board swap exchanges actual undealt cards without duplicates', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['steal_future_board']);
  startHand(room);
  room.hand.stage = 'FLOP';
  room.hand.community = Array.from({ length: 3 }, () => room.hand.deck.pop());
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  const oldHole = room.players[0].holeCards.slice();
  const nextCards = [room.hand.deck.at(-2), room.hand.deck.at(-4)];
  useTrick(room, 'p0', 'steal_future_board');
  assert.deepEqual(room.players[0].holeCards, nextCards);
  assert.deepEqual([room.hand.deck.at(-2), room.hand.deck.at(-4)], oldHole);
  const all = [...room.hand.deck, ...room.hand.community, ...room.players.flatMap((p) => p.holeCards)];
  assert.equal(new Set(all).size, all.length);
});

test('cloud flower swaps both holes for real available A and K, twice per match', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.handNumber = 8;
  room.trickMatch.selection = beginTrickSelection(room, () => 0);
  room.trickMatch.selection.offers.set('p0', ['permanent_card']);
  chooseTrick(room, 'p0', 'permanent_card');
  room.trickMatch.selection = null;
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  useTrick(room, 'p0', 'permanent_card');
  assert.deepEqual(room.players[0].holeCards.map((card) => card[0]), ['A', 'K']);
  assert(room.players[0].holeCards.every((card) => !room.hand.deck.includes(card)));
  room.trickMatch.uses.set('p0:permanent_card', [1, 2]);
  assert.throws(() => useTrick(room, 'p0', 'permanent_card'), /次数/);
});

test('strategy card can designate the river before it is revealed', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['strategy_card']);
  startHand(room);
  const card = room.hand.trickStrategyCards.get('p0');
  room.hand.stage = 'TURN';
  room.hand.community = Array.from({ length: 4 }, () => room.hand.deck.pop());
  room.hand.currentBet = 0;
  room.players.forEach((p) => { p.betThisRound = 0; });
  room.hand.needsToAct = new Set(['p0', 'p1']);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');

  useTrick(room, 'p0', 'strategy_card', { river: true });
  assert.equal(room.hand.community.length, 4, 'the river must remain hidden until the street ends');
  assert.deepEqual(room.hand.trickNextBoard, [card]);
  assert.throws(() => useTrick(room, 'p0', 'strategy_card', { river: true }), /本局已经使用/);
  applyAction(room, 'p0', 'check');
  applyAction(room, 'p1', 'check');
  assert.equal(room.hand.stage, 'RIVER');
  assert.equal(room.hand.community[4], card);
});

test('catching an active cheat transfers twenty blinds and disabling a target blocks further tricks', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['catch_cheat', 'disable_tricks']);
  room.trickMatch.owned.set('p1', ['peek_rank']);
  startHand(room);
  useTrick(room, 'p1', 'peek_rank', { targetId: 'p2' });
  room.hand.stage = 'RIVER';
  room.hand.community = Array.from({ length: 5 }, () => room.hand.deck.pop());
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  const before = room.players[1].chips;
  useTrick(room, 'p0', 'catch_cheat', { targetId: 'p1' });
  assert.equal(room.players[1].chips, before - room.bigBlind * 20);
  useTrick(room, 'p0', 'disable_tricks', { targetId: 'p1' });
  assert.throws(() => useTrick(room, 'p1', 'peek_rank', { targetId: 'p2' }), /当前不能使用|禁用/);
});

test('mental chaos preserves a unique physical deck even with many players', () => {
  const room = roomWithPlayers(10);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['mental_chaos']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  useTrick(room, 'p0', 'mental_chaos');
  const cards = [...room.hand.deck, ...room.players.flatMap((p) => p.holeCards)];
  assert.equal(new Set(cards).size, cards.length);
  assert(room.players.every((p) => p.holeCards.length === 2));
});

test('whole-table active tricks reflect only for players they affect', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['mental_chaos', 'peek_all']);
  room.trickMatch.owned.set('p1', ['trick_reflect']);
  room.trickMatch.owned.set('p2', ['trick_reflect', 'guard_epic']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');

  useTrick(room, 'p0', 'mental_chaos');
  assert.equal(room.hand.trickBorrowed.get('p1'), 'mental_chaos');
  assert.equal(room.hand.trickBorrowed.has('p2'), false);
  assert.equal(room.trickMatch.uses.get('p1:trick_reflect'), undefined);

  room.hand.turnIndex = room.hand.actingOrder.indexOf('p1');
  useTrick(room, 'p1', 'mental_chaos');
  assert.equal(room.hand.trickBorrowed.has('p1'), false);
  assert.deepEqual(room.trickMatch.uses.get('p1:trick_reflect'), [1]);

  useTrick(room, 'p0', 'peek_all');
  assert.equal(room.hand.trickBorrowed.get('p1'), 'peek_all');
  assert.equal(room.hand.trickBorrowed.has('p2'), false);
  useTrick(room, 'p1', 'peek_all');
  assert.deepEqual(room.trickMatch.uses.get('p1:trick_reflect'), [1, 1]);

  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  useTrick(room, 'p0', 'mental_chaos');
  assert.equal(room.hand.trickBorrowed.has('p1'), false);
});

test('whole-table chip transfer reflects only for players who paid', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['reveal_tax']);
  room.trickMatch.owned.set('p1', ['trick_reflect']);
  room.trickMatch.owned.set('p2', ['trick_reflect']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  room.findPlayer('p2').chips = room.bigBlind - 1;

  useTrick(room, 'p0', 'reveal_tax');
  assert.equal(room.hand.trickBorrowed.get('p1'), 'reveal_tax');
  assert.equal(room.hand.trickBorrowed.has('p2'), false);
});

test('self reflection can be used twice per phase', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['future_self']);
  startHand(room);
  room.hand.stage = 'FLOP';
  room.hand.community = Array.from({ length: 3 }, () => room.hand.deck.pop());
  assert.match(TRICKS.future_self.usage, /每阶段限用 2 次/);
  useTrick(room, 'p0', 'future_self');
  useTrick(room, 'p0', 'future_self');
  assert.throws(() => useTrick(room, 'p0', 'future_self'), /本阶段使用次数已达上限/);
});

test('mental chaos is capped at three uses across the whole match', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['mental_chaos']);
  room.trickMatch.uses.set('p0:mental_chaos', [1, 2, 3]);
  room.trickMatch.handNumber = 3;
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  assert.match(TRICKS.mental_chaos.usage, /整场限用 3 次/);
  assert.throws(() => useTrick(room, 'p0', 'mental_chaos'), /整场使用次数已用完/);
});

test('rank replacement draws a real remaining card and replaces the lower hole card', () => {
  for (const [trickId, rank, cap] of [
    ['ace_card', 'A', 2], ['king_card', 'K', 2], ['queen_card', 'Q', 2],
  ]) {
    const room = roomWithPlayers(2);
    beginTrickMatch(room);
    room.trickMatch.selection = null;
    room.trickMatch.owned.set('p0', [trickId]);
    startHand(room);
    room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
    const before = room.players[0].holeCards.slice();
    const lower = '23456789TJQKA'.indexOf(before[0][0]) <=
      '23456789TJQKA'.indexOf(before[1][0]) ? 0 : 1;
    const choices = room.hand.deck.filter((card) => card[0] === rank);
    assert(choices.length > 0);
    useTrick(room, 'p0', trickId);
    assert.equal(room.players[0].holeCards[lower][0], rank);
    assert.equal(room.players[0].holeCards[1 - lower], before[1 - lower]);
    assert(!room.hand.deck.includes(room.players[0].holeCards[lower]));
    assert.equal(TRICKS[trickId].usage, `整场限用 ${cap} 次`);
  }
});

test('reverse board reveals the five original board cards in reverse order', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['reverse_board']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  const deck = room.hand.deck;
  const n = deck.length;
  const expected = [deck[n - 8], deck[n - 6], deck[n - 4], deck[n - 3], deck[n - 2]];
  useTrick(room, 'p0', 'reverse_board');
  assert.deepEqual(room.hand.trickNextBoard, expected);
  for (let turn = 0; room.hand.stage !== 'RIVER' && turn < 12; turn++) {
    const actor = room.hand.actingOrder[room.hand.turnIndex];
    const action = legalActions(room, actor).includes('check') ? 'check' : 'call';
    applyAction(room, actor, action);
  }
  assert.equal(room.hand.stage, 'RIVER');
  assert.deepEqual(room.hand.community, expected);
  const allCards = [...room.hand.deck, ...room.hand.community,
    ...room.players.flatMap((p) => p.holeCards)];
  assert.equal(new Set(allCards).size, allCards.length);
});

test('chaos child rerolls every owned skill into an epic one, never 自我暗示', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.handNumber = 8;
  room.trickMatch.owned.set('p0', ['permanent_card']);
  const selection = beginTrickSelection(room, () => 0);
  selection.offers.set('p0', ['chaos_child']);
  chooseTrick(room, 'p0', 'chaos_child');
  assert.equal(room.trickMatch.owned.get('p0').length, 2);
  assert(room.trickMatch.owned.get('p0').every((id) =>
    TRICKS[id].rarity === 'epic' && !['chaos_child', 'self_suggestion'].includes(id)));
});

test('five-card exchange is private, waits for confirmation, and keeps one copy of every card', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['swap_five']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  const before = room.players[0].holeCards.slice();
  useTrick(room, 'p0', 'swap_five');
  assert.equal(room.trickMatch.uses.get('p0:swap_five'), undefined);
  const cards = getPublicState(room, 'p0').trickMatch.pendingChoice.cards;
  assert.equal(getPublicState(room, 'p1').trickMatch.pendingChoice, null);
  useTrick(room, 'p0', 'swap_five', { choiceIndexes: [0, 2] });
  assert.deepEqual(room.players[0].holeCards, [before[0], cards[2]]);
  assert(!room.hand.deck.includes(cards[2]));
  const liveCards = [...room.players.flatMap((p) => p.holeCards), ...room.hand.deck];
  assert.equal(new Set(liveCards).size, liveCards.length);
});

test('choosing the next public card places exactly that real card on the next street', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['control_five']);
  startHand(room);
  room.hand.stage = 'FLOP';
  room.hand.community = [room.hand.deck.pop(), room.hand.deck.pop(), room.hand.deck.pop()];
  room.hand.currentBet = 0;
  room.players.forEach((p) => { p.betThisRound = 0; });
  room.hand.needsToAct = new Set(['p0', 'p1']);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  useTrick(room, 'p0', 'control_five');
  const [turn, river] = getPublicState(room, 'p0').trickMatch.pendingChoice.cards;
  useTrick(room, 'p0', 'control_five', { choiceIndexes: [0, 1] });
  assert(!room.hand.deck.includes(turn));
  assert(!room.hand.deck.includes(river));
  applyAction(room, 'p0', 'check');
  applyAction(room, 'p1', 'check');
  assert.equal(room.hand.stage, 'TURN');
  assert.equal(room.hand.community[3], turn);
  applyAction(room, room.hand.actingOrder[room.hand.turnIndex], 'check');
  applyAction(room, room.hand.actingOrder[room.hand.turnIndex], 'check');
  assert.equal(room.hand.community[4], river);
});

test('passive end-of-hand drain conserves chips through settlement', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['drain_small']);
  startHand(room);
  room.players[0].chips -= 20;
  room.players[0].betThisHand += 20;
  const totalBefore = room.players.reduce((sum, p) => sum + p.chips + p.betThisHand, 0);
  forceFoldFromHand(room, 'p1');
  forceFoldFromHand(room, 'p2');
  assert.equal(room.hand.stage, 'SHOWDOWN');
  assert(room.hand.trickPotDrain >= room.smallBlind);
  assert.equal(room.players.reduce((sum, p) => sum + p.chips, 0), totalBefore);
});

test('pot-drain availability matches the actual extractable amount', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['drain_quarter']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  room.players[0].betThisHand = 10;
  room.players[1].betThisHand = 0;
  assert.equal(getPublicState(room, 'p0').trickMatch.owned[0].available, false);
  assert.throws(() => useTrick(room, 'p0', 'drain_quarter'), /底池筹码不足/);
  assert.equal(room.trickMatch.uses.get('p0:drain_quarter'), undefined);

  const usableRoom = roomWithPlayers(2);
  beginTrickMatch(usableRoom);
  usableRoom.trickMatch.selection = null;
  usableRoom.trickMatch.owned.set('p0', ['drain_quarter']);
  startHand(usableRoom);
  usableRoom.hand.turnIndex = usableRoom.hand.actingOrder.indexOf('p0');
  usableRoom.players.forEach((player) => { player.betThisHand = 20; });
  assert.equal(getPublicState(usableRoom, 'p0').trickMatch.owned[0].available, true);
  useTrick(usableRoom, 'p0', 'drain_quarter');
  assert.equal(getPublicState(usableRoom, 'p0').hand.pot, 20);
});

test('buyout is paid once per phase, targets only a later unacted player, then forces fold on their turn', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  startHand(room);
  room.hand.stage = 'RIVER';
  room.hand.community = Array.from({ length: 5 }, () => room.hand.deck.pop());
  for (const p of room.players) { p.chips -= 10; p.betThisHand += 10; }
  room.hand.turnIndex = 1;
  const actor = room.players.find((p) => p.id === room.hand.actingOrder[1]);
  const target = room.players.find((p) => p.id === room.hand.actingOrder[2]);
  const earlier = room.players.find((p) => p.id === room.hand.actingOrder[0]);
  room.trickMatch.owned.set(actor.id, ['forced_fold']);
  target.allIn = true;
  assert.throws(() => useTrick(room, actor.id, 'forced_fold', { targetId: target.id }), /全下/);
  target.allIn = false;
  assert.throws(() => useTrick(room, actor.id, 'forced_fold', { targetId: earlier.id }), /之后/);
  const before = room.players.reduce((sum, p) => sum + p.chips + p.betThisHand, 0);
  useTrick(room, actor.id, 'forced_fold', { targetId: target.id });
  assert.equal(getPublicState(room, target.id).trickMatch.forcedFold.byName, actor.name);
  assert.equal(getPublicState(room, earlier.id).trickMatch.forcedFold, null);
  assert.deepEqual(legalActions(room, target.id), []);
  assert.throws(() => useTrick(room, actor.id, 'forced_fold', { targetId: earlier.id }), /本阶段/);
  applyAction(room, actor.id, room.hand.currentBet > actor.betThisRound ? 'call' : 'check');
  assert.equal(room.hand.actingOrder[room.hand.turnIndex], target.id);
  assert.deepEqual(legalActions(room, target.id), ['fold']);
  assert.throws(() => applyAction(room, target.id, 'call'));
  applyAction(room, target.id, 'fold');
  assert(target.folded);
  assert.equal(getPublicState(room, target.id).trickMatch.forcedFold, null);
  assert.equal(room.players.reduce((sum, p) => sum + p.chips + p.betThisHand, 0), before);
});

test('swap_five is rejected after preflop', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['swap_five']);
  startHand(room);
  room.hand.stage = 'FLOP';
  room.hand.community = [room.hand.deck.pop(), room.hand.deck.pop(), room.hand.deck.pop()];
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  assert.equal(getPublicState(room, 'p0').trickMatch.owned[0].available, false);
  assert.throws(() => useTrick(room, 'p0', 'swap_five'), /只能在翻牌前/);
});

test('river suit prediction pays from all other players at settlement and stealing replaces the skill', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p1', ['color_bet', 'steal_skill']);
  room.trickMatch.owned.set('p2', ['peek_rank']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p1');
  const before = room.players.map((p) => p.chips);
  useTrick(room, 'p1', 'color_bet', { suit: 'h' });
  const river = room.hand.deck.find((card) => card[1] === 'h');
  room.hand.deck.splice(room.hand.deck.indexOf(river), 1);
  room.hand.community = Array.from({ length: 4 }, () => room.hand.deck.pop()).concat(river);
  room.hand.revealed = { pots: [] };
  onTrickSettlement(room);
  assert.match(getPublicState(room, 'p1').trickMatch.messages.at(-1), /命中/);
  assert.equal(room.players[0].chips, before[0] - room.bigBlind);
  assert.equal(room.players[2].chips, before[2] - room.bigBlind);
  assert.equal(room.players[1].chips, before[1] + 2 * room.bigBlind);
  useTrick(room, 'p1', 'steal_skill', { targetId: 'p2' });
  assert(getPublicState(room, 'p1').trickMatch.owned.some((trick) => trick.id === 'peek_rank'));
  assert(!getPublicState(room, 'p1').trickMatch.owned.some((trick) => trick.id === 'steal_skill'));
});

test('every active trick has a server handler rather than an unimplemented fallback', () => {
  for (const trick of Object.values(TRICKS)) {
    if (trick.kind === 'passive') continue;
    const room = roomWithPlayers(3);
    beginTrickMatch(room);
    room.trickMatch.selection = null;
    room.trickMatch.owned.set('p0', [trick.id]);
    startHand(room);
    room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
    try {
      useTrick(room, 'p0', trick.id, { targetId: 'p1', cardIndex: 0,
        myCardIndex: 0, color: '红', choiceIndexes: [0, 1] });
    } catch (error) {
      assert.doesNotMatch(error.message, /千术尚未实现/, trick.id);
    }
  }
});

test('左邻右舍 passes over folded seats and needs three players still in the hand', () => {
  const room = roomWithPlayers(4);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  for (const p of room.players) room.trickMatch.owned.set(p.id, ['neighbor_swap']);
  startHand(room);
  const folder = room.findPlayer(currentActorForTrick(room));
  applyAction(room, folder.id, 'fold');
  const user = currentActorForTrick(room);
  const bySeat = room.players.slice().sort((a, b) => a.seat - b.seat);
  const seatIndex = bySeat.findIndex((p) => p.id === user);
  assert.equal(bySeat[(seatIndex - 1 + 4) % 4].id, folder.id, 'the folded player sits right next to the user');
  const live = bySeat.filter((p) => !p.folded);
  const liveIndex = live.findIndex((p) => p.id === user);
  const left = live[(liveIndex - 1 + live.length) % live.length];
  const right = live[(liveIndex + 1) % live.length];
  const cards = { folder: folder.holeCards.slice(), left: left.holeCards.slice(), right: right.holeCards.slice() };
  useTrick(room, user, 'neighbor_swap');
  assert.deepEqual(folder.holeCards, cards.folder, 'the folded hand is untouched');
  assert.equal(left.holeCards[1], cards.right[0]);
  assert.equal(right.holeCards[0], cards.left[1]);

  const small = roomWithPlayers(3);
  beginTrickMatch(small);
  small.trickMatch.selection = null;
  for (const p of small.players) small.trickMatch.owned.set(p.id, ['neighbor_swap']);
  startHand(small);
  applyAction(small, currentActorForTrick(small), 'fold');
  assert.throws(() => useTrick(small, currentActorForTrick(small), 'neighbor_swap'), /三名未弃牌/);
});

function allInSpot(trickIds) {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p1', trickIds);
  startHand(room);
  applyAction(room, currentActorForTrick(room), 'allin');
  const [p0, p1, p2] = room.players;
  assert(p0.allIn && room.hand.allInLocked);
  assert.equal(currentActorForTrick(room), 'p1');
  return { room, p0, p1, p2 };
}

test('after an all-in, action tricks still work but never touch the all-in player\'s hole cards', () => {
  const { room, p0, p1, p2 } = allInSpot(['exchange']);
  assert.equal(getPublicState(room, 'p1').trickMatch.owned.find((t) => t.id === 'exchange').available, true);
  const allInCards = p0.holeCards.slice();
  assert.throws(() => useTrick(room, 'p1', 'exchange', { targetId: p0.id, both: true }), /全下/);
  assert.deepEqual(p0.holeCards, allInCards);
  const before = [p1.holeCards.slice(), p2.holeCards.slice()];
  useTrick(room, 'p1', 'exchange', { targetId: p2.id, both: true });
  assert.deepEqual(p1.holeCards, before[1]);
  assert.deepEqual(p2.holeCards, before[0]);
});

test('targeted swaps refuse an all-in player', () => {
  let spot = allInSpot(['steal_hole']);
  assert.throws(() => useTrick(spot.room, 'p1', 'steal_hole', { targetId: 'p0', cardIndex: 0 }), /全下/);

  spot = allInSpot(['neighbor_swap']);
  const allInCards = spot.p0.holeCards.slice();
  assert.throws(() => useTrick(spot.room, 'p1', 'neighbor_swap'), /全下/);
  assert.deepEqual(spot.p0.holeCards, allInCards);

  spot = allInSpot(['fate_swap']);
  spot.room.hand.stage = 'FLOP';
  spot.room.hand.community = ['Ah', 'Kd', '2c'];
  spot.p0.holeCards = ['As', 'Ac'];
  spot.p1.holeCards = ['3d', '4d'];
  spot.p2.holeCards = ['7h', '8s'];
  assert.throws(() => useTrick(spot.room, 'p1', 'fate_swap'), /最强玩家/);
  assert.deepEqual(spot.p0.holeCards, ['As', 'Ac']);
});

test('tricks that pick their own targets skip players who are all-in', () => {
  const runs = { mental_chaos: 12, random_replace: 12, ultimate_swap: 1, ban_pairs: 1 };
  for (const [trickId, count] of Object.entries(runs)) {
    for (let run = 0; run < count; run++) {
      const { room, p0, p1, p2 } = allInSpot([trickId]);
      room.hand.stage = 'FLOP';
      room.hand.community = ['Qd', 'Kc', '7d'];
      p0.holeCards = ['Qs', 'Ks'];
      p1.holeCards = ['2c', '3h'];
      p2.holeCards = ['Qh', 'Jh'];
      // The hand was dealt at random, so take the hand-picked cards out of the deck.
      const placed = new Set([...room.hand.community, ...p0.holeCards, ...p1.holeCards, ...p2.holeCards]);
      room.hand.deck = room.hand.deck.filter((card) => !placed.has(card));
      useTrick(room, 'p1', trickId, trickId === 'ban_pairs' ? { communityIndex: 0 } : {});
      assert.deepEqual(p0.holeCards, ['Qs', 'Ks'], trickId);
      if (trickId === 'ultimate_swap') assert.deepEqual(p1.holeCards.slice().sort(), ['Jh', 'Qh']);
      if (trickId === 'ban_pairs') assert.notEqual(p2.holeCards[0], 'Qh');
    }
  }
});

test('a read-kind trick stays available after any all-in', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p1', ['peek_rank']);
  startHand(room);
  applyAction(room, currentActorForTrick(room), 'allin');
  assert(room.hand.allInLocked);
  assert.equal(getPublicState(room, 'p1').trickMatch.owned[0].available, true);
  useTrick(room, 'p1', 'peek_rank', { targetId: 'p2' });
  assert.equal(room.trickMatch.uses.get('p1:peek_rank').length, 1);
});

test('buyout remains available after another player goes all-in', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p1', ['forced_fold']);
  room.players[0].chips = 40;
  startHand(room);
  const [allInPlayer, actor, target] = room.players;
  applyAction(room, allInPlayer.id, 'allin');
  assert.equal(allInPlayer.allIn, true);
  room.hand.stage = 'RIVER';
  room.hand.turnIndex = room.hand.actingOrder.indexOf(actor.id);
  const view = getPublicState(room, actor.id).trickMatch;
  assert.deepEqual(view.forcedFoldTargets, [target.id]);
  assert.equal(view.owned.find((trick) => trick.id === 'forced_fold').available, true);
  useTrick(room, actor.id, 'forced_fold', { targetId: target.id });
  assert.equal(room.hand.trickForcedFolds.get(target.id), actor.id);
});

test('timeout chooses randomly only among the highest available rarity', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection.offers.set('p0', ['peek_rank', 'peek_one', 'peek_both']);
  room.trickMatch.selection.offers.set('p1', ['peek_rank', 'peek_one', 'peek_both']);
  autoChooseTricks(room, () => 0);
  assert.equal(room.trickMatch.owned.get('p0')[0], 'peek_both');
  assert.equal(room.trickMatch.owned.get('p1')[0], 'peek_both');
});

test('yin-yang masks only the third community card for its owner', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['yin_yang']);
  startHand(room);
  room.hand.stage = 'FLOP';
  room.hand.community = [room.hand.deck.pop(), room.hand.deck.pop(), room.hand.deck.pop()];
  assert.deepEqual(getPublicState(room, 'p0').hand.community,
    [...room.hand.community.slice(0, 2), null]);
  assert.deepEqual(getPublicState(room, 'p1').hand.community, room.hand.community);
  room.hand.stage = 'SHOWDOWN';
  assert.deepEqual(getPublicState(room, 'p0').hand.community, room.hand.community);
});

test('random replacement skips players protected from card changes', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['random_replace']);
  room.trickMatch.owned.set('p1', ['guard_epic']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  const guarded = room.players[1].holeCards.slice();
  const others = [room.players[0].holeCards.slice(), room.players[2].holeCards.slice()];
  useTrick(room, 'p0', 'random_replace');
  assert.deepEqual(room.players[1].holeCards, guarded);
  // The victim is drawn at random from the user and the unguarded player.
  assert(room.players[0].holeCards.join() !== others[0].join() || room.players[2].holeCards.join() !== others[1].join());
});

test('the phase-four quantity trick grants ten common or rare tricks and is not granted randomly', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.handNumber = 12;
  const selection = beginTrickSelection(room, () => 0.99);
  selection.offers.set('p0', ['quantity_wins']);
  chooseTrick(room, 'p0', 'quantity_wins');
  assert.equal(room.trickMatch.owned.get('p0').length, 10);
  assert(room.trickMatch.owned.get('p0').every((id) => ['common', 'rare'].includes(TRICKS[id].rarity)));
  assert(!room.trickMatch.owned.get('p0').some((id) => ['ground_below', 'ground_middle'].includes(id)));
});

test('天空之下 grants two random rare tricks and says which', () => {
  for (let run = 0; run < 30; run++) {
    const room = roomWithPlayers(3);
    beginTrickMatch(room);
    room.trickMatch.handNumber = 8;
    const selection = beginTrickSelection(room);
    selection.offers.set('p0', ['sky_below']);
    room.hand = { trickMessages: new Map() };   // the finished hand the prompt is shown on
    chooseTrick(room, 'p0', 'sky_below');
    const message = room.hand.trickMessages.get('p0').find((text) => text.startsWith('天空之下：'));
    const names = message.replace('天空之下：额外获得 ', '').split('、');
    assert.equal(names.length, 2);
    const byName = Object.fromEntries(Object.values(TRICKS).map((trick) => [trick.name, trick]));
    for (const name of names) {
      assert.equal(byName[name].rarity, 'rare', name);
      assert(room.trickMatch.owned.get('p0').includes(byName[name].id));
    }
  }
});

test('ascension ladder upgrades and grants a bonus at the next phase boundary', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.owned.set('p0', ['ladder_one']);
  room.trickMatch.handNumber = 4;
  beginTrickSelection(room, () => 0);
  const held = room.trickMatch.owned.get('p0');
  assert(held.includes('ladder_two'));
  assert(held.some((id) => TRICKS[id].rarity === 'rare' && id !== 'ladder_two'));
  assert(!held.includes('ladder_one'));
});

test('board audit folds only players who changed the board and can still fold', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['board_audit']);
  startHand(room);
  room.hand.stage = 'RIVER';
  room.hand.community = Array.from({ length: 5 }, () => room.hand.deck.pop());
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  room.hand.trickBoardSwappers.add('p1');
  const result = useTrick(room, 'p0', 'board_audit');
  assert.deepEqual(result.foldPlayerIds, ['p1']);
  forceFoldFromHand(room, 'p1');
  assert.equal(room.players[1].folded, true);
  assert.equal(room.players[2].folded, false);
});

test('trick resistance cancels the first incoming swap each phase but still charges the attacker', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['exchange']);
  room.trickMatch.owned.set('p1', ['trick_resistance']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  const before = room.players.map((p) => p.holeCards.slice());
  useTrick(room, 'p0', 'exchange', { targetId: 'p1', both: true });
  assert.deepEqual(room.players.map((p) => p.holeCards), before);
  assert.equal(room.trickMatch.uses.get('p0:exchange').length, 1);
  assert.equal(room.trickMatch.resistanceUsedPhases.get('p1'), 1);
  useTrick(room, 'p0', 'exchange', { targetId: 'p1', both: true });
  assert.deepEqual(room.players[0].holeCards, before[1]);
  assert.deepEqual(room.players[1].holeCards, before[0]);
});

test('purist excludes twos and sevens from the initial draw', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['purist']);
  for (let hand = 0; hand < 8; hand++) {
    startHand(room);
    assert(room.players[0].holeCards.every((card) => !['2', '7'].includes(card[0])));
  }
});

test('shared rain reports lower ranks without bypassing anti-peek protection', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['shared_rain']);
  room.trickMatch.owned.set('p1', ['guard_rare']);
  startHand(room);
  useTrick(room, 'p0', 'shared_rain');
  const report = getPublicState(room, 'p0').trickMatch.messages.at(-1);
  assert.match(report, /玩家1：受防窥保护/);
  assert.match(report, /玩家2：/);
  assert.equal(TRICKS.shared_rain.usage, '每阶段限用 2 次');
});

test('a player kicked while a trick selection is in flight cannot claim an exclusive family', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection.offers = new Map([
    ['p0', ['high_probe']],
    ['p1', ['retention_common']],
    ['p2', ['high_probe']],
  ]);
  room.players[1].kicked = true;
  room.players[1].eliminated = true;
  assert.throws(() => chooseTrick(room, 'p1', 'retention_common'), /当前不能选千术/);
  autoChooseTricks(room);
  assert.equal(room.trickMatch.owned.has('p1'), false);
  assert.equal(room.trickMatch.retentionOwner, null);
  room.trickMatch.selection = { phase: 2, offers: new Map([['p0', ['retention_common']]]), chosen: new Set(),
    deadline: Date.now() + 1000 };
  assert.doesNotThrow(() => chooseTrick(room, 'p0', 'retention_common'));
});

test('rarity draw renormalizes instead of falling back to a flat pick when a tier is phase-locked out', () => {
  const room = roomWithPlayers(1);
  beginTrickMatch(room);
  room.trickMatch.handNumber = TRICK_PHASE_HANDS * (TRICK_PHASES - 1); // last phase: common is excluded
  // Under the old code this roll (10 of 100) landed deep in the "common" bucket; since common
  // is unavailable this phase, it used to fall through to a flat pick across every eligible
  // trick regardless of rarity. Renormalized over the remaining rare/epic/legendary weights
  // (30/15/5 -> total 50), roll*50 = 5 still lands inside the rare bucket (0-30), so every
  // offered trick this phase should now deterministically be rare.
  const selection = beginTrickSelection(room, () => 0.1);
  const offer = selection.offers.get('p0');
  assert(offer.length > 0);
  assert(offer.every((id) => TRICKS[id].rarity === 'rare'), offer.map((id) => TRICKS[id].rarity));
});

test('retention frees up for a later checkpoint once its owner is gone for good', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection.offers = new Map([['p1', ['retention_common']]]);
  chooseTrick(room, 'p1', 'retention_common');
  assert.equal(room.trickMatch.retentionOwner, 'p1');

  room.players[1].eliminated = true;
  room.trickMatch.handNumber = 4;
  const selection = beginTrickSelection(room);
  assert.equal(room.trickMatch.retentionOwner, null);
  assert(!selection.offers.has('p1'), 'an eliminated player should not be re-offered anything');
  selection.offers.set('p0', ['retention_rare']);
  assert.doesNotThrow(() => chooseTrick(room, 'p0', 'retention_rare'),
    'retention should be choosable again once the old owner is gone for good');
  assert.equal(room.trickMatch.retentionOwner, 'p0');
});

test('blind effects hide own cards, derived rank, and retention intel until showdown', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['retention_common', 'future_self', 'control_five']);
  room.trickMatch.pendingBlindEffects.push({ targetId: 'p0', handNumber: 1 });
  startHand(room);
  const view = getPublicState(room, 'p0');
  assert.deepEqual(view.players[0].holeCards, [null, null]);
  assert.equal(view.trickMatch.pendingChoice, null);
  assert(!view.trickMatch.views.some((item) => item.label.startsWith('留底')));
  assert.throws(() => useTrick(room, 'p0', 'retention_common'), /遮蔽/);
  assert.throws(() => useTrick(room, 'p0', 'future_self'), /遮蔽/);
  room.hand.stage = 'FLOP';
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  useTrick(room, 'p0', 'control_five');
  assert.equal(getPublicState(room, 'p0').trickMatch.pendingChoice.trickId, 'control_five');
});

test('fake intel changes trick peeks but does not change actual cards or showdown', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['peek_both']);
  room.trickMatch.owned.set('p1', ['fake_intel']);
  startHand(room);
  const actual = room.findPlayer('p1').holeCards.slice();
  useTrick(room, 'p0', 'peek_both', { targetId: 'p1' });
  const seen = getPublicState(room, 'p0').players.find((p) => p.id === 'p1').holeCards;
  assert.notDeepEqual(seen, actual);
  assert(seen.every((card) => '23456789'.includes(card[0])));
  assert.deepEqual(room.findPlayer('p1').holeCards, actual);
});

test('guessed ranks force fold only after the target next acts', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['guess_holes']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  const ranks = room.findPlayer('p1').holeCards.map((card) => card[0]).reverse();
  useTrick(room, 'p0', 'guess_holes', { targetId: 'p1', ranks });
  assert(room.hand.trickForcedGuessFolds.has('p1'));
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p1');
  assert.deepEqual(legalActions(room, 'p1'), ['fold']);
  applyAction(room, 'p1', 'fold');
  assert(!room.hand.trickForcedGuessFolds.has('p1'));
});

test('不动如山 guards its holder\'s hole cards for good and pins a chosen turn or river', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['immovable', 'bottom_deal']);
  room.trickMatch.owned.set('p1', ['exchange', 'suit_shift']);
  room.trickMatch.owned.set('p2', ['control_five']);
  startHand(room);
  const h = room.hand;
  const p0Cards = room.findPlayer('p0').holeCards.slice();
  h.turnIndex = h.actingOrder.indexOf('p1');
  assert.throws(() => useTrick(room, 'p1', 'exchange', { targetId: 'p0', myCardIndex: 0, cardIndex: 0 }), /不动如山/);
  assert.deepEqual(room.findPlayer('p0').holeCards, p0Cards, 'opponents can never swap them');

  const planned = plannedBoard(h);
  assert(getPublicState(room, 'p0').trickMatch.owned.find((t) => t.id === 'immovable').available,
    'the lock is usable while it is someone else\'s turn');
  useTrick(room, 'p0', 'immovable', { street: 'river' });
  assert.equal(h.trickBoardLocks[4], planned[4]);
  assert.deepEqual(plannedBoard(h), planned, 'locking changes nothing about the board to come');
  assert.throws(() => useTrick(room, 'p0', 'immovable', { street: 'turn' }), /本局已经使用过/);
  // A random draw by another player cannot take the pinned river.
  useTrick(room, 'p1', 'suit_shift', { cardIndex: 0 });
  while (h.stage === 'PREFLOP') applyAction(room, currentActorForTrick(room), legalActions(room, currentActorForTrick(room)).includes('check') ? 'check' : 'call');
  h.turnIndex = h.actingOrder.indexOf('p2');
  assert.throws(() => useTrick(room, 'p2', 'control_five'), /不动如山/);
  while (h.community.length < 5) applyAction(room, currentActorForTrick(room), legalActions(room, currentActorForTrick(room)).includes('check') ? 'check' : 'call');
  assert.equal(h.community[4], planned[4], 'the river is the pinned card');
  assert.throws(() => useTrick(room, 'p0', 'immovable', { street: 'turn' }));
});

test('不动如山 can pin the turn and is refused once the turn is out', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['immovable']);
  startHand(room);
  const h = room.hand;
  while (h.stage === 'PREFLOP') applyAction(room, currentActorForTrick(room), legalActions(room, currentActorForTrick(room)).includes('check') ? 'check' : 'call');
  const planned = plannedBoard(h);
  useTrick(room, 'p0', 'immovable', { street: 'turn' });
  while (h.stage === 'FLOP') applyAction(room, currentActorForTrick(room), legalActions(room, currentActorForTrick(room)).includes('check') ? 'check' : 'call');
  assert.deepEqual(h.community, planned.slice(0, 4));
  room.trickMatch.handNumber += 1;
  h.trickUsedThisHand.clear();
  assert.throws(() => useTrick(room, 'p0', 'immovable', { street: 'river' }), /转牌翻出前/);
});

test('shoe-shine and no-board settlement transfers only available chips', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['shoe_shine', 'bluff_no_board']);
  startHand(room);
  const h = room.hand;
  h.stage = 'SHOWDOWN';
  h.trickRiverPlayerIds = ['p0', 'p1'];
  h.trickNoBoard.add('p0');
  room.findPlayer('p2').folded = true;
  room.findPlayer('p1').chips = 15;
  room.findPlayer('p2').chips = 25;
  h.revealed = { pots: [{ amount: 100, winnerIds: ['p0'] }], showCards: true };
  const before = room.players.reduce((sum, p) => sum + p.chips, 0);
  onTrickSettlement(room);
  assert.equal(room.findPlayer('p1').chips, 0);
  assert.equal(room.findPlayer('p2').chips, 0);
  assert.equal(room.players.reduce((sum, p) => sum + p.chips, 0), before);
});

test('self-suggestion replaces owned tricks with a legendary and its possible selection bonus', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.handNumber = 4;
  room.trickMatch.owned.set('p0', ['ace_card']);
  const selection = beginTrickSelection(room);
  selection.offers.set('p0', ['self_suggestion']);
  chooseTrick(room, 'p0', 'self_suggestion');
  const [granted] = room.trickMatch.owned.get('p0');
  // Bonus picks from the granted legendary may legitimately roll ace_card again,
  // so only the slot that replaced the old loadout is checked.
  assert.notEqual(granted, 'ace_card');
  assert.equal(TRICKS[granted].rarity, 'legendary');
});

test('ultimate swap takes the two highest opponent cards and ban-pairs never changes actor holes', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['ultimate_swap', 'ban_pairs']);
  startHand(room);
  const h = room.hand;
  h.turnIndex = h.actingOrder.indexOf('p0');
  room.findPlayer('p0').holeCards = ['2h', '3h'];
  room.findPlayer('p1').holeCards = ['Ah', 'Kh'];
  room.findPlayer('p2').holeCards = ['Qh', 'Jh'];
  for (const card of ['2h', '3h', 'Ah', 'Kh', 'Qh', 'Jh']) {
    const index = h.deck.indexOf(card);
    if (index !== -1) h.deck.splice(index, 1);
  }
  useTrick(room, 'p0', 'ultimate_swap');
  assert.deepEqual(room.findPlayer('p0').holeCards, ['Ah', 'Kh']);
  assert.deepEqual(room.findPlayer('p1').holeCards, ['2h', '3h']);
  h.stage = 'FLOP';
  h.community = ['2s', '5c', '9d'];
  h.deck = h.deck.filter((card) => !h.community.includes(card) && card[0] !== '2');
  useTrick(room, 'p0', 'ban_pairs', { communityIndex: 0 });
  assert.deepEqual(room.findPlayer('p0').holeCards, ['Ah', 'Kh']);
  assert(!room.findPlayer('p1').holeCards.some((card) => card[0] === '2'));
});

test('ultimate swap leaves both cards unchanged when the global top two are not higher', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['ultimate_swap']);
  startHand(room);
  const h = room.hand;
  h.turnIndex = h.actingOrder.indexOf('p0');
  room.findPlayer('p0').holeCards = ['Ah', 'Ad'];
  room.findPlayer('p1').holeCards = ['Kc', '2c'];
  room.findPlayer('p2').holeCards = ['Qd', 'Jd'];
  assert.throws(() => useTrick(room, 'p0', 'ultimate_swap'), /没有高于/);
  assert.deepEqual(room.findPlayer('p0').holeCards, ['Ah', 'Ad']);
  assert.deepEqual(room.findPlayer('p1').holeCards, ['Kc', '2c']);
  assert.deepEqual(room.findPlayer('p2').holeCards, ['Qd', 'Jd']);
});

test('ultimate swap checks each of the global top two against its matching own card', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['ultimate_swap']);
  startHand(room);
  const h = room.hand;
  h.turnIndex = h.actingOrder.indexOf('p0');
  room.findPlayer('p0').holeCards = ['Ah', '2h'];
  room.findPlayer('p1').holeCards = ['Kc', '3c'];
  room.findPlayer('p2').holeCards = ['Qd', 'Jd'];
  useTrick(room, 'p0', 'ultimate_swap');
  assert.deepEqual(room.findPlayer('p0').holeCards, ['Ah', 'Qd']);
  assert.equal(room.findPlayer('p1').holeCards[0], 'Kc');
  assert.equal(room.findPlayer('p2').holeCards[0], '2h');
});

test('discard-all swaps a visible folded card for own card while two players remain live', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['discard_all']);
  startHand(room);
  const beforeMine = room.findPlayer('p0').holeCards[0];
  const beforeFolded = room.findPlayer('p1').holeCards[1];
  forceFoldFromHand(room, 'p1');
  assert.equal(room.hand.stage, 'PREFLOP');
  assert(room.hand.publicReveals.has('p1'));
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  useTrick(room, 'p0', 'discard_all', { targetId: 'p1', myCardIndex: 0, cardIndex: 1 });
  assert.equal(room.findPlayer('p0').holeCards[0], beforeFolded);
  assert.equal(room.findPlayer('p1').holeCards[1], beforeMine);
});

test('common retention can select two opening cards from its first three draws', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection.offers.set('p0', ['retention_common']);
  chooseTrick(room, 'p0', 'retention_common');
  room.trickMatch.selection = null;
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p0');
  useTrick(room, 'p0', 'retention_common');
  const cards = getPublicState(room, 'p0').trickMatch.pendingChoice.cards;
  useTrick(room, 'p0', 'retention_common', { choiceIndexes: [0, 2] });
  assert.deepEqual(room.findPlayer('p0').holeCards, [cards[0], cards[2]]);
});

function currentActorForTrick(room) {
  return room.hand.actingOrder[room.hand.turnIndex];
}

function stealSpot(thiefTricks) {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.handNumber = TRICK_PHASE_HANDS;
  room.trickMatch.owned.set('p1', thiefTricks);
  room.trickMatch.owned.set('p2', ['sky_outside']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p1');
  return room;
}

test('stealing 天空之外 grants and announces its two epic tricks', () => {
  const room = stealSpot(['steal_skill']);
  useTrick(room, 'p1', 'steal_skill', { targetId: 'p2' });
  const loadout = room.trickMatch.owned.get('p1');
  assert.equal(loadout[0], 'sky_outside');
  assert(!loadout.includes('steal_skill'));
  assert(loadout.filter((id) => TRICKS[id].rarity === 'epic').length >= 2);
  const messages = getPublicState(room, 'p1').trickMatch.messages;
  const stolenAt = messages.findIndex((text) => /偷师：永久获得 天空之外/.test(text));
  const bonusAt = messages.findIndex((text) => /天空之外：额外获得 .+、.+/.test(text));
  assert(stolenAt >= 0 && bonusAt > stolenAt);
});

test('a 偷师 borrowed through 千术反转 still keeps the stolen trick', () => {
  const room = stealSpot(['trick_reflect']);
  room.hand.trickBorrowed.set('p1', 'steal_skill');
  useTrick(room, 'p1', 'steal_skill', { targetId: 'p2' });
  const loadout = room.trickMatch.owned.get('p1');
  assert(loadout.includes('trick_reflect'));
  assert(loadout.includes('sky_outside'));
  assert(loadout.filter((id) => TRICKS[id].rarity === 'epic').length >= 3);
});

test('捉千 is used twice a phase, and a target who used no trick makes it miss but still count', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p1', ['catch_cheat']);
  startHand(room);
  room.hand.turnIndex = room.hand.actingOrder.indexOf('p1');
  const trick = getPublicState(room, 'p1').trickMatch.owned.find((item) => item.id === 'catch_cheat');
  assert.match(trick.usage, /每阶段限用 2 次/);
  room.hand.stage = 'RIVER';
  room.hand.community = Array.from({ length: 5 }, () => room.hand.deck.pop());
  const chips = () => [room.findPlayer('p0').chips, room.findPlayer('p1').chips];
  const before = chips();
  useTrick(room, 'p1', 'catch_cheat', { targetId: 'p0' });
  assert.deepEqual(chips(), before, 'a miss moves no chips');
  assert.match(getPublicState(room, 'p1').trickMatch.messages.at(-1), /落空/);
  room.hand.trickActiveUsers.add('p0');
  useTrick(room, 'p1', 'catch_cheat', { targetId: 'p0' });
  assert.deepEqual(chips(), [before[0] - 20 * room.bigBlind, before[1] + 20 * room.bigBlind]);
  assert.throws(() => useTrick(room, 'p1', 'catch_cheat', { targetId: 'p0' }), /本阶段使用次数已达上限/);
  room.trickMatch.handNumber += TRICK_PHASE_HANDS;
  useTrick(room, 'p1', 'catch_cheat', { targetId: 'p0' });
});

test('算牌 counts only cards still to come', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['rank_count']);
  startHand(room);
  const h = room.hand;
  const me = room.findPlayer('p0');
  me.holeCards = ['Ah', 'Kd'];
  for (const card of ['Ah', 'Kd']) if (h.deck.includes(card)) h.deck.splice(h.deck.indexOf(card), 1);
  h.community = ['As', '2c', '3d'];
  for (const card of h.community) if (h.deck.includes(card)) h.deck.splice(h.deck.indexOf(card), 1);
  h.stage = 'FLOP';
  useTrick(room, 'p0', 'rank_count');
  const aces = h.deck.filter((card) => card[0] === 'A').length;
  const kings = h.deck.filter((card) => card[0] === 'K').length;
  assert.equal(getPublicState(room, 'p0').trickMatch.messages.at(-1), `算牌：牌堆中还剩 A ${aces} 张，K ${kings} 张`);
});

test('阴间 active tricks: twice a phase, once a hand; 佛眼 shows the real flop at the start of the next hand only', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['yin_buddha']);
  const play = () => { while (room.hand.stage !== 'SHOWDOWN') applyAction(room, currentActorForTrick(room), legalActions(room, currentActorForTrick(room)).includes('check') ? 'check' : 'call'); };
  const preview = () => getPublicState(room, 'p0').trickMatch.views.find((view) => /佛眼/.test(view.label));
  startHand(room);
  assert.match(getPublicState(room, 'p0').trickMatch.owned[0].usage, /每阶段限用 2 次，每局最多 1 次/);
  useTrick(room, 'p0', 'yin_buddha');
  assert.throws(() => useTrick(room, 'p0', 'yin_buddha'), /本局已经使用过/);
  play();
  startHand(room);
  const shown = preview().cards;
  useTrick(room, 'p0', 'yin_buddha');
  play();
  assert.deepEqual(room.hand.community.slice(0, 3), shown);
  startHand(room);
  assert(preview(), 'the second use shows in the hand after it');
  assert.throws(() => useTrick(room, 'p0', 'yin_buddha'), /本阶段使用次数已达上限/);
  play();
  startHand(room);
  assert.equal(preview(), undefined, 'no preview without a use the hand before');
});

test('a rare trick picked in phase three brings a random common one, and the offer says so', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.handNumber = 8;
  const selection = beginTrickSelection(room, () => 0);
  selection.offers.set('p0', ['suit_count', 'blind_box']);
  const offers = getPublicState(room, 'p0').trickMatch.selection.offers;
  assert.equal(offers.find((t) => t.id === 'suit_count').bonusCommon, true);
  assert.equal(offers.find((t) => t.id === 'blind_box').bonusCommon, false);
  chooseTrick(room, 'p0', 'suit_count');
  const held = room.trickMatch.owned.get('p0');
  assert.equal(held.length, 2);
  assert(held.includes('suit_count'));
  assert.equal(TRICKS[held.find((id) => id !== 'suit_count')].rarity, 'common');
});

test('终极抵抗反转 undoes two opposing tricks a phase, still spending them, and lends the trick', () => {
  const room = roomWithPlayers(3);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['ultimate_reflect']);
  room.trickMatch.owned.set('p1', ['peek_both', 'steal_hole', 'exchange']);
  startHand(room);
  const h = room.hand;
  h.turnIndex = h.actingOrder.indexOf('p1');
  const p0 = room.findPlayer('p0');
  const p1 = room.findPlayer('p1');
  const cards = [p0.holeCards.slice(), p1.holeCards.slice()];
  assert.equal(useTrick(room, 'p1', 'peek_both', { targetId: 'p0' }), null);
  assert.equal(getPublicState(room, 'p1').trickMatch.views.length, 0, 'the peek shows nothing');
  assert.match(getPublicState(room, 'p1').trickMatch.messages.at(-1), /终极抵抗反转/);
  assert.equal(getPublicState(room, 'p1').trickMatch.owned.find((t) => t.id === 'peek_both').uses, 1, 'still counted');
  const lent = getPublicState(room, 'p0').trickMatch.owned.find((t) => t.id === 'peek_both');
  assert(lent?.borrowed, 'the defender holds the trick for this hand');
  useTrick(room, 'p1', 'steal_hole', { targetId: 'p0', cardIndex: 0 });
  assert.deepEqual([p0.holeCards, p1.holeCards], cards, 'the swap was undone');
  useTrick(room, 'p1', 'exchange', { targetId: 'p0', both: true });
  assert.deepEqual([p0.holeCards, p1.holeCards], [cards[1], cards[0]], 'a third trick in the phase goes through');
  useTrick(room, 'p0', 'peek_both', { targetId: 'p1' });
  assert.equal(getPublicState(room, 'p0').trickMatch.views.length, 1, 'the lent trick works');
  assert.equal(getPublicState(room, 'p0').trickMatch.owned.find((t) => t.id === 'trick_reflect'), undefined);
});

test('定江山 picks the flop in order from eight cards, twice a match', () => {
  const room = roomWithPlayers(2);
  beginTrickMatch(room);
  room.trickMatch.selection = null;
  room.trickMatch.owned.set('p0', ['control_flop']);
  startHand(room);
  const h = room.hand;
  h.turnIndex = h.actingOrder.indexOf('p0');
  assert.match(getPublicState(room, 'p0').trickMatch.owned[0].usage, /整场限用 2 次/);
  assert.deepEqual(useTrick(room, 'p0', 'control_flop'), { prepared: true });
  const offered = getPublicState(room, 'p0').trickMatch.pendingChoice.cards;
  assert.equal(offered.length, 8);
  useTrick(room, 'p0', 'control_flop', { choiceIndexes: [5, 0, 2] });
  while (h.stage === 'PREFLOP') applyAction(room, currentActorForTrick(room), legalActions(room, currentActorForTrick(room)).includes('check') ? 'check' : 'call');
  assert.deepEqual(h.community, [offered[5], offered[0], offered[2]]);
});
