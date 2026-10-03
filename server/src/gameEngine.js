import { freshDeck, shuffle } from './deck.js';
import { solve, pickWinners } from './handEvaluator.js';
import { onTrickFold, onTrickHandStart, onTrickNextBoard, onTrickPreflopEnd, voidTrickHand,
  onTrickHandEnd, onTrickSettlement, retentionDrawCount, hasTrick, observedHoleCards,
  trickTurnSeconds, trickView, trickCardIntel } from './tricks.js';

export const TURN_SECONDS = 30;

function nextSeatIndex(players, fromSeat) {
  // players: array of {seat, eliminated}, sorted by seat, wraps around
  const seats = players.map((p) => p.seat).sort((a, b) => a - b);
  const idx = seats.findIndex((s) => s > fromSeat);
  return idx === -1 ? seats[0] : seats[idx];
}

export function startHand(room) {
  settleEliminations(room);
  const contenders = room.players.filter((p) => !p.eliminated && !p.kicked && !p.waitingForNextHand);
  if (contenders.length < 2) {
    room.hand = null;
    return null;
  }
  if (!room.trickMatch) {
    room.replayOf = null;
    room.handNumber += 1;
  }
  room.players.forEach((p) => {
    p.holeCards = null;
    p.folded = false;
    p.allIn = false;
    p.betThisRound = 0;
    p.betThisHand = 0;
    p.lastAction = null;
  });

  // rotate dealer to next active seat after current dealer
  room.dealerSeat = nextSeatIndex(contenders, room.dealerSeat);
  const orderedBySeat = contenders.slice().sort((a, b) => a.seat - b.seat);
  const dealerPos = orderedBySeat.findIndex((p) => p.seat === room.dealerSeat);
  const order = [
    ...orderedBySeat.slice(dealerPos),
    ...orderedBySeat.slice(0, dealerPos),
  ]; // order[0] = dealer/button

  const deck = shuffle(freshDeck());
  const trickRetentionCards = new Map();
  for (const p of order) {
    const drawn = Array.from({ length: retentionDrawCount(room, p.id) }, () => {
      if (!hasTrick(room, p.id, 'purist')) return deck.pop();
      const index = deck.findLastIndex((card) => card[0] !== '2' && card[0] !== '7');
      if (index < 0) throw new Error('牌堆没有符合纯粹主义者条件的牌');
      return deck.splice(index, 1)[0];
    });
    p.holeCards = drawn.slice(0, 2);
    if (drawn.length > 2) trickRetentionCards.set(p.id, drawn.slice(2));
  }

  const heads = order.length === 2;
  const sbPlayer = heads ? order[0] : order[1 % order.length];
  const bbPlayer = heads ? order[1] : order[2 % order.length];

  postBlind(sbPlayer, room.smallBlind);
  postBlind(bbPlayer, room.bigBlind);

  const actingOrder = order.map((p) => p.id);
  const firstToActIdx = heads
    ? 0
    : (order.indexOf(bbPlayer) + 1) % order.length;

  room.hand = {
    stage: 'PREFLOP',
    deck,
    community: [],
    currentBet: room.bigBlind,
    minRaise: room.bigBlind,
    raisedPlayerIds: new Set(), // players who've used their raise this round (raiseMode 'single')
    allInLocked: order.some((p) => p.allIn), // locks raising until this entire hand ends
    sbPlayerId: sbPlayer.id,
    bbPlayerId: bbPlayer.id,
    actingOrder,
    turnIndex: firstToActIdx,
    needsToAct: new Set(
      order.filter((p) => !p.allIn).map((p) => p.id)
    ),
    turnDeadline: Date.now() + trickTurnSeconds(room, actingOrder[firstToActIdx]) * 1000,
    log: [],
    revealed: null,
    peeks: new Map(), // targetPlayerId -> Set(viewerPlayerId) who paid to see their folded cards
    publicReveals: new Set(), // playerIds who voluntarily showed their folded cards to everyone
    foldOrder: [],
    trickPotDrain: 0,
    trickForcedFolds: new Map(),
    trickNextBoard: null,
    trickRetentionCards,
  };

  onTrickHandStart(room);

  if (room.hand.needsToAct.size === 0) closeBettingRound(room);
  else if (!room.hand.needsToAct.has(actingOrder[firstToActIdx])) {
    advanceTurnIndex(room);
    room.hand.turnDeadline = Date.now() + trickTurnSeconds(room, currentActor(room).id) * 1000;
  }
  return room.hand;
}

function postBlind(player, amount) {
  const bet = Math.min(amount, player.chips);
  player.chips -= bet;
  player.betThisRound = bet;
  player.betThisHand = bet;
  if (player.chips === 0) player.allIn = true;
}

function playerById(room, id) {
  return room.players.find((p) => p.id === id);
}

function activeActors(room) {
  // non-folded, non-all-in players still in the hand, in acting order
  const h = room.hand;
  return h.actingOrder
    .map((id) => playerById(room, id))
    .filter((p) => !p.folded && !p.allIn);
}

function liveInHand(room) {
  const h = room.hand;
  return h.actingOrder.map((id) => playerById(room, id)).filter((p) => !p.folded);
}

export function currentActor(room) {
  const h = room.hand;
  if (!h || h.stage === 'SHOWDOWN') return null;
  return playerById(room, h.actingOrder[h.turnIndex]);
}

function advanceTurnIndex(room) {
  const h = room.hand;
  const n = h.actingOrder.length;
  for (let step = 1; step <= n; step++) {
    const idx = (h.turnIndex + step) % n;
    const p = playerById(room, h.actingOrder[idx]);
    if (!p.folded && !p.allIn && h.needsToAct.has(p.id)) {
      h.turnIndex = idx;
      return;
    }
  }
}

function raiseIsAllowed(room, p) {
  return raiseBlockedReason(room, p) === null;
}

function raiseBlockedReason(room, p) {
  const h = room.hand;
  if (h.allInLocked) return '本局已有玩家全下，只能跟注、过牌或弃牌。';
  if (!activeActors(room).some((other) => other.id !== p.id)) return '没有其他可继续下注的玩家。';
  if (room.raiseMode === 'single' && h.raisedPlayerIds.has(p.id)) return '本轮已加注一次，下一轮可再次加注。';
  const minTo = h.currentBet + h.minRaise;
  if (minTo > p.betThisRound + p.chips) return `筹码不足以加注到 ${minTo}。`;
  if (room.maxPotPerRound && room.maxPotPerRound < minTo) return `单轮下注上限为 ${room.maxPotPerRound}，无法继续加注。`;
  if (room.maxPotPerHand && p.betThisHand + minTo - p.betThisRound > room.maxPotPerHand)
    return `整局下注上限为 ${room.maxPotPerHand}，无法继续加注。`;
  if (maxRaiseTo(room, p) < minTo) return `受其他玩家筹码限制，无法加注到 ${minTo}。`;
  return null;
}

export function legalActions(room, playerId) {
  const h = room.hand;
  const p = playerById(room, playerId);
  if (!h || !p || p.folded || p.allIn || currentActor(room)?.id !== playerId ||
      !h.needsToAct.has(playerId)) return [];
  if (h.trickForcedFolds?.has(playerId) || h.trickForcedGuessFolds?.has(playerId)) return ['fold'];
  const toCall = h.currentBet - p.betThisRound;
  const actions = ['fold'];
  if (toCall <= 0) actions.push('check');
  else actions.push('call');
  if (!h.allInLocked) {
    if (p.chips > toCall && raiseIsAllowed(room, p)) actions.push('raise');
    // Only offer all-in when it's more than a plain call, or actually empties the stack.
    const allInTo = maxAllInTo(room, p);
    const alreadyRaised = room.raiseMode === 'single' && h.raisedPlayerIds.has(p.id);
    if (allInTo > p.betThisRound &&
        (!alreadyRaised || allInTo <= h.currentBet) &&
        (allInTo > h.currentBet || allInTo === p.betThisRound + p.chips)) actions.push('allin');
  }
  return actions;
}

// Raises and all-ins are both capped at the smallest stack among the other
// players still live in the hand -- you can never bet more than everyone else could match.
export function maxRaiseTo(room, p) {
  let cap = p.betThisRound + p.chips;
  if (room.maxPotPerRound) cap = Math.min(cap, room.maxPotPerRound);
  if (room.maxPotPerHand) {
    const handRoomLeft = room.maxPotPerHand - p.betThisHand;
    cap = Math.min(cap, p.betThisRound + handRoomLeft);
  }
  const others = activeActors(room).filter((x) => x.id !== p.id);
  if (others.length) {
    cap = Math.min(cap, Math.min(...others.map((x) => x.betThisRound + x.chips)));
  }
  return Math.floor(cap / 10) * 10;
}

export function maxAllInTo(room, p) {
  const h = room.hand;
  const cap = maxRaiseTo(room, p);
  // A raise cap must never reduce a call or refund money already in the pot.
  const callTo = Math.min(h.currentBet, p.betThisRound + p.chips);
  return Math.max(callTo, Math.floor(cap / 10) * 10);
}

export function applyAction(room, playerId, type, amount) {
  const h = room.hand;
  const actor = currentActor(room);
  if (!h || !actor || actor.id !== playerId) {
    throw new Error('not your turn');
  }
  if (!legalActions(room, playerId).includes(type)) {
    throw new Error(h.allInLocked && (type === 'raise' || type === 'allin')
      ? '本局已有玩家全下，只能跟注、过牌或弃牌'
      : '当前不能执行此操作');
  }
  const p = actor;
  const toCall = h.currentBet - p.betThisRound;

  if (type === 'fold') {
    p.folded = true;
    h.foldOrder.push(p.id);
    onTrickFold(room, p.id);
    p.lastAction = 'fold';
    h.needsToAct.delete(p.id);
    h.trickForcedFolds?.delete(p.id);
    h.trickForcedGuessFolds?.delete(p.id);
  } else if (type === 'check') {
    if (toCall > 0) throw new Error('cannot check, must call or fold');
    p.lastAction = 'check';
    h.needsToAct.delete(p.id);
  } else if (type === 'call') {
    const pay = Math.min(toCall, p.chips);
    p.chips -= pay;
    p.betThisRound += pay;
    p.betThisHand += pay;
    if (p.chips === 0) {
      p.allIn = true;
      h.allInLocked = true;
    }
    p.lastAction = p.allIn ? 'allin' : 'call';
    h.needsToAct.delete(p.id);
  } else if (type === 'raise') {
    if (!raiseIsAllowed(room, p)) throw new Error('raise not allowed right now');
    if (!Number.isFinite(amount)) throw new Error('无效的加注金额');
    const raiseTo = Math.round(amount);
    if (raiseTo % 10 !== 0) throw new Error('raise must be a multiple of 10');
    const minTo = h.currentBet + h.minRaise;
    if (raiseTo < minTo && raiseTo < p.betThisRound + p.chips) {
      throw new Error(`raise must be at least ${minTo}`);
    }
    const delta = raiseTo - p.betThisRound;
    if (delta > p.chips) throw new Error('not enough chips');
    const raiseSize = raiseTo - h.currentBet;
    if (room.maxPotPerRound && raiseTo > room.maxPotPerRound) {
      throw new Error(`raise cannot exceed the round cap of ${room.maxPotPerRound}`);
    }
    const projectedBetThisHand = p.betThisHand + delta;
    if (room.maxPotPerHand && projectedBetThisHand > room.maxPotPerHand) {
      throw new Error(`raise cannot exceed the hand cap of ${room.maxPotPerHand}`);
    }
    if (raiseTo > maxRaiseTo(room, p)) {
      throw new Error(`加注不能超过其他玩家能跟上的额度（${maxRaiseTo(room, p)}）`);
    }
    p.chips -= delta;
    p.betThisRound = raiseTo;
    p.betThisHand += delta;
    if (p.chips === 0) {
      p.allIn = true;
      h.allInLocked = true;
    }
    h.currentBet = raiseTo;
    if (raiseSize > h.minRaise) h.minRaise = raiseSize;
    h.raisedPlayerIds.add(p.id);
    p.lastAction = p.allIn ? 'allin' : 'raise';
    h.needsToAct = new Set(
      activeActors(room)
        .filter((x) => x.id !== p.id)
        .map((x) => x.id)
    );
  } else if (type === 'allin') {
    // capped by room rules and by the shortest stack among other live players;
    // only a true all-in (chips hit zero) if the cap doesn't bind below the
    // player's full stack
    const raiseTo = maxAllInTo(room, p);
    const delta = raiseTo - p.betThisRound;
    p.chips -= delta;
    p.betThisRound = raiseTo;
    p.betThisHand += delta;
    const wentAllIn = p.chips === 0;
    if (wentAllIn) p.allIn = true;
    p.lastAction = wentAllIn ? 'allin' : 'raise';
    h.needsToAct.delete(p.id);
    h.allInLocked = true;
    if (raiseTo > h.currentBet) {
      const raiseSize = raiseTo - h.currentBet;
      h.currentBet = raiseTo;
      if (raiseSize > h.minRaise) h.minRaise = raiseSize;
      h.raisedPlayerIds.add(p.id);
      // reopen action for everyone still live who isn't all-in
      h.needsToAct = new Set(
        activeActors(room)
          .filter((x) => x.id !== p.id)
          .map((x) => x.id)
      );
    }
  } else {
    throw new Error('unknown action');
  }

  return progressHand(room);
}

export function forceTimeoutAction(room) {
  const actor = currentActor(room);
  if (!actor) return null;
  const h = room.hand;
  const toCall = h.currentBet - actor.betThisRound;
  const type = h.trickForcedFolds?.has(actor.id) || h.trickForcedGuessFolds?.has(actor.id) || toCall > 0
    ? 'fold' : 'check';
  return applyAction(room, actor.id, type, 0);
}

// Forces a player out of the current hand (used when the host kicks them).
// Unlike applyAction, this doesn't require it to be their turn.
export function forceFoldFromHand(room, playerId) {
  const h = room.hand;
  if (!h || h.stage === 'SHOWDOWN' || !h.actingOrder.includes(playerId)) return null;
  const p = playerById(room, playerId);
  if (!p || p.folded || p.allIn) return null;
  const wasActor = currentActor(room)?.id === playerId;
  p.folded = true;
  h.foldOrder.push(p.id);
  onTrickFold(room, p.id);
  p.lastAction = 'fold';
  h.needsToAct.delete(p.id);
  h.trickForcedFolds?.delete(p.id);
  h.trickForcedGuessFolds?.delete(p.id);

  const live = liveInHand(room);
  if (live.length === 1) return finishHandUncontested(room);
  if (h.needsToAct.size === 0) return closeBettingRound(room);
  if (wasActor || currentActor(room)?.allIn || currentActor(room)?.folded) {
    advanceTurnIndex(room);
    h.turnDeadline = Date.now() + trickTurnSeconds(room, currentActor(room).id) * 1000;
  }
  return { event: 'ACTION_TAKEN' };
}

function progressHand(room) {
  const h = room.hand;
  const live = liveInHand(room);

  if (live.length === 1) {
    return finishHandUncontested(room);
  }

  if (h.needsToAct.size === 0) {
    return closeBettingRound(room);
  }

  advanceTurnIndex(room);
  h.turnDeadline = Date.now() + trickTurnSeconds(room, currentActor(room).id) * 1000;
  return { event: 'ACTION_TAKEN' };
}

function remainingActorsCanAct(room) {
  return activeActors(room).length;
}

function closeBettingRound(room) {
  const h = room.hand;
  if (h.stage === 'PREFLOP') onTrickPreflopEnd(room);
  room.players.forEach((p) => {
    p.betThisRound = 0;
    if (!p.folded) p.lastAction = null;
  });
  h.currentBet = 0;
  h.minRaise = room.bigBlind;
  h.raisedPlayerIds = new Set();

  if (remainingActorsCanAct(room) <= 1) {
    // everyone left is all-in (or only one can still act) -> run out remaining cards
    while (h.stage !== 'RIVER') {
      dealNextStreet(room);
    }
    return goToShowdown(room);
  }

  if (h.stage === 'RIVER') {
    return goToShowdown(room);
  }

  dealNextStreet(room);
  h.needsToAct = new Set(activeActors(room).map((p) => p.id));
  h.turnIndex = firstToActPostflop(room);
  h.turnDeadline = Date.now() + trickTurnSeconds(room, currentActor(room).id) * 1000;
  return { event: 'STREET_DEALT', stage: h.stage };
}

function dealNextStreet(room) {
  const h = room.hand;
  const draw = () => h.deck.pop();
  const nextCard = () => {
    if (h.trickNextBoard) {
      const card = Array.isArray(h.trickNextBoard) ? h.trickNextBoard.shift() : h.trickNextBoard;
      if (!Array.isArray(h.trickNextBoard) || h.trickNextBoard.length === 0)
        h.trickNextBoard = null;
      return card;
    }
    return draw();
  };
  // 不动如山 took a locked turn or river out of the deck; it is dealt here without drawing, so the
  // cards after it arrive exactly as planned.
  const slotCard = (slot) => {
    const locked = h.trickBoardLocks?.[slot];
    if (!locked) return nextCard();
    delete h.trickBoardLocks[slot];
    return locked;
  };
  if (h.stage === 'PREFLOP') {
    draw(); // burn
    const first = nextCard();
    h.community.push(first, nextCard(), nextCard());
    h.stage = 'FLOP';
    onTrickNextBoard(room, first);
  } else if (h.stage === 'FLOP') {
    draw();
    const card = slotCard(3);
    h.community.push(card);
    h.stage = 'TURN';
    onTrickNextBoard(room, card);
  } else if (h.stage === 'TURN') {
    draw();
    const card = slotCard(4);
    h.community.push(card);
    h.stage = 'RIVER';
    h.trickRiverPlayerIds = h.actingOrder.filter((id) => !playerById(room, id).folded);
    onTrickNextBoard(room, card);
  }
}

function firstToActPostflop(room) {
  const h = room.hand;
  const n = h.actingOrder.length;
  // action starts with the first live player after the dealer (index 0); dealer acts last
  for (let step = 1; step <= n; step++) {
    const idx = step % n;
    const p = playerById(room, h.actingOrder[idx]);
    if (!p.folded && !p.allIn) return idx;
  }
  return 0;
}

// Splits contributions into main/side pots. A layer whose contributors all
// folded goes to the last of them to fold: once the others had folded, that
// player was the only one left contesting it.
function buildPots(room) {
  const h = room.hand;
  const contributors = room.players
    .filter((p) => p.betThisHand > 0)
    .sort((a, b) => a.betThisHand - b.betThisHand);
  const levels = [...new Set(contributors.map((p) => p.betThisHand))];
  let prevLevel = 0;
  const pots = [];
  for (const level of levels) {
    const layerContributors = contributors.filter((p) => p.betThisHand >= level);
    const amount = (level - prevLevel) * layerContributors.length;
    let eligible = layerContributors.filter((p) => !p.folded);
    if (eligible.length === 0) {
      const lastFolder = layerContributors.reduce((a, b) =>
        h.foldOrder.indexOf(b.id) > h.foldOrder.indexOf(a.id) ? b : a
      );
      eligible = [lastFolder];
    }
    const last = pots[pots.length - 1];
    if (amount > 0 && last && last.eligible.length === eligible.length &&
        last.eligible.every((p) => eligible.includes(p))) {
      last.amount += amount;
    } else if (amount > 0) {
      pots.push({ amount, eligible });
    }
    prevLevel = level;
  }
  const drain = h.trickPotDrain || 0;
  if (drain > 0 && pots.length) {
    const total = pots.reduce((sum, pot) => sum + pot.amount, 0);
    const unitCount = drain / 10;
    const shares = pots.map((pot) => drain * pot.amount / total / 10);
    const units = shares.map(Math.floor);
    let remaining = unitCount - units.reduce((sum, value) => sum + value, 0);
    const priority = shares.map((value, index) => ({ index, fraction: value - units[index] }))
      .sort((a, b) => b.fraction - a.fraction);
    for (const item of priority) {
      if (!remaining) break;
      if (units[item.index] * 10 < pots[item.index].amount) {
        units[item.index]++;
        remaining--;
      }
    }
    pots.forEach((pot, index) => { pot.amount -= units[index] * 10; });
  }
  return pots;
}

function finishHandUncontested(room) {
  const h = room.hand;
  h.foldedPreflop = h.stage === 'PREFLOP';
  onTrickHandEnd(room);
  const payoutsById = new Map();
  for (const pot of buildPots(room)) {
    const payee = pot.eligible[0];
    payee.chips += pot.amount;
    payoutsById.set(payee.id, (payoutsById.get(payee.id) || 0) + pot.amount);
  }
  // Nobody needs to see the rest of the deck to determine a winner here,
  // but dealing it out anyway is a nice bit of table theater.
  while (h.stage !== 'RIVER') {
    dealNextStreet(room);
  }
  h.stage = 'SHOWDOWN';
  h.revealed = {
    pots: [...payoutsById].map(([playerId, amount]) => (
      { amount, winnerIds: [playerId], payouts: [{ playerId, amount }], hand: null }
    )),
    showCards: false,
  };
  onTrickSettlement(room);
  if (h.foldedPreflop && room.trickMatch) voidTrickHand(room);
  else if (h.foldedPreflop && room.handLimit) {
    // A limited normal match doesn't count it either: the winner keeps the blinds, and the next
    // hand is dealt under the same number.
    room.replayOf = room.handNumber;
    room.handNumber -= 1;
  }
  return { event: 'HAND_COMPLETE', revealed: h.revealed };
}

function goToShowdown(room) {
  const h = room.hand;
  h.stage = 'SHOWDOWN';
  onTrickHandEnd(room);
  const pots = buildPots(room);

  const dealerIdx = h.actingOrder.length
    ? h.actingOrder.findIndex(
        (id) => playerById(room, id).seat === room.dealerSeat
      )
    : 0;

  const potResults = pots.map((pot) => {
    if (pot.eligible.length === 1) {
      pot.eligible[0].chips += pot.amount;
      return { amount: pot.amount, winnerIds: [pot.eligible[0].id],
        payouts: [{ playerId: pot.eligible[0].id, amount: pot.amount }], handName: null };
    }
    const solved = pot.eligible.map((p) => ({
      player: p,
      hand: solve([...p.holeCards, ...h.community]),
    }));
    const winners = pickWinners(solved.map((s) => s.hand));
    const winningPlayers = solved.filter((s) => winners.includes(s.hand));
    const share = Math.floor(pot.amount / winningPlayers.length / 10) * 10;
    const remainder = (pot.amount - share * winningPlayers.length) / 10;

    // Remaining ten-chip units are distributed starting left of the dealer.
    const orderStartingAfterDealer = [
      ...h.actingOrder.slice(dealerIdx + 1),
      ...h.actingOrder.slice(0, dealerIdx + 1),
    ];
    const sortedWinners = winningPlayers
      .slice()
      .sort(
        (a, b) =>
          orderStartingAfterDealer.indexOf(a.player.id) -
          orderStartingAfterDealer.indexOf(b.player.id)
      );

    const payouts = sortedWinners.map((w, i) => {
      const amount = share + (i < remainder ? 10 : 0);
      w.player.chips += amount;
      return { playerId: w.player.id, amount };
    });

    return {
      amount: pot.amount,
      winnerIds: winningPlayers.map((w) => w.player.id),
      payouts,
      handName: winningPlayers[0].hand.name,
      // Each winner's made hand and the five cards that make it, for the settlement screen.
      hands: winningPlayers.map((w) => ({
        playerId: w.player.id,
        handName: w.hand.descr === 'Royal Flush' ? 'Royal Flush' : w.hand.name,
        cards: w.hand.cards.map((card) => `${card.value}${card.suit}`),
      })),
    };
  });

  h.revealed = { pots: potResults, showCards: true };
  onTrickSettlement(room);
  return { event: 'HAND_COMPLETE', revealed: h.revealed };
}

export function getPublicState(room, forPlayerId) {
  const h = room.hand;
  const actor = currentActor(room);
  const me = playerById(room, forPlayerId);
  const myLegalActions = actor && actor.id === forPlayerId ? legalActions(room, forPlayerId) : [];
  return {
    status: room.status,
    code: room.code,
    hostPlayerId: room.hostPlayerId,
    buyIn: room.buyIn,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    raiseMode: room.raiseMode,
    gameMode: room.gameMode,
    trickMatch: trickView(room, forPlayerId),
    handLimit: room.handLimit,
    handNumber: room.replayOf ?? room.handNumber,
    handReplayed: room.replayOf != null,
    matchComplete: !!room.matchComplete,
    maxPotPerRound: room.maxPotPerRound,
    maxPotPerHand: room.maxPotPerHand,
    history: room.history,
    awaitingContinue: !!room.awaitingContinue,
    readyPlayerIds: [...room.readyPlayerIds],
    dealerSeat: room.dealerSeat,
    sbPlayerId: h ? h.sbPlayerId : null,
    bbPlayerId: h ? h.bbPlayerId : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar || 'preset-1',
      nameplate: p.nameplate || 'plain',
      bot: !!p.bot,
      bio: p.bio || '',
      seat: p.seat,
      chips: p.chips,
      connected: p.connected,
      eliminated: p.eliminated,
      kicked: !!p.kicked,
      waitingForNextHand: !!p.waitingForNextHand,
      inVoice: !!p.inVoice,
      folded: h ? !!p.folded : false,
      allIn: h ? !!p.allIn : false,
      betThisRound: h ? p.betThisRound : 0,
      betThisHand: h ? p.betThisHand : 0,
      lastAction: h ? p.lastAction : null,
      holeCards: !h || !p.holeCards ? null :
        p.id === forPlayerId && h.trickBlindHoles?.has(forPlayerId) && h.stage !== 'SHOWDOWN'
          ? [null, null] :
        (p.id === forPlayerId ||
          (h.revealed && h.revealed.showCards && !p.folded) ||
          h.peeks.get(p.id)?.has(forPlayerId) ||
          h.publicReveals.has(p.id) ||
          h.trickPeeks?.get(forPlayerId)?.has(p.id))
          ? h.stage === 'SHOWDOWN' && h.revealed?.showCards
            ? p.holeCards : observedHoleCards(room, forPlayerId, p.id)
          : p.holeCards.map((card, index) =>
            h.trickPeekIndexes?.get(forPlayerId)?.get(p.id)?.has(index)
              ? observedHoleCards(room, forPlayerId, p.id)[index] : null),
      holeCardIntel: h && p.id !== forPlayerId
        ? trickCardIntel(room, forPlayerId, p.id) : null,
      peekedByMe: h ? !!h.peeks.get(p.id)?.has(forPlayerId) : false,
      revealedToAll: h ? h.publicReveals.has(p.id) : false,
      handRank:
        h && p.id === forPlayerId && p.holeCards && !p.folded && h.community.length >= 3 &&
          !(h.trickBlindfolded?.has(forPlayerId) && h.stage !== 'RIVER' && h.stage !== 'SHOWDOWN') &&
          !(h.trickBlindHoles?.has(forPlayerId) && h.stage !== 'SHOWDOWN') &&
          !(h.trickHideRiver?.has(forPlayerId) && h.stage !== 'SHOWDOWN')
          && !(h.trickYinMasks?.get(forPlayerId)?.some((index) => index < h.community.length) && h.stage !== 'SHOWDOWN')
          ? solve([...p.holeCards, ...h.community]).name
          : null,
    })),
    hand: h
      ? {
          stage: h.stage,
          community: h.community.map((card, index) =>
            h.stage !== 'SHOWDOWN' &&
            (h.trickBlindfolded?.has(forPlayerId) && h.stage !== 'RIVER' && index < 3 ||
            h.trickHideRiver?.has(forPlayerId) && index === 4 ||
            h.trickYinMasks?.get(forPlayerId)?.includes(index)) ? null : card),
          currentBet: h.currentBet,
          minRaise: h.minRaise,
          pot: room.players.reduce((s, p) => s + p.betThisHand, 0) - (h.trickPotDrain || 0),
          actingPlayerId: actor ? actor.id : null,
          turnDeadline: h.turnDeadline,
          turnSeconds: actor ? trickTurnSeconds(room, actor.id) : TURN_SECONDS,
          revealed: h.revealed,
          legalActions: myLegalActions,
          raiseBlockedReason: actor && actor.id === forPlayerId ? raiseBlockedReason(room, actor) : null,
          allInLocked: !!h.allInLocked,
          toCall: actor ? h.currentBet - actor.betThisRound : 0,
          maxRaiseTo: myLegalActions.includes('raise') ? maxRaiseTo(room, me) : null,
          allInTo: actor && actor.id === forPlayerId ? maxAllInTo(room, actor) : null,
        }
      : null,
  };
}

export function peekCost(room, targetId) {
  const h = room.hand;
  const isWinner = !!h?.revealed?.pots.some((pot) => pot.winnerIds.includes(targetId));
  return isWinner ? room.bigBlind : room.smallBlind;
}

export function payToPeek(room, viewerId, targetId) {
  const h = room.hand;
  if (!h || h.stage !== 'SHOWDOWN' || !h.revealed) throw new Error('只能在摊牌阶段看牌');
  if (viewerId === targetId) throw new Error('不能看自己的牌');
  const viewer = playerById(room, viewerId);
  const target = playerById(room, targetId);
  if (!viewer || !target) throw new Error('玩家不存在');

  const isWinner = h.revealed.pots.some((pot) => pot.winnerIds.includes(targetId));
  const alreadyPublic = h.publicReveals.has(targetId) || (h.revealed.showCards && !target.folded);
  if (alreadyPublic) throw new Error('这名玩家的底牌已经公开了');
  if (!target.folded && !isWinner) throw new Error('看不了这名玩家的牌');

  const cost = peekCost(room, targetId);
  if (viewer.chips < cost) throw new Error('筹码不够');
  const seen = h.peeks.get(targetId) || new Set();
  if (seen.has(viewerId)) throw new Error('已经看过了');
  viewer.chips -= cost;
  target.chips += cost;
  seen.add(viewerId);
  h.peeks.set(targetId, seen);
}

export function revealFoldedCards(room, playerId) {
  const h = room.hand;
  if (!h) throw new Error('没有进行中的牌局');
  const p = playerById(room, playerId);
  if (!p) throw new Error('玩家不存在');
  if (!p.folded) throw new Error('只有弃牌的人可以公开自己的牌');
  h.publicReveals.add(playerId);
}

export function settleEliminations(room) {
  room.players.forEach((p) => {
    if (!p.eliminated && !p.waitingForNextHand && p.chips < room.bigBlind) p.eliminated = true;
  });
  const remaining = room.players.filter((p) => !p.eliminated && !p.waitingForNextHand);
  return remaining.length <= 1;
}
