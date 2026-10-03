import PlayerMenu from './PlayerMenu';
import Card from './Card';
import Avatar from './Avatar';
import PovHands from './PovHands';
import { nameplateProps } from '../nameplates';

const ACTION_LABEL = {
  fold: '弃牌',
  check: '过牌',
  call: '跟注',
  raise: '加注',
  allin: '全下',
};


function ViewCardsIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
}

export default function Seat({
  player,
  isMe,
  isDealer,
  isSmallBlind,
  isBigBlind,
  isActing,
  dealKey,
  dealDelay0 = 0,
  dealDelay1 = 0.08,
  dealFrom,
  style,
  menu,
  isShowdown,
  canReveal,
  onReveal,
  cardSelectionRole,
  selectedCardIndex,
  onSelectCard,
  onTrick,
}) {
  const showFaceUp = isMe || !!player.holeCards?.some(Boolean);
  const inHand = !!player.holeCards;
  const plate = nameplateProps(player.nameplate);

  return (
    <div
      className={[
        'seat',
        isMe ? 'mine' : '',
        isMe && inHand ? 'holding-cards' : '',
        isActing ? 'acting' : '',
        player.folded ? 'folded' : '',
        player.eliminated ? 'eliminated' : '',
        player.waitingForNextHand ? 'waiting-for-next-hand' : '',
        !player.connected ? 'disconnected' : '',
        canReveal ? 'has-card-action' : '',
        player.peekedByMe ? 'has-viewed-cards' : '',
      ].join(' ')}
      style={style}
    >
      {isDealer && <div className="dealer-chip">D</div>}
      {isSmallBlind && <div className="blind-chip sb-chip">SB</div>}
      {isBigBlind && <div className="blind-chip bb-chip">BB</div>}
      <div className="seat-cards">
        {inHand ? (
          <>
            {[0, 1].map((index) => {
              const intel = player.holeCardIntel?.[index];
              const cardShown = isMe || !!player.holeCards[index];
              const card = <span key={`${dealKey}-${index}-${player.holeCards[index] ? 'shown' : 'hidden'}`}
                className="seat-card-wrap">
                <Card code={cardShown ? player.holeCards[index] : null}
                  delay={index === 0 ? dealDelay0 : dealDelay1} dealFrom={isMe ? null : dealFrom}
                  extraClass={`${isShowdown || player.peekedByMe || player.revealedToAll ? 'card-revealed' : ''}${isMe ? ' card-pov-deal' : ''}`} />
                {!cardShown && intel && <span className="card-intel-mark" title="千术情报">
                  {[intel.rank && (intel.rank === 'T' ? '10' : intel.rank), intel.suit, intel.color]
                    .filter(Boolean).join(' · ')}
                </span>}
              </span>;
              if (!cardSelectionRole || !onSelectCard) return card;
              const label = cardSelectionRole === 'self'
                ? `选择你自己的${index === 0 ? '左' : '右'}张底牌`
                : `选择${player.name}的${index === 0 ? '左' : '右'}张底牌`;
              return <button key={`${dealKey}-${index}-target`} type="button"
                className={`seat-card-target${selectedCardIndex === index ? ' chosen' : ''}`}
                aria-label={label} onClick={() => onSelectCard(player.id, index)}>{card}</button>;
            })}
            {isMe && <PovHands key={dealKey} />}
          </>
        ) : (
          <div className="seat-cards-placeholder" />
        )}
      </div>
      <div className={`seat-info ${plate.className}`} style={plate.style}>
        <div className="seat-name">
          <Avatar avatar={player.avatar} name={player.name} className="seat-avatar" />
          <span className="seat-name-text" title={player.name}>{player.name}</span>
        </div>
        <div className="seat-chips">
          {player.kicked
            ? '已被踢出'
            : player.eliminated
            ? `已出局（${player.chips}）`
            : player.waitingForNextHand
            ? '下一局加入'
            : `${player.chips} 筹码`}
        </div>
        {player.lastAction && !player.eliminated && (
          <div className="seat-action">{ACTION_LABEL[player.lastAction]}</div>
        )}
        {onTrick && (
          <button type="button" className="seat-trick-btn" aria-label="打开出千面板" aria-haspopup="dialog" onClick={onTrick}>出千</button>
        )}
      </div>
      {player.betThisRound > 0 && (
        <div className="seat-bet" key={player.betThisRound}>
          <span className="chip-token" />
          {player.betThisRound}
        </div>
      )}
      {menu && <PlayerMenu name={player.name} className="seat-menu" {...menu} />}
      {canReveal && (
        <button className="seat-peek-btn" onClick={onReveal}>
          <span className="seat-peek-label"><ViewCardsIcon />亮底牌</span>
          <span className="seat-peek-hint">全桌可见</span>
        </button>
      )}
    </div>
  );
}
