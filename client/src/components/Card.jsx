import { useTheme } from '../ThemeContext';

const SUIT_SYMBOL = { h: '♥', d: '♦', c: '♣', s: '♠' };
const RED_SUITS = new Set(['h', 'd']);
const RANK_LABEL = { T: '10' };

const MINIMAL_SUIT_COLOR = { s: '#eef3ee', h: '#ff5d6c', d: '#ffb545', c: '#4fd7c1' };

export default function Card({ code, delay = 0, extraClass = '', dealFrom = null }) {
  const { cardTheme } = useTheme() || { cardTheme: 'comic' };
  const flyClass = dealFrom ? 'card-fly-deal' : '';
  const style = {
    animationDelay: `${delay}s`,
    ...(dealFrom ? { '--deal-x': `${dealFrom.x}px`, '--deal-y': `${dealFrom.y}px` } : null),
  };

  if (cardTheme === 'illustrated') {
    const src = code ? `/cards/${code}.png` : '/cards/back.png';
    return (
      <img
        className={`card card-illustrated ${code ? 'card-face' : 'card-back'} ${flyClass} ${extraClass}`}
        src={src}
        alt={code || 'card back'}
        draggable={false}
        style={style}
      />
    );
  }

  if (!code) {
    return <div className={`card card-back card-${cardTheme} ${flyClass} ${extraClass}`} style={style} />;
  }
  const rank = code[0];
  const suit = code[1];
  const isRed = RED_SUITS.has(suit);
  return (
    <div
      className={`card card-face card-${cardTheme} ${isRed ? 'card-red' : 'card-black'} ${flyClass} ${extraClass}`}
      style={{ ...style, '--suit-color': MINIMAL_SUIT_COLOR[suit] }}
    >
      <span className="card-rank card-rank-top">{RANK_LABEL[rank] || rank}</span>
      <span className="card-suit">{SUIT_SYMBOL[suit]}</span>
      <span className="card-rank card-rank-bottom">{RANK_LABEL[rank] || rank}</span>
    </div>
  );
}
