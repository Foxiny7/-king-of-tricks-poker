import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Card from './Card';

const RARITY = { common: '普通', rare: '罕见', epic: '史诗', legendary: '传说' };
const CARD_TARGET_TRICKS = new Set(['exchange', 'peek_one', 'peek_both', 'peek_rank', 'mark_chosen',
  'reveal_loadout', 'reveal_one', 'intuition', 'discard_both', 'forced_fold', 'suit_or_run',
  'high_probe', 'hand_scent', 'steal_skill', 'steal_hole', 'bottom_deal', 'suit_shift',
  'catch_cheat', 'disable_tricks', 'blindfold', 'discard_all', 'guess_holes', 'strategy_card',
  'blind_next', 'mental_block']);
const TABLE_CHOICE_TRICKS = new Set(['swap_five', 'control_five', 'control_flop', 'retention_common',
  'retention_rare', 'retention_epic', 'retention_legendary']);
const TABLE_DIRECT_TRICKS = new Set(['peek_all', 'blind_box', 'peek_next', 'mark_chosen']);

export default function TrickPanel({ room, playerId, onUse, onStartCardTargeting, onClose }) {
  const ref = useRef(null);
  const [selectedId, setSelectedId] = useState('');
  const [betSuit, setBetSuit] = useState('h');
  const [communityIndex, setCommunityIndex] = useState(0);
  const [lockStreet, setLockStreet] = useState('river');
  const match = room.trickMatch;
  const selected = match.owned.find((trick) => trick.id === selectedId);

  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);

  function selectTrick(trick) {
    setSelectedId(trick.id);
    if (trick.available && (CARD_TARGET_TRICKS.has(trick.id) ||
        TABLE_CHOICE_TRICKS.has(trick.id) || TABLE_DIRECT_TRICKS.has(trick.id))) {
      onStartCardTargeting(trick.id);
    }
  }

  return createPortal(
    <dialog tabIndex={-1} className="trick-panel" ref={ref} onClose={() => { if (!ref.current?.open) onClose(); }}
      onClick={(event) => { if (event.target === ref.current) ref.current.close(); }}>
      <div className="trick-panel-body">
        <header className="trick-panel-header">
          <h2>我的千术</h2>
          <button type="button" className="trick-panel-close" onClick={() => ref.current.close()} aria-label="关闭千术手册">×</button>
        </header>
        <div className="trick-panel-grid">
          {match.owned.map((trick) => {
            const autoPassive = trick.kind === 'passive' && trick.id !== 'strategy_card';
            return (
            <button type="button" key={trick.id}
              className={`trick-owned-card rarity-${trick.rarity} ${selectedId === trick.id ? 'selected' : ''}`}
              onClick={() => selectTrick(trick)}
              aria-pressed={selectedId === trick.id}>
              <span>{RARITY[trick.rarity]}　{trick.id === 'strategy_card' ? '被动（可操作）' : trick.kind === 'passive' ? '被动' : trick.kind === 'change' ? '行动' : '情报'}</span>
              <strong>{trick.name}{trick.borrowed ? '（借用）' : ''}</strong>
              <small>{trick.description}</small>
              {!autoPassive && <small><b>次数</b> {trick.usage}</small>}
              {!autoPassive && <small><b>剩余</b> {trick.remainingUsage}</small>}
              <small><b>触发</b> {trick.condition}</small>
              <em>{autoPassive ? '自动生效' : trick.available
                ? CARD_TARGET_TRICKS.has(trick.id) || TABLE_CHOICE_TRICKS.has(trick.id) || TABLE_DIRECT_TRICKS.has(trick.id)
                  ? '点击后在牌桌上操作' : '可以使用' :
                trick.kind === 'change' && room.hand?.actingPlayerId !== playerId
                  ? '仅轮到你行动时可用' :
                trick.id.startsWith('retention_') && room.hand?.stage !== 'PREFLOP'
                  ? '仅翻牌前自己的行动回合可选底牌' :
                trick.id === 'discard_all' && !room.players.some((p) => p.id !== playerId && p.folded && p.revealedToAll)
                  ? '本局还没有可换入的已弃底牌' :
                trick.id === 'drain_quarter' && room.hand?.pot < 20
                  ? '可抽取筹码不足 10' : '当前不满足使用条件或次数已用完'}</em>
            </button>
            );
          })}
        </div>
        {selected && selected.kind !== 'passive' && !CARD_TARGET_TRICKS.has(selected.id) &&
          !TABLE_CHOICE_TRICKS.has(selected.id) && !TABLE_DIRECT_TRICKS.has(selected.id) && (
          <div className="trick-panel-activate">
            {selected.id === 'color_bet' && (
              <label>猜河牌花色
                <select value={betSuit} onChange={(event) => setBetSuit(event.target.value)}>
                  <option value="h">红桃</option><option value="d">方块</option>
                  <option value="c">梅花</option><option value="s">黑桃</option>
                </select>
              </label>
            )}
            {selected.id === 'ban_pairs' && (
              <label>指定已翻出的公共牌
                <select value={communityIndex} onChange={(event) => setCommunityIndex(Number(event.target.value))}>
                  {(room.hand?.community || []).map((card, index) =>
                    <option key={index} value={index}>{index + 1} · {card?.[0] || '未翻出'}</option>)}
                </select>
              </label>
            )}
            {selected.id === 'immovable' && (
              <label>锁定的公共牌
                <select value={lockStreet} onChange={(event) => setLockStreet(event.target.value)}>
                  <option value="turn">转牌</option><option value="river">河牌</option>
                </select>
              </label>
            )}
            <button type="button" className="primary" disabled={!selected.available}
              onClick={() => onUse(selected.id, selected.id === 'color_bet' ? { suit: betSuit } :
                selected.id === 'ban_pairs' ? { communityIndex } :
                selected.id === 'immovable' ? { street: lockStreet } : {})}>
              使用 {selected.name}
            </button>
          </div>
        )}
        {(match.messages.length > 0 || match.views.length > 0 || match.publicAnnouncements?.length > 0) && (
          <section className="trick-panel-intel" aria-labelledby="trick-intel-title">
            <h3 id="trick-intel-title">本局情报</h3>
            {match.publicAnnouncements?.map((message, index) =>
              <p key={`public-${index}-${message}`}>{message}</p>)}
            {match.messages.map((message, index) => <p key={`${index}-${message}`}>{message}</p>)}
            {match.views.map((view, index) => (
              <div className="trick-intel-view" key={`${index}-${view.label}`}>
                <span>{view.label}</span><div>{view.cards.map((card, i) => <Card code={card} key={`${card}-${i}`} />)}</div>
              </div>
            ))}
          </section>
        )}
      </div>
    </dialog>,
    document.body
  );
}
