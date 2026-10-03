import { useState } from 'react';
import GameWindow from './GameWindow';
import PovHands from './PovHands';
import { useTheme } from '../ThemeContext';
import { CARD_THEMES, TABLE_THEMES, HAND_STYLES } from '../themes';

const TABS = [
  { id: 'card', label: '卡牌' },
  { id: 'table', label: '牌桌' },
  { id: 'hand', label: '持牌视角' },
];

function CardPreview({ theme }) {
  if (theme.backImage) return <span className="theme-card-preview theme-card-preview-art" style={{ backgroundImage: `url(${theme.backImage})` }} />;
  return <img className="theme-card-preview theme-card-preview-img" src="/cards/back.png" alt="" draggable={false} />;
}

// 藏品, from the title screen: the one place the player picks card backs, the table and the hands.
export default function Collection({ onClose }) {
  const { cardTheme, tableTheme, handStyle, setCardTheme, setTableTheme, setHandStyle, surpriseMe } = useTheme();
  const [tab, setTab] = useState('card');
  const themes = tab === 'card' ? CARD_THEMES : TABLE_THEMES;
  const current = tab === 'card' ? cardTheme : tableTheme;
  const choose = tab === 'card' ? setCardTheme : setTableTheme;

  return (
    <GameWindow title="藏品" tabs={TABS} tab={tab} onTab={setTab} onClose={onClose} className="profile-window collection-window">
      <div className="window-subtabs">
        <button type="button" className="window-subtabs-action" onClick={surpriseMe}>随机搭配</button>
      </div>
      {tab === 'hand' ? (
        <div className="hand-style-grid">
          {HAND_STYLES.map((style) => <button key={style.id} type="button"
            className={`hand-style-option${handStyle === style.id ? ' active' : ''}`}
            aria-pressed={handStyle === style.id} onClick={() => setHandStyle(style.id)}>
            <span className="hand-style-preview" data-hand-style={style.id} style={{ '--hand-art': `url("${style.image}")` }}>
              <span className="hand-style-preview-cards"><i>A♠</i><i>K♥</i></span>
              <PovHands />
            </span>
            <span>{style.name}</span>
          </button>)}
        </div>
      ) : (
        <div className="theme-swatch-row">
          {themes.map((theme) => (
            <button key={theme.id} type="button" className={`theme-swatch ${current === theme.id ? 'active' : ''}`}
              aria-pressed={current === theme.id} onClick={() => choose(theme.id)}>
              {tab === 'card'
                ? <CardPreview theme={theme} />
                : <span className="theme-table-preview" style={{ background: `url(${theme.image}) center / cover` }} />}
              <span>{theme.name}</span>
            </button>
          ))}
        </div>
      )}
    </GameWindow>
  );
}
