import { useEffect, useRef, useState } from 'react';
import { speakTimeWarning } from '../speech';

const CHIP_VALUES = [10, 20, 50, 100, 200, 500, 1000];

export default function ActionBar({ room, me, onAction, handRankLabel }) {
  const hand = room.hand;
  const [raiseAccum, setRaiseAccum] = useState(0);
  const [showRaise, setShowRaise] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);

  const myPlayer = room.players.find((p) => p.id === me.playerId);
  const isMyTurn = hand?.actingPlayerId === me.playerId;

  useEffect(() => {
    if (!hand?.turnDeadline) return;
    const tick = () => setRemainingMs(Math.max(0, hand.turnDeadline - Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [hand?.turnDeadline]);

  useEffect(() => {
    setRaiseAccum(0);
    setShowRaise(false);
  }, [isMyTurn, hand?.stage]);

  // One warning per turn, as the clock crosses ten seconds.
  const warnedRef = useRef(null);
  useEffect(() => {
    if (!isMyTurn || !hand?.turnDeadline || warnedRef.current === hand.turnDeadline) return;
    const left = (hand.turnDeadline - Date.now()) / 1000;
    if (left <= 10 && left > 8) {
      warnedRef.current = hand.turnDeadline;
      speakTimeWarning();
    }
  }, [isMyTurn, hand?.turnDeadline, remainingMs]);

  if (!isMyTurn || !myPlayer) return null;

  const actions = hand.legalActions || [];
  const seconds = Math.ceil(remainingMs / 1000);

  const minRaiseSize = hand.minRaise;
  const maxRaiseSize = actions.includes('raise') ? hand.maxRaiseTo - hand.currentBet : 0;
  const minRaiseTo = hand.currentBet + minRaiseSize;
  const maxRaiseTo = hand.currentBet + maxRaiseSize;
  const raiseTo = hand.currentBet + raiseAccum;
  const canConfirmRaise = raiseAccum >= minRaiseSize && raiseAccum <= maxRaiseSize;

  return (
    <div className={`action-bar${seconds <= 10 ? ' action-bar-urgent' : ''}`}>
      <div className="action-heading">
        <div><strong>轮到你行动</strong>{handRankLabel && <span className="hand-rank-badge">{handRankLabel}</span>}</div>
        <span>筹码 <b>{myPlayer.chips.toLocaleString()}</b></span>
      </div>
      {hand.raiseBlockedReason && <p className="action-rule-note">{hand.raiseBlockedReason}</p>}
      <div className="timer-row">
        <div className="timer-bar">
          <div
            className="timer-fill"
            style={{ width: `${Math.min(100, (remainingMs / ((hand.turnSeconds || 30) * 1000)) * 100)}%` }}
          />
        </div>
        <span className="timer-count">{seconds}s</span>
      </div>
      <div className="action-buttons">
        {actions.includes('fold') && (
          <button className="danger" onClick={() => onAction('fold')}>
            弃牌
          </button>
        )}
        {actions.includes('check') && (
          <button onClick={() => onAction('check')}>过牌</button>
        )}
        {actions.includes('call') && (
          <button onClick={() => onAction('call')}>跟注 {Math.min(hand.toCall, myPlayer.chips)}{hand.toCall >= myPlayer.chips ? '（全下）' : ''}</button>
        )}
        {actions.includes('raise') && (
          <button className={`raise-toggle${showRaise ? ' active' : ''}`} aria-expanded={showRaise}
            onClick={() => setShowRaise((open) => !open)}>
            加注
          </button>
        )}
        {actions.includes('allin') && (
          <button className="allin" onClick={() => onAction('allin')}>
            全下 {hand.allInTo ?? myPlayer.chips + myPlayer.betThisRound}
          </button>
        )}
      </div>
      {actions.includes('raise') && showRaise && (
        <div className="raise-controls">
          {raiseAccum > 0 && (
            <div className="raise-summary"><span>加注到 <strong>{raiseTo}</strong></span><span>需投入 {Math.max(0, raiseTo - myPlayer.betThisRound)}</span></div>
          )}
          <div className="raise-presets" aria-label="快捷选择加注金额">
            <button onClick={() => setRaiseAccum(minRaiseSize)}>最小 {minRaiseTo}</button>
            <button onClick={() => setRaiseAccum(maxRaiseSize)}>最大 {maxRaiseTo}</button>
          </div>
          <div className="chip-row">
            {CHIP_VALUES.map((v) => (
              <button
                key={v}
                className="chip-btn"
                disabled={raiseAccum + v > maxRaiseSize}
                onClick={() => setRaiseAccum((a) => a + v)}
              >
                +{v}
              </button>
            ))}
            <button className="link-btn" onClick={() => setRaiseAccum(0)}>
              重置
            </button>
          </div>
          <button className="primary" disabled={!canConfirmRaise} onClick={() => onAction('raise', raiseTo)}>
            {raiseAccum > 0 ? `加注到 ${raiseTo}` : '选择加注金额'}
          </button>
        </div>
      )}
    </div>
  );
}
