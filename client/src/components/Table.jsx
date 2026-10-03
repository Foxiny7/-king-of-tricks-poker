import { useEffect, useRef, useState } from 'react';
import Card from './Card';
import Seat from './Seat';
import RoomChat from './RoomChat';
import ActionBar from './ActionBar';
import HandRankings from './HandRankings';
import Settings from './Settings';
import { PlayerProfile } from './Profile';
import { voiceSlotRef } from '../voiceSlot';
import TrickPanel from './TrickPanel';
import TrickCatalog from './TrickCatalog';
import { translateHandName } from '../handNames';
import { socket } from '../socket';
import { isSpeechAvailable, speakAction, speakOutcome, speakStreet } from '../speech';
import { useSetting } from '../settings';
import { playBooSound, playVictorySound } from '../sounds';
import { emojiIconSrc } from '../emojiIcons';
import { useTheme } from '../ThemeContext';
import { HAND_STYLES } from '../themes';

const CARD_TARGET_TRICKS = new Set(['exchange', 'peek_one', 'peek_both', 'peek_rank', 'mark_chosen',
  'reveal_loadout', 'reveal_one', 'intuition', 'discard_both', 'forced_fold', 'suit_or_run',
  'high_probe', 'hand_scent', 'steal_skill', 'steal_hole', 'bottom_deal', 'suit_shift',
  'catch_cheat', 'disable_tricks', 'blindfold', 'discard_all', 'guess_holes', 'strategy_card',
  'blind_next', 'mental_block']);
const OWN_CARD_TRICKS = new Set(['bottom_deal', 'suit_shift', 'strategy_card']);
const TABLE_CHOICE_TRICKS = new Set(['swap_five', 'control_five', 'control_flop', 'retention_common',
  'retention_rare', 'retention_epic', 'retention_legendary']);
const TABLE_DIRECT_TRICKS = new Set(['peek_all', 'blind_box', 'peek_next', 'mark_chosen']);
// Card choices made in order: 定江山 the three flop cards, 定河山 the turn then the river.
const ORDERED_CHOICES = {
  control_flop: ['第一张', '第二张', '第三张'],
  control_five: ['转牌', '河牌'],
};

const TOOL_PATHS = {
  friends: <><circle cx="8" cy="8" r="3" /><path d="M2 20v-2a6 6 0 0 1 12 0v2M17 11a3 3 0 1 0-2-5.6M17 15a5 5 0 0 1 5 5" /></>,
  trick: <><path d="M5 3h14v18H5zM8 7h8M8 11h5M8 15h8" /><path d="m17 13 2 2-2 2-2-2z" /></>,
  book: <><path d="M4 4h6a3 3 0 0 1 3 3v14a3 3 0 0 0-3-3H4zM20 4h-4a3 3 0 0 0-3 3v14a3 3 0 0 1 3-3h4z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M10 2h4l.5 2.5 2 1 2.3-1 2 3.5-2 1.6v2.8l2 1.6-2 3.5-2.3-1-2 1L14 22h-4l-.5-2.5-2-1-2.3 1-2-3.5 2-1.6v-2.8l-2-1.6 2-3.5 2.3 1 2-1z" /></>,
  ranks: <><path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" /></>,
  back: <><path d="M11 5 4 12l7 7M4 12h16" /></>,
};
function ToolIcon({ name }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TOOL_PATHS[name]}</svg>;
}

function layoutSeats(players, meId) {
  const n = players.length;
  const meIdx = players.findIndex((p) => p.id === meId);
  const rotated = [...players.slice(meIdx + 1), ...players.slice(0, meIdx + 1)];
  return rotated.map((p, i) => {
    const angle = Math.PI / 2 + ((i - (n - 1)) * 2 * Math.PI) / n;
    const x = 50 + 42 * Math.cos(angle);
    const y = Math.max(18, Math.min(82, 50 + 38 * Math.sin(angle)));
    // direction from the center deck pile out to this seat, used to make dealt
    // cards visibly fly outward from the deck instead of just fading in place
    const dealFrom = { x: -Math.cos(angle) * 130, y: -Math.sin(angle) * 88 };
    return {
      player: p,
      style: { left: `clamp(46px, ${x}%, calc(100% - 46px))`, top: `${y}%` },
      dealFrom,
    };
  });
}

// Fills the action dock while someone else is deciding, so the felt keeps one size all hand long.
function TurnWait({ hand, players }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const actor = players.find((p) => p.id === hand.actingPlayerId);
  const remaining = hand.turnDeadline ? Math.max(0, hand.turnDeadline - now) : 0;
  return (
    <div className="table-wait" role="status">
      <div className="table-wait-heading">
        <strong>{actor ? `等待 ${actor.name} 行动` : '发牌中'}</strong>
        {actor && hand.turnDeadline && <span className="timer-count">{Math.ceil(remaining / 1000)}s</span>}
      </div>
      {actor && hand.turnDeadline && (
        <div className="timer-bar">
          <div className="timer-fill" style={{ width: `${Math.min(100, (remaining / ((hand.turnSeconds || 30) * 1000)) * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function summarizeWinners(revealed, players) {
  const totals = new Map(); // playerId -> { amount, handName, cards }
  revealed.pots.forEach((pot) => {
    pot.payouts.forEach(({ playerId: id, amount }) => {
      const entry = totals.get(id) || { amount: 0, handName: pot.handName, cards: null };
      entry.amount += amount;
      // The made hand is the same in every pot a player wins; take it from the first that has one.
      const made = pot.hands?.find((item) => item.playerId === id);
      if (made && !entry.cards) Object.assign(entry, { handName: made.handName, cards: made.cards });
      else if (pot.handName && !entry.handName) entry.handName = pot.handName;
      totals.set(id, entry);
    });
  });
  return [...totals.entries()].map(([id, v]) => {
    const player = players.find((p) => p.id === id);
    const netAmount = v.amount - (player?.betThisHand || 0);
    return { id, ...v, netAmount };
  });
}

export default function Table({ room, me, onAction, onReturnToLobby, onKick, onRebuy, onReady, onPeek, onReveal, onUseTrick, onOpenFriends, onAddBot, onAddFriend }) {
  const hand = room.hand;
  const seats = layoutSeats(room.players, me.playerId);
  const isHost = room.hostPlayerId === me.playerId;
  const { tableTheme, handStyle } = useTheme();
  const handArt = HAND_STYLES.find((style) => style.id === handStyle)?.image || HAND_STYLES[0].image;
  const [showRankings, setShowRankings] = useState(false);
  // The result panel can be folded to one line, like the chat, so it never hides the board; the
  // choice holds for the following hands while the player stays at the table.
  const [settlementFolded, setSettlementFolded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [profilePlayer, setProfilePlayer] = useState(null);
  const [showTrickPanel, setShowTrickPanel] = useState(false);
  const [showTrickCatalog, setShowTrickCatalog] = useState(false);
  const [cardTargeting, setCardTargeting] = useState(null);
  const [guessedRanks, setGuessedRanks] = useState(['A', 'A']);
  const [tableChoiceIndexes, setTableChoiceIndexes] = useState([]);
  const [intelToast, setIntelToast] = useState(null);
  const intelCounts = useRef({ handNumber: 0, messages: 0, views: 0, publicAnnouncements: 0 });
  const intelQueue = useRef([]);
  const [peekFly, setPeekFly] = useState(null);

  useEffect(() => setCardTargeting(null), [hand.stage]);
  useEffect(() => {
    const match = room.trickMatch;
    if (!match) return;
    const newHand = intelCounts.current.handNumber !== match.handNumber;
    const previous = newHand ? { messages: 0, views: 0, publicAnnouncements: 0 } : intelCounts.current;
    const incoming = [
      ...(match.publicAnnouncements || []).slice(previous.publicAnnouncements).map((message) => ({ message })),
      ...match.messages.slice(previous.messages).map((message) => ({ message })),
      ...match.views.slice(previous.views).map((view) => ({ view })),
    ];
    intelCounts.current = { handNumber: match.handNumber,
      messages: match.messages.length, views: match.views.length,
      publicAnnouncements: (match.publicAnnouncements || []).length };
    if (newHand) intelQueue.current = [];
    intelQueue.current.push(...incoming);
    if (newHand || !intelToast) setIntelToast(intelQueue.current.shift() || null);
  }, [room.trickMatch]);
  useEffect(() => {
    if (!intelToast) return undefined;
    const timer = setTimeout(() => setIntelToast(intelQueue.current.shift() || null), 4500);
    return () => clearTimeout(timer);
  }, [intelToast]);
  const myPlayer = room.players.find((p) => p.id === me.playerId);
  const winners = hand.revealed ? summarizeWinners(hand.revealed, room.players) : [];
  // The whole match is over (its last hand, or one player left), not just this hand.
  const matchOver = !!(room.trickMatch?.ended || room.matchComplete);
  const primarySeat = winners.length ? seats.find((s) => s.player.id === winners[0].id) : null;
  // The same players the server waits for (playersAwaitedForContinue): bots never tap 继续.
  const awaitedPlayers = room.players.filter(
    (p) => p.connected && !p.bot && !p.eliminated && !p.kicked && !p.waitingForNextHand
  );
  const iAmReady = room.readyPlayerIds?.includes(me.playerId);
  const iAmWaitingForNextHand = !!myPlayer?.waitingForNextHand;
  const peekTargets = hand.revealed ? room.players.filter((p) =>
    p.id !== me.playerId && p.holeCards && !p.revealedToAll &&
    (p.folded || !hand.revealed.showCards)
  ) : [];
  const quickCardTricks = room.trickMatch?.owned.filter((trick) => trick.available &&
    ['discard_all', 'strategy_card', 'retention_common', 'retention_rare',
      'retention_epic', 'retention_legendary'].includes(trick.id)) || [];

  function peekCostFor(targetId) {
    const isWinner = !!hand.revealed?.pots.some((pot) => pot.winnerIds.includes(targetId));
    return isWinner ? room.bigBlind : room.smallBlind;
  }

  function canPeekTarget(player) {
    if (hand.stage !== 'SHOWDOWN' || !myPlayer || player.id === me.playerId || player.peekedByMe) {
      return false;
    }
    const isWinner = !!hand.revealed?.pots.some((pot) => pot.winnerIds.includes(player.id));
    const alreadyPublic = hand.revealed?.showCards && !player.folded;
    if (alreadyPublic) return false;
    if (!player.folded && !isWinner) return false;
    return myPlayer.chips >= peekCostFor(player.id);
  }

  const sbPlayer = room.players.find((p) => p.id === room.sbPlayerId);
  const bbPlayer = room.players.find((p) => p.id === room.bbPlayerId);

  const [gestures, setGestures] = useState([]);

  useEffect(() => {
    const onGesture = ({ type, icon, from, to }) => {
      const fromSeat = seats.find((s) => s.player.id === from);
      const toSeat = to ? seats.find((s) => s.player.id === to) : null;
      if (!fromSeat) return;
      const key = Date.now() + Math.random();
      setGestures((g) => [...g, { key, type, icon, fromSeat, toSeat }]);
      setTimeout(() => setGestures((g) => g.filter((x) => x.key !== key)), type === 'gift' ? 3900 : 2200);
    };
    socket.on('gesture', onGesture);
    return () => socket.off('gesture', onGesture);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.players.map((p) => p.id).join(',')]);

  const [speechEnabled, setSpeechEnabled] = useSetting('speech');
  const prevActionsRef = useRef({});
  useEffect(() => {
    if (!speechEnabled) {
      room.players.forEach((p) => {
        prevActionsRef.current[p.id] = p.lastAction;
      });
      return;
    }
    room.players.forEach((p) => {
      const prev = prevActionsRef.current[p.id];
      if (p.lastAction && p.lastAction !== prev) {
        speakAction(p);
      }
      prevActionsRef.current[p.id] = p.lastAction;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.players, speechEnabled]);

  // Declared after the action announcements so a new street is queued behind the action.
  const lastStageRef = useRef(hand.stage);
  useEffect(() => {
    if (hand.stage !== lastStageRef.current) speakStreet(hand.stage);
    lastStageRef.current = hand.stage;
  }, [hand.stage]);

  function toggleSpeech() {
    setSpeechEnabled(!speechEnabled);
  }

  const playedOutcomeSoundRef = useRef(null);
  useEffect(() => {
    // Announcement and win/lose sting each check their own setting.
    if (!hand.revealed || winners.length === 0) return;
    if (playedOutcomeSoundRef.current === room.dealerSeat) return;
    playedOutcomeSoundRef.current = room.dealerSeat;

    const iPlayed = !!myPlayer?.holeCards;
    const iWon = iPlayed && winners.some((w) => w.id === myPlayer.id);
    speakOutcome(winners.map((w) => ({ name: room.players.find((pl) => pl.id === w.id)?.name, amount: w.netAmount, handName: w.handName })), { iPlayed, iWon });
    if (iPlayed) {
      if (iWon) playVictorySound();
      else playBooSound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand.revealed, room.dealerSeat]);

  function sendGift(targetId, icon) {
    socket.emit('send_gesture', { type: 'gift', icon, targetId });
  }

  function startCardTargeting(trickId) {
    if (TABLE_DIRECT_TRICKS.has(trickId)) {
      setShowTrickPanel(false);
      onUseTrick(trickId);
      return;
    }
    if (TABLE_CHOICE_TRICKS.has(trickId)) {
      setTableChoiceIndexes([]);
      setCardTargeting({ trickId, step: 'choice' });
      setShowTrickPanel(false);
      onUseTrick(trickId, {}, (ok) => {
        if (!ok) setCardTargeting(null);
      });
      return;
    }
    setCardTargeting({ trickId, step: ['exchange', 'discard_all'].includes(trickId)
      ? 'self' : 'target', myCardIndex: null });
    setShowTrickPanel(false);
  }

  function toggleTableChoice(index) {
    const needed = ORDERED_CHOICES[cardTargeting?.trickId]?.length || 2;
    setTableChoiceIndexes((current) => current.includes(index)
      ? current.filter((item) => item !== index)
      : [...current.slice(-(needed - 1)), index]);
  }

  function confirmTableChoice() {
    const trickId = cardTargeting?.trickId;
    if (!TABLE_CHOICE_TRICKS.has(trickId)) return;
    onUseTrick(trickId, { choiceIndexes: tableChoiceIndexes }, (ok) => {
      if (ok) {
        setCardTargeting(null);
        setTableChoiceIndexes([]);
      }
    });
  }

  function handleCardTarget(playerId, index) {
    if (!cardTargeting) return;
    if (['exchange', 'discard_all'].includes(cardTargeting.trickId) &&
        cardTargeting.step === 'self') {
      setCardTargeting({ ...cardTargeting, step: 'target', myCardIndex: index });
      return;
    }
    const trickId = cardTargeting.trickId;
    const targetsOpponent = playerId !== me.playerId;
    const options = OWN_CARD_TRICKS.has(trickId)
      ? { cardIndex: index }
      : {
          targetId: targetsOpponent ? playerId : undefined,
          ...(['exchange', 'discard_all'].includes(trickId) ? {
            myCardIndex: cardTargeting.myCardIndex, cardIndex: index,
            both: cardTargeting.both } : {}),
          ...(['peek_one', 'steal_hole'].includes(trickId) ? { cardIndex: index } : {}),
          ...(trickId === 'guess_holes' ? { ranks: guessedRanks } : {}),
        };
    if (!targetsOpponent && !OWN_CARD_TRICKS.has(trickId)) return;
    if (['discard_both', 'discard_all'].includes(trickId)) {
      const target = room.players.find((player) => player.id === playerId);
      if (!target?.folded) return;
    }
    if (trickId === 'forced_fold' && !room.trickMatch?.forcedFoldTargets?.includes(playerId)) return;
    if (trickId === 'steal_hole' && room.players.find((player) => player.id === playerId)?.folded) return;
    onUseTrick(trickId, options, (ok) => {
      if (ok) setCardTargeting(null);
    });
  }

  function cardRoleFor(player) {
    if (!cardTargeting) return null;
    if (cardTargeting.step === 'choice') return null;
    if (cardTargeting.step === 'self') return player.id === me.playerId ? 'self' : null;
    if (OWN_CARD_TRICKS.has(cardTargeting.trickId)) return player.id === me.playerId ? 'self' : null;
    if (player.id === me.playerId || !CARD_TARGET_TRICKS.has(cardTargeting.trickId)) return null;
    if (cardTargeting.trickId === 'forced_fold' && !room.trickMatch?.forcedFoldTargets?.includes(player.id)) return null;
    if (['exchange', 'steal_hole'].includes(cardTargeting.trickId) && player.allIn) return null;
    return 'target';
  }

  function handlePeek(targetId) {
    const targetSeat = seats.find((s) => s.player.id === targetId);
    if (targetSeat) {
      setPeekFly({ key: Date.now(), style: targetSeat.style, cost: peekCostFor(targetId) });
      setTimeout(() => setPeekFly(null), 900);
    }
    onPeek(targetId);
  }


  return (
    <div className="table-view" data-hand-style={handStyle} style={{ '--hand-art': `url("${handArt}")` }}>
      <header className="table-header">
        <div className="table-room-info"><strong>{room.code}</strong>
          <span className="table-street-badge">{{ PREFLOP: '翻牌前', FLOP: '翻牌', TURN: '转牌', RIVER: '河牌', SHOWDOWN: '摊牌' }[hand.stage] || '牌局中'}</span>
          {room.trickMatch && <span className="table-hand-count">{`第 ${room.trickMatch.handNumber}/16 局`}</span>}
          {!room.trickMatch && room.handLimit && <span className="table-hand-count">{`第 ${room.handNumber}/${room.handLimit} 局`}</span>}
          <span>盲注 {room.smallBlind}/{room.bigBlind}</span>
        </div>
        <div className="table-tools" aria-label="牌桌工具">
          <span className="voice-slot" ref={voiceSlotRef} />
          <button className="table-theme-btn" onClick={onOpenFriends}><ToolIcon name="friends" />好友</button>
          {room.trickMatch && <button className="table-theme-btn trick-tool-btn" onClick={() => setShowTrickCatalog(true)}>
            <ToolIcon name="book" />千术图鉴
          </button>}
          <button className="table-theme-btn" onClick={() => setShowSettings(true)}>
            <ToolIcon name="settings" />设置
          </button>
          <button className="hand-rankings-btn" onClick={() => setShowRankings(true)}>
            <ToolIcon name="ranks" />牌谱
          </button>
          {isSpeechAvailable() && (
            <button className="table-icon-btn" onClick={toggleSpeech} title="语音播报"
              aria-label={speechEnabled ? '关闭语音播报' : '开启语音播报'} aria-pressed={speechEnabled}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 9h4l5-4v14l-5-4H4z" />
                {speechEnabled ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}
              </svg>
            </button>
          )}
          {isHost && room.players.filter((p) => !p.kicked).length < 10 && (
            <button type="button" className="table-theme-btn add-bot-btn" onClick={onAddBot}
              title="测试机器人：能过牌就过牌，遇到下注就弃牌；下一局入座">+ 机器人</button>
          )}
          {isHost && (
            <button type="button" className="leave-room-btn end-game-btn" onClick={onReturnToLobby}><ToolIcon name="back" />返回大厅</button>
          )}
        </div>
      </header>
      {showTrickCatalog && <TrickCatalog onClose={() => setShowTrickCatalog(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {profilePlayer && room.players.some((p) => p.id === profilePlayer) && (
        <PlayerProfile player={room.players.find((p) => p.id === profilePlayer)}
          onClose={() => setProfilePlayer(null)} />
      )}
      {showTrickPanel && <TrickPanel room={room} playerId={me.playerId} onUse={onUseTrick}
        onStartCardTargeting={startCardTargeting} onClose={() => setShowTrickPanel(false)} />}
      {quickCardTricks.length > 0 && !cardTargeting && (
        <div className="trick-quick-actions" aria-label="可在牌桌使用的换牌千术">
          {quickCardTricks.map((trick) => <button type="button" key={trick.id}
            onClick={() => startCardTargeting(trick.id)}>{trick.name}：选牌</button>)}
        </div>
      )}
      {cardTargeting && <div className="trick-target-prompt" role="status">
        <span>{cardTargeting.step === 'choice'
          ? cardTargeting.trickId === 'control_five'
            ? '控牌：按顺序选出转牌、河牌'
            : cardTargeting.trickId === 'control_flop'
              ? '定江山：按顺序选出三张翻牌'
              : '留底／换底：在牌桌上选两张牌作为底牌'
          : cardTargeting.trickId === 'exchange' && cardTargeting.step === 'self'
          ? '调包：先点击你要交换的底牌'
          : cardTargeting.trickId === 'exchange'
            ? `调包：已选你的${cardTargeting.myCardIndex === 0 ? '左' : '右'}牌，再点击对手的一张底牌`
            : OWN_CARD_TRICKS.has(cardTargeting.trickId)
              ? '点击你要替换的那张底牌'
              : cardTargeting.trickId === 'guess_holes'
                ? '先选两个点数，再点击目标玩家的底牌确认猜测'
              : ['blind_next', 'mental_block'].includes(cardTargeting.trickId)
                ? '点击目标玩家的任一张底牌，指定作用对象'
              : '点击目标玩家的一张底牌'}
        </span>
        {cardTargeting.trickId === 'guess_holes' && [0, 1].map((index) => (
          <label key={index}>{`第 ${index + 1} 张`}
            <select value={guessedRanks[index]} onChange={(event) => setGuessedRanks((current) =>
              current.map((rank, i) => i === index ? event.target.value : rank))}>
              {'23456789TJQKA'.split('').map((rank) =>
                <option key={rank} value={rank}>{rank === 'T' ? '10' : rank}</option>)}
            </select>
          </label>
        ))}
        {cardTargeting.trickId === 'exchange' && cardTargeting.step === 'target' && (
          <button type="button" onClick={() => setCardTargeting({ ...cardTargeting, both: !cardTargeting.both })}>
            {cardTargeting.both ? '已选两张全换' : '切换为两张全换'}
          </button>
        )}
        {cardTargeting.trickId === 'strategy_card' && hand.stage === 'TURN' && (
          <button type="button" onClick={() => {
            onUseTrick('strategy_card', { river: true }, (ok) => {
              if (ok) setCardTargeting(null);
            });
          }}>指定下一张河牌</button>
        )}
        <button type="button" onClick={() => setCardTargeting(null)}>取消</button>
      </div>}
      {cardTargeting?.step === 'choice' && room.trickMatch?.pendingChoice?.trickId === cardTargeting.trickId && (
        <div className="trick-board-choice" role="dialog" aria-label="选择千术候选牌">
          <div className="trick-board-choice-head">
            <strong>{room.trickMatch.owned.find((trick) => trick.id === cardTargeting.trickId)?.name}</strong>
            <button type="button" onClick={() => setCardTargeting(null)}>取消</button>
          </div>
          <p>{cardTargeting.trickId === 'control_five'
            ? '先选转牌，再选河牌'
            : cardTargeting.trickId === 'control_flop'
              ? '按翻开的顺序选三张翻牌'
            : room.trickMatch.pendingChoice.river
              ? '选自己一张底牌，再选一张备用牌替换'
              : '从候选牌中选择两张作为底牌'}</p>
          <div className="trick-board-choice-cards">
            {room.trickMatch.pendingChoice.cards.map((card, index) => (
              <button key={index} type="button"
                className={tableChoiceIndexes.includes(index) ? 'chosen' : ''}
                aria-pressed={tableChoiceIndexes.includes(index)}
                aria-label={'选择第 ' + (index + 1) + ' 张牌'}
                onClick={() => toggleTableChoice(index)}>
                <Card code={card} />
                {tableChoiceIndexes.includes(index) && <small>{ORDERED_CHOICES[cardTargeting.trickId]
                  ? ORDERED_CHOICES[cardTargeting.trickId][tableChoiceIndexes.indexOf(index)]
                  : '已选'}</small>}
                {room.trickMatch.pendingChoice.river && <small>{index < 2 ? '现有底牌' : '备用牌'}</small>}
              </button>
            ))}
          </div>
          <button type="button" className="primary" disabled={tableChoiceIndexes.length !== (ORDERED_CHOICES[cardTargeting.trickId]?.length || 2) ||
            (room.trickMatch.pendingChoice.river &&
              !(tableChoiceIndexes.some((index) => index < 2) &&
                tableChoiceIndexes.some((index) => index >= 2)))}
            onClick={confirmTableChoice}>
            确认选择
          </button>
        </div>
      )}
      {room.trickMatch?.forcedFold && <div className="trick-target-prompt buyout-alert" role="alert">
        你中了{room.trickMatch.forcedFold.type === 'guess' ? '管中窥豹' : '赠筹·买断'}：轮到你行动时只能弃牌。
      </div>}
      {intelToast && <div className="trick-intel-toast" role="status">
        {intelToast.message || intelToast.view.label}
        {intelToast.view && <div className="trick-intel-toast-cards">
          {intelToast.view.cards.map((card, index) => <Card code={card} key={index} />)}
        </div>}
      </div>}
      <div className={`table-felt${room.players.length > 6 ? ' crowded' : ''}${hand.revealed ? ' showdown' : ''}`}
        data-table-theme={tableTheme}>
        <div className="community">
          {[0, 1, 2, 3, 4].map((i) => {
            const code = hand.community[i] || null;
            // flop's 3 cards flip open one after another; turn/river flip alone
            const streetDelay = i < 3 ? i * 0.35 : 0;
            return (
              <Card
                key={`${room.dealerSeat}-community-${i}-${code ? 'shown' : 'hidden'}`}
                code={code}
                delay={code ? streetDelay : 0}
              />
            );
          })}
        </div>
        <div className="pot"><span>底池</span><strong>{hand.pot.toLocaleString()}</strong></div>
        {primarySeat && (
          <div
            key={hand.stage}
            className="pot-fly"
            style={{ '--target-left': primarySeat.style.left, '--target-top': primarySeat.style.top }}
          >
            <span className="chip-token" />
            {hand.pot}
          </div>
        )}
        <div className="deck-pile" key={room.dealerSeat}>
          <Card code={null} extraClass="deck-card" />
          <Card code={null} extraClass="deck-card" />
          <Card code={null} extraClass="deck-card" />
        </div>
        {seats.map(({ player, style, dealFrom }, seatIdx) => player.id === me.playerId ? null : (
          <Seat
            key={player.id}
            player={player}
            isMe={player.id === me.playerId}
            isDealer={player.seat === room.dealerSeat}
            isSmallBlind={player.id === room.sbPlayerId}
            isBigBlind={player.id === room.bbPlayerId}
            isActing={hand.actingPlayerId === player.id}
            isShowdown={hand.stage === 'SHOWDOWN'}
            dealKey={room.dealerSeat}
            dealDelay0={0.5 + seatIdx * 0.4}
            dealDelay1={0.5 + seats.length * 0.4 + seatIdx * 0.4}
            dealFrom={dealFrom}
            style={style}
            menu={player.id === me.playerId ? null : {
              onProfile: () => setProfilePlayer(player.id),
              onAddFriend: player.bot ? null : () => onAddFriend(player.id),
              onGift: (icon) => sendGift(player.id, icon),
              onKick: isHost && !player.kicked ? () => onKick(player.id) : null,
              // Chips can be topped up only on the settlement screen, as the server requires.
              onRebuy: isHost && player.eliminated && !player.kicked && hand.stage === 'SHOWDOWN' && hand.revealed &&
                !matchOver ? () => onRebuy(player.id) : null,
            }}
            canReveal={player.id === me.playerId && player.folded && !player.revealedToAll}
            onReveal={onReveal}
            cardSelectionRole={cardRoleFor(player)}
            selectedCardIndex={cardTargeting?.trickId === 'exchange' && player.id === me.playerId
              ? cardTargeting.myCardIndex : null}
            onSelectCard={cardTargeting ? handleCardTarget : null}
          />
        ))}
        {gestures.map((g) =>
          g.type === 'emote' ? (
            <div key={g.key} className="emote-bubble" style={g.fromSeat.style}>
              <img src={emojiIconSrc(g.icon)} alt={g.icon} className="emoji-icon" draggable={false} />
            </div>
          ) : (
            <div
              key={g.key}
              className="pot-fly gift-fly"
              style={{
                '--target-left': (g.toSeat || g.fromSeat).style.left,
                '--target-top': (g.toSeat || g.fromSeat).style.top,
                left: g.fromSeat.style.left,
                top: g.fromSeat.style.top,
              }}
            >
              <img src={emojiIconSrc(g.icon)} alt={g.icon} className="emoji-icon" draggable={false} />
            </div>
          )
        )}
        {peekFly && (
          <div
            key={peekFly.key}
            className="pot-fly peek-fly"
            style={{ '--target-left': peekFly.style.left, '--target-top': peekFly.style.top }}
          >
            <span className="chip-token" />
            {peekFly.cost}
          </div>
        )}
      </div>

      {myPlayer && <Seat
        key={myPlayer.id}
        player={myPlayer}
        isMe
        isDealer={myPlayer.seat === room.dealerSeat}
        isSmallBlind={myPlayer.id === room.sbPlayerId}
        isBigBlind={myPlayer.id === room.bbPlayerId}
        isActing={hand.actingPlayerId === myPlayer.id}
        isShowdown={hand.stage === 'SHOWDOWN'}
        dealKey={room.dealerSeat}
        dealDelay0={0.25}
        dealDelay1={0.55}
        canReveal={myPlayer.folded && !myPlayer.revealedToAll}
        onReveal={onReveal}
        cardSelectionRole={cardRoleFor(myPlayer)}
        selectedCardIndex={cardTargeting?.trickId === 'exchange' ? cardTargeting.myCardIndex : null}
        onSelectCard={cardTargeting ? handleCardTarget : null}
        onTrick={room.trickMatch ? () => setShowTrickPanel(true) : null}
      />}

      {hand.revealed && (
        <section className={`showdown-banner${settlementFolded ? ' folded' : ''}`} aria-label="本局结算">
          <div className="showdown-head">
            <h2>{matchOver ? '最终结算' : '本局结算'}</h2>
            <button type="button" className="showdown-fold" aria-expanded={!settlementFolded}
              onClick={() => setSettlementFolded((folded) => !folded)}>{settlementFolded ? '展开' : '收起'}</button>
          </div>
          {settlementFolded ? (
            <p className="showdown-summary">
              {winners.map((w) => `${room.players.find((pl) => pl.id === w.id)?.name} ${w.handName ? translateHandName(w.handName) : '其他玩家弃牌'} 分得 ${w.amount}`).join('；')}
            </p>
          ) : <>
          {winners.map((w) => (
            <div key={w.id} className="settlement-row">
              <span className="settlement-player">{room.players.find((pl) => pl.id === w.id)?.name}
                <small>{w.handName ? translateHandName(w.handName) : '其他玩家弃牌'}</small>
                {w.cards && (
                  <span className="settlement-cards" aria-label={`${translateHandName(w.handName)}：${w.cards.join(' ')}`}>
                    {w.cards.map((code) => <Card key={code} code={code} extraClass="card-revealed" />)}
                  </span>
                )}
              </span>
              <span className="settlement-amount">分得 {w.amount}
                <small>本局净{w.netAmount >= 0 ? '赢' : '输'} {Math.abs(w.netAmount)}</small>
              </span>
            </div>
          ))}
          {peekTargets.length > 0 && (
            <div className="settlement-peek">
              <p>查看底牌</p>
              <div className="settlement-peek-grid">
                {peekTargets.map((p) => (
                  p.peekedByMe ? (
                    <span key={p.id} className="settlement-peek-viewed">{p.name}<span>✓ 已查看</span></span>
                  ) : (
                    <button key={p.id} className="settlement-peek-btn" disabled={!canPeekTarget(p)}
                      aria-label={`查看 ${p.name} 的底牌，花费 ${peekCostFor(p.id)} 筹码`}
                      onClick={() => handlePeek(p.id)}>
                      <span>{p.name} 的底牌</span><strong>{peekCostFor(p.id)} 筹码</strong>
                    </button>
                  )
                ))}
              </div>
            </div>
          )}
          {room.trickMatch?.ended && (
            <div className="trick-final-loadouts">
              <h3>全桌千术公开</h3>
              {[...room.trickMatch.finalLoadouts].sort((a, b) => b.chips - a.chips).map((player, index) => (
                <div className="trick-final-player" key={player.playerId}>
                  <span><strong>#{index + 1} {player.name}</strong><small>{player.chips} 筹码</small></span>
                  <div>{player.tricks.map((trick) => <span key={trick.id} className={`rarity-${trick.rarity}`}>{trick.name}</span>)}</div>
                </div>
              ))}
            </div>
          )}
          {!matchOver && room.players.some((p) => p.eliminated && !p.kicked) && (
            <div className="settlement-rebuys">
              <p>补筹码</p>
              {room.players.filter((p) => p.eliminated && !p.kicked).map((p) => (
                <div key={p.id} className="settlement-row">
                  <span className="settlement-player">{p.name}<small>剩余 {p.chips} 筹码</small></span>
                  {isHost ? (
                    <button className="settlement-rebuy-btn" onClick={() => onRebuy(p.id)} aria-label={`给 ${p.name} 补至 ${room.buyIn} 筹码`}>
                      补至 {room.buyIn}
                    </button>
                  ) : <span className="waiting-note">等待房主补筹码</span>}
                </div>
              ))}
            </div>
          )}
          </>}
          {room.handReplayed && <p className="waiting-note">{`本局不计入局数，下一局仍是第 ${room.handNumber} 局`}</p>}
          {!room.awaitingContinue && <p className="waiting-note">{matchOver ? '牌局结束，45 秒后返回大厅' : '45 秒后返回大厅'}</p>}
          {room.awaitingContinue && (
            <div className="continue-gate">
              {iAmWaitingForNextHand ? (
                <span className="waiting-note">本局已结束，下一局自动入座</span>
              ) : myPlayer?.eliminated ? (
                <span className="waiting-note">你已出局</span>
              ) : (
                <button className="primary" disabled={iAmReady} onClick={onReady}>
                  {iAmReady ? '已确认，等待其他玩家' : '继续下一局'}
                </button>
              )}
              <span className="waiting-note">
                {awaitedPlayers.filter((p) => room.readyPlayerIds.includes(p.id)).length}/{awaitedPlayers.length} 已确认
              </span>
            </div>
          )}
        </section>
      )}


      <ActionBar
        room={room}
        me={me}
        onAction={onAction}
        handRankLabel={
          myPlayer?.handRank && !hand.revealed ? translateHandName(myPlayer.handRank) : null
        }
      />
      {!hand.revealed && hand.actingPlayerId !== me.playerId && <TurnWait hand={hand} players={room.players} />}

      <RoomChat me={me} />
      {showRankings && <HandRankings onClose={() => setShowRankings(false)} />}
    </div>
  );
}
