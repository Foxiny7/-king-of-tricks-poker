import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSetting } from '../settings';
import { translate } from '../localize';

const RARITIES = [
  { id: 'all', name: '全部' },
  { id: 'common', name: '普通' },
  { id: 'rare', name: '罕见' },
  { id: 'epic', name: '史诗' },
  { id: 'legendary', name: '传说' },
];
const RARITY_NAME = Object.fromEntries(RARITIES.slice(1).map(({ id, name }) => [id, name]));
const RARITY_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3 };

export default function TrickCatalog({ onClose }) {
  const [language] = useSetting('language');
  const dialogRef = useRef(null);
  const [catalog, setCatalog] = useState([]);
  const [rarity, setRarity] = useState('all');
  const [query, setQuery] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    fetch('/tricks').then((response) => {
      if (!response.ok) throw new Error('catalog unavailable');
      return response.json();
    }).then(setCatalog).catch(() => setLoadFailed(true));
    return () => dialog.close();
  }, []);

  const visibleTricks = useMemo(() => catalog.filter((trick) =>
    (rarity === 'all' || trick.rarity === rarity) &&
    `${trick.name} ${trick.description} ${trick.family} ${language === 'en' ? `${translate(trick.name)} ${translate(trick.description)}` : ''}`.toLowerCase().includes(query.trim().toLowerCase())
  ).sort((a, b) => a.family.localeCompare(b.family, 'zh-CN') ||
    RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity]), [catalog, query, rarity, language]);

  return createPortal(
    <dialog tabIndex={-1} className="trick-panel trick-catalog-panel" ref={dialogRef}
      onClose={() => { if (!dialogRef.current?.open) onClose(); }}
      onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current.close(); }}>
      <div className="trick-panel-body">
        <header className="trick-panel-header">
          <div>
            <h2>千术图鉴</h2>
          </div>
          <button type="button" className="trick-panel-close" onClick={() => dialogRef.current.close()} aria-label="关闭千术图鉴">×</button>
        </header>
        <div className="trick-catalog-controls">
          <div className="trick-catalog-filters" aria-label="按品阶筛选">
            {RARITIES.map((item) => <button key={item.id} type="button"
              className={rarity === item.id ? 'active' : ''} aria-pressed={rarity === item.id}
              onClick={() => setRarity(item.id)}>{item.name}</button>)}
          </div>
          <label className="trick-catalog-search">
            <span className="sr-only">搜索千术</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或效果" />
          </label>
          <span className="trick-catalog-count">{catalog.length ? `${visibleTricks.length} / ${catalog.length} 项` : '载入图鉴…'}</span>
        </div>
        {loadFailed ? <p className="trick-catalog-empty">图鉴暂时无法载入</p> : visibleTricks.length ? (
          <div className="trick-catalog-grid">
            {visibleTricks.map((trick) => (
              <article className={`trick-owned-card trick-catalog-card rarity-${trick.rarity}`} key={trick.id}>
                <span>{RARITY_NAME[trick.rarity]}　{trick.kind === 'passive' ? '被动' : trick.kind === 'change' ? '行动' : '情报'}</span>
                <strong>{trick.name}</strong>
                <p>{trick.description}</p>
                <dl>
                  {(trick.kind !== 'passive' || trick.id === 'strategy_card') &&
                    <div><dt>使用次数</dt><dd>{trick.usage}</dd></div>}
                  <div><dt>{trick.kind === 'passive' ? '生效时机' : '使用条件'}</dt><dd>{trick.condition}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        ) : <p className="trick-catalog-empty">没有找到符合条件的千术</p>}
      </div>
    </dialog>,
    document.body
  );
}
